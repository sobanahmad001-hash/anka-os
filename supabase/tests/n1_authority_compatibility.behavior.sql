-- Run after fixture + migration in the SAME psql session, isolated local DB only.
\set ON_ERROR_STOP on
begin;
select pg_temp.check_true((select count(*)=5 from public.organization_department_memberships), 'only verified active same-org departments seeded across both organizations');
select pg_temp.check_true((select count(*)=2 from public.project_manager_bindings), 'only verified project owners seeded');
select pg_temp.check_true(not exists(select 1 from public.project_manager_bindings where user_id=pg_temp.id('title-only')), 'title alone never seeds PM');
select pg_temp.check_true(not exists(select 1 from public.organization_contributor_designations), 'no designation inferred');
select pg_temp.check_true((select count(*)=9 from private.n1_authority_backfill_issues), 'unverified mappings and legacy elevated roles recorded');
select pg_temp.check_true(not exists((table public.organization_memberships except table private.fixture_legacy_memberships)
  union all (table private.fixture_legacy_memberships except table public.organization_memberships)), 'legacy memberships unchanged');
select pg_temp.check_true(not exists((table public.projects except table private.fixture_legacy_projects)
  union all (table private.fixture_legacy_projects except table public.projects)), 'project ownership unchanged');
select pg_temp.check_true(not exists(select 1 from private.fixture_legacy_grants g join pg_class c on c.oid=g.oid where c.relacl is distinct from g.relacl), 'legacy grants unchanged');
select pg_temp.check_true(not exists(table private.fixture_legacy_policies except
  select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies), 'legacy RLS unchanged');
select pg_temp.check_true((select count(*)=4 from pg_class where relname in
  ('organization_department_memberships','organization_contributor_designations','project_manager_bindings','n1_authority_backfill_issues') and relrowsecurity), 'new tables have RLS');
select pg_temp.check_true(not has_function_privilege('anon','public.get_my_authority_compatibility(uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.get_my_authority_compatibility(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_my_authority_compatibility(uuid)','EXECUTE'), 'self RPC ACL');

insert into public.project_manager_bindings(organization_id,user_id,project_id,source)
values(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('verified'),'explicit');
select pg_temp.check_true((select count(*)=2 from public.project_manager_bindings where project_id=pg_temp.id('verified')), 'multiple PMs per project');
select pg_temp.expect_error($q$insert into public.project_manager_bindings(organization_id,user_id,project_id,source)
  values(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('verified'),'explicit')$q$, '23505');
select pg_temp.expect_error($q$insert into public.project_manager_bindings(organization_id,user_id,project_id,source)
  values(pg_temp.id('org-b'),pg_temp.id('foreign'),pg_temp.id('verified'),'explicit')$q$, '23503');
select pg_temp.expect_error($q$insert into public.organization_department_memberships(organization_id,user_id,department_id,source)
  values(pg_temp.id('org-a'),pg_temp.id('alice'),'foreign','explicit')$q$, '23503');
select pg_temp.expect_error($q$insert into public.project_manager_bindings(organization_id,user_id,project_id,source)
  values(pg_temp.id('org-a'),pg_temp.id('revoked'),pg_temp.id('verified'),'explicit')$q$, '42501');
select pg_temp.expect_error($q$insert into public.organization_contributor_designations(organization_id,user_id,designation)
  values(pg_temp.id('org-a'),pg_temp.id('elevated'),'executive')$q$, '42501');
insert into public.organization_contributor_designations(organization_id,user_id,designation)
values(pg_temp.id('org-a'),pg_temp.id('alice'),'executive');
select pg_temp.check_true((select role='contributor' from public.organization_memberships where user_id=pg_temp.id('alice')), 'Executive designation does not elevate contributor');
select pg_temp.expect_error($q$insert into public.organization_contributor_designations(organization_id,user_id,designation)
  values(pg_temp.id('org-a'),pg_temp.id('alice'),'intern')$q$, '23505');

