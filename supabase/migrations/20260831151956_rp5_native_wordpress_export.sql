-- RP5: provider-neutral WordPress export jobs with a native, private theme artifact.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.wordpress_export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_page_design_id uuid not null,
  provider text not null default 'native'
    check (provider in ('native', 'wpconvert')),
  provider_job_id text,
  provider_download_url text,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'complete', 'failed')),
  storage_path text,
  artifact_sha256 text check (
    artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$'
  ),
  seo_verification jsonb not null default '{}'::jsonb
    check (jsonb_typeof(seo_verification) = 'object'),
  failure_reason text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (website_page_design_id, organization_id)
    references public.website_page_designs(id, organization_id) on delete cascade,
  constraint wordpress_export_jobs_complete_artifact check (
    status <> 'complete'
    or (storage_path is not null and artifact_sha256 is not null and completed_at is not null)
  ),
  constraint wordpress_export_jobs_failure_reason check (
    status <> 'failed' or failure_reason is not null
  ),
  unique (id, organization_id)
);

create index idx_wordpress_export_jobs_design_requested
  on public.wordpress_export_jobs(
    organization_id, website_page_design_id, requested_at desc
  );

create index idx_wordpress_export_jobs_requested_by
  on public.wordpress_export_jobs(requested_by);

alter table public.wordpress_export_jobs enable row level security;

create policy "Team can read permitted WordPress export jobs"
  on public.wordpress_export_jobs
  for select
  to authenticated
  using (
    public.is_team_organization_member(organization_id)
    and exists (
      select 1
      from public.website_page_designs design
      where design.id = website_page_design_id
        and design.organization_id = wordpress_export_jobs.organization_id
    )
  );

revoke all on public.wordpress_export_jobs from anon, authenticated;
grant select on public.wordpress_export_jobs to authenticated;
grant all on public.wordpress_export_jobs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wordpress-theme-exports',
  'wordpress-theme-exports',
  false,
  26214400,
  array['application/zip']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.complete_native_wordpress_export(
  p_job_id uuid,
  p_organization_id uuid,
  p_storage_path text,
  p_artifact_sha256 text,
  p_seo_verification jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_design_id uuid;
begin
  select job.website_page_design_id
  into v_design_id
  from public.wordpress_export_jobs job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.provider = 'native'
    and job.status = 'processing'
  for update;

  if v_design_id is null then
    raise exception 'Native WordPress export job is not processing';
  end if;

  if p_storage_path not like
    p_organization_id::text || '/' || v_design_id::text || '/' || p_job_id::text || '/%'
  then
    raise exception 'Native WordPress export storage path is outside the job scope';
  end if;

  if not (
    p_seo_verification @> '{"title_matches":true,"meta_description_matches":true,"heading_hierarchy_preserved":true,"image_alt_text_preserved":true,"all_checks_passed":true}'::jsonb
  ) then
    raise exception 'Every SEO preservation check must pass before export completion';
  end if;

  update public.website_page_designs
  set status = 'exported',
      exported_at = now(),
      wordpress_export_url = 'storage://wordpress-theme-exports/' || p_storage_path
  where id = v_design_id
    and organization_id = p_organization_id
    and status = 'approved';

  if not found then
    raise exception 'Only an approved website page design can complete export';
  end if;

  update public.wordpress_export_jobs
  set status = 'complete',
      storage_path = p_storage_path,
      artifact_sha256 = p_artifact_sha256,
      seo_verification = p_seo_verification,
      failure_reason = null,
      completed_at = now()
  where id = p_job_id
    and organization_id = p_organization_id;
end;
$$;

revoke all on function public.complete_native_wordpress_export(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_native_wordpress_export(
  uuid, uuid, text, text, jsonb
) to service_role;

comment on table public.wordpress_export_jobs is
  'Auditable WordPress theme export attempts. Native is the default provider; paid adapters can be added without changing the browser contract.';
comment on column public.wordpress_export_jobs.storage_path is
  'Private wordpress-theme-exports object path. Short-lived signed URLs are issued on demand and are never persisted.';
comment on column public.wordpress_export_jobs.seo_verification is
  'Automated title, description, heading, and image-alt preservation results plus the human pre-publish checklist.';
comment on function public.complete_native_wordpress_export(uuid, uuid, text, text, jsonb) is
  'Atomically completes an RP5 job and transitions exactly one approved page design to exported. Service role only.';

commit;
