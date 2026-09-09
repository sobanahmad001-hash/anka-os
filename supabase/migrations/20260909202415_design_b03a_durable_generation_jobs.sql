-- B03A durable image-generation request ledger.

create table public.design_image_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  direction_version_id uuid not null,
  model_registry_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  operation_key text not null,
  request_checksum text not null,
  prompt text not null,
  status text not null default 'queued',
  failure_phase text,
  failure_reason text,
  media_asset_id uuid,
  retry_of_job_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint design_image_generation_jobs_org_operation_key_unique
    unique (organization_id, requested_by, operation_key),
  constraint design_image_generation_jobs_id_org_unique
    unique (id, organization_id),
  constraint design_image_generation_jobs_media_org_unique
    unique (media_asset_id, organization_id),
  constraint design_image_generation_jobs_retry_org_unique
    unique (retry_of_job_id, organization_id),
  constraint design_image_generation_jobs_direction_version_fk
    foreign key (direction_version_id, organization_id)
    references public.design_direction_versions (id, organization_id),
  constraint design_image_generation_jobs_model_registry_fk
    foreign key (model_registry_id, organization_id)
    references public.design_model_registry (id, organization_id),
  constraint design_image_generation_jobs_media_asset_fk
    foreign key (media_asset_id, organization_id)
    references public.design_media_assets (id, organization_id),
  constraint design_image_generation_jobs_retry_fk
    foreign key (retry_of_job_id, organization_id)
    references public.design_image_generation_jobs (id, organization_id),
  constraint design_image_generation_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed', 'outcome_unknown')),
  constraint design_image_generation_jobs_failure_phase_check
    check (failure_phase is null or failure_phase in ('configuration', 'provider', 'storage', 'registration')),
  constraint design_image_generation_jobs_operation_key_check
    check (operation_key = btrim(operation_key) and length(operation_key) between 8 and 200),
  constraint design_image_generation_jobs_checksum_check
    check (request_checksum ~ '^[0-9a-f]{64}$'),
  constraint design_image_generation_jobs_prompt_check
    check (length(btrim(prompt)) between 1 and 12000),
  constraint design_image_generation_jobs_not_self_retry_check
    check (retry_of_job_id is null or retry_of_job_id <> id),
  constraint design_image_generation_jobs_lifecycle_check
    check (
      (status = 'queued' and started_at is null and completed_at is null and failure_phase is null and failure_reason is null and media_asset_id is null)
      or (status = 'running' and started_at is not null and completed_at is null and failure_phase is null and failure_reason is null)
      or (status = 'succeeded' and started_at is not null and completed_at is not null and failure_phase is null and failure_reason is null and media_asset_id is not null)
      or (status = 'failed' and completed_at is not null and failure_phase is not null and failure_reason is not null)
      or (status = 'outcome_unknown' and started_at is not null and completed_at is not null and failure_phase = 'provider' and failure_reason is not null)
    )
);

create index design_image_generation_jobs_direction_history_idx
  on public.design_image_generation_jobs (organization_id, direction_version_id, created_at desc);

create index design_image_generation_jobs_model_registry_fk_idx
  on public.design_image_generation_jobs (model_registry_id, organization_id);

create index design_image_generation_jobs_requested_by_idx
  on public.design_image_generation_jobs (requested_by, organization_id);

create index design_image_generation_jobs_active_idx
  on public.design_image_generation_jobs (organization_id, direction_version_id, updated_at desc)
  where status in ('queued', 'running', 'outcome_unknown');

create or replace function private.guard_design_image_generation_job()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_job public.design_image_generation_jobs%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'Design image generation jobs cannot be deleted';
  end if;

  if tg_op = 'INSERT' and new.retry_of_job_id is not null then
    select * into parent_job
    from public.design_image_generation_jobs
    where id = new.retry_of_job_id
      and organization_id = new.organization_id
    for update;

    if not found then
      raise exception 'Retry source job was not found';
    end if;

    if parent_job.status <> 'failed' or parent_job.failure_phase <> 'provider' then
      raise exception 'Only confirmed provider failures may be retried';
    end if;

    if parent_job.direction_version_id <> new.direction_version_id
      or parent_job.model_registry_id <> new.model_registry_id
      or parent_job.request_checksum <> new.request_checksum
      or parent_job.prompt <> new.prompt then
      raise exception 'Retry payload must match the source request';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if (new.organization_id, new.direction_version_id, new.model_registry_id, new.requested_by,
        new.operation_key, new.request_checksum, new.prompt, new.retry_of_job_id, new.created_at)
      is distinct from
       (old.organization_id, old.direction_version_id, old.model_registry_id, old.requested_by,
        old.operation_key, old.request_checksum, old.prompt, old.retry_of_job_id, old.created_at) then
      raise exception 'Design image generation job identity is immutable';
    end if;

    if old.status in ('succeeded', 'failed', 'outcome_unknown') then
      raise exception 'Terminal design image generation jobs are immutable';
    end if;

    if not (
      (old.status = 'queued' and new.status in ('running', 'failed'))
      or (old.status = 'running' and new.status in ('succeeded', 'failed', 'outcome_unknown'))
    ) then
      raise exception 'Invalid design image generation job transition: % to %', old.status, new.status;
    end if;

    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger guard_design_image_generation_job_trigger
before insert or update or delete on public.design_image_generation_jobs
for each row execute function private.guard_design_image_generation_job();

alter table public.design_image_generation_jobs enable row level security;

create policy design_image_generation_jobs_select_visible_direction
on public.design_image_generation_jobs
for select
to authenticated
using (
  public.is_team_organization_member(organization_id)
  and
  exists (
    select 1
    from public.design_direction_versions direction_version
    where direction_version.id = design_image_generation_jobs.direction_version_id
      and direction_version.organization_id = design_image_generation_jobs.organization_id
  )
);

revoke all on table public.design_image_generation_jobs from public, anon, authenticated;
grant select on table public.design_image_generation_jobs to authenticated;
grant all on table public.design_image_generation_jobs to service_role;

revoke all on function private.guard_design_image_generation_job() from public, anon, authenticated;
grant execute on function private.guard_design_image_generation_job() to service_role;
