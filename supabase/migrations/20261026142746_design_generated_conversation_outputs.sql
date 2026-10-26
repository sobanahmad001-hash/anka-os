begin;
set local lock_timeout='5s';
-- New requests gain an explicit immutable chat link. No legacy jobs are updated.
create table private.design_media_conversation_links (
 job_id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references auth.users(id),
 conversation_id uuid not null references public.department_chat_conversations(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,organization_id) references private.design_media_generation_jobs(id,organization_id)
);
alter table private.design_media_conversation_links owner to postgres;
alter table private.design_media_conversation_links enable row level security;
revoke all on private.design_media_conversation_links from public,anon,authenticated,service_role;
create index design_media_conversation_links_scope on private.design_media_conversation_links(organization_id,actor_id,conversation_id,job_id);
create function private.guard_design_media_conversation_link() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Original media conversation links are immutable';end;$$;
alter function private.guard_design_media_conversation_link() owner to postgres;
revoke all on function private.guard_design_media_conversation_link() from public,anon,authenticated,service_role;
create trigger guard_design_media_conversation_link before update or delete on private.design_media_conversation_links for each row execute function private.guard_design_media_conversation_link();

create function private.require_design_generated_chat(p_org uuid,p_actor uuid,p_conversation uuid,p_request jsonb default null,p_write boolean default false)
returns public.department_chat_conversations language plpgsql security invoker set search_path='' as $$
declare c public.department_chat_conversations;
begin
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where o.id=p_org and o.status='active' and m.user_id=p_actor and m.status='active' and m.member_kind='team'
 and (m.role in ('system_owner','operations_admin','executive') or m.department_id='design') for share of m,o;
 if not found then raise exception 'Current Design authority required' using errcode='42501';end if;
 if p_write then perform private.require_design_video_reference_owner(p_org,p_conversation,p_actor);end if;
 select * into c from public.department_chat_conversations where id=p_conversation and organization_id=p_org and owner_id=p_actor and department_id='design' and state in ('active','archived') for share;
 if not found then raise exception 'Exact owned Design conversation required' using errcode='42501';end if;
 if c.context_kind='department_private' and c.project_id is null and c.engagement_id is null then
  if p_request is not null and (p_request#>>'{context,kind}' is distinct from 'private' or p_request#>>'{context,id}' is distinct from c.id::text) then raise exception 'Original private conversation differs' using errcode='42501';end if;
 elsif c.context_kind='department_project' and c.project_id is not null and c.engagement_id is not null then
  perform private.require_accessible_department_chat_conversation(c.id,p_org,c.project_id,c.engagement_id,'design',p_actor,p_write);
  if p_request is not null then
   if p_request#>>'{context,kind}' is distinct from 'engagement' or p_request#>>'{context,id}' is distinct from c.engagement_id::text then raise exception 'Original project conversation differs' using errcode='42501';end if;
   perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id
   where es.id=(p_request#>>'{context,service_id}')::uuid and es.organization_id=p_org and es.engagement_id=c.engagement_id and sc.department_id='design';
   if not found then raise exception 'Original Design service differs' using errcode='42501';end if;
  end if;
 else raise exception 'Exact Design conversation kind required' using errcode='42501';end if;
 return c;
end;$$;
alter function private.require_design_generated_chat(uuid,uuid,uuid,jsonb,boolean) owner to postgres;
revoke all on function private.require_design_generated_chat(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;

-- These service-only wrappers retain the existing private-job authority boundary.
-- Definer access is necessary because neither callers nor service_role have table rights.
create function public.claim_design_media_in_conversation(p_org uuid,p_actor uuid,p_conversation uuid,p_operation uuid,p_quote uuid,p_request jsonb,p_prompt text,p_acceptance jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb;existing_job uuid;
begin
 perform private.require_design_generated_chat(p_org,p_actor,p_conversation,p_request,true);
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_actor::text||':'||p_operation::text,0));
 select id into existing_job from private.design_media_generation_jobs where organization_id=p_org and actor_id=p_actor and operation_key=p_operation;
 if found and not exists(select 1 from private.design_media_conversation_links where job_id=existing_job and organization_id=p_org and actor_id=p_actor and conversation_id=p_conversation) then
  raise exception 'Historical or differently associated request cannot be attached to this chat' using errcode='23505';
 end if;
 j:=public.claim_design_media_generation(p_org,p_actor,p_operation,p_quote,p_request,p_prompt,p_acceptance);
 insert into private.design_media_conversation_links(job_id,organization_id,actor_id,conversation_id)
 select id,p_org,p_actor,p_conversation from private.design_media_generation_jobs where id=(j->>'id')::uuid and organization_id=p_org and actor_id=p_actor and operation_key=p_operation
 on conflict(job_id) do nothing;
 if not exists(select 1 from private.design_media_conversation_links where job_id=(j->>'id')::uuid and organization_id=p_org and actor_id=p_actor and conversation_id=p_conversation) then raise exception 'Original conversation association differs' using errcode='23505';end if;
 return j||jsonb_build_object('conversation_id',p_conversation,'chat_binding','explicit');
end;$$;
alter function public.claim_design_media_in_conversation(uuid,uuid,uuid,uuid,uuid,jsonb,text,jsonb) owner to postgres;
revoke all on function public.claim_design_media_in_conversation(uuid,uuid,uuid,uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.claim_design_media_in_conversation(uuid,uuid,uuid,uuid,uuid,jsonb,text,jsonb) to service_role;

create function public.get_design_media_conversation_result(p_org uuid,p_actor uuid,p_operation uuid,p_conversation uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb;linked uuid;private_chat uuid;version_number integer;
begin
 j:=public.get_design_media_generation(p_org,p_actor,p_operation);
 select conversation_id into linked from private.design_media_conversation_links where job_id=(j->>'id')::uuid and organization_id=p_org and actor_id=p_actor;
 if linked is not null then
  if p_conversation is not null and p_conversation<>linked then raise exception 'Original request belongs to another conversation' using errcode='42501';end if;
  perform private.require_design_generated_chat(p_org,p_actor,linked,j->'request',false);
  j:=j||jsonb_build_object('conversation_id',linked,'chat_binding','explicit');
 elsif j#>>'{request,context,kind}'='private' then
  private_chat:=(j#>>'{request,context,id}')::uuid;
  if p_conversation is not null then
   if p_conversation<>private_chat then raise exception 'Original request belongs to another private conversation' using errcode='42501';end if;
   perform private.require_design_generated_chat(p_org,p_actor,private_chat,j->'request',false);
  end if;
  j:=j||jsonb_build_object('conversation_id',private_chat,'chat_binding','private_context');
 elsif p_conversation is not null then raise exception 'Unassociated historical project output remains in Output history' using errcode='42501';
 end if;
 select v.version_number into version_number from public.design_creative_brief_versions v where v.id=(j#>>'{request,creative_brief_version_id}')::uuid and v.organization_id=p_org;
 return j||jsonb_build_object('brief_version_number',version_number);
end;$$;
alter function public.get_design_media_conversation_result(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.get_design_media_conversation_result(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_design_media_conversation_result(uuid,uuid,uuid,uuid) to service_role;

create function public.list_design_media_conversation_results(p_org uuid,p_actor uuid,p_conversation uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.department_chat_conversations;item private.design_media_generation_jobs;items jsonb:='[]'::jsonb;
begin
 if (p_before is null)<>(p_before_id is null) then raise exception 'Exact result cursor required' using errcode='22023';end if;
 c:=private.require_design_generated_chat(p_org,p_actor,p_conversation,null,false);
 for item in select j.* from private.design_media_generation_jobs j where j.organization_id=p_org and j.actor_id=p_actor
 and ((c.context_kind='department_private' and j.request#>>'{context,kind}'='private' and j.request#>>'{context,id}'=p_conversation::text)
 or exists(select 1 from private.design_media_conversation_links l where l.job_id=j.id and l.organization_id=p_org and l.actor_id=p_actor and l.conversation_id=p_conversation))
 and (p_before is null or (j.created_at,j.id)<(p_before,p_before_id)) order by j.created_at desc,j.id desc limit 25 loop
  items:=items||jsonb_build_array(public.get_design_media_conversation_result(p_org,p_actor,item.operation_key,p_conversation));
 end loop;
 return items;
end;$$;
alter function public.list_design_media_conversation_results(uuid,uuid,uuid,timestamptz,uuid) owner to postgres;
revoke all on function public.list_design_media_conversation_results(uuid,uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_design_media_conversation_results(uuid,uuid,uuid,timestamptz,uuid) to service_role;
commit;
