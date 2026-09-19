-- Same isolated psql session, after fixture/migration/behavior; no live database.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select pg_temp.check_true(current_user='service_role' and not (select rolsuper from pg_roles where rolname=current_user), 'actual non-superuser service role');
select pg_temp.check_true((select count(*)=9 from public.organization_memberships)
  and (select count(*)=3 from public.organizations), 'service-role parent SELECT with RLS and no caller identity');
select pg_temp.check_true(has_schema_privilege(current_user,'private','USAGE')
  and has_function_privilege(current_user,'private.n1_guard_compatibility_history()','EXECUTE'), 'service-role trigger schema/function access');

insert into public.organization_department_memberships(organization_id,user_id,department_id,source)
values(pg_temp.id('org-a'),pg_temp.id('bob'),'design','explicit');
insert into public.organization_contributor_designations(organization_id,user_id,designation)
values(pg_temp.id('org-a'),pg_temp.id('bob'),'intern');
insert into public.project_manager_bindings(organization_id,user_id,project_id,source)
values(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('verified-2'),'explicit');
select pg_temp.check_true((select count(*)=1 from public.organization_department_memberships where user_id=pg_temp.id('bob') and source='explicit' and status='active'), 'service department insert');
select pg_temp.check_true((select count(*)=1 from public.organization_contributor_designations where user_id=pg_temp.id('bob') and status='active'), 'service designation insert');
select pg_temp.check_true((select count(*)=1 from public.project_manager_bindings where user_id=pg_temp.id('bob') and status='active'), 'service PM insert');

update public.organization_department_memberships set status='revoked',revoked_at=now() where user_id=pg_temp.id('bob') and source='explicit';
update public.organization_contributor_designations set status='revoked',revoked_at=now() where user_id=pg_temp.id('bob');
update public.project_manager_bindings set status='revoked',revoked_at=now() where user_id=pg_temp.id('bob');
insert into public.organization_department_memberships(organization_id,user_id,department_id,source)
values(pg_temp.id('org-a'),pg_temp.id('bob'),'design','explicit');
insert into public.organization_contributor_designations(organization_id,user_id,designation)
values(pg_temp.id('org-a'),pg_temp.id('bob'),'executive');
insert into public.project_manager_bindings(organization_id,user_id,project_id,source)
values(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('verified-2'),'explicit');
select pg_temp.check_true((select count(*)=2 and count(*) filter(where status='revoked')=1 and count(*) filter(where status='active')=1
  from public.organization_department_memberships where user_id=pg_temp.id('bob') and source='explicit'), 'service department revoke/re-add retains history');
select pg_temp.check_true((select count(*)=2 and count(*) filter(where status='revoked')=1 and count(*) filter(where status='active')=1
  from public.organization_contributor_designations where user_id=pg_temp.id('bob')), 'service designation revoke/re-add retains history');
select pg_temp.check_true((select count(*)=2 and count(*) filter(where status='revoked')=1 and count(*) filter(where status='active')=1
  from public.project_manager_bindings where user_id=pg_temp.id('bob')), 'service PM revoke/re-add retains history');
select pg_temp.expect_error('delete from public.organization_department_memberships', '42501');
select pg_temp.expect_error('delete from public.organization_contributor_designations', '42501');
select pg_temp.expect_error('delete from public.project_manager_bindings', '42501');
select pg_temp.check_true((select count(*)=9 from private.n1_authority_backfill_issues), 'service-role private issue ledger read');
select pg_temp.expect_error('delete from private.n1_authority_backfill_issues', '42501');
select pg_temp.expect_error($q$insert into public.project_manager_bindings(organization_id,user_id,project_id,source)
  values(pg_temp.id('org-a'),pg_temp.id('revoked'),pg_temp.id('verified'),'explicit')$q$, '42501');

-- Prove the invoker trigger really needs both parent reads, rather than being
-- accidentally bypassed by postgres execution or relying on a definer shortcut.
reset role;
savepoint no_organization_read;
revoke select on public.organizations from service_role;
set local role service_role;
select pg_temp.expect_error($q$insert into public.organization_department_memberships(organization_id,user_id,department_id,source)
  values(pg_temp.id('org-a'),pg_temp.id('alice'),'content','explicit')$q$, '42501');
reset role;
rollback to no_organization_read;
savepoint no_membership_read;
revoke select on public.organization_memberships from service_role;
set local role service_role;
select pg_temp.expect_error($q$insert into public.organization_contributor_designations(organization_id,user_id,designation)
  values(pg_temp.id('org-a'),pg_temp.id('alice'),'intern')$q$, '42501');
reset role;
rollback to no_membership_read;

-- Invoker-only temporary helper runs nine actual denied writes per browser role.
create function pg_temp.n1_denied_mutations() returns void language plpgsql security invoker as $$
declare table_name text; extra_column text; extra_value text;
begin
  foreach table_name in array array['organization_department_memberships','organization_contributor_designations','project_manager_bindings'] loop
    perform pg_temp.check_true(not has_table_privilege(current_user,'public.'||table_name,'INSERT')
      and not has_table_privilege(current_user,'public.'||table_name,'UPDATE')
      and not has_table_privilege(current_user,'public.'||table_name,'DELETE'), current_user||' mutation ACL: '||table_name);
    extra_column := case table_name when 'organization_department_memberships' then 'department_id' when 'organization_contributor_designations' then 'designation' else 'project_id' end;
    extra_value := case table_name when 'organization_department_memberships' then quote_literal('content') when 'organization_contributor_designations' then quote_literal('intern') else 'pg_temp.id(''verified'')' end;
    perform pg_temp.expect_error(format('insert into public.%I(organization_id,user_id,source,%I) values(pg_temp.id(''org-a''),pg_temp.id(''alice''),''explicit'',%s)',table_name,extra_column,extra_value),'42501');
    perform pg_temp.expect_error(format('update public.%I set status=''revoked'',revoked_at=now()',table_name),'42501');
    perform pg_temp.expect_error(format('delete from public.%I',table_name),'42501');
  end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('alice')::text,true);
select pg_temp.n1_denied_mutations();
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.n1_denied_mutations();
reset role;
rollback;
\echo N1 service-role round trips, parent reads, ledger access and browser mutation denials passed
