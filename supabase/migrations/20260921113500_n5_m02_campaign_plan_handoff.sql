-- M02: approved exact campaign brief to canonical internal N3 downstream request.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create table public.marketing_campaign_plan_handoffs (
  request_id uuid primary key references public.requests(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  engagement_id uuid not null,
  campaign_id uuid not null,
  plan_version_id uuid not null,
  brief_version_id uuid not null,
  brief_checksum text not null check(brief_checksum ~ '^[a-f0-9]{64}$'),
  approval_id uuid not null,
  receiving_service_id uuid not null,
  receiving_workstream_id uuid not null,
  title text not null check(length(title) between 1 and 240),
  requested_output text not null check(length(requested_output) between 1 and 7500),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  foreign key(engagement_id,organization_id) references public.engagements(id,organization_id) on delete restrict,
  foreign key(campaign_id,organization_id) references public.marketing_campaigns(id,organization_id) on delete restrict,
  foreign key(plan_version_id,organization_id) references public.marketing_campaign_plan_versions(id,organization_id) on delete restrict,
  foreign key(brief_version_id,organization_id) references public.artifact_versions(id,organization_id) on delete restrict,
  foreign key(approval_id,organization_id) references public.artifact_approvals(id,organization_id) on delete restrict,
  foreign key(receiving_service_id,organization_id) references public.engagement_services(id,organization_id) on delete restrict,
  foreign key(receiving_workstream_id,project_id,organization_id) references public.workstreams(id,project_id,organization_id) on delete restrict
);
create index marketing_campaign_plan_handoffs_source_idx on public.marketing_campaign_plan_handoffs
  (organization_id,campaign_id,plan_version_id,confirmed_at desc);
alter table public.marketing_campaign_plan_handoffs enable row level security;
create policy marketing_campaign_plan_handoffs_team_read on public.marketing_campaign_plan_handoffs
  for select to authenticated using(public.is_team_organization_member(organization_id));
revoke all on public.marketing_campaign_plan_handoffs from public,anon,authenticated,service_role;
grant select on public.marketing_campaign_plan_handoffs to authenticated;
create trigger marketing_campaign_plan_handoffs_immutable before update or delete
  on public.marketing_campaign_plan_handoffs for each row execute function private.p7_reject_history_mutation();

create function public.confirm_marketing_campaign_plan_handoff(
  p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_campaign_id uuid,
  p_request_id uuid,p_plan_version_id uuid,p_brief_version_id uuid,p_brief_checksum text,
  p_approval_id uuid,p_receiving_service_id uuid,p_receiving_workstream_id uuid,
  p_title text,p_requested_output text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  prior public.marketing_campaign_plan_handoffs%rowtype;
  source_record record;
  recipient_department text;
  normalized_title text:=trim(coalesce(p_title,''));
  normalized_output text:=trim(coalesce(p_requested_output,''));
begin
  if actor is null or p_organization_id is null or p_project_id is null or p_engagement_id is null
    or p_campaign_id is null or p_request_id is null or p_plan_version_id is null
    or p_brief_version_id is null or p_approval_id is null or p_receiving_service_id is null
    or p_receiving_workstream_id is null or p_brief_checksum is null
    or p_brief_checksum !~ '^[a-f0-9]{64}$'
    or length(normalized_title) not between 1 and 240
    or length(normalized_output) not between 1 and 7500 then
    raise exception 'Complete exact campaign plan handoff required' using errcode='22023';
  end if;
  if not private.p7_assignment_authority(p_organization_id,p_project_id,'marketing',actor) then
    raise exception 'Exact-project Marketing request authority required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('m02-handoff:'||p_request_id::text,0));
  select * into prior from public.marketing_campaign_plan_handoffs where request_id=p_request_id;
  if found then
    if prior.organization_id is distinct from p_organization_id or prior.project_id is distinct from p_project_id
      or prior.engagement_id is distinct from p_engagement_id or prior.campaign_id is distinct from p_campaign_id
      or prior.plan_version_id is distinct from p_plan_version_id or prior.brief_version_id is distinct from p_brief_version_id
      or prior.brief_checksum is distinct from p_brief_checksum or prior.approval_id is distinct from p_approval_id
      or prior.receiving_service_id is distinct from p_receiving_service_id
      or prior.receiving_workstream_id is distinct from p_receiving_workstream_id
      or prior.title is distinct from normalized_title or prior.requested_output is distinct from normalized_output
      or prior.confirmed_by is distinct from actor then
      raise exception 'Request ID already used with different campaign handoff inputs' using errcode='23505';
    end if;
    return jsonb_build_object('request_id',prior.request_id,'brief_version_id',prior.brief_version_id,'replayed',true);
  end if;
  select v.content_checksum,a.id artifact_id,plan.id plan_id
    into source_record
    from public.marketing_campaign_plan_review_submissions submission
    join public.marketing_campaign_plan_versions plan on plan.id=submission.plan_version_id
      and plan.organization_id=submission.organization_id
    join public.artifact_versions v on v.id=submission.artifact_version_id
      and v.organization_id=submission.organization_id
    join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id
    join public.artifact_approvals approval on approval.id=p_approval_id
      and approval.artifact_version_id=v.id and approval.artifact_id=a.id
      and approval.organization_id=v.organization_id and approval.engagement_id=plan.engagement_id
    join public.engagements e on e.id=plan.engagement_id and e.organization_id=plan.organization_id
    where submission.organization_id=p_organization_id and submission.campaign_id=p_campaign_id
      and submission.plan_version_id=p_plan_version_id and submission.artifact_version_id=p_brief_version_id
      and submission.artifact_id=a.id
      and plan.engagement_id=p_engagement_id and plan.campaign_id=p_campaign_id
      and e.project_id=p_project_id and e.brand_id=plan.brand_id
      and a.artifact_type='campaign_brief' and a.engagement_id=p_engagement_id
    for share of submission,plan,v,a,approval,e;
  if not found or source_record.content_checksum is distinct from p_brief_checksum then
    raise exception 'Approved exact campaign brief or checksum unavailable' using errcode='23514';
  end if;
  perform 1 from public.engagement_services es join public.service_catalog sc
    on sc.id=es.service_id and sc.organization_id=es.organization_id
    where es.organization_id=p_organization_id and es.engagement_id=p_engagement_id
      and es.status='active' and sc.is_active and sc.department_id='marketing' for share of es,sc;
  if not found then raise exception 'Active Marketing service required' using errcode='42501'; end if;
  select sc.department_id into recipient_department
    from public.engagement_services es join public.service_catalog sc
      on sc.id=es.service_id and sc.organization_id=es.organization_id
    where es.id=p_receiving_service_id and es.organization_id=p_organization_id
      and es.engagement_id=p_engagement_id and es.status='active'
      and sc.is_active and sc.department_id in ('content','design') for share of es,sc;
  if not found then raise exception 'Active same-engagement Content or Design service required' using errcode='42501'; end if;
  perform 1 from public.workstreams w where w.id=p_receiving_workstream_id
    and w.organization_id=p_organization_id and w.project_id=p_project_id
    and w.department_id=recipient_department and w.status='active' for share;
  if not found then raise exception 'Active matching recipient project workstream required' using errcode='42501'; end if;
  perform public.post_project_discussion_message_with_links(
    p_organization_id,p_project_id,p_request_id,
    'Marketing campaign handoff: '||normalized_title||' · approved brief '||p_brief_version_id::text||'.',
    null,'[]'::jsonb);
  perform public.create_project_handoff_request(
    p_organization_id,p_project_id,p_request_id,p_request_id,null,p_receiving_workstream_id,
    normalized_title,normalized_output||E'\n\nExact approved campaign brief: '||p_brief_version_id::text
      ||' (SHA-256 '||p_brief_checksum||'); source plan '||p_plan_version_id::text||'.',
    'Review exact approved campaign brief and preserve existing work.','medium',null);
  insert into public.marketing_campaign_plan_handoffs(
    request_id,organization_id,project_id,engagement_id,campaign_id,plan_version_id,
    brief_version_id,brief_checksum,approval_id,receiving_service_id,receiving_workstream_id,
    title,requested_output,confirmed_by
  ) values (
    p_request_id,p_organization_id,p_project_id,p_engagement_id,p_campaign_id,p_plan_version_id,
    p_brief_version_id,p_brief_checksum,p_approval_id,p_receiving_service_id,p_receiving_workstream_id,
    normalized_title,normalized_output,actor
  );
  return jsonb_build_object('request_id',p_request_id,'brief_version_id',p_brief_version_id,'replayed',false);
end;
$$;
revoke all on function public.confirm_marketing_campaign_plan_handoff(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_marketing_campaign_plan_handoff(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text)
  to authenticated;
commit;
