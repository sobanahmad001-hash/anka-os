-- Real N1-E migration behavior on synthetic remaining parents; no hosted claims.
create function pg_temp.n1e_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'N1-E assertion failed: %',label; end if; end $$;
create function pg_temp.n1e_error(statement text,state text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=state then return; end if;
    raise exception 'Expected %, received %: %',state,sqlstate,sqlerrm;
  end;
  raise exception 'Expected error %, but action succeeded: %',state,statement;
end $$;

-- A named PM can confirm this exact specialist-approved version, but cannot
-- become its specialist reviewer or the actor releasing it.
set role authenticated;
select set_config('request.jwt.claim.sub',md5('alice')::uuid::text,false);
select pg_temp.n1e_check((public.get_deliverable_version_capabilities(md5('org-a')::uuid,
  md5('version')::uuid)->>'can_confirm_pm')::boolean,'exact PM can confirm');
select pg_temp.n1e_check(not (public.get_deliverable_version_capabilities(md5('org-a')::uuid,
  md5('version')::uuid)->>'can_release')::boolean,'PM cannot release');
select pg_temp.n1e_check((public.confirm_governed_deliverable_project_manager(md5('org-a')::uuid,
  md5('version')::uuid,2,md5('confirm-1')::uuid)->>'confirmed')::boolean,'PM confirmation');
select pg_temp.n1e_check((public.confirm_governed_deliverable_project_manager(md5('org-a')::uuid,
  md5('version')::uuid,2,md5('confirm-1')::uuid)->>'idempotent_replay')::boolean,'exact replay');
select pg_temp.n1e_error('select public.confirm_governed_deliverable_project_manager('
  ||quote_literal(md5('org-a')::uuid)||','||quote_literal(md5('version')::uuid)
  ||',3,'||quote_literal(md5('confirm-1')::uuid)||')','23505');
reset role;
select pg_temp.n1e_check((select count(*)=1 from public.deliverable_pm_confirmations),
  'one immutable confirmation');

-- The original P7 release RPC still works on an independently approved
-- version without a PM confirmation; the new record is not a universal gate.
insert into public.deliverable_versions(id,organization_id,project_id,deliverable_id,version_number,
  title,review_status,created_by,internal_reviewer_id,state_version)
values(md5('version-release')::uuid,md5('org-a')::uuid,md5('verified')::uuid,
  md5('deliverable')::uuid,2,'Release without PM record','ready_for_client_review',
  md5('bob')::uuid,md5('owner')::uuid,2);
insert into public.approvals(organization_id,project_id,deliverable_id,deliverable_version_id,
  approval_type,decision,decided_by) values(md5('org-a')::uuid,md5('verified')::uuid,
  md5('deliverable')::uuid,md5('version-release')::uuid,'internal_quality','approved',md5('owner')::uuid);
set role authenticated;
select set_config('request.jwt.claim.sub',md5('ops')::uuid::text,false);
select pg_temp.n1e_check((public.get_deliverable_version_capabilities(md5('org-a')::uuid,
  md5('version-release')::uuid)->>'can_release')::boolean,'leadership release capability without PM record');
select pg_temp.n1e_check((public.release_governed_deliverable_version(md5('org-a')::uuid,
  md5('version-release')::uuid,2,false,'Client review',md5('release-1')::uuid)->>'review_status')
  ='client_reviewing','real P7 release without PM confirmation');
reset role;
select pg_temp.n1e_check((select count(*)=0 from public.deliverable_pm_confirmations
  where deliverable_version_id=md5('version-release')::uuid),'release did not manufacture confirmation');

-- Receipt replay cannot turn a revoked exact-project PM binding into authority.
update public.project_manager_bindings set status='revoked',revoked_at=clock_timestamp()
where organization_id=md5('org-a')::uuid and project_id=md5('verified')::uuid
  and user_id=md5('alice')::uuid and status='active';
set role authenticated;
select set_config('request.jwt.claim.sub',md5('alice')::uuid::text,false);
select pg_temp.n1e_error('select public.confirm_governed_deliverable_project_manager('
  ||quote_literal(md5('org-a')::uuid)||','||quote_literal(md5('version')::uuid)
  ||',2,'||quote_literal(md5('confirm-1')::uuid)||')','42501');
reset role;

-- Artifact approval nomination, sign-off, and change requests recheck project
-- specialist scope and named participation. A PM binding alone cannot sign.
set role service_role;
select pg_temp.n1e_error('select public.create_artifact_approval_request('
  ||quote_literal(md5('artifact-version')::uuid)||',''parallel'',array['
  ||quote_literal(md5('alice')::uuid)||','||quote_literal(md5('head')::uuid)
  ||']::uuid[],'||quote_literal(md5('owner')::uuid)||')','42501');
create temporary table n1e_request as select (public.create_artifact_approval_request(
  md5('artifact-version')::uuid,'parallel',array[md5('owner')::uuid,md5('head')::uuid],
  md5('owner')::uuid)->>'id')::uuid id;
select pg_temp.n1e_error('select public.sign_off_artifact_approval('
  ||quote_literal((select id from n1e_request))||','||quote_literal(md5('alice')::uuid)||')','42501');
select pg_temp.n1e_check((public.request_artifact_approval_changes((select id from n1e_request),
  md5('head')::uuid,'Please revise spacing',md5('change-1')::uuid)->>'idempotent_replay')::boolean=false,
  'named head can request changes');
select pg_temp.n1e_check((public.request_artifact_approval_changes((select id from n1e_request),
  md5('head')::uuid,'Please revise spacing',md5('change-1')::uuid)->>'idempotent_replay')::boolean,
  'change request replay');
select pg_temp.n1e_check((public.sign_off_artifact_approval((select id from n1e_request),
  md5('owner')::uuid)->>'status')='pending','first specialist sign-off');
select pg_temp.n1e_check((public.sign_off_artifact_approval((select id from n1e_request),
  md5('head')::uuid)->>'status')='completed','second specialist sign-off');
reset role;
select pg_temp.n1e_check((select count(*)=1 from public.artifact_approvals
  where artifact_version_id=md5('artifact-version')::uuid),'one artifact approval');
insert into public.artifacts(id,organization_id,engagement_id,project_id,artifact_type,created_by)
values(md5('artifact-2')::uuid,md5('org-a')::uuid,md5('eng-1')::uuid,
  md5('verified')::uuid,'design_system',md5('bob')::uuid);
insert into public.artifact_versions(id,organization_id,artifact_id,created_by)
values(md5('artifact-version-2')::uuid,md5('org-a')::uuid,md5('artifact-2')::uuid,
  md5('bob')::uuid);
set role service_role;
create temporary table n1e_revoked_request as select (public.create_artifact_approval_request(
  md5('artifact-version-2')::uuid,'parallel',array[md5('owner')::uuid,md5('head')::uuid],
  md5('owner')::uuid)->>'id')::uuid id;
reset role;
update public.project_department_participation set status='revoked',
  revoked_by=md5('owner')::uuid,revoked_at=clock_timestamp()
where organization_id=md5('org-a')::uuid and project_id=md5('verified')::uuid
  and department_id='design' and status='active';
set role service_role;
select pg_temp.n1e_error('select public.sign_off_artifact_approval('
  ||quote_literal((select id from n1e_revoked_request))||','||quote_literal(md5('head')::uuid)||')','42501');
reset role;
select pg_temp.n1e_check((select count(*)=1 from public.artifact_approvals),
  'revoked participation cannot add artifact approval');
select 'N1-E focused migration and behavior assertions passed' as result;
