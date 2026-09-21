-- D01 owner-private image requests. No provider or production data is created by this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.design_private_experiment_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  creative_brief_version_id uuid not null,
  model_registry_id uuid not null,
  connection_id uuid not null,
  operation_key uuid not null,
  request_checksum text not null check (request_checksum ~ '^[0-9a-f]{64}$'),
  prompt text not null check (length(btrim(prompt)) between 1 and 6000),
  provider_size text not null check (provider_size in ('1024x1024', '1024x1536', '1536x1024')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'outcome_unknown')),
  failure_phase text check (failure_phase is null or failure_phase in ('configuration', 'provider', 'storage', 'registration')),
  failure_reason text check (failure_reason is null or length(failure_reason) between 1 and 2000),
  storage_path text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, owner_id, operation_key),
  foreign key (creative_brief_version_id, organization_id)
    references public.design_creative_brief_versions(id, organization_id) on delete restrict,
  foreign key (model_registry_id, organization_id)
    references public.design_model_registry(id, organization_id) on delete restrict,
  foreign key (connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete restrict,
  check (storage_path is null or storage_path = organization_id::text || '/private/' || owner_id::text || '/' || id::text || '.png'),
  check (
    (status = 'queued' and started_at is null and completed_at is null and storage_path is null and failure_phase is null and failure_reason is null)
    or (status = 'running' and started_at is not null and completed_at is null and storage_path is null)
    or (status = 'succeeded' and started_at is not null and completed_at is not null and storage_path is not null and failure_phase is null and failure_reason is null)
    or (status = 'failed' and completed_at is not null and failure_phase is not null and failure_reason is not null and storage_path is null)
    or (status = 'outcome_unknown' and started_at is not null and completed_at is not null and failure_phase = 'provider' and failure_reason is not null and storage_path is null)
  )
);

create index design_private_experiment_jobs_owner_history_idx
  on public.design_private_experiment_jobs(organization_id, owner_id, created_at desc);
create index design_private_experiment_jobs_brief_fk_idx
  on public.design_private_experiment_jobs(creative_brief_version_id, organization_id);
create index design_private_experiment_jobs_model_fk_idx
  on public.design_private_experiment_jobs(model_registry_id, organization_id);
create index design_private_experiment_jobs_connection_fk_idx
  on public.design_private_experiment_jobs(connection_id, organization_id);

create or replace function private.guard_design_private_experiment_job()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare brief public.design_creative_briefs%rowtype;
begin
  if tg_op = 'DELETE' then raise exception 'Private experiment history cannot be deleted'; end if;
  if tg_op = 'INSERT' then
    select b.* into brief from public.design_creative_briefs b
      join public.design_creative_brief_versions v on v.creative_brief_id = b.id and v.organization_id = b.organization_id
    where v.id = new.creative_brief_version_id and v.organization_id = new.organization_id;
    if not found or brief.visibility <> 'private' or brief.created_by <> new.owner_id
      or brief.frozen_version_id is distinct from new.creative_brief_version_id then
      raise exception 'Private generation requires the owner and exact frozen private brief version' using errcode = '23514';
    end if;
    if not exists (select 1 from public.integration_connections c
      join public.integration_connection_departments d on d.connection_id = c.id and d.organization_id = c.organization_id
      where c.id = new.connection_id and c.organization_id = new.organization_id
        and c.provider = 'openai' and c.status = 'verified' and c.archived_at is null and d.department_id = 'design'
        and not exists (select 1 from public.integration_connection_engagements mapped
          where mapped.connection_id = c.id and mapped.organization_id = c.organization_id)) then
      raise exception 'Private generation requires a verified organization-level Design connection' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if (new.organization_id, new.owner_id, new.creative_brief_version_id, new.model_registry_id,
      new.connection_id, new.operation_key, new.request_checksum, new.prompt, new.provider_size, new.created_at)
      is distinct from
      (old.organization_id, old.owner_id, old.creative_brief_version_id, old.model_registry_id,
      old.connection_id, old.operation_key, old.request_checksum, old.prompt, old.provider_size, old.created_at) then
      raise exception 'Private experiment request identity is immutable';
    end if;
    if old.status in ('succeeded', 'failed', 'outcome_unknown') or not (
      (old.status = 'queued' and new.status in ('running', 'failed'))
      or (old.status = 'running' and new.status in ('succeeded', 'failed', 'outcome_unknown'))
    ) then raise exception 'Invalid private experiment job transition'; end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger guard_design_private_experiment_job
