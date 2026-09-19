begin;
insert into public.organization_memberships(organization_id,user_id,role,department_id,member_kind,status)
values(pg_temp.id('org-b'),pg_temp.id('bob'),'contributor','foreign','team','active');
insert into public.organization_department_memberships(organization_id,user_id,department_id,source)
values(pg_temp.id('org-b'),pg_temp.id('bob'),'foreign','explicit');
insert into public.project_manager_bindings(organization_id,user_id,project_id,source)
values(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('verified'),'explicit'),
(pg_temp.id('org-b'),pg_temp.id('bob'),pg_temp.id('foreign-project'),'explicit');
set role service_role;
insert into public.tasks(id,organization_id,project_id,user_id,created_by,assigned_to)
values(pg_temp.id('d-task'),pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('alice'),pg_temp.id('alice'),pg_temp.id('bob'));
select public.save_work_item(null,pg_temp.id('eng-1'),'Retain this work','','task','medium','not_started',
 pg_temp.id('bob'),'design',null,null,null,null,null,0,null,pg_temp.id('alice'),'manual');
insert into public.tasks(id,organization_id,project_id,user_id,created_by,assigned_to)
values(pg_temp.id('d-other-task'),pg_temp.id('org-b'),pg_temp.id('foreign-project'),pg_temp.id('other-owner'),pg_temp.id('other-owner'),pg_temp.id('bob'));
reset role;
-- Minimal approved delegation history owned by target; no scheduler/provider run.
insert into public.recurring_work_plans(id,organization_id,project_id,engagement_id,engagement_service_id,service_id,status_changed_by,created_by)
values(pg_temp.id('d-plan'),pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('eng-1'),pg_temp.id('service'),pg_temp.id('catalog'),pg_temp.id('bob'),pg_temp.id('bob'));
insert into public.recurring_work_plan_versions(id,organization_id,plan_id,version_number,title,frequency,timezone,effective_start,created_by)
values(pg_temp.id('d-version'),pg_temp.id('org-a'),pg_temp.id('d-plan'),1,'Retained history','weekly','UTC',current_date,pg_temp.id('bob'));
insert into private.n1c_recurring_delegations(organization_id,project_id,plan_id,plan_version_id,approved_by,payload,approval_basis,approved_binding_id)
select pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('d-plan'),pg_temp.id('d-version'),pg_temp.id('bob'),'{}','project_manager',id
from public.project_manager_bindings where organization_id=pg_temp.id('org-a') and user_id=pg_temp.id('bob') and status='active';
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('alice')::text,true);
select pg_temp.expect_error($q$select public.deactivate_organization_member(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('denied'))$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select set_config('request.jwt.claim.sub',pg_temp.id('ops')::text,true);
select pg_temp.expect_error($q$select public.deactivate_organization_member(pg_temp.id('org-a'),pg_temp.id('owner'),pg_temp.id('last-owner'))$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select pg_temp.expect_error($q$select public.deactivate_organization_member(pg_temp.id('org-a'),pg_temp.id('foreign'),pg_temp.id('foreign-target'))$q$,'42501');
select pg_temp.expect_error($q$select public.deactivate_organization_member(pg_temp.id('org-b'),pg_temp.id('bob'),pg_temp.id('foreign-org'))$q$,'42501');
select pg_temp.expect_error($q$select public.deactivate_organization_member(pg_temp.id('org-a'),pg_temp.id('owner'),pg_temp.id('self'))$q$,'42501');
do $$
declare first jsonb; replay jsonb; again jsonb;
begin
 first:=public.deactivate_organization_member(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('deactivate'));
 replay:=public.deactivate_organization_member(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('deactivate'));
 again:=public.deactivate_organization_member(pg_temp.id('org-a'),pg_temp.id('bob'),pg_temp.id('repeat'));
 perform pg_temp.check_true(first->>'audit_id'=replay->>'audit_id' and (replay->>'replayed')::boolean,'same request replays original audit');
 perform pg_temp.check_true((again->>'already_deactivated')::boolean and again->>'audit_id' is null,'repeat is no-op audit');
 perform pg_temp.check_true(jsonb_array_length(first->'reassignment_records')=2,'both work types flagged without changing work');
 perform pg_temp.check_true((first->>'auth_account_preserved')::boolean and not (first->>'sessions_revoked')::boolean,'no global account/session claim');
 perform pg_temp.expect_error($q$select public.deactivate_organization_member(pg_temp.id('org-a'),pg_temp.id('alice'),pg_temp.id('deactivate'))$q$,'23505');
 perform pg_temp.check_true(jsonb_array_length(public.get_organization_deactivation_history(pg_temp.id('org-a'),pg_temp.id('bob'))->'history')=1,'one retained deactivation record');
end $$;
-- Same already-authenticated identity, no token refresh or global sign-out.
select set_config('request.jwt.claim.sub',pg_temp.id('bob')::text,true);
select pg_temp.check_true(not public.is_team_organization_member(pg_temp.id('org-a')) and public.is_team_organization_member(pg_temp.id('org-b')),'current membership isolates revoked organization');
select pg_temp.expect_error($q$select public.get_assignment_capabilities(pg_temp.id('org-a'),pg_temp.id('verified'))$q$,'42501');
select pg_temp.expect_error($q$insert into public.tasks(project_id,user_id,created_by) values(pg_temp.id('verified'),pg_temp.id('bob'),pg_temp.id('bob'))$q$,'42501');
select pg_temp.expect_error($q$select public.get_organization_deactivation_history(pg_temp.id('org-a'),pg_temp.id('bob'))$q$,'42501');
select pg_temp.check_true((public.get_assignment_capabilities(pg_temp.id('org-b'),pg_temp.id('foreign-project'))->>'can_assign')::boolean,'other organization PM access retained');
reset role;
select set_config('request.jwt.claim.sub','',true);
set role service_role;
select pg_temp.expect_error($q$select public.update_p5_project_task(pg_temp.id('org-a'),pg_temp.id('d-task'),1,'backlog',pg_temp.id('bob'),null,'',pg_temp.id('bob'))$q$,'42501');
reset role;
select pg_temp.check_true((select status='revoked' from public.organization_memberships where organization_id=pg_temp.id('org-a') and user_id=pg_temp.id('bob')),'membership retained revoked');
select pg_temp.check_true((select status='active' from public.organization_memberships where organization_id=pg_temp.id('org-b') and user_id=pg_temp.id('bob')),'other org retained');
select pg_temp.check_true(not exists(select 1 from public.organization_department_memberships where organization_id=pg_temp.id('org-a') and user_id=pg_temp.id('bob') and status='active'),'department authority revoked');
select pg_temp.check_true(not exists(select 1 from public.organization_contributor_designations where organization_id=pg_temp.id('org-a') and user_id=pg_temp.id('bob') and status='active'),'designation revoked but retained');
select pg_temp.check_true(not exists(select 1 from public.project_manager_bindings where organization_id=pg_temp.id('org-a') and user_id=pg_temp.id('bob') and status='active'),'PM authority revoked');
select pg_temp.check_true((select status='revoked' from private.n1c_recurring_delegations where approved_by=pg_temp.id('bob')),'delegation withdrawn');
select pg_temp.check_true((select count(*)=2 and bool_and(assigned_to=pg_temp.id('bob') and row_version=1) from public.tasks),'work assignments and versions preserved');
select pg_temp.check_true(exists(select 1 from auth.users where id=pg_temp.id('bob')) and exists(select 1 from public.profiles where id=pg_temp.id('bob')),'Auth/profile retained');
select pg_temp.expect_error('delete from private.n1d_deactivations','42501');
-- Fixed-Anka atomic app provisioning, without global profile mutation.
insert into public.organizations values('8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25','active');
insert into public.departments(id,organization_id,name) values('development','8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25','Development');
insert into public.organization_memberships(organization_id,user_id,role,member_kind,status)
values('8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25',pg_temp.id('owner'),'system_owner','team','active');
insert into auth.users(id,email) values(pg_temp.id('new-invite'),'new@example.invalid');
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select pg_temp.expect_error($q$select public.complete_team_invitation(pg_temp.id('new-invite'),'new@example.invalid','design','contributor')$q$,'42501');
reset role;
select pg_temp.check_true(not exists(select 1 from public.organization_memberships where user_id=pg_temp.id('new-invite')),'failed setup leaves no partial membership');
set role authenticated;
select public.complete_team_invitation(pg_temp.id('new-invite'),'new@example.invalid','development','contributor');
select pg_temp.expect_error($q$select public.complete_team_invitation(pg_temp.id('new-invite'),'new@example.invalid','development','operations_admin')$q$,'23505');
reset role;
rollback;
\echo N1-D scoped deactivation/provisioning behavior passed.
