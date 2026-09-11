-- MB04A - immutable, manual Marketing campaign-plan drafts.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.marketing_campaign_plan_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  engagement_id uuid not null,
  brand_id uuid not null,
  version_number integer not null check (version_number > 0),
  parent_version_id uuid,
  source_plan_version_id uuid,
  lifecycle_status text not null default 'draft' check (lifecycle_status = 'draft'),
  title text not null check (length(trim(title)) between 1 and 180),
  objective text not null check (length(trim(objective)) between 1 and 4000),
  channels text[] not null check (cardinality(channels) between 1 and 20),
  starts_on date,
  ends_on date,
  audience text not null default '' check (length(audience) <= 4000),
  landing_page_url text check (landing_page_url is null or length(landing_page_url) <= 2000),
  approved_message_version_id uuid,
  measurement_plan_version_id uuid,
  change_summary text not null default '' check (length(change_summary) <= 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id) references public.marketing_campaigns(id, organization_id) on delete cascade,
  foreign key (engagement_id, organization_id) references public.engagements(id, organization_id) on delete cascade,
  foreign key (brand_id, organization_id) references public.brands(id, organization_id) on delete restrict,
  foreign key (parent_version_id, organization_id) references public.marketing_campaign_plan_versions(id, organization_id) on delete restrict,
  foreign key (source_plan_version_id, organization_id) references public.marketing_campaign_plan_versions(id, organization_id) on delete restrict,
  foreign key (approved_message_version_id, organization_id) references public.artifact_versions(id, organization_id) on delete restrict,
  foreign key (measurement_plan_version_id, organization_id) references public.artifact_versions(id, organization_id) on delete restrict,
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  unique (campaign_id, version_number),
  unique (id, organization_id)
);

create table public.marketing_campaign_plan_creative_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  plan_version_id uuid not null,
  position integer not null check (position between 1 and 100),
  format text not null check (length(trim(format)) between 1 and 240),
  intended_placement text not null check (length(trim(intended_placement)) between 1 and 500),
  message_version_id uuid,
  due_date date,
  created_at timestamptz not null default now(),
  foreign key (plan_version_id, organization_id) references public.marketing_campaign_plan_versions(id, organization_id) on delete cascade,
  foreign key (message_version_id, organization_id) references public.artifact_versions(id, organization_id) on delete restrict,
  unique (plan_version_id, position)
);

create index idx_marketing_campaign_plan_versions_campaign on public.marketing_campaign_plan_versions(organization_id, campaign_id, version_number desc);
create index idx_marketing_campaign_plan_versions_engagement on public.marketing_campaign_plan_versions(organization_id, engagement_id);
create index idx_marketing_campaign_plan_versions_brand on public.marketing_campaign_plan_versions(organization_id, brand_id);
create index idx_marketing_campaign_plan_versions_parent on public.marketing_campaign_plan_versions(organization_id, parent_version_id) where parent_version_id is not null;
create index idx_marketing_campaign_plan_versions_source on public.marketing_campaign_plan_versions(organization_id, source_plan_version_id) where source_plan_version_id is not null;
create index idx_marketing_campaign_plan_versions_message on public.marketing_campaign_plan_versions(organization_id, approved_message_version_id) where approved_message_version_id is not null;
create index idx_marketing_campaign_plan_versions_measurement on public.marketing_campaign_plan_versions(organization_id, measurement_plan_version_id) where measurement_plan_version_id is not null;
create index idx_marketing_campaign_plan_requirements_version on public.marketing_campaign_plan_creative_requirements(organization_id, plan_version_id, position);
create index idx_marketing_campaign_plan_requirements_message on public.marketing_campaign_plan_creative_requirements(organization_id, message_version_id) where message_version_id is not null;

alter table public.engagement_events drop constraint engagement_events_event_type_check;
alter table public.engagement_events add constraint engagement_events_event_type_check
check (event_type in (
  'engagement_created', 'service_activated', 'blueprint_instantiated',
  'artifact_version_created', 'artifact_approved', 'design_direction_released',
  'campaign_created', 'campaign_updated', 'artifact_draft_proposed_via_chat',
  'stage_status_changed', 'work_item_created', 'work_item_status_changed', 'work_item_assigned',
  'recurring_plan_created', 'recurring_plan_version_created',
  'recurring_plan_version_approved', 'recurring_plan_status_changed',
  'recurring_period_generated', 'marketing_campaign_plan_version_created'
));

