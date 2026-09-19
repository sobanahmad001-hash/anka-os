\set ON_ERROR_STOP on
begin;
create function pg_temp.read_admin(who text) returns jsonb language sql as $$
  select public.get_authority_administration(pg_temp.id('org-a'),pg_temp.id(who));
$$;
create function pg_temp.change_admin(who text, action text, value text) returns jsonb language sql as $$
  select public.change_authority_compatibility(pg_temp.id('org-a'),pg_temp.id(who),action,value,
    pg_temp.read_admin(who)->>'token',gen_random_uuid());
$$;
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
do $$
declare info jsonb; first_result jsonb; again jsonb; nonce uuid := gen_random_uuid(); token text; dept_id text; pm_id text;
begin
  info := public.get_authority_administration(pg_temp.id('org-a'));
  perform pg_temp.check_true(info->>'compatibility_only'='true' and info->'snapshot'='null'::jsonb, 'scoped initial admin options');
  perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(info->'members') x where x->>'organization_id'<>pg_temp.id('org-a')::text), 'no foreign members');
  perform pg_temp.check_true(jsonb_array_length(info->'departments')=2, 'only same-org departments');
  perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(info->'projects') x where x->>'id' in (pg_temp.id('archived')::text,pg_temp.id('foreign-project')::text)), 'no foreign or archived project options');
  token := pg_temp.read_admin('alice')->>'token';
  first_result := public.change_authority_compatibility(pg_temp.id('org-a'),pg_temp.id('alice'),'add_department','content',token,nonce);
  dept_id := first_result->>'record_id';
  again := public.change_authority_compatibility(pg_temp.id('org-a'),pg_temp.id('alice'),'add_department','content',token,nonce);
  perform pg_temp.check_true(again->>'replayed'='true' and again->>'record_id'=dept_id, 'same command replay, single row');
  perform pg_temp.expect_error(format('select public.change_authority_compatibility(%L,%L,%L,%L,%L,%L)',pg_temp.id('org-a'),pg_temp.id('alice'),'add_department','design',token,nonce),'23505');
  perform pg_temp.expect_error(format('select public.change_authority_compatibility(%L,%L,%L,%L,%L,%L)',pg_temp.id('org-a'),pg_temp.id('alice'),'set_designation','intern',token,gen_random_uuid()),'40001');
  perform pg_temp.check_true(jsonb_array_length(pg_temp.read_admin('alice')->'snapshot'->'department_memberships')=2,'multiple active departments');
  perform pg_temp.expect_error($q$select pg_temp.change_admin('alice','add_department','content')$q$,'23505');
  perform pg_temp.change_admin('alice','revoke_department',dept_id);
  perform pg_temp.change_admin('alice','add_department','content');
  perform pg_temp.check_true(jsonb_array_length(pg_temp.read_admin('alice')->'snapshot'->'department_memberships')=3,'department revoke/readd history retained');
  perform pg_temp.change_admin('alice','set_designation','intern');
  perform pg_temp.change_admin('alice','set_designation','executive');
  perform pg_temp.check_true(pg_temp.read_admin('alice')->'snapshot'->>'legacy_role'='contributor','executive designation does not elevate role');
  perform pg_temp.check_true(jsonb_array_length(pg_temp.read_admin('alice')->'snapshot'->'contributor_designations')=2,'designation replacement preserves history');
  perform pg_temp.change_admin('alice','set_designation','executive');
  perform pg_temp.check_true(jsonb_array_length(pg_temp.read_admin('alice')->'snapshot'->'contributor_designations')=2,'same designation creates no duplicate history');
  perform pg_temp.change_admin('alice','set_designation',null);
  perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(pg_temp.read_admin('alice')->'snapshot'->'contributor_designations') x where x->>'status'='active'),'clear designation revokes only');
  first_result := pg_temp.change_admin('bob','add_project_manager',pg_temp.id('verified')::text);
  pm_id := first_result->>'record_id';
  perform pg_temp.change_admin('bob','add_project_manager',pg_temp.id('verified-2')::text);
  perform pg_temp.check_true(jsonb_array_length(pg_temp.read_admin('bob')->'snapshot'->'project_manager_bindings')=2,'one user multiple project bindings');
  perform pg_temp.check_true(jsonb_array_length(pg_temp.read_admin('alice')->'snapshot'->'project_manager_bindings')=1,'existing PM retained when adding another');
  perform pg_temp.change_admin('bob','revoke_project_manager',pm_id);
  perform pg_temp.change_admin('bob','add_project_manager',pg_temp.id('verified')::text);
  perform pg_temp.check_true(jsonb_array_length(pg_temp.read_admin('bob')->'snapshot'->'project_manager_bindings')=3,'PM revoke/readd history retained');
  perform pg_temp.expect_error($q$select pg_temp.change_admin('foreign','set_designation','intern')$q$,'42501');
  perform pg_temp.expect_error($q$select pg_temp.change_admin('client','set_designation','intern')$q$,'42501');
  perform pg_temp.expect_error($q$select pg_temp.change_admin('revoked','add_department','content')$q$,'42501');
  perform pg_temp.expect_error($q$select pg_temp.change_admin('alice','add_department','foreign')$q$,'42501');
  perform pg_temp.expect_error(format('select pg_temp.change_admin(%L,%L,%L)','alice','add_project_manager',pg_temp.id('foreign-project')),'42501');
  perform pg_temp.expect_error(format('select pg_temp.change_admin(%L,%L,%L)','alice','add_project_manager',pg_temp.id('archived')),'42501');
  perform pg_temp.expect_error($q$select pg_temp.change_admin('elevated','set_designation','executive')$q$,'42501');
  perform pg_temp.expect_error($q$select pg_temp.change_admin('alice','set_designation','system_owner')$q$,'42501');
  perform pg_temp.expect_error(format('select pg_temp.change_admin(%L,%L,%L)','alice','revoke_project_manager',pm_id),'42501');
  perform pg_temp.expect_error($q$select pg_temp.change_admin('alice','not_an_action',null)$q$,'22023');
  perform pg_temp.expect_error($q$select private.n1b_snapshot(pg_temp.id('org-a'),pg_temp.id('alice'))$q$,'42501');
  perform pg_temp.expect_error($q$select private.n1b_require_admin(pg_temp.id('org-a'))$q$,'42501');
  perform pg_temp.expect_error($q$select * from private.n1b_authority_requests$q$,'42501');
