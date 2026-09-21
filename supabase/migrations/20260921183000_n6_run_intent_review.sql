begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A review decision is append-only and does not authorize provider execution.
create table public.pipeline_run_intent_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_intent_id uuid not null references public.pipeline_run_intents(id) on delete restrict,
  request_id uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('accepted_for_planning', 'rejected')),
  reason text not null default '' check (length(reason) <= 1000),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(),
  unique (run_intent_id),
  unique (organization_id, request_id)
);
create index pipeline_run_intent_reviews_org_intent
  on public.pipeline_run_intent_reviews(organization_id, run_intent_id);
create trigger protect_pipeline_run_intent_reviews before update or delete
  on public.pipeline_run_intent_reviews for each row execute function private.reject_pipeline_template_mutation();
alter table public.pipeline_run_intent_reviews enable row level security;
revoke all on public.pipeline_run_intent_reviews from public, anon, authenticated, service_role;
grant select on public.pipeline_run_intent_reviews to authenticated, service_role;
create policy "Current team can read pipeline run reviews"
  on public.pipeline_run_intent_reviews for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function public.review_pipeline_run_intent(
  p_organization_id uuid, p_run_intent_id uuid, p_request_id uuid,
  p_decision text, p_reason text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  intent public.pipeline_run_intents;
  existing public.pipeline_run_intent_reviews;
  decision_value text := trim(coalesce(p_decision, ''));
  reason_value text := trim(coalesce(p_reason, ''));
  request_sha text;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_run_intent_id is null or p_request_id is null then
    raise exception 'Authenticated review scope is required.' using errcode = '42501';
  end if;
  if decision_value not in ('accepted_for_planning', 'rejected')
    or length(reason_value) > 1000
    or (decision_value = 'rejected' and reason_value = '') then
    raise exception 'A valid decision and rejection reason are required.' using errcode = '22023';
  end if;
  -- Hold active organization and reviewer membership through the decision.
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin')
    for share of organization, membership;
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'run_intent_id', p_run_intent_id, 'decision', decision_value, 'reason', reason_value
  )::text, 'UTF8'), 'sha256'), 'hex');
  select * into intent from public.pipeline_run_intents
    where id = p_run_intent_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'Run request not found in this organization.' using errcode = '42501';
  end if;
  if intent.requested_by = actor then
    raise exception 'The requester cannot review their own run.' using errcode = '42501';
  end if;
  select * into existing from public.pipeline_run_intent_reviews
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.reviewed_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request id belongs to another review.' using errcode = '23505';
    end if;
    return jsonb_build_object('review_id', existing.id, 'decision', existing.decision,
      'run_intent_id', existing.run_intent_id, 'idempotent_replay', true);
  end if;
  if exists (select 1 from public.pipeline_run_intent_reviews where run_intent_id = intent.id) then
    raise exception 'This run request already has a review decision.' using errcode = '55000';
  end if;
  perform 1 from public.engagements engagement
    where engagement.id = intent.engagement_id
      and engagement.organization_id = p_organization_id
      and engagement.status in ('planning', 'active') for share;
  if not found then
    raise exception 'The engagement is no longer eligible for run planning.' using errcode = '55000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(intent.input_manifest -> 'assets') selected(value)
    left join public.engagement_assets asset on asset.id = (selected.value ->> 'id')::uuid
      and asset.engagement_id = intent.engagement_id
      and asset.organization_id = p_organization_id
    where asset.id is null
  ) or exists (
    select 1 from jsonb_array_elements(intent.input_manifest -> 'services') selected(value)
    left join public.engagement_services service on service.id = (selected.value ->> 'id')::uuid
      and service.engagement_id = intent.engagement_id
      and service.organization_id = p_organization_id
      and service.status in ('planned', 'active')
    where service.id is null
  ) then
    raise exception 'Pinned assets or services are no longer available; create a new run request.' using errcode = '55000';
  end if;
  insert into public.pipeline_run_intent_reviews(
    organization_id, run_intent_id, request_id, request_sha256,
    decision, reason, reviewed_by
  ) values (
    p_organization_id, intent.id, p_request_id, request_sha,
    decision_value, reason_value, actor
  ) returning id into new_id;
  return jsonb_build_object('review_id', new_id, 'decision', decision_value,
    'run_intent_id', intent.id, 'idempotent_replay', false);
end;
$$;
revoke all on function public.review_pipeline_run_intent(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_pipeline_run_intent(uuid, uuid, uuid, text, text)
  to authenticated;
comment on table public.pipeline_run_intent_reviews is
  'One immutable human review decision per manual pipeline intent; acceptance permits planning only, not task mutation or provider spend.';
commit;
