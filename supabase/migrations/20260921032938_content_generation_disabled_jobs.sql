-- C04: durable, fail-closed Content generation requests. No paid execution is enabled.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.content_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  engagement_id uuid not null,
  source_artifact_version_id uuid not null,
  model_configuration_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  request_kind text not null check (request_kind in ('draft', 'rewrite')),
  variant_count integer not null check (variant_count between 1 and 3),
  input_checksum text not null check (input_checksum ~ '^[0-9a-f]{64}$'),
  input_manifest jsonb not null default '{}'::jsonb,
  status text not null default 'blocked' check (status = 'blocked'),
  blocked_reason text not null default 'Paid Content generation is disabled until numeric cost limits and activation are approved.'
    check (blocked_reason = 'Paid Content generation is disabled until numeric cost limits and activation are approved.'),
  ai_run_id uuid,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_microusd bigint,
  actual_cost_microusd bigint,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint content_generation_jobs_no_execution_check check (
    ai_run_id is null and input_tokens is null and output_tokens is null
    and estimated_cost_microusd is null and actual_cost_microusd is null
    and started_at is null and completed_at is null
  ),
  constraint content_generation_jobs_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint content_generation_jobs_engagement_fk foreign key (engagement_id, project_id, organization_id)
    references public.engagements(id, project_id, organization_id) on delete restrict,
  constraint content_generation_jobs_source_fk foreign key (source_artifact_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  constraint content_generation_jobs_model_fk foreign key (model_configuration_id, organization_id)
    references public.department_chat_model_configurations(id, organization_id) on delete restrict,
  constraint content_generation_jobs_request_key unique (organization_id, requested_by, request_id),
  unique (id, organization_id)
);

create index content_generation_jobs_project_created_idx
  on public.content_generation_jobs(organization_id, project_id, created_at desc);
create index content_generation_jobs_engagement_created_idx
  on public.content_generation_jobs(organization_id, engagement_id, created_at desc);
create index content_generation_jobs_source_fk_idx
  on public.content_generation_jobs(source_artifact_version_id, organization_id);
create index content_generation_jobs_model_fk_idx
  on public.content_generation_jobs(model_configuration_id, organization_id);

create function private.protect_disabled_content_generation_job()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Content generation jobs cannot be changed while paid generation is disabled.';
end;
$$;
create trigger content_generation_jobs_immutable
before update or delete on public.content_generation_jobs
for each row execute function private.protect_disabled_content_generation_job();
revoke all on function private.protect_disabled_content_generation_job() from public, anon, authenticated;
grant execute on function private.protect_disabled_content_generation_job() to service_role;

create function public.record_blocked_content_generation_job(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid,
  p_source_artifact_version_id uuid, p_model_configuration_id uuid,
  p_actor_id uuid, p_request_id uuid, p_request_kind text,
  p_variant_count integer, p_input_checksum text, p_input_manifest jsonb
) returns public.content_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare v_job public.content_generation_jobs%rowtype;
begin
  insert into public.content_generation_jobs (
    organization_id, project_id, engagement_id, source_artifact_version_id,
    model_configuration_id, requested_by, request_id, request_kind,
    variant_count, input_checksum, input_manifest
  ) values (
    p_organization_id, p_project_id, p_engagement_id, p_source_artifact_version_id,
    p_model_configuration_id, p_actor_id, p_request_id, p_request_kind,
    p_variant_count, p_input_checksum, p_input_manifest
  ) on conflict (organization_id, requested_by, request_id) do nothing
  returning * into v_job;
  if v_job.id is null then
    select * into v_job from public.content_generation_jobs
    where organization_id = p_organization_id and requested_by = p_actor_id and request_id = p_request_id;
    if not found or v_job.project_id is distinct from p_project_id
       or v_job.engagement_id is distinct from p_engagement_id
       or v_job.source_artifact_version_id is distinct from p_source_artifact_version_id
       or v_job.model_configuration_id is distinct from p_model_configuration_id
       or v_job.request_kind is distinct from p_request_kind
       or v_job.variant_count is distinct from p_variant_count
       or v_job.input_checksum is distinct from p_input_checksum then
      raise exception 'Generation request ID was already used for different inputs.';
    end if;
  end if;
  return v_job;
end;
$$;
revoke all on function public.record_blocked_content_generation_job(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, integer, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_blocked_content_generation_job(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, integer, text, jsonb
) to service_role;

alter table public.content_generation_jobs enable row level security;
create policy content_generation_jobs_read_own
on public.content_generation_jobs for select to authenticated
using (requested_by = (select auth.uid()) and public.is_team_organization_member(organization_id));
revoke all on public.content_generation_jobs from public, anon, authenticated, service_role;
grant select on public.content_generation_jobs to authenticated;
grant select, insert on public.content_generation_jobs to service_role;
commit;
