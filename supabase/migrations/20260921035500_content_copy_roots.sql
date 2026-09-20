-- C05: copy one exact Content writer version into a new, unapproved root.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.content_copy_roots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  engagement_id uuid not null,
  source_version_id uuid not null,
  source_checksum text not null check (source_checksum ~ '^[0-9a-f]{64}$'),
  copied_version_id uuid not null,
  operation_key uuid not null,
  copied_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete restrict,
  foreign key (source_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  foreign key (copied_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  unique (organization_id, copied_by, operation_key),
  unique (copied_version_id),
  unique (id, organization_id)
);
create index content_copy_roots_engagement_created_idx
  on public.content_copy_roots(organization_id, engagement_id, created_at desc);
create index content_copy_roots_source_idx
  on public.content_copy_roots(organization_id, source_version_id);

alter table public.content_copy_roots enable row level security;
create policy content_copy_roots_team_read on public.content_copy_roots
  for select to authenticated
  using (public.is_team_organization_member(organization_id));
revoke all on public.content_copy_roots from public, anon, authenticated, service_role;
grant select on public.content_copy_roots to authenticated;
grant select, insert on public.content_copy_roots to service_role;

create function public.copy_content_writer_version(
  p_organization_id uuid, p_engagement_id uuid, p_source_version_id uuid,
  p_source_checksum text, p_operation_key uuid, p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_prior public.content_copy_roots%rowtype;
  v_source record;
  v_artifact_id uuid;
  v_version_id uuid;
begin
  if p_organization_id is null or p_engagement_id is null or p_source_version_id is null
    or p_operation_key is null or p_actor_id is null or p_source_checksum is null
    or p_source_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'Copy request requires exact scope, source checksum and operation key.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_actor_id::text || ':' || p_operation_key::text, 0));
  select * into v_prior from public.content_copy_roots
    where organization_id=p_organization_id and copied_by=p_actor_id and operation_key=p_operation_key;
  if found then
    if v_prior.engagement_id is distinct from p_engagement_id
      or v_prior.source_version_id is distinct from p_source_version_id
      or v_prior.source_checksum is distinct from p_source_checksum then
      raise exception 'Copy request ID was already used for a different source.' using errcode = '23505';
    end if;
    select artifact_id into v_artifact_id from public.artifact_versions
      where id=v_prior.copied_version_id and organization_id=p_organization_id;
    return jsonb_build_object('artifact_id',v_artifact_id,'version_id',v_prior.copied_version_id,
      'source_version_id',v_prior.source_version_id,'replayed',true);
  end if;

  select v.id version_id, v.content, v.content_checksum, v.data_classification,
    a.id artifact_id, a.brand_id, a.project_id, a.engagement_stage_instance_id,
    a.engagement_id, a.artifact_type, e.status engagement_status
  into v_source
  from public.artifact_versions v
  join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id
  join public.engagements e on e.id=a.engagement_id and e.organization_id=a.organization_id
  where v.id=p_source_version_id and v.organization_id=p_organization_id
    and a.engagement_id=p_engagement_id
  for share of v, a;
  if not found or v_source.artifact_type is distinct from 'content'
    or v_source.content->>'schema_version' is distinct from '2'
    or coalesce(v_source.content->>'output_type','') not in
      ('website_page_copy','blog_article','social_copy','campaign_copy','custom_text') then
    raise exception 'Exact Content writer source is unavailable in this engagement.' using errcode = '23503';
  end if;
  if v_source.content_checksum <> p_source_checksum then
    raise exception 'Source version changed; refresh before copying.' using errcode = '23514';
  end if;
  if v_source.engagement_status not in ('planning','active') or not exists (
    select 1 from public.engagement_services es
    join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id
    where es.organization_id=p_organization_id and es.engagement_id=p_engagement_id
      and es.status='active' and sc.department_id='content' and sc.is_active
  ) then
    raise exception 'An active Content service is required to copy a writer version.' using errcode = '23514';
  end if;
  if v_source.content->>'output_type' = 'website_page_copy' and not exists (
    select 1 from public.artifact_versions structure_version
    join public.artifacts structure on structure.id=structure_version.artifact_id
      and structure.organization_id=structure_version.organization_id
    where structure_version.id=(v_source.content->>'source_architecture_version_id')::uuid
      and structure_version.organization_id=p_organization_id
      and structure.engagement_id=p_engagement_id and structure.brand_id=v_source.brand_id
      and structure.artifact_type='website_architecture'
      and exists (select 1 from jsonb_array_elements(structure_version.content->'pages') page
        where page->>'page_key'=v_source.content->>'target_page_key')
  ) then
    raise exception 'The exact Website Architecture target is no longer available.' using errcode = '23503';
  end if;

  insert into public.artifacts(organization_id, project_id, brand_id, engagement_id,
    engagement_stage_instance_id, artifact_type, title, created_by)
  values (p_organization_id, v_source.project_id, v_source.brand_id, p_engagement_id,
    v_source.engagement_stage_instance_id, 'content',
    left(v_source.content->>'working_title',240), p_actor_id)
  returning id into v_artifact_id;
  insert into public.artifact_versions(organization_id, artifact_id, version_number,
    parent_version_id, content, content_checksum, change_summary, ai_use_allowed,
    data_classification, created_by)
  values (p_organization_id, v_artifact_id, 1, null, v_source.content,
    v_source.content_checksum, 'Copied from exact Content version ' || p_source_version_id::text,
    false, v_source.data_classification, p_actor_id)
  returning id into v_version_id;
  insert into public.content_copy_roots(organization_id, engagement_id, source_version_id,
    source_checksum, copied_version_id, operation_key, copied_by)
  values (p_organization_id, p_engagement_id, p_source_version_id,
    p_source_checksum, v_version_id, p_operation_key, p_actor_id);
  insert into public.engagement_events(organization_id, engagement_id, event_type, actor_id, payload)
  values (p_organization_id, p_engagement_id, 'artifact_version_created', p_actor_id,
    jsonb_build_object('record_type','artifact','record_id',v_artifact_id,'version_id',v_version_id,
      'action','copied_into_unapproved_draft','artifact_type','content',
      'source_artifact_version_id',p_source_version_id));
  return jsonb_build_object('artifact_id',v_artifact_id,'version_id',v_version_id,
    'source_version_id',p_source_version_id,'replayed',false);
end;
$$;
revoke all on function public.copy_content_writer_version(uuid,uuid,uuid,text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.copy_content_writer_version(uuid,uuid,uuid,text,uuid,uuid)
  to service_role;
commit;
