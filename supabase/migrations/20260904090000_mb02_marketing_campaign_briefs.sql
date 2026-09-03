-- MB02B - governed Marketing campaign brief saves.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.marketing_brief_save_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null default 'save_campaign_brief' check (action = 'save_campaign_brief'),
  idempotency_key uuid not null,
  payload_checksum text not null check (payload_checksum ~ '^[a-f0-9]{64}$'),
  artifact_id uuid not null,
  artifact_version_id uuid not null,
  campaign_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete cascade,
  foreign key (artifact_version_id, organization_id) references public.artifact_versions(id, organization_id) on delete cascade,
  foreign key (campaign_id, organization_id) references public.marketing_campaigns(id, organization_id) on delete cascade,
  unique (organization_id, actor_id, action, idempotency_key),
  check (expires_at > created_at),
  unique (id, organization_id)
);

create index idx_marketing_brief_save_requests_expiry
  on public.marketing_brief_save_requests (expires_at);

alter table public.marketing_brief_save_requests enable row level security;
revoke all on public.marketing_brief_save_requests from anon, authenticated;
grant all on public.marketing_brief_save_requests to service_role;

create or replace function public.save_marketing_campaign_brief(
  p_organization_id uuid,
  p_engagement_id uuid,
  p_campaign_id uuid,
  p_artifact_id uuid,
  p_expected_latest_version_id uuid,
  p_title text,
  p_content jsonb,
  p_content_checksum text,
  p_change_summary text,
  p_ai_use_allowed boolean,
  p_idempotency_key uuid,
  p_payload_checksum text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_membership record;
  v_engagement record;
  v_campaign record;
  v_artifact public.artifacts%rowtype;
  v_latest public.artifact_versions%rowtype;
  v_version public.artifact_versions%rowtype;
  v_replay public.marketing_brief_save_requests%rowtype;
  v_asset_ids uuid[] := '{}'::uuid[];
begin
  if p_organization_id is null or p_actor_id is null or p_idempotency_key is null then
    raise exception 'Organization, actor, and idempotency key are required';
  end if;
  if p_payload_checksum !~ '^[a-f0-9]{64}$' or p_content_checksum !~ '^[a-f0-9]{64}$' then
    raise exception 'Valid request and content checksums are required';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then raise exception 'Campaign brief content is required'; end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 240 then raise exception 'Brief title is required'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_actor_id::text || ':save_campaign_brief:' || p_idempotency_key::text, 0));

  select * into v_replay from public.marketing_brief_save_requests
  where organization_id = p_organization_id and actor_id = p_actor_id
    and action = 'save_campaign_brief' and idempotency_key = p_idempotency_key;
  if found then
    if v_replay.payload_checksum <> p_payload_checksum then
      raise exception 'Idempotency key was already used with a different payload' using errcode = '23505';
    end if;
    select * into v_version from public.artifact_versions
    where id = v_replay.artifact_version_id and organization_id = p_organization_id;
    return to_jsonb(v_version) || jsonb_build_object('artifact_id', v_replay.artifact_id, 'replayed', true);
  end if;

  select role, department_id into v_membership from public.organization_memberships
  where organization_id = p_organization_id and user_id = p_actor_id
    and member_kind = 'team' and status = 'active';
  if not found or not (v_membership.role in ('system_owner', 'operations_admin', 'executive') or v_membership.department_id = 'marketing') then
    raise exception 'Marketing department access required';
  end if;

  select id, brand_id into v_engagement from public.engagements
  where id = p_engagement_id and organization_id = p_organization_id;
  if not found or not exists (
    select 1 from public.engagement_services es join public.service_catalog sc on sc.id = es.service_id
    where es.engagement_id = p_engagement_id and es.organization_id = p_organization_id
      and es.status = 'active' and sc.department_id = 'marketing' and sc.is_active
  ) then raise exception 'Active Marketing engagement required'; end if;

  select id, engagement_id, brand_id into v_campaign from public.marketing_campaigns
  where id = p_campaign_id and organization_id = p_organization_id for share;
  if not found or v_campaign.engagement_id <> p_engagement_id or v_campaign.brand_id <> v_engagement.brand_id then
    raise exception 'Campaign does not match this Marketing engagement';
  end if;

  if jsonb_typeof(coalesce(p_content->'existing_asset_version_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'Existing asset version IDs must be an array';
  end if;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into v_asset_ids
  from jsonb_array_elements_text(coalesce(p_content->'existing_asset_version_ids', '[]'::jsonb));
  if cardinality(v_asset_ids) > 100 then raise exception 'At most 100 existing asset versions may be referenced'; end if;
  if exists (
    select 1 from unnest(v_asset_ids) asset_id where not exists (
      select 1 from public.artifact_versions av where av.id = asset_id and av.organization_id = p_organization_id
    )
  ) then raise exception 'Every existing asset must reference an exact readable version in this organization'; end if;

  if p_artifact_id is null then
    insert into public.artifacts (organization_id, brand_id, engagement_id, artifact_type, title, created_by)
    values (p_organization_id, v_engagement.brand_id, p_engagement_id, 'campaign_brief', trim(p_title), p_actor_id)
    returning * into v_artifact;
  else
    select * into v_artifact from public.artifacts
    where id = p_artifact_id and organization_id = p_organization_id for update;
    if not found or v_artifact.artifact_type <> 'campaign_brief' or v_artifact.engagement_id <> p_engagement_id or v_artifact.brand_id <> v_engagement.brand_id then
      raise exception 'Campaign brief does not match this engagement';
    end if;
    update public.artifacts set title = trim(p_title) where id = v_artifact.id and organization_id = p_organization_id returning * into v_artifact;
  end if;

  select * into v_latest from public.artifact_versions
  where artifact_id = v_artifact.id and organization_id = p_organization_id
  order by version_number desc limit 1 for update;
  if (v_latest.id is distinct from p_expected_latest_version_id) then
    raise exception 'Campaign brief changed since it was loaded; refresh before saving' using errcode = '40001';
  end if;

  insert into public.artifact_versions (
    organization_id, artifact_id, version_number, parent_version_id, content, content_checksum,
    change_summary, ai_use_allowed, data_classification, created_by
  ) values (
    p_organization_id, v_artifact.id, coalesce(v_latest.version_number, 0) + 1, v_latest.id,
    p_content, p_content_checksum, left(coalesce(p_change_summary, ''), 1000),
    coalesce(p_ai_use_allowed, false), 'internal', p_actor_id
  ) returning * into v_version;

  insert into public.marketing_campaign_artifacts (organization_id, campaign_id, artifact_id, relation_type, linked_by)
  values (p_organization_id, p_campaign_id, v_artifact.id, 'campaign_brief', p_actor_id)
  on conflict (campaign_id, artifact_id) do nothing;

  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (p_organization_id, p_engagement_id, 'artifact_version_created', p_actor_id,
    jsonb_build_object('record_type', 'artifact', 'record_id', v_artifact.id, 'version_id', v_version.id,
      'action', 'version_created', 'artifact_type', 'campaign_brief', 'campaign_id', p_campaign_id));

  insert into public.marketing_brief_save_requests (
    organization_id, actor_id, idempotency_key, payload_checksum, artifact_id, artifact_version_id, campaign_id
  ) values (
    p_organization_id, p_actor_id, p_idempotency_key, p_payload_checksum, v_artifact.id, v_version.id, p_campaign_id
  );
  return to_jsonb(v_version) || jsonb_build_object('artifact_id', v_artifact.id, 'replayed', false);
end;
$$;

revoke all on function public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid) to service_role;

comment on table public.marketing_brief_save_requests is
  'Metadata-only, actor-scoped 30-day replay ledger for atomic governed campaign-brief saves; no brief payload is stored.';

commit;
