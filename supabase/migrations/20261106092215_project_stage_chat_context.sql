-- Explicit stage metadata is pinned to the existing human message and original UUID.
-- No provider call, business execution, approval, or automatic resend is authorized here.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $guard$ begin
 if md5((select prosrc from pg_proc where oid='public.append_context_chat_human_message(uuid,uuid,uuid,uuid,text)'::regprocedure)) is distinct from '4abcf7346b54ca71b45bb4fda54332e7'
 or md5((select prosrc from pg_proc where oid='public.start_context_chat_human_message(uuid,uuid,uuid,text,uuid,text,uuid,text)'::regprocedure)) is distinct from '204a417aed7ad6df559ff1dee409bd7e'
 or exists(select 1 from pg_attribute where attrelid='public.department_chat_messages'::regclass and attname='project_stage_context' and not attisdropped)
 then raise exception 'Exact Chat persistence prerequisites changed';end if;
end;$guard$;
alter table public.department_chat_messages add column project_stage_context jsonb
 check(project_stage_context is null or (jsonb_typeof(project_stage_context)='object' and octet_length(project_stage_context::text)<=32768 and role='user' and status='completed' and ai_run_id is null));
create function private.guard_project_stage_message_context() returns trigger language plpgsql set search_path='' as $$begin
 if new.project_stage_context is distinct from old.project_stage_context then raise exception 'Original message stage context is immutable' using errcode='55000';end if;return new;
end$$;
revoke all on function private.guard_project_stage_message_context() from public,anon,authenticated,service_role;
create trigger project_stage_message_context_immutable before update of project_stage_context on public.department_chat_messages
 for each row execute function private.guard_project_stage_message_context();
CREATE FUNCTION private.append_project_stage_message_core(p_conversation_id uuid, p_organization_id uuid, p_actor_id uuid, p_request_id uuid, p_body text, p_stage_context jsonb)
 RETURNS public.department_chat_messages
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_conversation public.department_chat_conversations;
  v_existing public.department_chat_messages;
  v_message public.department_chat_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_membership public.organization_memberships;
begin
  if p_request_id is null or length(v_body) not between 1 and 8000 then
    raise exception 'Human message and request ID are required.' using errcode = '22023';
  end if;
  select * into v_conversation
  from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.context_kind in ('organization', 'department_private', 'project_team')
  for update;
  if not found then
    raise exception 'Conversation is unavailable.' using errcode = '42501';
  end if;
  select * into v_membership
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_id
    and membership.member_kind = 'team' and membership.status = 'active';
  if not found then
    raise exception 'Active team membership required.' using errcode = '42501';
  end if;
  if v_conversation.context_kind = 'department_private'
    and v_membership.department_id is distinct from v_conversation.department_id
    and not coalesce(v_membership.role in ('system_owner', 'operations_admin', 'executive'), false)
    and not exists (
      select 1 from public.organization_department_memberships department_membership
      where department_membership.organization_id = p_organization_id
        and department_membership.user_id = p_actor_id
        and department_membership.department_id = v_conversation.department_id
        and department_membership.status = 'active'
    ) then
    raise exception 'Department access changed.' using errcode = '42501';
  end if;
  if v_conversation.context_kind = 'project_team' and not exists (
    select 1 from public.projects project
    where project.id = v_conversation.project_id
      and project.organization_id = p_organization_id
      and project.archived_at is null
  ) then
    raise exception 'Project is unavailable.' using errcode = '42501';
  end if;

  if v_conversation.owner_id <> p_actor_id then
    if v_conversation.context_kind <> 'project_team' then
      raise exception 'Conversation is unavailable.' using errcode = '42501';
    end if;
    perform 1 from public.project_context_chat_shares share
      where share.conversation_id = v_conversation.id
        and share.organization_id = p_organization_id
        and share.project_id = v_conversation.project_id
        and share.recipient_id = p_actor_id and share.revoked_at is null
      for share;
    if not found then
      raise exception 'Project conversation sharing is unavailable.' using errcode = '42501';
    end if;
  end if;
  select * into v_existing from public.department_chat_messages message
  where message.conversation_id = p_conversation_id
    and message.client_request_id = p_request_id and message.role = 'user';
  if found then
    if v_existing.organization_id is distinct from p_organization_id
      or v_existing.author_id is distinct from p_actor_id
      or v_existing.body is distinct from v_body
      or v_existing.status <> 'completed'
      or v_existing.ai_run_id is not null
      or v_existing.project_stage_context is distinct from p_stage_context then
      raise exception 'Request ID already used with different message inputs.' using errcode = '23505';
    end if;
    return v_existing;
  end if;
  if v_conversation.state <> 'active' then
    raise exception 'Reopen the conversation before sending.' using errcode = '23514';
  end if;
  insert into public.department_chat_messages (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, author_id, role, body, status, client_request_id, sequence, finished_at, project_stage_context
  ) values (
    v_conversation.id, v_conversation.organization_id, v_conversation.project_id,
    v_conversation.engagement_id, v_conversation.department_id, v_conversation.owner_id,
    p_actor_id, 'user', v_body, 'completed', p_request_id, v_conversation.next_sequence, now(), p_stage_context
  ) returning * into v_message;
  update public.department_chat_conversations
  set next_sequence = next_sequence + 1, last_activity_at = now(), updated_at = now()
  where id = v_conversation.id;
  return v_message;