create trigger trg_marketing_campaign_plan_versions_immutable before update or delete on public.marketing_campaign_plan_versions for each row execute function private.reject_immutable_artifact_history_change();
create trigger trg_marketing_campaign_plan_requirements_immutable before update or delete on public.marketing_campaign_plan_creative_requirements for each row execute function private.reject_immutable_artifact_history_change();
alter table public.marketing_campaign_plan_versions enable row level security;
alter table public.marketing_campaign_plan_creative_requirements enable row level security;
create policy "Team can read campaign plan versions" on public.marketing_campaign_plan_versions for select to authenticated using (public.is_team_organization_member(organization_id));
create policy "Team can read campaign plan requirements" on public.marketing_campaign_plan_creative_requirements for select to authenticated using (public.is_team_organization_member(organization_id));
revoke all on public.marketing_campaign_plan_versions, public.marketing_campaign_plan_creative_requirements from anon, authenticated, service_role;
grant select on public.marketing_campaign_plan_versions, public.marketing_campaign_plan_creative_requirements to authenticated;
grant select, insert on public.marketing_campaign_plan_versions, public.marketing_campaign_plan_creative_requirements to service_role;

create or replace function public.save_marketing_campaign_plan_draft(
  p_organization_id uuid, p_engagement_id uuid, p_campaign_id uuid, p_expected_latest_version_id uuid,
  p_title text, p_objective text, p_channels text[], p_starts_on date, p_ends_on date,
  p_audience text, p_landing_page_url text, p_approved_message_version_id uuid,
  p_measurement_plan_version_id uuid, p_creative_requirements jsonb, p_change_summary text,
  p_source_plan_version_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_membership record;
  v_engagement record;
  v_campaign record;
  v_latest public.marketing_campaign_plan_versions%rowtype;
  v_saved public.marketing_campaign_plan_versions%rowtype;
  v_requirement jsonb;
  v_position integer := 0;
  v_message_version_id uuid;
begin
  if p_organization_id is null or p_engagement_id is null or p_campaign_id is null or p_actor_id is null then raise exception 'Organization, engagement, campaign, and actor are required'; end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 180 then raise exception 'Plan title is required'; end if;
  if length(trim(coalesce(p_objective, ''))) not between 1 and 4000 then raise exception 'Plan objective is required'; end if;
  if p_channels is null or cardinality(p_channels) not between 1 and 20 or array_position(p_channels, null) is not null then raise exception 'At least one channel is required'; end if;
  if exists (select 1 from unnest(p_channels) item where length(trim(item)) not between 1 and 120) then raise exception 'Channels must be non-empty and no longer than 120 characters'; end if;
  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then raise exception 'Plan end date cannot precede its start date'; end if;
  if length(coalesce(p_audience, '')) > 4000 or length(coalesce(p_landing_page_url, '')) > 2000 or length(coalesce(p_change_summary, '')) > 1000 then raise exception 'Plan text exceeds its supported length'; end if;
  if nullif(trim(coalesce(p_landing_page_url, '')), '') is not null and p_landing_page_url !~* '^https?://[^[:space:]]+$' then raise exception 'Landing page must use an HTTP or HTTPS URL'; end if;
  if jsonb_typeof(coalesce(p_creative_requirements, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_creative_requirements, '[]'::jsonb)) > 100 then raise exception 'Creative requirements must be an array of at most 100 items'; end if;

  select role, department_id into v_membership from public.organization_memberships
  where organization_id = p_organization_id and user_id = p_actor_id and member_kind = 'team' and status = 'active';
  if not found or not (v_membership.role in ('system_owner', 'operations_admin', 'executive') or v_membership.department_id = 'marketing') then raise exception 'Marketing department access required'; end if;
  if not exists (select 1 from public.organizations where id = p_organization_id and status = 'active') then raise exception 'Active organization required'; end if;
  select id, brand_id into v_engagement from public.engagements where id = p_engagement_id and organization_id = p_organization_id;
  if not found or not exists (
    select 1 from public.engagement_services es join public.service_catalog sc on sc.id = es.service_id
    where es.engagement_id = p_engagement_id and es.organization_id = p_organization_id
      and es.status = 'active' and sc.department_id = 'marketing' and sc.is_active
  ) then raise exception 'Active Marketing engagement required'; end if;
  select id, engagement_id, brand_id into v_campaign from public.marketing_campaigns
  where id = p_campaign_id and organization_id = p_organization_id for share;
  if not found or v_campaign.engagement_id <> p_engagement_id or v_campaign.brand_id <> v_engagement.brand_id then raise exception 'Campaign does not match this Marketing engagement'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text || ':' || p_campaign_id::text || ':campaign_plan', 0));
  select * into v_latest from public.marketing_campaign_plan_versions
  where organization_id = p_organization_id and campaign_id = p_campaign_id order by version_number desc limit 1;
  if v_latest.id is distinct from p_expected_latest_version_id then raise exception 'Campaign plan changed since it was loaded; refresh before saving' using errcode = '40001'; end if;
  if p_source_plan_version_id is not null and not exists (
    select 1 from public.marketing_campaign_plan_versions where id = p_source_plan_version_id and organization_id = p_organization_id and campaign_id = p_campaign_id
  ) then raise exception 'Source plan version is not in this campaign lineage'; end if;
  if p_approved_message_version_id is not null and not exists (
    select 1 from public.artifact_versions av join public.artifacts a on a.id = av.artifact_id and a.organization_id = av.organization_id
    join public.artifact_approvals approval on approval.artifact_version_id = av.id and approval.organization_id = av.organization_id
    where av.id = p_approved_message_version_id and av.organization_id = p_organization_id and a.engagement_id = p_engagement_id
      and a.artifact_type in ('campaign_messaging', 'scripts')
  ) then raise exception 'Approved message must reference an approved campaign-messaging or script version in this engagement'; end if;
  if p_measurement_plan_version_id is not null and not exists (
    select 1 from public.artifact_versions av join public.artifacts a on a.id = av.artifact_id and a.organization_id = av.organization_id
    where av.id = p_measurement_plan_version_id and av.organization_id = p_organization_id and a.engagement_id = p_engagement_id and a.artifact_type = 'measurement_plan'
  ) then raise exception 'Measurement source must reference an exact measurement-plan version in this engagement'; end if;

  insert into public.marketing_campaign_plan_versions (
    organization_id, campaign_id, engagement_id, brand_id, version_number, parent_version_id, source_plan_version_id,
    title, objective, channels, starts_on, ends_on, audience, landing_page_url,
    approved_message_version_id, measurement_plan_version_id, change_summary, created_by
  ) values (
    p_organization_id, p_campaign_id, p_engagement_id, v_engagement.brand_id, coalesce(v_latest.version_number, 0) + 1, v_latest.id, p_source_plan_version_id,
    trim(p_title), trim(p_objective), p_channels, p_starts_on, p_ends_on, trim(coalesce(p_audience, '')), nullif(trim(coalesce(p_landing_page_url, '')), ''),
    p_approved_message_version_id, p_measurement_plan_version_id, trim(coalesce(p_change_summary, '')), p_actor_id
  ) returning * into v_saved;

  for v_requirement in select value from jsonb_array_elements(coalesce(p_creative_requirements, '[]'::jsonb)) loop
    v_position := v_position + 1;
    if jsonb_typeof(v_requirement) <> 'object' or length(trim(coalesce(v_requirement->>'format', ''))) not between 1 and 240
      or length(trim(coalesce(v_requirement->>'intended_placement', ''))) not between 1 and 500 then raise exception 'Every creative requirement needs format and intended placement'; end if;
    begin v_message_version_id := nullif(v_requirement->>'message_version_id', '')::uuid;
    exception when invalid_text_representation then raise exception 'Creative message reference must be a UUID'; end;
    if v_message_version_id is not null and not exists (
      select 1 from public.artifact_versions av join public.artifacts a on a.id = av.artifact_id and a.organization_id = av.organization_id
      join public.artifact_approvals approval on approval.artifact_version_id = av.id and approval.organization_id = av.organization_id
      where av.id = v_message_version_id and av.organization_id = p_organization_id and a.engagement_id = p_engagement_id
        and a.artifact_type in ('campaign_messaging', 'scripts')
    ) then raise exception 'Creative message reference must be an approved message version in this engagement'; end if;
    insert into public.marketing_campaign_plan_creative_requirements (
      organization_id, plan_version_id, position, format, intended_placement, message_version_id, due_date
    ) values (
      p_organization_id, v_saved.id, v_position, trim(v_requirement->>'format'), trim(v_requirement->>'intended_placement'),
      v_message_version_id, nullif(v_requirement->>'due_date', '')::date
    );
  end loop;

  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (p_organization_id, p_engagement_id, 'marketing_campaign_plan_version_created', p_actor_id,
    jsonb_build_object('record_type', 'marketing_campaign_plan', 'record_id', p_campaign_id, 'version_id', v_saved.id,
      'version_number', v_saved.version_number, 'action', 'draft_saved'));
  return to_jsonb(v_saved) || jsonb_build_object('creative_requirement_count', v_position);
end;
$$;

revoke all on function public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid) to service_role;
comment on table public.marketing_campaign_plan_versions is 'Append-only, unapproved Marketing campaign-plan drafts. No row authorizes spend, publishing, provider activity, or downstream work creation.';
comment on table public.marketing_campaign_plan_creative_requirements is 'Version-scoped creative requirements only; rows are planning records and never create Content or Design work.';
commit;