before insert or update or delete on public.design_private_experiment_jobs
for each row execute function private.guard_design_private_experiment_job();

alter table public.design_private_experiment_jobs enable row level security;
create policy "Owners read private Design experiment jobs" on public.design_private_experiment_jobs
for select to authenticated using (
  owner_id = (select auth.uid()) and public.is_team_organization_member(organization_id)
);
revoke all on public.design_private_experiment_jobs from public, anon, authenticated;
grant select on public.design_private_experiment_jobs to authenticated;
grant all on public.design_private_experiment_jobs to service_role;

create table public.design_private_experiment_promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  source_job_id uuid not null,
  target_engagement_id uuid not null,
  target_brand_id uuid not null,
  target_service_id uuid not null,
  asset_version_id uuid not null,
  operation_key uuid not null,
  request_checksum text not null check (request_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, owner_id, operation_key),
  unique (asset_version_id, organization_id),
  foreign key (source_job_id, organization_id)
    references public.design_private_experiment_jobs(id, organization_id) on delete restrict,
  foreign key (target_engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete restrict,
  foreign key (target_brand_id, organization_id)
    references public.brands(id, organization_id) on delete restrict,
  foreign key (target_service_id, organization_id)
    references public.engagement_services(id, organization_id) on delete restrict,
  foreign key (asset_version_id, organization_id)
    references public.design_asset_versions(id, organization_id) on delete restrict
);
create index design_private_experiment_promotions_source_fk_idx
  on public.design_private_experiment_promotions(source_job_id, organization_id);
create index design_private_experiment_promotions_engagement_fk_idx
  on public.design_private_experiment_promotions(target_engagement_id, organization_id);
create index design_private_experiment_promotions_brand_fk_idx
  on public.design_private_experiment_promotions(target_brand_id, organization_id);
create index design_private_experiment_promotions_service_fk_idx
  on public.design_private_experiment_promotions(target_service_id, organization_id);

create or replace function private.guard_design_private_experiment_promotion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'Private experiment promotions are immutable'; end if;
  if not exists (select 1 from public.design_private_experiment_jobs job
    where job.id = new.source_job_id and job.organization_id = new.organization_id
      and job.owner_id = new.owner_id and job.status = 'succeeded') then
    raise exception 'Promotion requires the owner and a completed private image' using errcode = '23514';
  end if;
  if not exists (select 1 from public.design_asset_versions version
    join public.design_assets asset on asset.id = version.asset_id and asset.organization_id = version.organization_id
    where version.id = new.asset_version_id and version.organization_id = new.organization_id
      and version.lifecycle_status = 'draft' and version.created_by = new.owner_id
      and asset.engagement_id = new.target_engagement_id and asset.brand_id = new.target_brand_id) then
    raise exception 'Promotion must target an owned unapproved draft asset in the selected engagement' using errcode = '23514';
  end if;
  if not exists (select 1 from public.engagement_services es
    join public.service_catalog service on service.id = es.service_id and service.organization_id = es.organization_id
    where es.id = new.target_service_id and es.organization_id = new.organization_id
      and es.engagement_id = new.target_engagement_id and es.status = 'active'
      and service.department_id = 'design' and service.is_active) then
    raise exception 'Promotion requires an active Design service on the selected engagement' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_design_private_experiment_promotion
before insert or update or delete on public.design_private_experiment_promotions
for each row execute function private.guard_design_private_experiment_promotion();

alter table public.design_private_experiment_promotions enable row level security;
create policy "Owners read private Design promotion links" on public.design_private_experiment_promotions
for select to authenticated using (
  owner_id = (select auth.uid()) and public.is_team_organization_member(organization_id)
);
revoke all on public.design_private_experiment_promotions from public, anon, authenticated;
grant select on public.design_private_experiment_promotions to authenticated;
grant all on public.design_private_experiment_promotions to service_role;

