begin;

create table private.project_positioning_versions (
  version_id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  engagement_id uuid not null,
  version_number bigint not null check (version_number > 0),
  prior_version_id uuid references private.project_positioning_versions(version_id),
  binding_id uuid not null references private.project_foundation_brief_bindings(request_id),
  actor_id uuid not null,
  conversation_id uuid not null,
  source_message_id uuid not null references public.department_chat_messages(id),
  approval_message_id uuid not null references public.department_chat_messages(id),
  wording text not null check (char_length(btrim(wording)) > 0 and char_length(wording) <= 80000),
  wording_sha256 text not null check (wording_sha256 = encode(sha256(convert_to(wording,'UTF8')),'hex')),
  unique (organization_id,project_id,engagement_id,version_number),
  foreign key (conversation_id,organization_id,project_id,actor_id)
    references public.department_chat_conversations(id,organization_id,project_id,owner_id)
);
create index positioning_prior_version_idx on private.project_positioning_versions(prior_version_id);
create index positioning_binding_idx on private.project_positioning_versions(binding_id);
create index positioning_source_idx on private.project_positioning_versions(source_message_id);
create index positioning_approval_idx on private.project_positioning_versions(approval_message_id);
create index positioning_conversation_idx on private.project_positioning_versions(conversation_id,organization_id,project_id,actor_id);
alter table private.project_positioning_versions enable row level security;
revoke all on private.project_positioning_versions from public,anon,authenticated,service_role;
create trigger preserve_positioning_version before update or delete on private.project_positioning_versions
  for each row execute function private.n1b_preserve_receipt();

create function private.positioning_version_metadata(v private.project_positioning_versions)
returns jsonb language sql stable strict security invoker set search_path='' as $$
  select jsonb_build_object('version_id',v.version_id,'version_number',v.version_number,
    'binding_id',v.binding_id,'wording_sha256',v.wording_sha256,
    'conversation_id',case when auth.uid()=v.actor_id then v.conversation_id end)
$$;
revoke all on function private.positioning_version_metadata(private.project_positioning_versions)
  from public,anon,authenticated,service_role;

create function public.read_project_positioning_output(p_organization_id uuid,p_project_id uuid,
  p_engagement_id uuid,p_conversation_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare
  project public.projects;
  live_binding uuid;
  latest jsonb;
  selected jsonb;
begin
  project:=private.n2_scope_require_member(p_organization_id,p_project_id,false);
  perform 1 from public.engagements e where e.id=p_engagement_id and e.organization_id=p_organization_id
    and e.project_id=p_project_id and e.status in ('planning','active') for share;
  if not found then raise exception 'Current project engagement required' using errcode='42501'; end if;
  select case when b.brief_sha256=encode(sha256(convert_to(project.description,'UTF8')),'hex')
      then b.request_id end into live_binding from private.project_foundation_brief_bindings b
    where b.organization_id=p_organization_id and b.project_id=p_project_id and b.engagement_id=p_engagement_id
    order by b.revision desc limit 1;

  select private.positioning_version_metadata(v) into latest from private.project_positioning_versions v
    where v.organization_id=p_organization_id and v.project_id=p_project_id and v.engagement_id=p_engagement_id
    order by v.version_number desc limit 1;
  if p_conversation_id is not null then
    perform private.require_project_chat_action_owner(p_organization_id,p_project_id,p_conversation_id,null,true);
  end if;
  if p_version_id is not null then
    select private.positioning_version_metadata(v)||jsonb_build_object('wording',v.wording) into selected
      from private.project_positioning_versions v
      where v.version_id=p_version_id and v.organization_id=p_organization_id and v.project_id=p_project_id
        and v.engagement_id=p_engagement_id and v.conversation_id=p_conversation_id and v.actor_id=auth.uid()
        and not exists(select 1 from public.project_context_chat_shares s
          where s.conversation_id=p_conversation_id and s.revoked_at is null);
    if selected is null then raise exception 'Original private positioning version unavailable' using errcode='42501'; end if;
  end if;
  return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'engagement_id',p_engagement_id,'actor_id',auth.uid(),'binding_id',live_binding,'current',latest,'selected',selected);
end $$;

