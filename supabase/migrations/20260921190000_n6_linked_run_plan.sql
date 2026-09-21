begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- An accepted intent may receive one immutable, bounded plan of existing work.
create table public.pipeline_run_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_intent_id uuid not null references public.pipeline_run_intents(id) on delete restrict,
  request_id uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  work_manifest jsonb not null check (jsonb_typeof(work_manifest) = 'array'),
  work_sha256 text not null check (work_sha256 ~ '^[0-9a-f]{64}$'),
  planned_by uuid not null references auth.users(id) on delete restrict,
  planned_at timestamptz not null default clock_timestamp(),
  unique (run_intent_id),
  unique (organization_id, request_id)
);
create index pipeline_run_plans_org_intent on public.pipeline_run_plans(organization_id, run_intent_id);
create trigger protect_pipeline_run_plans before update or delete
  on public.pipeline_run_plans for each row execute function private.reject_pipeline_template_mutation();
alter table public.pipeline_run_plans enable row level security;
revoke all on public.pipeline_run_plans from public, anon, authenticated, service_role;
grant select on public.pipeline_run_plans to authenticated, service_role;
create policy "Current team can read pipeline run plans"
  on public.pipeline_run_plans for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function public.plan_manual_pipeline_run(
  p_organization_id uuid, p_run_intent_id uuid, p_request_id uuid,
  p_work_item_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  intent public.pipeline_run_intents;
  existing public.pipeline_run_plans;
  work_manifest jsonb;
  request_sha text;
  work_sha text;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_run_intent_id is null or p_request_id is null then
    raise exception 'Authenticated run scope is required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_work_item_ids), 0) not between 1 and 50
    or array_position(p_work_item_ids, null) is not null
    or (select count(distinct id) from unnest(p_work_item_ids) id) <> cardinality(p_work_item_ids) then
    raise exception 'Choose 1 to 50 unique work items.' using errcode = '22023';
  end if;
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
    'run_intent_id', p_run_intent_id, 'work_item_ids', to_jsonb(p_work_item_ids)
  )::text, 'UTF8'), 'sha256'), 'hex');
  select * into intent from public.pipeline_run_intents
    where id = p_run_intent_id and organization_id = p_organization_id for update;
  if not found or intent.requested_by <> actor then
    raise exception 'Only the current run requester can plan this intent.' using errcode = '42501';
  end if;
  select * into existing from public.pipeline_run_plans
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.planned_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request id belongs to another run plan.' using errcode = '23505';
    end if;
    return jsonb_build_object('run_plan_id', existing.id,
      'work_sha256', existing.work_sha256, 'idempotent_replay', true);
  end if;
  if exists (select 1 from public.pipeline_run_plans where run_intent_id = intent.id) then
    raise exception 'This run request already has a linked work plan.' using errcode = '55000';
  end if;
  if not exists (select 1 from public.pipeline_run_intent_reviews review
    where review.run_intent_id = intent.id and review.organization_id = p_organization_id
      and review.decision = 'accepted_for_planning') then
    raise exception 'A separate accepted planning review is required.' using errcode = '42501';
  end if;
  perform 1 from public.engagements engagement
    where engagement.id = intent.engagement_id
      and engagement.organization_id = p_organization_id
      and engagement.status in ('planning', 'active') for share;
  if not found then
    raise exception 'The engagement is no longer eligible.' using errcode = '55000';
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
    raise exception 'Pinned inputs are no longer available; start a new run request.' using errcode = '55000';
  end if;
  perform 1 from public.work_items item
    join unnest(p_work_item_ids) chosen(id) on chosen.id = item.id
    where item.organization_id = p_organization_id
      and item.engagement_id = intent.engagement_id
      and item.deleted_at is null for share of item;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id, 'row_version', item.row_version, 'title', item.title,
    'status', item.status, 'department_id', item.department_id,
    'assignee_id', item.assignee_id, 'due_date', item.due_date,
    'stage_id', item.linked_engagement_stage_instance_id
  ) order by chosen.position), '[]'::jsonb) into work_manifest
  from unnest(p_work_item_ids) with ordinality chosen(id, position)
  join public.work_items item on item.id = chosen.id
    and item.organization_id = p_organization_id
    and item.engagement_id = intent.engagement_id
    and item.deleted_at is null;
  if jsonb_array_length(work_manifest) <> cardinality(p_work_item_ids) then
    raise exception 'A work item is unavailable in this engagement.' using errcode = '42501';
  end if;
  if pg_catalog.octet_length(work_manifest::text) > 65536 then
    raise exception 'Linked work exceeds the 64 KiB limit.' using errcode = '22023';
  end if;
  work_sha := encode(extensions.digest(convert_to(work_manifest::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.pipeline_run_plans(
    organization_id, run_intent_id, request_id, request_sha256,
    work_manifest, work_sha256, planned_by
  ) values (
    p_organization_id, intent.id, p_request_id, request_sha,
    work_manifest, work_sha, actor
  ) returning id into new_id;
  return jsonb_build_object('run_plan_id', new_id, 'work_sha256', work_sha,
    'linked_work_items', jsonb_array_length(work_manifest), 'idempotent_replay', false);
end;
$$;
revoke all on function public.plan_manual_pipeline_run(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.plan_manual_pipeline_run(uuid, uuid, uuid, uuid[]) to authenticated;
comment on table public.pipeline_run_plans is
  'Immutable accepted manual-run work-item snapshots, limited to 50 same-engagement items; canonical work is not mutated.';
commit;
