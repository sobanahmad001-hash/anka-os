-- MB03B - Marketing-owned, immutable SEO research evidence.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.artifacts drop constraint artifacts_artifact_type_check;
alter table public.artifacts add constraint artifacts_artifact_type_check check (artifact_type in (
  'discovery','vision','audience','brand_statement','website_architecture','keyword_strategy','content',
  'campaign_messaging','scripts','channel_strategy','campaign_brief','measurement_plan','marketing_report',
  'technical_brief','launch_checklist','design_system','seo_research'
));
comment on constraint artifacts_artifact_type_check on public.artifacts is
  'Canonical artifact vocabulary, including Marketing-owned immutable SEO research evidence.';

create table public.marketing_seo_research_save_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null default 'save_seo_research' check (action = 'save_seo_research'),
  idempotency_key uuid not null,
  payload_checksum text not null check (payload_checksum ~ '^[a-f0-9]{64}$'),
  artifact_id uuid not null,
  artifact_version_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete cascade,
  foreign key (artifact_version_id, organization_id) references public.artifact_versions(id, organization_id) on delete cascade,
  unique (organization_id, actor_id, action, idempotency_key),
  unique (id, organization_id),
  check (expires_at > created_at)
);
create index idx_marketing_seo_research_save_requests_expiry on public.marketing_seo_research_save_requests(expires_at);
alter table public.marketing_seo_research_save_requests enable row level security;
revoke all on public.marketing_seo_research_save_requests from anon, authenticated;
grant all on public.marketing_seo_research_save_requests to service_role;