create function public.recover_project_positioning_output(p_organization_id uuid,p_project_id uuid,
  p_engagement_id uuid,p_conversation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare receipt jsonb;
begin
  perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
  perform private.require_project_chat_action_owner(p_organization_id,p_project_id,p_conversation_id,null,false);
  select private.positioning_version_metadata(v) into receipt from private.project_positioning_versions v
    where v.version_id=p_request_id and v.organization_id=p_organization_id and v.project_id=p_project_id
      and v.engagement_id=p_engagement_id and v.conversation_id=p_conversation_id and v.actor_id=auth.uid();
  return receipt;
end $$;

create function public.save_project_positioning_output(p_organization_id uuid,p_project_id uuid,
  p_engagement_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_approval_message_id uuid,
  p_wording text,p_binding_id uuid,p_expected_version_id uuid,p_request_id uuid,p_attested boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare
  prior private.project_positioning_versions;
  saved private.project_positioning_versions;
  project public.projects;
  binding private.project_foundation_brief_bindings;
  manager_role text;
begin
  if p_attested is distinct from true or p_request_id is null or p_binding_id is null
    or p_source_message_id is null or p_approval_message_id is null or p_conversation_id is null
    or p_wording is null or char_length(btrim(p_wording))=0 or char_length(p_wording)>80000 then
    raise exception 'Explicit approval of exact saved wording required' using errcode='22023';
  end if;
  project:=private.n2_scope_require_member(p_organization_id,p_project_id,false);
  perform 1 from public.engagements e where e.id=p_engagement_id and e.organization_id=p_organization_id
    and e.project_id=p_project_id for update;
  if not found then raise exception 'Exact engagement required' using errcode='42501'; end if;
  perform private.require_project_chat_action_owner(p_organization_id,p_project_id,p_conversation_id,null,false);
  select * into saved from private.project_positioning_versions where version_id=p_request_id;
  if found then
    if row(saved.organization_id,saved.project_id,saved.engagement_id,saved.actor_id,saved.conversation_id,
      saved.source_message_id,saved.approval_message_id,saved.wording,saved.binding_id,saved.prior_version_id)
      is distinct from row(p_organization_id,p_project_id,p_engagement_id,auth.uid(),p_conversation_id,
      p_source_message_id,p_approval_message_id,p_wording,p_binding_id,p_expected_version_id) then
      raise exception 'Request identity unavailable' using errcode='23505';
    end if;
    return private.positioning_version_metadata(saved);
  end if;

  select m.role into manager_role from public.organization_memberships m where m.organization_id=p_organization_id
    and m.user_id=auth.uid() and m.status='active' and m.member_kind='team' for share;
  if manager_role is null or manager_role not in ('system_owner','operations_admin') then
    perform 1 from public.project_manager_bindings b where b.organization_id=p_organization_id
      and b.project_id=p_project_id and b.user_id=auth.uid() and b.status='active' for share;
    if not found then raise exception 'Current project manager required' using errcode='42501'; end if;
  end if;
  perform 1 from public.engagements where id=p_engagement_id and status in ('planning','active');
  if not found then raise exception 'Current engagement required' using errcode='42501'; end if;
  perform private.require_project_chat_action_owner(p_organization_id,p_project_id,p_conversation_id,p_approval_message_id,true);
  if exists(select 1 from public.project_context_chat_shares where conversation_id=p_conversation_id and revoked_at is null) then
    raise exception 'Original private Project Chat required' using errcode='42501';
  end if;
  select * into binding from private.project_foundation_brief_bindings b where b.organization_id=p_organization_id
    and b.project_id=p_project_id and b.engagement_id=p_engagement_id order by b.revision desc limit 1;
  if binding.request_id is distinct from p_binding_id or binding.brief_sha256 is distinct from
    encode(sha256(convert_to(project.description,'UTF8')),'hex') then
    raise exception 'Bound Business brief changed; review again' using errcode='40001';
  end if;
  perform 1 from public.department_chat_messages s join public.department_chat_messages a
    on a.id=p_approval_message_id and a.conversation_id=s.conversation_id and a.sequence>=s.sequence
    where s.id=p_source_message_id and s.organization_id=p_organization_id and s.project_id=p_project_id
      and s.conversation_id=p_conversation_id and s.owner_id=auth.uid() and s.status='completed'
      and (s.role='assistant' or (s.role='user' and s.author_id=auth.uid()))
      and strpos(s.body,p_wording)>0 for share of s,a;
  if not found then raise exception 'Review the exact saved wording and subsequent owner approval' using errcode='22023'; end if;
  select * into prior from private.project_positioning_versions v where v.organization_id=p_organization_id
    and v.project_id=p_project_id and v.engagement_id=p_engagement_id order by v.version_number desc limit 1;
  if prior.version_id is distinct from p_expected_version_id then
    raise exception 'Positioning version changed; review again' using errcode='40001';
  end if;
  insert into private.project_positioning_versions(version_id,organization_id,project_id,engagement_id,
    version_number,prior_version_id,binding_id,actor_id,conversation_id,source_message_id,approval_message_id,wording,wording_sha256)
    values(p_request_id,p_organization_id,p_project_id,p_engagement_id,coalesce(prior.version_number,0)+1,
      p_expected_version_id,p_binding_id,auth.uid(),p_conversation_id,p_source_message_id,p_approval_message_id,p_wording,
      encode(sha256(convert_to(p_wording,'UTF8')),'hex')) returning * into saved;
  return private.positioning_version_metadata(saved);
end $$;

revoke all on function public.read_project_positioning_output(uuid,uuid,uuid,uuid,uuid),
  public.recover_project_positioning_output(uuid,uuid,uuid,uuid,uuid),
  public.save_project_positioning_output(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.read_project_positioning_output(uuid,uuid,uuid,uuid,uuid),
  public.recover_project_positioning_output(uuid,uuid,uuid,uuid,uuid),
  public.save_project_positioning_output(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,boolean)
  to authenticated;
commit;