end;
$function$;
CREATE FUNCTION private.start_project_stage_message_core(p_conversation_id uuid, p_organization_id uuid, p_actor_id uuid, p_context_kind text, p_project_id uuid, p_department_id text, p_request_id uuid, p_body text, p_stage_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_conversation public.department_chat_conversations;
  v_membership public.organization_memberships;
  v_message public.department_chat_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_title text;
begin
  if p_conversation_id is null or p_request_id is null or length(v_body) not between 1 and 8000
    or p_context_kind is null or p_context_kind not in ('organization', 'department_private', 'project_team')
    or (p_context_kind = 'organization' and (p_project_id is not null or p_department_id is not null))
    or (p_context_kind = 'department_private' and (p_project_id is not null or p_department_id is null or p_department_id not in ('content', 'design', 'marketing')))
    or (p_context_kind = 'project_team' and (p_project_id is null or p_department_id is not null)) then
    raise exception 'Valid context, first message and request identity required.' using errcode = '22023';
  end if;
  -- Lifecycle operations lock the project first. Use the same order and hold
  -- the parent until commit so archive/delete cannot cross a successful Send.
  if p_context_kind = 'project_team' then
    perform 1 from public.projects project
    where project.id = p_project_id and project.organization_id = p_organization_id and project.archived_at is null
    for share;
    if not found then raise exception 'Project is unavailable.' using errcode = '42501'; end if;
  end if;
  select membership.* into v_membership from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id and organization.status = 'active'
  where membership.organization_id = p_organization_id and membership.user_id = p_actor_id
    and membership.member_kind = 'team' and membership.status = 'active'
  for share of membership, organization;
  if not found then raise exception 'Active team membership required.' using errcode = '42501'; end if;
  if p_context_kind = 'department_private'
    and v_membership.department_id is distinct from p_department_id
    and not coalesce(v_membership.role in ('system_owner', 'operations_admin', 'executive'), false) then
    perform 1 from public.organization_department_memberships department_membership
    where department_membership.organization_id = p_organization_id
      and department_membership.user_id = p_actor_id and department_membership.department_id = p_department_id
      and department_membership.status = 'active'
    for share;
    if not found then raise exception 'Department access changed.' using errcode = '42501'; end if;
  end if;
  v_title := regexp_replace(v_body, '[[:space:]]+', ' ', 'g');
  if char_length(v_title) > 80 then v_title := rtrim(left(v_title, 79)) || '…'; end if;
  insert into public.department_chat_conversations (
    id, organization_id, owner_id, context_kind, project_id, department_id, title
  ) values (
    p_conversation_id, p_organization_id, p_actor_id, p_context_kind, p_project_id, p_department_id, v_title
  ) on conflict (id) do nothing;
  select * into v_conversation from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id for update;
  if not found or v_conversation.organization_id is distinct from p_organization_id
    or v_conversation.owner_id is distinct from p_actor_id
    or v_conversation.context_kind is distinct from p_context_kind
    or v_conversation.project_id is distinct from p_project_id
    or v_conversation.department_id is distinct from p_department_id
    or v_conversation.engagement_id is not null then
    raise exception 'Conversation identity mismatch.' using errcode = '42501';
  end if;
  v_message := private.append_project_stage_message_core(p_conversation_id, p_organization_id, p_actor_id, p_request_id, v_body, p_stage_context);
  select * into v_conversation from public.department_chat_conversations conversation where conversation.id = p_conversation_id;
  return jsonb_build_object('conversation', to_jsonb(v_conversation), 'message', to_jsonb(v_message));
end;
$function$;

revoke all on function private.append_project_stage_message_core(uuid,uuid,uuid,uuid,text,jsonb),private.start_project_stage_message_core(uuid,uuid,uuid,text,uuid,text,uuid,text,jsonb) from public,anon,authenticated,service_role;
-- Existing legacy append body and grants retained; plain replay cannot adopt stage context.
CREATE OR REPLACE FUNCTION public.append_context_chat_human_message(p_conversation_id uuid, p_organization_id uuid, p_actor_id uuid, p_request_id uuid, p_body text)
 RETURNS department_chat_messages
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_conversation public.department_chat_conversations;
  v_existing public.department_chat_messages;
  v_message public.department_chat_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_membership public.organization_memberships;
begin
  if p_request_id is null or length(v_body) not between 1 and 8000 then
    raise exception 'Human message and request ID are required.' using errcode = '22023';
  end if;
  select * into v_conversation
  from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.context_kind in ('organization', 'department_private', 'project_team')
  for update;
  if not found then
    raise exception 'Conversation is unavailable.' using errcode = '42501';
  end if;
  select * into v_membership
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_id
    and membership.member_kind = 'team' and membership.status = 'active';
  if not found then
    raise exception 'Active team membership required.' using errcode = '42501';
  end if;
  if v_conversation.context_kind = 'department_private'
    and v_membership.department_id is distinct from v_conversation.department_id
    and not coalesce(v_membership.role in ('system_owner', 'operations_admin', 'executive'), false)
    and not exists (
      select 1 from public.organization_department_memberships department_membership
      where department_membership.organization_id = p_organization_id
        and department_membership.user_id = p_actor_id
        and department_membership.department_id = v_conversation.department_id
        and department_membership.status = 'active'
    ) then
    raise exception 'Department access changed.' using errcode = '42501';
  end if;
  if v_conversation.context_kind = 'project_team' and not exists (
    select 1 from public.projects project
    where project.id = v_conversation.project_id
      and project.organization_id = p_organization_id
      and project.archived_at is null
  ) then
    raise exception 'Project is unavailable.' using errcode = '42501';
  end if;

  if v_conversation.owner_id <> p_actor_id then
    if v_conversation.context_kind <> 'project_team' then
      raise exception 'Conversation is unavailable.' using errcode = '42501';
    end if;
    perform 1 from public.project_context_chat_shares share
      where share.conversation_id = v_conversation.id
        and share.organization_id = p_organization_id
        and share.project_id = v_conversation.project_id
        and share.recipient_id = p_actor_id and share.revoked_at is null
      for share;
    if not found then
      raise exception 'Project conversation sharing is unavailable.' using errcode = '42501';
    end if;
  end if;
  select * into v_existing from public.department_chat_messages message
  where message.conversation_id = p_conversation_id
    and message.client_request_id = p_request_id and message.role = 'user';
  if found then
    if v_existing.organization_id is distinct from p_organization_id
      or v_existing.author_id is distinct from p_actor_id
      or v_existing.body is distinct from v_body
      or v_existing.status <> 'completed'
      or v_existing.ai_run_id is not null
      or v_existing.project_stage_context is not null then
      raise exception 'Request ID already used with different message inputs.' using errcode = '23505';
    end if;
    return v_existing;
  end if;
  if v_conversation.state <> 'active' then
    raise exception 'Reopen the conversation before sending.' using errcode = '23514';
  end if;
  insert into public.department_chat_messages (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, author_id, role, body, status, client_request_id, sequence, finished_at
  ) values (
    v_conversation.id, v_conversation.organization_id, v_conversation.project_id,
    v_conversation.engagement_id, v_conversation.department_id, v_conversation.owner_id,
    p_actor_id, 'user', v_body, 'completed', p_request_id, v_conversation.next_sequence, now()
  ) returning * into v_message;
  update public.department_chat_conversations
  set next_sequence = next_sequence + 1, last_activity_at = now(), updated_at = now()
  where id = v_conversation.id;
  return v_message;
end;
$function$;
create function private.project_stage_chat_metadata(p_org uuid,p_project uuid,p_selection jsonb,p_output_ids uuid[]) returns jsonb
 language plpgsql set search_path='' as $metadata$
declare h jsonb;u jsonb;g jsonb;steps jsonb;items jsonb;refs jsonb:='[]';works jsonb;vid uuid;ref jsonb;matches jsonb;result jsonb;begin
 if jsonb_typeof(p_selection) is distinct from 'object' or octet_length(p_selection::text)>4096
 or (select count(*) from jsonb_object_keys(p_selection))<>9 or not p_selection?&array['version','organization_id','project_id','engagement_id','plan_id','group_id','phase','partition','context_sha256']
 or p_selection->'version' is distinct from '1'::jsonb or p_selection->>'organization_id' is distinct from p_org::text or p_selection->>'project_id' is distinct from p_project::text
 or coalesce(p_selection->>'context_sha256','')!~'^[a-f0-9]{64}$'
 or p_output_ids is null or coalesce(array_ndims(p_output_ids),1)<>1 or cardinality(p_output_ids)>20 or array_position(p_output_ids,null) is not null
 or (select count(distinct x) from unnest(p_output_ids)x)<>cardinality(p_output_ids)
 then raise exception 'Exact bounded explicit stage and output selection required' using errcode='22023';end if;
 h:=public.read_project_stage_plan(p_org,p_project,(p_selection->>'engagement_id')::uuid);
 if h->>'plan_id' is distinct from p_selection->>'plan_id' or h->>'state' is distinct from 'available' then raise exception 'Selected plan changed' using errcode='40001';end if;
 u:=public.read_project_stage_partition(p_org,p_project,(p_selection->>'engagement_id')::uuid,(p_selection->>'plan_id')::uuid,(p_selection->>'group_id')::uuid,p_selection->'partition');
 if u->>'state' is distinct from 'current' or u->>'context_sha256' is distinct from p_selection->>'context_sha256' then raise exception 'Selected stage changed; retain the draft and explicitly review current context' using errcode='40001';end if;
 select value into g from jsonb_array_elements(h->'groups') where value->>'id'=p_selection->>'group_id';
 select coalesce(jsonb_agg(s.value order by s.step_order),'[]') into steps from jsonb_array_elements(u->'steps') with ordinality s(value,step_order) where s.value->>'phase'=p_selection->>'phase'
 and exists(select 1 from jsonb_array_elements(h->'bindings') b where b->>'group_id'=g->>'id' and b->>'publication_id'=g->>'publication_id' and b->>'step_key'=s.value->>'key' and b->>'phase'=p_selection->>'phase');
 if jsonb_array_length(steps)=0 or jsonb_array_length(steps)<>(select count(*) from jsonb_array_elements(h->'bindings') b where b->>'group_id'=g->>'id' and b->>'publication_id'=g->>'publication_id' and b->>'phase'=p_selection->>'phase') then raise exception 'Complete configured stage selection required' using errcode='42501';end if;
 select coalesce(jsonb_agg(i.value||jsonb_build_object('step_key',s.value->>'key') order by s.step_order,i.item_order),'[]') into items from jsonb_array_elements(steps) with ordinality s(value,step_order) cross join lateral jsonb_array_elements(s.value->'items') with ordinality i(value,item_order);
 if jsonb_array_length(items)>100 then raise exception 'Stage metadata exceeds bound' using errcode='54000';end if;
 foreach vid in array p_output_ids loop
  select coalesce(jsonb_agg(i.value order by i.item_order),'[]') into matches from jsonb_array_elements(items) with ordinality i(value,item_order) where i.value->'output'->>'artifact_version_id'=vid::text;
  ref:=matches->0->'output';
  if jsonb_array_length(matches)=0 or ref->>'artifact_id' is null or coalesce(ref->>'content_checksum','')!~'^[a-f0-9]{64}$'
  or exists(select 1 from jsonb_array_elements(matches)i where i->'output' is distinct from ref) then raise exception 'Selected exact output differs from this stage' using errcode='42501';end if;
  refs:=refs||jsonb_build_array(jsonb_build_object('artifact_id',ref->'artifact_id','artifact_version_id',vid,'version_number',ref->'version_number','content_checksum',ref->'content_checksum','approval_id',ref->'approval_id',
   'ai_use_allowed',coalesce(ref->'ai_use_allowed','false'::jsonb),'approved',(select bool_and(i->'output_approved'='true'::jsonb) from jsonb_array_elements(matches)i),
   'material_current',(select bool_and(i->'material_current'='true'::jsonb) from jsonb_array_elements(matches)i),'needs_update',(select bool_or(i->'needs_update'='true'::jsonb) from jsonb_array_elements(matches)i)));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('step_key',i.value->'step_key','instance',i.value->'instance','work_item_id',i.value->'work_item_id','status',i.value->'work_status') order by i.item_order),'[]') into works from jsonb_array_elements(items) with ordinality i(value,item_order);
 result:=jsonb_build_object('version',1,'selection',p_selection,'output_version_ids',to_jsonb(p_output_ids),'work',works,'outputs',refs,'body_included',false,'attachments_included',false);
 if octet_length(result::text)>32768 then raise exception 'Stage metadata exceeds bound' using errcode='54000';end if;return result;