-- Storage is copied first. This service-only wrapper atomically creates the official
-- draft asset/version and its owner-private provenance link in one SQL transaction.
create or replace function public.register_design_private_promotion(
  p_organization_id uuid, p_owner_id uuid, p_source_job_id uuid,
  p_target_service_id uuid, p_promotion_checksum text, p_upload jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing public.design_private_experiment_promotions%rowtype;
  v_job public.design_private_experiment_jobs%rowtype;
  v_result jsonb;
  v_link public.design_private_experiment_promotions%rowtype;
  v_key uuid;
begin
  if p_upload is null or jsonb_typeof(p_upload) <> 'object'
    or p_promotion_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'Private promotion payload is invalid';
  end if;
  v_key := (p_upload->>'p_operation_key')::uuid;
  if (p_upload->>'p_organization_id')::uuid is distinct from p_organization_id
    or (p_upload->>'p_actor_id')::uuid is distinct from p_owner_id then
    raise exception 'Promotion upload actor or organization mismatch' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_owner_id::text || ':' || v_key::text || ':private_promotion', 0));
  select * into v_existing from public.design_private_experiment_promotions
    where organization_id = p_organization_id and owner_id = p_owner_id and operation_key = v_key;
  if found then
    if v_existing.source_job_id <> p_source_job_id or v_existing.target_service_id <> p_target_service_id
      or v_existing.request_checksum <> p_promotion_checksum
      or v_existing.target_engagement_id <> (p_upload->>'p_engagement_id')::uuid
      or v_existing.target_brand_id <> (p_upload->>'p_brand_id')::uuid then
      raise exception 'Promotion key belongs to a different exact source or target' using errcode = '23505';
    end if;
    select pg_catalog.jsonb_build_object('asset', to_jsonb(asset), 'version', to_jsonb(version),
      'promotion', to_jsonb(v_existing), 'idempotent_replay', true) into v_result
    from public.design_asset_versions version
    join public.design_assets asset on asset.id = version.asset_id and asset.organization_id = version.organization_id
    where version.id = v_existing.asset_version_id and version.organization_id = p_organization_id;
    if v_result is null then raise exception 'Promoted draft asset is unavailable'; end if;
    return v_result;
  end if;
  select * into v_job from public.design_private_experiment_jobs
    where id = p_source_job_id and organization_id = p_organization_id and owner_id = p_owner_id
      and status = 'succeeded' for share;
  if not found then raise exception 'Completed owned private image required' using errcode = '23514'; end if;
  if not exists (select 1 from public.engagement_services es
    join public.service_catalog service on service.id = es.service_id and service.organization_id = es.organization_id
    where es.id = p_target_service_id and es.organization_id = p_organization_id
      and es.engagement_id = (p_upload->>'p_engagement_id')::uuid
      and es.status = 'active' and service.department_id = 'design' and service.is_active) then
    raise exception 'Active target Design service required' using errcode = '23514';
  end if;
  v_result := public.register_design_asset_upload(
    (p_upload->>'p_organization_id')::uuid,
    (p_upload->>'p_engagement_id')::uuid,
    (p_upload->>'p_brand_id')::uuid,
    (p_upload->>'p_asset_id')::uuid,
    (p_upload->>'p_version_id')::uuid,
    (p_upload->>'p_expected_latest_version_id')::uuid,
    (p_upload->>'p_source_direction_version_id')::uuid,
    p_upload->>'p_name', p_upload->>'p_output_type',
    p_upload->>'p_placement', p_upload->>'p_rights_notes',
    p_upload->>'p_original_filename', p_upload->>'p_storage_path',
    p_upload->>'p_mime_type', (p_upload->>'p_byte_size')::bigint,
    (p_upload->>'p_width')::integer, (p_upload->>'p_height')::integer,
    p_upload->>'p_content_checksum', p_upload->>'p_change_summary',
    p_upload->>'p_operation_key', p_upload->>'p_request_checksum',
    (p_upload->>'p_actor_id')::uuid
  );
  insert into public.design_private_experiment_promotions(
    organization_id, owner_id, source_job_id, target_engagement_id,
    target_brand_id, target_service_id, asset_version_id, operation_key, request_checksum
  ) values (
    p_organization_id, p_owner_id, p_source_job_id,
    (p_upload->>'p_engagement_id')::uuid, (p_upload->>'p_brand_id')::uuid,
    p_target_service_id, (v_result->'version'->>'id')::uuid, v_key, p_promotion_checksum
  ) returning * into v_link;
  return v_result || pg_catalog.jsonb_build_object('promotion', to_jsonb(v_link));
end;
$$;
revoke all on function public.register_design_private_promotion(uuid,uuid,uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.register_design_private_promotion(uuid,uuid,uuid,uuid,text,jsonb)
  to service_role;
commit;
