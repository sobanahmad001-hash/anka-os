begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Immutable, provider-free manual-start intent. Execution is a later governed step.
create table public.pipeline_run_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  pipeline_template_id uuid not null,
  pipeline_template_version_id uuid not null,
  publication_id uuid not null references public.pipeline_template_publications(id) on delete restrict,
  request_id uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  input_manifest jsonb not null check (jsonb_typeof(input_manifest) = 'object'),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'awaiting_review' check (status = 'awaiting_review'),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  foreign key (engagement_id, organization_id) references public.engagements(id, organization_id) on delete restrict,
  foreign key (pipeline_template_version_id, pipeline_template_id, organization_id)
    references public.pipeline_template_versions(id, pipeline_template_id, organization_id) on delete restrict,
  unique (organization_id, request_id)
);
create index pipeline_run_intents_engagement_recent
  on public.pipeline_run_intents(organization_id, engagement_id, requested_at desc);
create trigger protect_pipeline_run_intents before update or delete
  on public.pipeline_run_intents for each row execute function private.reject_pipeline_template_mutation();
alter table public.pipeline_run_intents enable row level security;
revoke all on public.pipeline_run_intents from public, anon, authenticated, service_role;
grant select on public.pipeline_run_intents to authenticated, service_role;
create policy "Current team can read engagement pipeline intents"
  on public.pipeline_run_intents for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function public.start_pipeline_run_intent(
  p_organization_id uuid, p_engagement_id uuid, p_request_id uuid,
  p_asset_ids uuid[] default '{}'::uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  engagement public.engagements;
  origin public.engagement_pipeline_origins;
  publication public.pipeline_template_publications;
  existing public.pipeline_run_intents;
  request_sha text;
  manifest jsonb;
  input_sha text;
  assets jsonb;
  services jsonb;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_engagement_id is null or p_request_id is null
    or not private.has_active_pipeline_template_role(p_organization_id, array['system_owner', 'operations_admin']) then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_asset_ids), 0) > 20 or array_position(p_asset_ids, null) is not null
    or (select count(distinct id) from unnest(p_asset_ids) id) <> coalesce(cardinality(p_asset_ids), 0) then
    raise exception 'Choose at most 20 unique assets.' using errcode = '22023';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'engagement_id', p_engagement_id, 'asset_ids', to_jsonb(p_asset_ids)
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_request_id::text, 0));
  select * into existing from public.pipeline_run_intents
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.requested_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request id belongs to another run intent.' using errcode = '23505';
    end if;
    return jsonb_build_object('run_intent_id', existing.id, 'status', existing.status,
      'input_sha256', existing.input_sha256, 'idempotent_replay', true);
  end if;
  select * into engagement from public.engagements
    where id = p_engagement_id and organization_id = p_organization_id for share;
  if not found or engagement.status not in ('planning', 'active') then
    raise exception 'An active or planning engagement is required.' using errcode = '42501';
  end if;
  select * into origin from public.engagement_pipeline_origins
    where engagement_id = p_engagement_id and organization_id = p_organization_id;
  if not found then
    raise exception 'This engagement has no published pipeline origin.' using errcode = '22023';
  end if;
  select * into publication from public.pipeline_template_publications
    where pipeline_template_version_id = origin.pipeline_template_version_id
      and pipeline_template_id = origin.pipeline_template_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Published pipeline version is unavailable.' using errcode = '42501';
  end if;
  perform 1 from public.engagement_assets asset join unnest(p_asset_ids) chosen(id) on chosen.id = asset.id where asset.engagement_id = p_engagement_id and asset.organization_id = p_organization_id for share of asset;
  perform 1 from public.engagement_services item where item.engagement_id = p_engagement_id and item.organization_id = p_organization_id for share;
  select coalesce(jsonb_agg(jsonb_build_object('id', asset.id, 'kind', asset.asset_kind,
    'name', asset.name, 'source_url', asset.source_url, 'notes', asset.notes,
    'created_at', asset.created_at) order by chosen.position), '[]'::jsonb)
    into assets
  from unnest(p_asset_ids) with ordinality chosen(id, position)
  join public.engagement_assets asset on asset.id = chosen.id
    and asset.engagement_id = p_engagement_id and asset.organization_id = p_organization_id;
  if jsonb_array_length(assets) <> coalesce(cardinality(p_asset_ids), 0) then
    raise exception 'An asset is unavailable in this engagement.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', item.id, 'service_id', item.service_id,
    'status', item.status, 'owner_id', item.owner_id) order by item.service_id), '[]'::jsonb)
    into services from public.engagement_services item
    where item.engagement_id = p_engagement_id and item.organization_id = p_organization_id
      and item.status in ('planned', 'active');
  if jsonb_array_length(services) = 0 then
    raise exception 'No active or planned services remain.' using errcode = '22023';
  end if;
  manifest := jsonb_build_object(
    'engagement', jsonb_build_object('id', engagement.id, 'client_id', engagement.client_id,
      'brand_id', engagement.brand_id, 'name', engagement.name,
      'objective', engagement.objective, 'status', engagement.status),
    'pipeline', jsonb_build_object('version_id', origin.pipeline_template_version_id,
      'selection_sha256', origin.final_selection_sha256,
      'preview_rule_sha256', origin.preview_rule_sha256,
      'publication_id', publication.id, 'rule_sha256', publication.published_rule_sha256),
    'services', services, 'assets', assets);
  if pg_catalog.octet_length(manifest::text) > 32768 then
    raise exception 'Pinned inputs exceed the 32 KiB limit.' using errcode = '22023';
  end if;
  input_sha := encode(extensions.digest(convert_to(manifest::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.pipeline_run_intents(organization_id, engagement_id, pipeline_template_id,
    pipeline_template_version_id, publication_id, request_id, request_sha256,
    input_manifest, input_sha256, requested_by)
  values(p_organization_id, p_engagement_id, origin.pipeline_template_id,
    origin.pipeline_template_version_id, publication.id, p_request_id, request_sha,
    manifest, input_sha, actor) returning id into new_id;
  return jsonb_build_object('run_intent_id', new_id, 'status', 'awaiting_review',
    'input_sha256', input_sha, 'idempotent_replay', false);
end;
$$;
revoke all on function public.start_pipeline_run_intent(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.start_pipeline_run_intent(uuid, uuid, uuid, uuid[]) to authenticated;
comment on table public.pipeline_run_intents is
  'Immutable manual-start requests with bounded pinned inputs. No provider job, task mutation, or budget spend.';
commit;