insert into public.organization_department_memberships(organization_id,user_id,department_id,source)
values(pg_temp.id('org-a'),pg_temp.id('alice'),'content','explicit');
select pg_temp.check_true((select count(*)=2 from public.organization_department_memberships where user_id=pg_temp.id('alice')), 'multiple departments supported');
select pg_temp.expect_error($q$update public.organization_department_memberships set status='revoked' where user_id=pg_temp.id('alice') and department_id='content'$q$, '23514');
update public.organization_department_memberships set status='revoked',revoked_at=now()
where user_id=pg_temp.id('alice') and department_id='content';
select pg_temp.expect_error($q$update public.organization_department_memberships set status='active',revoked_at=null where user_id=pg_temp.id('alice') and department_id='content'$q$, '42501');
select pg_temp.expect_error($q$delete from public.organization_department_memberships where user_id=pg_temp.id('alice')$q$, '42501');
insert into public.organization_department_memberships(organization_id,user_id,department_id,source)
values(pg_temp.id('org-a'),pg_temp.id('alice'),'content','explicit');
select pg_temp.check_true((select count(*)=3 from public.organization_department_memberships where user_id=pg_temp.id('alice')), 're-add preserves old department history');

update public.project_manager_bindings set status='revoked',revoked_at=now()
where user_id=pg_temp.id('bob') and project_id=pg_temp.id('verified');
insert into public.project_manager_bindings(organization_id,user_id,project_id,source)
values(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('verified'),'explicit');
select pg_temp.check_true((select count(*)=2 from public.project_manager_bindings where user_id=pg_temp.id('bob')), 'PM re-add retains revoked history');
update public.organization_contributor_designations set status='revoked',revoked_at=now() where user_id=pg_temp.id('alice');
insert into public.organization_contributor_designations(organization_id,user_id,designation)
values(pg_temp.id('org-a'),pg_temp.id('alice'),'intern');
select pg_temp.check_true((select count(*)=2 from public.organization_contributor_designations where user_id=pg_temp.id('alice')), 'designation history retained');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('alice')::text,true);
select pg_temp.check_true((select count(*)=3 from public.organization_department_memberships), 'RLS returns only own rows');
select pg_temp.check_true(public.get_my_authority_compatibility(pg_temp.id('org-a'))->>'legacy_role'='contributor', 'self RPC preserves legacy role');
select pg_temp.check_true(public.get_my_authority_compatibility(pg_temp.id('org-a'))->>'compatibility_only'='true', 'RPC declares compatibility only');
select pg_temp.check_true(jsonb_array_length(public.get_my_authority_compatibility(pg_temp.id('org-a'))->'contributor_designations')=2, 'RPC includes designation history');
select pg_temp.expect_error($q$select public.get_my_authority_compatibility(pg_temp.id('org-b'))$q$, '42501');
select pg_temp.expect_error($q$insert into public.organization_contributor_designations(organization_id,user_id,designation)
  values(pg_temp.id('org-a'),pg_temp.id('alice'),'intern')$q$, '42501');
select pg_temp.expect_error($q$update public.project_manager_bindings set status='revoked',revoked_at=now()$q$, '42501');
select pg_temp.expect_error($q$select * from private.n1_authority_backfill_issues$q$, '42501');

-- Revocation is checked against database membership on the next read, not JWT role.
reset role;
update public.organization_memberships set status='revoked' where user_id=pg_temp.id('alice');
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.project_manager_bindings), 'revoked session cannot read bindings');
select pg_temp.expect_error($q$select public.get_my_authority_compatibility(pg_temp.id('org-a'))$q$, '42501');
select set_config('request.jwt.claim.sub',pg_temp.id('client')::text,true);
select pg_temp.expect_error($q$select public.get_my_authority_compatibility(pg_temp.id('org-a'))$q$, '42501');
select set_config('request.jwt.claim.sub',pg_temp.id('inactive-org')::text,true);
select pg_temp.expect_error($q$select public.get_my_authority_compatibility(pg_temp.id('org-inactive'))$q$, '42501');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$select public.get_my_authority_compatibility(pg_temp.id('org-a'))$q$, '42501');
reset role;
select pg_temp.check_true((select count(*)=3 from public.organization_department_memberships where user_id=pg_temp.id('alice')), 'membership revocation leaves history intact');
select pg_temp.check_true((select role='executive' from public.organization_memberships where user_id=pg_temp.id('elevated')), 'legacy elevated Executive remains unchanged');
rollback;
\echo N1 isolated migration behavior assertions passed
