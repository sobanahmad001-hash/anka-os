-- Recheck current project client authority before returning a saved decision receipt.
-- Existing decisions, events and receipts remain immutable and unchanged.
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function public.decide_governed_deliverable_version(
  p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,
  p_decision text,p_rationale text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; membership record; checksum text;
  replay jsonb; result jsonb; next_status text; next_version bigint;
begin
  if actor is null or p_request_id is null then raise exception 'Authentication and request id are required.' using errcode='42501'; end if;
  if p_decision not in ('approved','changes_required') then raise exception 'Unsupported client decision.' using errcode='22023'; end if;
  checksum:=encode(extensions.digest(convert_to(jsonb_build_object('version_id',p_deliverable_version_id,'expected_state_version',p_expected_state_version,'decision',p_decision,'rationale',coalesce(p_rationale,''))::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':client:'||p_request_id::text,0));
  select v.*,d.workstream_id,p.client_id into c from public.deliverable_versions v
  join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_deliverable_version_id and v.organization_id=p_organization_id and p.archived_at is null for update of v for share of p;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  if not coalesce((select (settings->>'client_approvals_enabled')::boolean from public.organizations where id=p_organization_id and status='active'),false) then raise exception 'Client approvals are disabled.' using errcode='42501'; end if;
  select role,member_kind into membership from public.organization_memberships
  where organization_id=p_organization_id and user_id=actor and status='active' for share;
  if not found or membership.member_kind<>'client' or membership.role not in ('client_admin','client_approver') then raise exception 'Exact-project client approver access required.' using errcode='42501'; end if;
  perform 1 from (
    select 1 from public.client_contacts contact
    join public.project_client_access access on access.client_contact_id=contact.id
      and access.project_id=c.project_id and access.organization_id=p_organization_id
    where contact.organization_id=p_organization_id and contact.client_id=c.client_id
      and contact.auth_user_id=actor and contact.status='active'
      and contact.portal_role in ('admin','approver') and access.status='active'
      and access.access_role in ('admin','approver') for share of contact,access
  ) authorized_access;
  if not found then raise exception 'Exact-project client approver access required.' using errcode='42501'; end if;
  -- Replays remain authorized reads, even after the original decision advanced state.
  replay:=private.p7_replay(p_organization_id,actor,'client_decision',p_request_id,checksum); if replay is not null then return replay; end if;
  if c.state_version<>p_expected_state_version then raise exception 'Deliverable version changed; reload before deciding.' using errcode='40001'; end if;
  if c.review_status<>'client_reviewing' then raise exception 'Version is not awaiting a client decision.' using errcode='23514'; end if;
  next_status:=case when p_decision='approved' then 'client_approved' else 'revision_requested' end;
  insert into public.approvals(
    organization_id,project_id,deliverable_id,deliverable_version_id,
    approval_type,decision,rationale,decided_by
  ) values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,
    'client_approval',p_decision,left(coalesce(p_rationale,''),4000),actor);
  perform set_config('anka.p7_governed_action','allowed',true);
  update public.deliverable_versions set review_status=next_status,state_version=state_version+1
  where id=p_deliverable_version_id returning state_version into next_version;
  update public.deliverables set status=case when p_decision='approved' then 'client_approved' else 'revision_requested' end where id=c.deliverable_id;
  update public.client_portal_items set status=next_status
  where project_id=c.project_id and source_type='deliverable_version'
    and source_id=p_deliverable_version_id and withdrawn_at is null;
  insert into public.deliverable_lifecycle_events(
    organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,
    client_id,event_type,actor_id,actor_kind,metadata
  ) values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,
    c.workstream_id,c.client_id,case when p_decision='approved' then 'client_approved' else 'client_changes_required' end,
    actor,'client',jsonb_build_object('rationale',left(coalesce(p_rationale,''),4000)));
  result:=jsonb_build_object('deliverable_version_id',p_deliverable_version_id,
    'state_version',next_version,'review_status',next_status);
  return private.p7_record(p_organization_id,actor,'client_decision',p_request_id,checksum,result);
end; $$;