end $$;
-- Every disallowed role fails both entry points, independent of titles/old permissions.
do $$
declare who text;
begin
  foreach who in array array['alice','elevated','title-only','bad-dept','client','revoked-admin','foreign','other-owner'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.id(who)::text,true);
    perform pg_temp.expect_error($q$select public.get_authority_administration(pg_temp.id('org-a'))$q$,'42501');
    perform pg_temp.expect_error($q$select public.change_authority_compatibility(pg_temp.id('org-a'),pg_temp.id('bob'),'set_designation','intern','fake',gen_random_uuid())$q$,'42501');
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_error($q$select public.get_authority_administration(pg_temp.id('org-a'))$q$,'42501');
  perform set_config('request.jwt.claim.sub',pg_temp.id('suspended-owner')::text,true);
  perform pg_temp.expect_error($q$select public.get_authority_administration(pg_temp.id('org-inactive'))$q$,'42501');
  perform set_config('request.jwt.claim.sub',pg_temp.id('ops')::text,true);
  perform pg_temp.change_admin('bob','set_designation','intern');
  perform pg_temp.check_true(pg_temp.read_admin('bob')->'snapshot'->>'legacy_role'='contributor','operations admin success');
end $$;
reset role;
-- Parent records/policies and direct browser ACLs remain unchanged.
select pg_temp.check_true(not exists(select * from public.organization_memberships except select * from private.n1b_parent_memberships),'legacy memberships unchanged');
select pg_temp.check_true(not exists(select * from public.projects except select * from private.n1b_parent_projects),'legacy projects unchanged');
select pg_temp.check_true(not exists(select * from public.profiles except select * from private.n1b_parent_profiles),'profiles unchanged');
select pg_temp.check_true(not exists(select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies except select * from private.n1b_prior_policies),'policies unchanged');
select pg_temp.check_true(not exists(select 1 from private.n1b_prior_acl a join pg_class c on c.oid=a.oid where c.relacl is distinct from a.relacl),'existing table ACL unchanged');
select pg_temp.check_true(not exists(select 1 from pg_proc where oid in ('public.get_authority_administration(uuid,uuid)'::regprocedure,'public.change_authority_compatibility(uuid,uuid,text,text,text,uuid)'::regprocedure) and prosecdef),'public wrappers are invoker');
select pg_temp.check_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'n1b_%' and p.proconfig is distinct from array['search_path=""']),'fixed empty search paths');
select pg_temp.expect_error('update private.n1b_authority_requests set created_at=clock_timestamp()','42501');
select pg_temp.expect_error('delete from private.n1b_authority_requests','42501');
do $$
declare role_name text; table_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach table_name in array array['organization_department_memberships','organization_contributor_designations','project_manager_bindings'] loop
      perform pg_temp.check_true(not has_table_privilege(role_name,'public.'||table_name,'INSERT') and
        not has_table_privilege(role_name,'public.'||table_name,'UPDATE') and not has_table_privilege(role_name,'public.'||table_name,'DELETE'),'no direct browser writes');
    end loop;
  end loop;
end $$;
-- Current membership/organization revalidation; clearing records for inactive targets is allowed.
update public.organization_memberships set status='revoked' where user_id=pg_temp.id('bob');
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select pg_temp.change_admin('bob','set_designation',null);
select pg_temp.expect_error($q$select pg_temp.change_admin('bob','set_designation','intern')$q$,'42501');
reset role;
update public.organization_memberships set role='contributor' where user_id=pg_temp.id('owner');
set role authenticated;
select pg_temp.expect_error($q$select public.get_authority_administration(pg_temp.id('org-a'))$q$,'42501');
select pg_temp.expect_error($q$select public.change_authority_compatibility(pg_temp.id('org-a'),pg_temp.id('alice'),'set_designation','intern','fake',gen_random_uuid())$q$,'42501');
reset role;
update public.organizations set status='suspended' where id=pg_temp.id('org-a');
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('ops')::text,true);
select pg_temp.expect_error($q$select public.get_authority_administration(pg_temp.id('org-a'))$q$,'42501');
reset role;
set role anon;
select pg_temp.expect_error($q$select public.get_authority_administration(pg_temp.id('org-a'))$q$,'42501');
select pg_temp.expect_error($q$select public.change_authority_compatibility(pg_temp.id('org-a'),pg_temp.id('alice'),'set_designation','intern','fake',gen_random_uuid())$q$,'42501');
reset role;
set role service_role;
select pg_temp.expect_error($q$select public.get_authority_administration(pg_temp.id('org-a'))$q$,'42501');
reset role;
rollback;
\echo N1-B administration behavior passed.
