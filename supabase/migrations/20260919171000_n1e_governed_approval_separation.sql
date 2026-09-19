-- N1-E local compatibility cutover candidate: three separate governed decisions.
-- This migration adds exact-project PM confirmation without changing P7 lifecycle states.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function private.n1e_org_authority(p_org uuid,p_project uuid,p_actor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare member_role text;
begin
  member_role:=private.n1c_require_scope(p_org,p_project,p_actor);
  return member_role in ('system_owner','operations_admin','executive');
end; $$;
create function private.n1e_exact_project_manager(p_org uuid,p_project uuid,p_actor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  perform private.n1c_require_scope(p_org,p_project,p_actor);
  perform 1 from public.project_manager_bindings b where b.organization_id=p_org and b.project_id=p_project and b.user_id=p_actor and b.status='active' for share;
  return found;
end; $$;
create function private.n1e_department_head(p_org uuid,p_project uuid,p_department text,p_actor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  perform private.n1c_require_scope(p_org,p_project,p_actor);
  perform 1 from public.organization_memberships m join public.project_department_participation pp on pp.organization_id=m.organization_id and pp.project_id=p_project and pp.department_id=m.department_id and pp.status='active'
   where m.organization_id=p_org and m.user_id=p_actor and m.member_kind='team' and m.status='active' and m.role='department_manager' and m.department_id=p_department for share of m,pp;
  return found;
end; $$;
create function private.n1e_specialist_authority(p_org uuid,p_project uuid,p_department text,p_actor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin return private.n1e_org_authority(p_org,p_project,p_actor) or private.n1e_department_head(p_org,p_project,p_department,p_actor); end; $$;

-- Specialist review, exact-PM confirmation, and release remain distinct.
create or replace function private.p7_eligible_reviewer(p_org uuid,p_project uuid,p_department text,p_creator uuid,p_owner uuid,p_reviewer uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin return p_reviewer is distinct from p_creator and p_reviewer is distinct from p_owner and private.n1e_specialist_authority(p_org,p_project,p_department,p_reviewer); end; $$;
create or replace function private.p7_release_authority(p_org uuid,p_project uuid,p_actor uuid)
returns boolean language sql security invoker set search_path='' as $$ select private.n1e_org_authority(p_org,p_project,p_actor); $$;
create or replace function private.p7_assignment_authority(p_org uuid,p_project uuid,p_department text,p_actor uuid)
returns boolean language sql security invoker set search_path='' as $$ select private.n1e_org_authority(p_org,p_project,p_actor) or private.n1e_exact_project_manager(p_org,p_project,p_actor) or private.n1e_department_head(p_org,p_project,p_department,p_actor); $$;

create table public.deliverable_pm_confirmations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict, project_id uuid not null, deliverable_id uuid not null, deliverable_version_id uuid not null,
 confirmed_by uuid not null references auth.users(id) on delete restrict, confirmed_state_version bigint not null check(confirmed_state_version>0), request_id uuid not null, confirmed_at timestamptz not null default clock_timestamp(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
 foreign key(deliverable_version_id,deliverable_id,project_id,organization_id) references public.deliverable_versions(id,deliverable_id,project_id,organization_id) on delete restrict,
 unique(deliverable_version_id),unique(organization_id,confirmed_by,request_id)
);
alter table public.deliverable_pm_confirmations enable row level security;
create policy "Team can read PM confirmations" on public.deliverable_pm_confirmations for select to authenticated using(public.is_team_organization_member(organization_id));
revoke all on public.deliverable_pm_confirmations from public,anon,authenticated;
grant select on public.deliverable_pm_confirmations to authenticated;
grant all on public.deliverable_pm_confirmations to service_role;
create trigger n1e_deliverable_pm_confirmations_immutable before update or delete on public.deliverable_pm_confirmations for each row execute function private.p7_reject_history_mutation();

create function public.confirm_governed_deliverable_project_manager(p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; existing public.deliverable_pm_confirmations%rowtype;
begin
 if actor is null or p_request_id is null then raise exception 'Authentication and request id are required.' using errcode='42501'; end if;
 -- A replay is still a privileged current action: a revoked PM cannot use an
 -- old request ID as a capability after their exact-project binding is gone.
 select v.project_id into c from public.deliverable_versions v where v.id=p_deliverable_version_id and v.organization_id=p_organization_id for share;
 if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
 if not (private.n1e_org_authority(p_organization_id,c.project_id,actor) or private.n1e_exact_project_manager(p_organization_id,c.project_id,actor)) then raise exception 'Exact-project PM confirmation authority required.' using errcode='42501'; end if;
 select * into existing from public.deliverable_pm_confirmations where organization_id=p_organization_id and confirmed_by=actor and request_id=p_request_id for share;
 if found then if existing.deliverable_version_id<>p_deliverable_version_id or existing.confirmed_state_version<>p_expected_state_version then raise exception 'Request ID conflict.' using errcode='23505'; end if; return jsonb_build_object('deliverable_version_id',existing.deliverable_version_id,'confirmed',true,'idempotent_replay',true); end if;
 select v.*,d.owner_id deliverable_owner_id into c from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id where v.id=p_deliverable_version_id and v.organization_id=p_organization_id for update of v;
 if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
 if c.state_version<>p_expected_state_version then raise exception 'Deliverable version changed; reload before confirmation.' using errcode='40001'; end if;
 if c.review_status<>'ready_for_client_review' then raise exception 'Only specialist-approved versions can receive PM confirmation.' using errcode='23514'; end if;
 if actor is not distinct from c.created_by or actor is not distinct from c.deliverable_owner_id or actor is not distinct from c.internal_reviewer_id then raise exception 'A PM confirmation cannot self-confirm or duplicate specialist review.' using errcode='42501'; end if;
 insert into public.deliverable_pm_confirmations(organization_id,project_id,deliverable_id,deliverable_version_id,confirmed_by,confirmed_state_version,request_id) values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,actor,p_expected_state_version,p_request_id);
 return jsonb_build_object('deliverable_version_id',p_deliverable_version_id,'confirmed',true,'idempotent_replay',false);
end; $$;
create or replace function public.get_deliverable_version_capabilities(p_organization_id uuid,p_deliverable_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; membership record; assigned uuid; client_allowed boolean:=false; feature_enabled boolean:=false; client_approved boolean:=false; released boolean:=false; delivered_fact boolean:=false; published_fact boolean:=false; pm_confirmed boolean:=false;
begin
 if actor is null then raise exception 'Authentication required.' using errcode='42501'; end if;
 select v.*,d.owner_id deliverable_owner_id,d.workstream_id,w.department_id,p.client_id,p.owner_id project_owner_id into c from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id join public.workstreams w on w.id=d.workstream_id and w.project_id=v.project_id and w.organization_id=v.organization_id join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id where v.id=p_deliverable_version_id and v.organization_id=p_organization_id;
 if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
 select role,department_id,member_kind into membership from public.organization_memberships where organization_id=p_organization_id and user_id=actor and status='active';
 select reviewer_id into assigned from public.deliverable_review_assignments where deliverable_version_id=p_deliverable_version_id and status='current';
 select coalesce((settings->>'client_approvals_enabled')::boolean,false) into feature_enabled from public.organizations where id=p_organization_id and status='active';
 select exists(select 1 from public.approvals where deliverable_version_id=p_deliverable_version_id and approval_type='client_approval' and decision='approved') into client_approved;
 select exists(select 1 from public.deliverable_lifecycle_events where deliverable_version_id=p_deliverable_version_id and event_type='released') into released;
 select exists(select 1 from public.deliverable_lifecycle_events where deliverable_version_id=p_deliverable_version_id and event_type='delivered') into delivered_fact;
 select exists(select 1 from public.deliverable_lifecycle_events where deliverable_version_id=p_deliverable_version_id and event_type='published') into published_fact;
 select exists(select 1 from public.deliverable_pm_confirmations where deliverable_version_id=p_deliverable_version_id and organization_id=p_organization_id) into pm_confirmed;
 select exists(select 1 from public.client_contacts contact join public.project_client_access access on access.client_contact_id=contact.id and access.project_id=c.project_id and access.organization_id=p_organization_id where contact.organization_id=p_organization_id and contact.client_id=c.client_id and contact.auth_user_id=actor and contact.status='active' and contact.portal_role in ('admin','approver') and access.status='active' and access.access_role in ('admin','approver')) into client_allowed;
 if not ((membership.member_kind='team' and private.p7_team(p_organization_id,actor)) or (membership.member_kind='client' and client_allowed)) then raise exception 'Exact-organization deliverable access required.' using errcode='42501'; end if;
 return jsonb_build_object('state_version',c.state_version,'assigned_reviewer_id',assigned,'client_approval_required',c.client_approval_required,'client_approvals_enabled',feature_enabled,'pm_confirmed',pm_confirmed,
  'can_submit',c.review_status='in_production' and membership.member_kind='team' and (membership.department_id=c.department_id or private.n1e_org_authority(p_organization_id,c.project_id,actor) or private.n1e_exact_project_manager(p_organization_id,c.project_id,actor)),
  'can_assign_reviewer',c.review_status='ready_for_internal_review' and private.p7_assignment_authority(p_organization_id,c.project_id,c.department_id,actor),
  'can_review',c.review_status='ready_for_internal_review' and assigned=actor and private.p7_eligible_reviewer(p_organization_id,c.project_id,c.department_id,c.created_by,c.deliverable_owner_id,actor),
  'can_confirm_pm',c.review_status='ready_for_client_review' and not pm_confirmed and actor is distinct from c.created_by and actor is distinct from c.deliverable_owner_id and actor is distinct from c.internal_reviewer_id and (private.n1e_org_authority(p_organization_id,c.project_id,actor) or private.n1e_exact_project_manager(p_organization_id,c.project_id,actor)),
  'can_release',c.review_status='ready_for_client_review' and c.client_id is not null and private.p7_release_authority(p_organization_id,c.project_id,actor),
  'can_client_decide',c.review_status='client_reviewing' and feature_enabled and client_allowed and membership.role in ('client_admin','client_approver'),
  'can_mark_delivered',released and not delivered_fact and c.review_status in ('client_reviewing','client_approved','delivered_published') and private.p7_release_authority(p_organization_id,c.project_id,actor) and not(c.client_approval_required and feature_enabled and not client_approved),
  'can_mark_published',released and not published_fact and c.review_status in ('client_reviewing','client_approved','delivered_published') and private.p7_release_authority(p_organization_id,c.project_id,actor) and not(c.client_approval_required and feature_enabled and not client_approved));
end; $$;

-- Artifact versions are project-scoped but have no canonical department column: unknown types fail closed to leadership.
create function private.n1e_artifact_department(p_type text) returns text language sql immutable set search_path='' as $$ select case when p_type in ('discovery','vision','audience','brand_statement','website_architecture','keyword_strategy','content','campaign_messaging','scripts') then 'content' when p_type in ('channel_strategy','campaign_brief','measurement_plan','marketing_report','seo_research') then 'marketing' when p_type in ('technical_brief','launch_checklist') then 'development' when p_type in ('design_system','design_delivery_package') then 'design' else null end; $$;
create function private.n1e_artifact_approval_authority(p_org uuid,p_project uuid,p_type text,p_version_author uuid,p_artifact_author uuid,p_actor uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare dept text:=private.n1e_artifact_department(p_type); begin if p_actor is not distinct from p_version_author or p_actor is not distinct from p_artifact_author then return false; end if; return private.n1e_org_authority(p_org,p_project,p_actor) or (dept is not null and private.n1e_department_head(p_org,p_project,dept,p_actor)); end; $$;
create function private.n1e_artifact_nomination_authority(p_org uuid,p_project uuid,p_type text,p_actor uuid) returns boolean language sql security invoker set search_path='' as $$ select private.n1e_org_authority(p_org,p_project,p_actor) or private.n1e_exact_project_manager(p_org,p_project,p_actor) or (private.n1e_artifact_department(p_type) is not null and private.n1e_department_head(p_org,p_project,private.n1e_artifact_department(p_type),p_actor)); $$;

create or replace function public.create_artifact_approval_request(p_artifact_version_id uuid,p_approval_policy text,p_required_approver_ids uuid[],p_requested_by uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v record; r public.artifact_approval_requests%rowtype; n integer;
begin
 if p_approval_policy not in ('sequential','parallel') then raise exception 'Approval policy must be sequential or parallel'; end if;
 if p_required_approver_ids is null or cardinality(p_required_approver_ids)<2 or cardinality(p_required_approver_ids)>50 or array_position(p_required_approver_ids,null) is not null then raise exception 'Select between 2 and 50 required approvers'; end if; select count(distinct x) into n from unnest(p_required_approver_ids) x; if n<>cardinality(p_required_approver_ids) then raise exception 'Required approvers must be unique'; end if;
 select av.id,av.organization_id,av.created_by version_author,a.id artifact_id,a.created_by artifact_author,a.project_id,a.artifact_type into v from public.artifact_versions av join public.artifacts a on a.id=av.artifact_id and a.organization_id=av.organization_id where av.id=p_artifact_version_id for update of av;
 if not found or v.project_id is null then raise exception 'Canonical project artifact version required' using errcode='42501'; end if;
 if not private.n1e_artifact_nomination_authority(v.organization_id,v.project_id,v.artifact_type,p_requested_by) then raise exception 'Scoped approval nomination authority required.' using errcode='42501'; end if;
 if exists(select 1 from unnest(p_required_approver_ids) x where not private.n1e_artifact_approval_authority(v.organization_id,v.project_id,v.artifact_type,v.version_author,v.artifact_author,x)) then raise exception 'Every named approver needs current scoped specialist authority and cannot self-approve.' using errcode='42501'; end if;
 if exists(select 1 from public.artifact_approvals where artifact_version_id=v.id) then raise exception 'This artifact version is already approved'; end if;
 insert into public.artifact_approval_requests(organization_id,artifact_version_id,approval_policy,requested_by) values(v.organization_id,v.id,p_approval_policy,p_requested_by) returning * into r;
 insert into public.artifact_approval_signoffs(organization_id,request_id,required_approver_id,sequence_position) select v.organization_id,r.id,x,case when p_approval_policy='sequential' then pos::integer else null end from unnest(p_required_approver_ids) with ordinality a(x,pos); return to_jsonb(r);
end; $$;
create or replace function public.sign_off_artifact_approval(p_request_id uuid,p_actor_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.artifact_approval_requests%rowtype;s public.artifact_approval_signoffs%rowtype;v record;remaining integer;approved public.artifact_approvals%rowtype;
begin
 select * into r from public.artifact_approval_requests where id=p_request_id for update; if not found then raise exception 'Approval request not found'; end if; if r.status<>'pending' then raise exception 'Approval request is not pending'; end if;
 select av.created_by version_author,a.id artifact_id,a.engagement_id,a.artifact_type,a.project_id,a.created_by artifact_author into v from public.artifact_versions av join public.artifacts a on a.id=av.artifact_id and a.organization_id=av.organization_id where av.id=r.artifact_version_id and av.organization_id=r.organization_id;
 if not found or v.project_id is null or not private.n1e_artifact_approval_authority(r.organization_id,v.project_id,v.artifact_type,v.version_author,v.artifact_author,p_actor_id) then raise exception 'Current scoped specialist authority required for sign-off.' using errcode='42501'; end if;
 select * into s from public.artifact_approval_signoffs where request_id=r.id and required_approver_id=p_actor_id for update; if not found then raise exception 'Only a named approver can sign this request' using errcode='42501'; end if; if s.signed_off_at is not null then raise exception 'This approver has already signed'; end if;
 update public.artifact_approval_signoffs set signed_off_at=statement_timestamp() where id=s.id returning * into s; select count(*) into remaining from public.artifact_approval_signoffs where request_id=r.id and signed_off_at is null;
 if remaining=0 then update public.artifact_approval_requests set status='completed' where id=r.id; insert into public.artifact_approvals(organization_id,artifact_id,artifact_version_id,engagement_id,approved_by) values(r.organization_id,v.artifact_id,r.artifact_version_id,v.engagement_id,p_actor_id) returning * into approved; insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload) values(r.organization_id,v.engagement_id,'artifact_approved',p_actor_id,jsonb_build_object('record_type','artifact','record_id',v.artifact_id,'version_id',r.artifact_version_id,'action','approved','artifact_type',v.artifact_type,'approval_request_id',r.id,'approval_policy',r.approval_policy)); end if;
 return jsonb_build_object('request_id',r.id,'status',case when remaining=0 then 'completed' else 'pending' end,'signed_off_at',s.signed_off_at,'approval_id',approved.id);
end; $$;
create or replace function public.request_artifact_approval_changes(p_request_id uuid,p_actor_id uuid,p_comment text,p_idempotency_key uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.artifact_approval_requests%rowtype;s public.artifact_approval_signoffs%rowtype;v record;existing public.artifact_version_comments%rowtype;saved public.artifact_version_comments%rowtype;body text;
begin
 if p_request_id is null or p_actor_id is null or p_idempotency_key is null then raise exception 'Approval request, actor, and idempotency key are required'; end if; body:=btrim(coalesce(p_comment,'')); if body='' or length(body)>8000 then raise exception 'A change request comment of 8000 characters or fewer is required'; end if;
 select * into r from public.artifact_approval_requests where id=p_request_id for update; if not found then raise exception 'Approval request is unavailable' using errcode='P0002'; end if;
 select av.created_by version_author,a.created_by artifact_author,a.project_id,a.artifact_type into v from public.artifact_versions av join public.artifacts a on a.id=av.artifact_id and a.organization_id=av.organization_id where av.id=r.artifact_version_id and av.organization_id=r.organization_id;
 if not found or v.project_id is null or not private.n1e_artifact_approval_authority(r.organization_id,v.project_id,v.artifact_type,v.version_author,v.artifact_author,p_actor_id) then raise exception 'Current scoped specialist authority required for change decision.' using errcode='42501'; end if;
 select * into s from public.artifact_approval_signoffs where request_id=r.id and required_approver_id=p_actor_id for update; if not found or s.signed_off_at is not null then raise exception 'Only an unsigned named approver can request changes' using errcode='42501'; end if;
 select * into existing from public.artifact_version_comments where approval_request_id=r.id and author_id=p_actor_id and request_change_key=p_idempotency_key for share; if found then if existing.body is distinct from body then raise exception 'Change request idempotency key was reused with different intent' using errcode='23505'; end if; return to_jsonb(existing)||jsonb_build_object('idempotent_replay',true); end if;
 if r.status<>'pending' then raise exception 'Only a pending approval request can receive requested changes' using errcode='55000'; end if; insert into public.artifact_version_comments(organization_id,artifact_version_id,author_id,body,comment_position,approval_request_id,request_change_key) values(r.organization_id,r.artifact_version_id,p_actor_id,body,null,r.id,p_idempotency_key) returning * into saved; return to_jsonb(saved)||jsonb_build_object('idempotent_replay',false);
end; $$;

revoke all on function private.n1e_org_authority(uuid,uuid,uuid),private.n1e_exact_project_manager(uuid,uuid,uuid),private.n1e_department_head(uuid,uuid,text,uuid),private.n1e_specialist_authority(uuid,uuid,text,uuid),private.n1e_artifact_department(text),private.n1e_artifact_approval_authority(uuid,uuid,text,uuid,uuid,uuid),private.n1e_artifact_nomination_authority(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
-- Artifact approval RPCs remain SECURITY INVOKER on the trusted service lane.
-- That role needs these read-only helpers to evaluate current scope at decision time.
grant execute on function private.n1e_org_authority(uuid,uuid,uuid),private.n1e_exact_project_manager(uuid,uuid,uuid),private.n1e_department_head(uuid,uuid,text,uuid),private.n1e_specialist_authority(uuid,uuid,text,uuid),private.n1e_artifact_department(text),private.n1e_artifact_approval_authority(uuid,uuid,text,uuid,uuid,uuid),private.n1e_artifact_nomination_authority(uuid,uuid,text,uuid) to service_role;
revoke all on function public.confirm_governed_deliverable_project_manager(uuid,uuid,bigint,uuid),public.create_artifact_approval_request(uuid,text,uuid[],uuid),public.sign_off_artifact_approval(uuid,uuid),public.request_artifact_approval_changes(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.confirm_governed_deliverable_project_manager(uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.create_artifact_approval_request(uuid,text,uuid[],uuid),public.sign_off_artifact_approval(uuid,uuid),public.request_artifact_approval_changes(uuid,uuid,text,uuid) to service_role;
commit;
