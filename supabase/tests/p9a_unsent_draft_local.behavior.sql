-- Disposable local P9A contract test: no production data or persisted fixture.
\set ON_ERROR_STOP on
begin;
set role postgres;
insert into auth.users(id) values
 ('bbbbbbbb-0000-4000-8000-000000000001'),
 ('bbbbbbbb-0000-4000-8000-000000000002');
insert into public.organizations(id,name,slug) values
 ('aaaaaaaa-0000-4000-8000-000000000001','P9A local fixture','p9a-local-fixture');
insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status)
values ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','team','contributor','content','active');
insert into public.clients(name,company,owner_id,organization_id)
values ('P9A local','P9A','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001')
returning id as client_id \gset
insert into public.agency_clients(organization_id,legacy_client_id,canonical_client_id,name,owner_id,created_by)
values ('aaaaaaaa-0000-4000-8000-000000000001',:'client_id',:'client_id','P9A local','bbbbbbbb-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001')
returning id as agency_id \gset
insert into public.brands(organization_id,client_id,name,is_default,created_by)
values ('aaaaaaaa-0000-4000-8000-000000000001',:'agency_id','P9A local',true,'bbbbbbbb-0000-4000-8000-000000000001')
returning id as brand_id \gset
insert into public.projects(id,name,department_id,status,owner_id,organization_id,client_id,engagement_type)
values ('eeeeeeee-0000-4000-8000-000000000001','P9A local','content','active','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',:'client_id','project')
returning id as project_id \gset
insert into public.engagements(id,organization_id,client_id,brand_id,legacy_project_id,project_id,name,engagement_type,status,created_by)
values ('ffffffff-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',:'agency_id',:'brand_id','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000001','P9A local','project','active','bbbbbbbb-0000-4000-8000-000000000001')
returning id as engagement_id \gset
insert into public.service_catalog(organization_id,department_id,slug,name)
values ('aaaaaaaa-0000-4000-8000-000000000001','content','p9a_local','P9A local')
returning id as service_id \gset
insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by)
values ('aaaaaaaa-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000001',:'service_id','active','bbbbbbbb-0000-4000-8000-000000000001');
insert into public.department_chat_conversations(id,organization_id,project_id,engagement_id,department_id,owner_id,title)
values ('dddddddd-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000001','content','bbbbbbbb-0000-4000-8000-000000000001','P9A local conversation');
set role service_role;
do $$
declare v public.department_chat_unsent_drafts;
begin
  v := public.save_department_chat_unsent_draft(
    'dddddddd-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'content',
    'bbbbbbbb-0000-4000-8000-000000000001',
    'Private original text', 'answer','','','','medium','');
  if v.prompt <> 'Private original text' or v.actor_id <> 'bbbbbbbb-0000-4000-8000-000000000001' then
    raise exception 'Save result changed scope';
  end if;
  v := public.get_department_chat_unsent_draft(
    'dddddddd-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'content',
    'bbbbbbbb-0000-4000-8000-000000000001');
  if v.prompt <> 'Private original text' then raise exception 'Same author cannot restore'; end if;
  begin
    perform public.get_department_chat_unsent_draft(
      'dddddddd-0000-4000-8000-000000000001',
      'aaaaaaaa-0000-4000-8000-000000000001',
      'eeeeeeee-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'content',
      'bbbbbbbb-0000-4000-8000-000000000002');
    raise exception 'Unauthorized read unexpectedly passed';
  exception when insufficient_privilege then null;
  end;
end $$;
set role postgres;
update public.organization_memberships set status='revoked'
where organization_id='aaaaaaaa-0000-4000-8000-000000000001'
  and user_id='bbbbbbbb-0000-4000-8000-000000000001';
set role service_role;
do $$
begin
  begin
    perform public.get_department_chat_unsent_draft(
      'dddddddd-0000-4000-8000-000000000001',
      'aaaaaaaa-0000-4000-8000-000000000001',
      'eeeeeeee-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'content',
      'bbbbbbbb-0000-4000-8000-000000000001');
    raise exception 'Revoked actor read unexpectedly passed';
  exception when insufficient_privilege then null;
  end;
  if not public.discard_department_chat_unsent_draft(
    'dddddddd-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'content',
    'bbbbbbbb-0000-4000-8000-000000000001') then
    raise exception 'Revoked actor cannot clear own stale draft';
  end if;
end $$;
set role postgres;
do $$
begin
  if has_table_privilege('anon','public.department_chat_unsent_drafts','select')
    or has_table_privilege('authenticated','public.department_chat_unsent_drafts','select')
    or has_function_privilege('authenticated','public.get_department_chat_unsent_draft(uuid,uuid,uuid,uuid,text,uuid)','execute')
  then raise exception 'Browser draft access unexpectedly granted'; end if;
  if not (select relrowsecurity from pg_class where oid='public.department_chat_unsent_drafts'::regclass)
  then raise exception 'Draft RLS disabled'; end if;
end $$;
rollback;