end;$metadata$;
revoke all on function private.project_stage_chat_metadata(uuid,uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;

create function public.send_project_stage_chat_message(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_request_id uuid,p_body text,p_start boolean,p_selection jsonb,p_output_version_ids uuid[]) returns jsonb
 language plpgsql security definer set search_path='' as $send$
declare actor uuid:=auth.uid();c public.department_chat_conversations;m public.department_chat_messages;metadata jsonb;saved jsonb;begin
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 if actor is null or p_start is null or p_conversation_id is null or p_request_id is null or length(btrim(coalesce(p_body,''))) not between 1 and 8000 then raise exception 'Exact owned message request required' using errcode='22023';end if;
 perform 1 from public.projects where id=p_project_id and organization_id=p_organization_id and archived_at is null for share;
 if not found then raise exception 'Active exact project required' using errcode='42501';end if;
 select * into c from public.department_chat_conversations where id=p_conversation_id for update;
 if c.id is not null then
  if c.organization_id is distinct from p_organization_id or c.project_id is distinct from p_project_id or c.owner_id is distinct from actor or c.context_kind is distinct from 'project_team' or c.engagement_id is not null or c.department_id is not null then raise exception 'Exact owned Project Chat required' using errcode='42501';end if;
  select * into m from public.department_chat_messages where conversation_id=c.id and client_request_id=p_request_id and role='user';
  if m.id is not null then
   if m.organization_id is distinct from p_organization_id or m.author_id is distinct from actor or m.body is distinct from btrim(p_body) or m.status<>'completed' or m.ai_run_id is not null
   or m.project_stage_context is null or m.project_stage_context->'selection' is distinct from p_selection or m.project_stage_context->'output_version_ids' is distinct from to_jsonb(p_output_version_ids)
   then raise exception 'Original message request owns different exact inputs' using errcode='23505';end if;
   return case when p_start then jsonb_build_object('conversation',to_jsonb(c),'message',to_jsonb(m)) else to_jsonb(m) end;
  end if;
 elsif not p_start then raise exception 'Existing owned Project Chat required' using errcode='42501';end if;
 metadata:=private.project_stage_chat_metadata(p_organization_id,p_project_id,p_selection,p_output_version_ids);
 if p_start then
  return private.start_project_stage_message_core(p_conversation_id,p_organization_id,actor,'project_team',p_project_id,null,p_request_id,p_body,metadata);
 end if;
 m:=private.append_project_stage_message_core(p_conversation_id,p_organization_id,actor,p_request_id,p_body,metadata);
 return to_jsonb(m);
end;$send$;
revoke all on function public.send_project_stage_chat_message(uuid,uuid,uuid,uuid,text,boolean,jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.send_project_stage_chat_message(uuid,uuid,uuid,uuid,text,boolean,jsonb,uuid[]) to authenticated;

create function public.read_project_stage_chat_message_context(p_organization_id uuid,p_conversation_id uuid,p_message_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $read$
declare c public.department_chat_conversations;m public.department_chat_messages;fresh jsonb;ids uuid[];begin
 select * into c from public.department_chat_conversations where id=p_conversation_id and organization_id=p_organization_id and owner_id=auth.uid() and context_kind='project_team' and state='active' and department_id is null and engagement_id is null for share;
 if c.id is null then raise exception 'Exact owned active Project Chat required' using errcode='42501';end if;
 perform private.n2_scope_require_member(p_organization_id,c.project_id,false);
 select * into m from public.department_chat_messages where id=p_message_id and organization_id=p_organization_id and conversation_id=c.id and author_id=auth.uid() and role='user' and status='completed' and ai_run_id is null for share;
 if m.id is null then raise exception 'Exact owned original message required' using errcode='42501';end if;
 if m.project_stage_context is null then return null;end if;
 select coalesce(array_agg(x::uuid order by ord),'{}'::uuid[]) into ids from jsonb_array_elements_text(m.project_stage_context->'output_version_ids') with ordinality as values_in_order(x,ord);
 fresh:=private.project_stage_chat_metadata(p_organization_id,c.project_id,m.project_stage_context->'selection',ids);
 if fresh is distinct from m.project_stage_context then raise exception 'Saved stage evidence changed; preserve original request for check-only recovery' using errcode='40001';end if;
 return fresh;
end;$read$;
revoke all on function public.read_project_stage_chat_message_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_project_stage_chat_message_context(uuid,uuid,uuid) to authenticated;
commit;