create function public.save_marketing_seo_research(
  p_organization_id uuid,
  p_engagement_id uuid,
  p_artifact_id uuid,
  p_expected_latest_version_id uuid,
  p_title text,
  p_content jsonb,
  p_content_checksum text,
  p_change_summary text,
  p_idempotency_key uuid,
  p_payload_checksum text,
  p_actor_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_membership record;
  v_engagement record;
  v_artifact public.artifacts%rowtype;
  v_latest public.artifact_versions%rowtype;
  v_version public.artifact_versions%rowtype;
  v_replay public.marketing_seo_research_save_requests%rowtype;
  v_strategy_version_id uuid;
begin
  if p_organization_id is null or p_actor_id is null or p_idempotency_key is null then
    raise exception 'Organization, actor, and idempotency key are required';
  end if;
  if p_payload_checksum !~ '^[a-f0-9]{64}$' or p_content_checksum !~ '^[a-f0-9]{64}$' then
    raise exception 'Valid request and content checksums are required';
  end if;
  if length(trim(coalesce(p_title,''))) not between 1 and 240 then raise exception 'Research title is required'; end if;
  if jsonb_typeof(p_content) <> 'object' or jsonb_typeof(p_content->'input') <> 'object'
    or jsonb_typeof(p_content->'source_facts') <> 'array'
    or jsonb_typeof(p_content->'interpretations') <> 'array'
    or jsonb_typeof(p_content->'limitations') <> 'array'
  then raise exception 'SEO research content is malformed'; end if;
  if p_content->'input'->>'research_type' not in ('domain','page')
    or nullif(trim(p_content->'input'->>'target_url'),'') is null
    or nullif(trim(p_content->'input'->>'market'),'') is null
    or (p_content->'input'->'language') is distinct from 'null'::jsonb
    or (p_content->'input'->'device') is distinct from 'null'::jsonb
  then raise exception 'SEO research scope is invalid'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_actor_id::text || ':save_seo_research:' || p_idempotency_key::text, 0));
  select role,department_id into v_membership from public.organization_memberships
  where organization_id=p_organization_id and user_id=p_actor_id and member_kind='team' and status='active'
    and exists(select 1 from public.organizations o where o.id=p_organization_id and o.status='active');
  if not found or not coalesce(
    v_membership.role in ('system_owner','operations_admin','executive') or v_membership.department_id='marketing', false
  ) then
    raise exception 'Marketing department access required' using errcode='42501';
  end if;
  select id,brand_id into v_engagement from public.engagements
  where id=p_engagement_id and organization_id=p_organization_id;
  if not found or not exists (
    select 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id
    where es.organization_id=p_organization_id and es.engagement_id=p_engagement_id
      and es.status='active' and sc.organization_id=p_organization_id and sc.department_id='marketing' and sc.is_active
  ) then raise exception 'Active Marketing engagement required' using errcode='42501'; end if;

  delete from public.marketing_seo_research_save_requests
  where organization_id=p_organization_id and actor_id=p_actor_id and action='save_seo_research'
    and idempotency_key=p_idempotency_key and expires_at <= pg_catalog.clock_timestamp();
  select * into v_replay from public.marketing_seo_research_save_requests
  where organization_id=p_organization_id and actor_id=p_actor_id and action='save_seo_research'
    and idempotency_key=p_idempotency_key and expires_at > pg_catalog.clock_timestamp();
  if found then
    if v_replay.payload_checksum <> p_payload_checksum then
      raise exception 'Idempotency key was already used with a different payload' using errcode='23505';
    end if;
    select * into v_version from public.artifact_versions
    where id=v_replay.artifact_version_id and organization_id=p_organization_id;
    return to_jsonb(v_version) || jsonb_build_object('artifact_id',v_replay.artifact_id,'replayed',true);
  end if;

  v_strategy_version_id := nullif(p_content->'input'->>'content_strategy_version_id','')::uuid;
  if v_strategy_version_id is not null and not exists (
    select 1 from public.artifact_versions av join public.artifacts a
      on a.id=av.artifact_id and a.organization_id=av.organization_id
    where av.id=v_strategy_version_id and av.organization_id=p_organization_id
      and a.brand_id=v_engagement.brand_id and a.artifact_type='keyword_strategy'
  ) then raise exception 'Content strategy version is unavailable for this brand' using errcode='42501'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || coalesce(p_artifact_id::text,p_idempotency_key::text) || ':seo_research_lineage', 0));
  if p_artifact_id is null then
    if p_expected_latest_version_id is not null then raise exception 'New research cannot supply an expected version'; end if;
    insert into public.artifacts(organization_id,brand_id,engagement_id,artifact_type,title,created_by)
    values(p_organization_id,v_engagement.brand_id,p_engagement_id,'seo_research',trim(p_title),p_actor_id)
    returning * into v_artifact;
  else
    select * into v_artifact from public.artifacts
    where id=p_artifact_id and organization_id=p_organization_id for update;
    if not found or v_artifact.artifact_type <> 'seo_research' or v_artifact.engagement_id <> p_engagement_id or v_artifact.brand_id <> v_engagement.brand_id then
      raise exception 'SEO research artifact does not match this engagement' using errcode='42501';
    end if;
    update public.artifacts set title=trim(p_title) where id=v_artifact.id and organization_id=p_organization_id returning * into v_artifact;
  end if;
  select * into v_latest from public.artifact_versions
  where artifact_id=v_artifact.id and organization_id=p_organization_id
  order by version_number desc limit 1 for update;
  if v_latest.id is distinct from p_expected_latest_version_id then
    raise exception 'SEO research changed since it was loaded; refresh before saving' using errcode='40001';
  end if;
  insert into public.artifact_versions(
    organization_id,artifact_id,version_number,parent_version_id,content,content_checksum,
    change_summary,ai_use_allowed,data_classification,created_by
  ) values(
    p_organization_id,v_artifact.id,coalesce(v_latest.version_number,0)+1,v_latest.id,p_content,p_content_checksum,
    left(coalesce(p_change_summary,''),1000),false,'internal',p_actor_id
  ) returning * into v_version;
  insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
  values(p_organization_id,p_engagement_id,'artifact_version_created',p_actor_id,
    jsonb_build_object('record_type','artifact','record_id',v_artifact.id,'version_id',v_version.id,
      'action','version_created','artifact_type','seo_research'));
  insert into public.marketing_seo_research_save_requests(
    organization_id,actor_id,idempotency_key,payload_checksum,artifact_id,artifact_version_id
  ) values(p_organization_id,p_actor_id,p_idempotency_key,p_payload_checksum,v_artifact.id,v_version.id);
  return to_jsonb(v_version) || jsonb_build_object('artifact_id',v_artifact.id,'replayed',false);
end;
$$;

revoke all on function public.save_marketing_seo_research(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.save_marketing_seo_research(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid) to service_role;

comment on table public.marketing_seo_research_save_requests is
  'Metadata-only, actor-scoped 30-day replay ledger for atomic immutable SEO research saves.';

commit;
