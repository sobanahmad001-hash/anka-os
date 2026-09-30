-- Isolated native PostgreSQL fixture cloned from the existing lifecycle test DB.
-- Reuses its synthetic member; never creates users or accesses production rows.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'anka_b1_firstsend_20260930' then raise exception 'B1 isolated fixture database required'; end if;
end $$;
insert into public.departments(id,name,organization_id) values ('content','B1 Content local fixture','99999999-9999-4999-8999-999999999901') on conflict(id) do nothing;
create function private.b1_force_message_failure() returns trigger language plpgsql as $$
begin if new.body = 'Force append rollback' then raise exception 'forced message failure' using errcode = '23514'; end if; return new; end $$;
create trigger b1_force_message_failure before insert on public.department_chat_messages for each row execute function private.b1_force_message_failure();
do $$
declare
  org uuid := '99999999-9999-4999-8999-999999999901';
  actor uuid := '99999999-9999-4999-8999-999999999902';
  conversation uuid := gen_random_uuid(); request uuid := gen_random_uuid();
  failed uuid := gen_random_uuid(); project uuid; archived uuid; result jsonb; replay jsonb;
  before_count bigint; after_count bigint;
begin
  if not has_function_privilege('service_role','public.start_context_chat_human_message(uuid,uuid,uuid,text,uuid,text,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.start_context_chat_human_message(uuid,uuid,uuid,text,uuid,text,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.start_context_chat_human_message(uuid,uuid,uuid,text,uuid,text,uuid,text)','EXECUTE') then raise exception 'RPC privilege mismatch'; end if;
  result := public.start_context_chat_human_message(conversation,org,actor,'department_private',null,'content',request,E'First\n  direction');
  replay := public.start_context_chat_human_message(conversation,org,actor,'department_private',null,'content',request,E'First\n  direction');
  if result#>>'{conversation,title}' <> 'First direction' or result#>>'{message,id}' <> replay#>>'{message,id}'
    or (select count(*) from public.department_chat_messages where conversation_id=conversation) <> 1
    or (select next_sequence from public.department_chat_conversations where id=conversation) <> 2 then raise exception 'First Send/replay mismatch'; end if;
  begin
    perform public.start_context_chat_human_message(conversation,org,actor,'department_private',null,'content',request,'Changed body');
    raise exception 'Changed replay accepted';
  exception when unique_violation then null; end;
  begin
    perform public.start_context_chat_human_message(conversation,org,actor,'organization',null,null,gen_random_uuid(),'Different scope');
    raise exception 'Scope mismatch accepted';
  exception when insufficient_privilege then null; end;
  select count(*) into before_count from public.department_chat_conversations;
  begin
    perform public.start_context_chat_human_message(failed,org,actor,'department_private',null,'content',gen_random_uuid(),'Force append rollback');
    raise exception 'Forced append failure accepted';
  exception when check_violation then null; end;
  select count(*) into after_count from public.department_chat_conversations;
  if after_count <> before_count or exists(select 1 from public.department_chat_conversations where id=failed) then raise exception 'Failed append left an orphan empty chat'; end if;
  update public.organization_memberships set status='revoked' where organization_id=org and user_id=actor;
  begin
    perform public.start_context_chat_human_message(failed,org,actor,'organization',null,null,gen_random_uuid(),'Revoked member');
    raise exception 'Revoked member accepted';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.department_chat_conversations where id=failed) then raise exception 'Revoked member created chat'; end if;
  update public.organization_memberships set status='active' where organization_id=org and user_id=actor;
  select id into project from public.projects where organization_id=org and archived_at is null order by id limit 1;
  if project is null then raise exception 'Existing active local project fixture required'; end if;
  result := public.start_context_chat_human_message(gen_random_uuid(),org,actor,'project_team',project,null,gen_random_uuid(),'Project message');
  if result#>>'{conversation,project_id}' <> project::text then raise exception 'Project context mismatch'; end if;
  select id into archived from public.projects where organization_id=org and archived_at is not null limit 1;
  if archived is null then
    perform set_config('request.jwt.claim.sub',actor::text,true);
    perform public.set_project_archived(org,project,true,gen_random_uuid());
    archived := project;
  end if;
  if archived is not null then
    begin
      perform public.start_context_chat_human_message(failed,org,actor,'project_team',archived,null,gen_random_uuid(),'Archived project');
      raise exception 'Archived project accepted';
    exception when insufficient_privilege then null; end;
  else raise exception 'Existing archived local project fixture required'; end if;
  if exists(select 1 from public.department_chat_conversations where id=failed) then raise exception 'Archived project created chat'; end if;
  raise notice 'B1 atomic first Send: replay/body/scope/rollback/revocation/project/archive/ACL checks passed';
end $$;
rollback;
