-- PLN3: deterministic current-rule preview and template-backed canonical composition.
-- Ordered after WCH3 migration 20260903235243_department_chat_proposals.sql.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function private.plan_pipeline_engagement(
  p_organization_id uuid,
  p_pipeline_template_version_id uuid,
  p_service_ids uuid[],
  p_existing_assets jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_version public.pipeline_template_versions%rowtype;
  v_publication public.pipeline_template_publications%rowtype;
  v_original_service_ids uuid[];
  v_original_sha256 text;
  v_final_sha256 text;
  v_rule_manifest jsonb;
  v_current_rule_sha256 text;
  v_plan_core jsonb;
  v_preview_rule_sha256 text;
  v_customization jsonb;
  v_available_count integer;
begin
  if coalesce(cardinality(p_service_ids), 0) = 0 then
    raise exception 'At least one service is required.' using errcode = '22023';
  end if;
  if (select count(*) from unnest(p_service_ids) selected(service_id))
     <> (select count(distinct service_id) from unnest(p_service_ids) selected(service_id)) then
    raise exception 'Selected services must be unique.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_existing_assets, '[]'::jsonb)) <> 'array' then
    raise exception 'Existing assets must be a JSON array.' using errcode = '22023';
  end if;

  select version.*
  into v_version
  from public.pipeline_template_versions version
  where version.id = p_pipeline_template_version_id
    and version.organization_id = p_organization_id;

  if not found then
    raise exception 'Pipeline template version is unavailable.' using errcode = '42501';
  end if;
  if not private.can_read_pipeline_template_version(
    v_version.id,
    p_organization_id
  ) then
    raise exception 'Pipeline template version is unavailable.' using errcode = '42501';
  end if;

  select publication.*
  into v_publication
  from public.pipeline_template_publications publication
  where publication.pipeline_template_version_id = v_version.id
    and publication.pipeline_template_id = v_version.pipeline_template_id
    and publication.organization_id = p_organization_id;

  select array_agg(selection.service_id order by selection.position)
  into v_original_service_ids
  from public.pipeline_template_version_services selection
  where selection.pipeline_template_version_id = v_version.id
    and selection.pipeline_template_id = v_version.pipeline_template_id
    and selection.organization_id = p_organization_id;

  select count(*)
  into v_available_count
  from public.service_catalog service
  where service.organization_id = p_organization_id
    and service.is_active
    and service.id = any(p_service_ids);

  if v_available_count <> cardinality(p_service_ids) then
    raise exception 'One or more selected services are unavailable.' using errcode = '22023';
  end if;

  v_original_sha256 := private.pipeline_service_selection_sha256(v_original_service_ids);
  v_final_sha256 := private.pipeline_service_selection_sha256(p_service_ids);
  v_rule_manifest := private.pipeline_rule_manifest(p_organization_id, p_service_ids);
  v_current_rule_sha256 := encode(extensions.digest(
    convert_to(v_rule_manifest::text, 'UTF8'), 'sha256'
  ), 'hex');

  with
  original_services as (
    select selected.service_id, selected.position - 1 as position
    from unnest(v_original_service_ids) with ordinality selected(service_id, position)
  ),
  selected_services as (
    select selected.service_id, selected.position - 1 as position
    from unnest(p_service_ids) with ordinality selected(service_id, position)
  ),
  primary_stages as (
    select distinct rule.target_stage_id as stage_id
    from public.service_stage_rules rule
    join selected_services selected on selected.service_id = rule.service_id
    where rule.organization_id = p_organization_id
      and rule.rule_kind = 'primary'
  ),
  fallback_decisions as (
    select
      rule.service_id,
      rule.target_stage_id,
      rule.prerequisite_key,
      rule.prerequisite_description,
      rule.fallback_stage_id,
      exists (
        select 1
        from jsonb_array_elements(coalesce(p_existing_assets, '[]'::jsonb)) asset
        where nullif(trim(asset ->> 'asset_kind'), '') = any(rule.accepted_asset_kinds)
          and nullif(trim(asset ->> 'name'), '') is not null
      ) as has_asset,
      exists (
        select 1
        from primary_stages primary_stage
        join public.blueprint_stage_catalog stage
          on stage.id = primary_stage.stage_id
         and stage.organization_id = p_organization_id
        where stage.slug = any(rule.satisfied_by_stage_slugs)
      ) as has_primary_stage
    from public.service_stage_rules rule
    join selected_services selected on selected.service_id = rule.service_id
    where rule.organization_id = p_organization_id
      and rule.rule_kind = 'prerequisite'
  ),
  relevant_stages as (
    select stage_id from primary_stages
    union
    select fallback_stage_id
    from fallback_decisions
    where not has_asset and not has_primary_stage
  ),
  prerequisite_plans as (
    select
      decision.*,
      satisfying.stage_id as satisfying_stage_id,
      case
        when decision.has_asset then 'existing_asset'
        when satisfying.stage_id is not null then 'selected_stage'
        else 'short_stage'
      end as satisfaction_method,
      case
        when decision.has_asset then null::uuid
        when satisfying.stage_id is not null then satisfying.stage_id
        else decision.fallback_stage_id
      end as prerequisite_stage_id
    from fallback_decisions decision
    left join lateral (
      select relevant.stage_id
      from relevant_stages relevant
      join public.blueprint_stage_catalog stage
        on stage.id = relevant.stage_id
       and stage.organization_id = p_organization_id
      join public.service_stage_rules rule
        on rule.service_id = decision.service_id
       and rule.prerequisite_key = decision.prerequisite_key
       and rule.rule_kind = 'prerequisite'
      where stage.slug = any(rule.satisfied_by_stage_slugs)
      order by stage.display_order desc, stage.slug
      limit 1
    ) satisfying on not decision.has_asset
  ),
  context_dependencies as (
    select
      prerequisite.target_stage_id as stage_id,
      prerequisite.prerequisite_stage_id as depends_on_stage_id,
      'context_gate'::text as dependency_kind,
      prerequisite.prerequisite_description as reason
    from prerequisite_plans prerequisite
    where prerequisite.prerequisite_stage_id is not null
  ),
  canonical_dependencies as (
    select
      dependency.stage_id,
      dependency.depends_on_stage_id,
      'finish_to_start'::text as dependency_kind,
      dependency.reason
    from public.blueprint_stage_dependencies dependency
    where dependency.organization_id = p_organization_id
      and dependency.stage_id in (select stage_id from relevant_stages)
      and dependency.depends_on_stage_id in (select stage_id from relevant_stages)
      and not exists (
        select 1
        from context_dependencies context_dependency
        where context_dependency.stage_id = dependency.stage_id
          and context_dependency.depends_on_stage_id = dependency.depends_on_stage_id
      )
  ),
  all_dependencies as (
    select * from context_dependencies
    union
    select * from canonical_dependencies
  ),
  customization as (
    select jsonb_build_object(
      'action', 'removed',
      'service_id', original.service_id,
      'original_position', original.position
    ) as change, 0 as action_order, original.position
    from original_services original
    where not exists (
      select 1 from selected_services selected where selected.service_id = original.service_id
    )
    union all
    select jsonb_build_object(
      'action', 'added',
      'service_id', selected.service_id,
      'final_position', selected.position
    ), 1, selected.position
    from selected_services selected
    where not exists (
      select 1 from original_services original where original.service_id = selected.service_id
    )
    union all
    select jsonb_build_object(
      'action', 'moved',
      'service_id', selected.service_id,
      'original_position', original.position,
      'final_position', selected.position
    ), 2, selected.position
    from selected_services selected
    join original_services original on original.service_id = selected.service_id
    where original.position <> selected.position
      and cardinality(v_original_service_ids) = cardinality(p_service_ids)
      and not exists (
        select 1
        from selected_services candidate
        where not exists (
          select 1 from original_services baseline where baseline.service_id = candidate.service_id
        )
      )
  )
  select jsonb_build_object(
    'services', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', service.id,
        'slug', service.slug,
        'name', service.name,
        'department_id', service.department_id,
        'position', selected.position
      ) order by selected.position), '[]'::jsonb)
      from selected_services selected
      join public.service_catalog service
        on service.id = selected.service_id
       and service.organization_id = p_organization_id
    ),
    'stages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', stage.id,
        'slug', stage.slug,
        'name', stage.name,
        'accountable_department_id', stage.accountable_department_id,
        'display_order', stage.display_order,
        'stage_kind', stage.stage_kind,
        'status', case when primary_stage.stage_id is null then 'ready' else 'planned' end
      ) order by stage.display_order, stage.slug), '[]'::jsonb)
      from relevant_stages relevant
      join public.blueprint_stage_catalog stage
        on stage.id = relevant.stage_id
       and stage.organization_id = p_organization_id
      left join primary_stages primary_stage on primary_stage.stage_id = relevant.stage_id
    ),
    'prerequisites', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'service_id', prerequisite.service_id,
        'target_stage_id', prerequisite.target_stage_id,
        'prerequisite_key', prerequisite.prerequisite_key,
        'description', prerequisite.prerequisite_description,
        'status', case when prerequisite.satisfaction_method = 'short_stage' then 'planned' else 'satisfied' end,
        'satisfaction_method', prerequisite.satisfaction_method,
        'prerequisite_stage_id', prerequisite.prerequisite_stage_id
      ) order by prerequisite.service_id, prerequisite.prerequisite_key), '[]'::jsonb)
      from prerequisite_plans prerequisite
    ),
    'dependencies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'stage_id', dependency.stage_id,
        'depends_on_stage_id', dependency.depends_on_stage_id,
        'dependency_kind', dependency.dependency_kind,
        'reason', dependency.reason
      ) order by dependency.stage_id, dependency.depends_on_stage_id, dependency.dependency_kind), '[]'::jsonb)
      from all_dependencies dependency
    ),
    'customization_provenance', (
      select coalesce(jsonb_agg(customization.change order by customization.action_order, customization.position), '[]'::jsonb)
      from customization
    )
  )
  into v_plan_core;

  v_customization := v_plan_core -> 'customization_provenance';
  v_preview_rule_sha256 := encode(extensions.digest(
    convert_to(jsonb_build_object(
      'organization_id', p_organization_id,
      'pipeline_template_version_id', v_version.id,
      'final_selection_sha256', v_final_sha256,
      'current_rule_sha256', v_current_rule_sha256,
      'plan', v_plan_core - 'customization_provenance'
    )::text, 'UTF8'), 'sha256'
  ), 'hex');

  return v_plan_core || jsonb_build_object(
    'organization_id', p_organization_id,
    'pipeline_template_id', v_version.pipeline_template_id,
    'pipeline_template_version_id', v_version.id,
    'version_number', v_version.version_number,
    'is_published', v_publication.id is not null,
    'publication_id', v_publication.id,
    'publication_number', v_publication.publication_number,
    'original_service_ids', to_jsonb(v_original_service_ids),
    'final_service_ids', to_jsonb(p_service_ids),
    'original_selection_sha256', v_original_sha256,
    'final_selection_sha256', v_final_sha256,
    'was_customized', v_original_sha256 <> v_final_sha256,
    'published_rule_sha256', v_publication.published_rule_sha256,
    'current_rule_sha256', v_current_rule_sha256,
    'preview_rule_sha256', v_preview_rule_sha256,
    'has_rule_drift', v_publication.id is not null
      and v_publication.published_rule_sha256 <> v_current_rule_sha256,
    'is_historical_version', v_publication.id is not null and exists (
      select 1
      from public.pipeline_template_publications newer
      where newer.pipeline_template_id = v_version.pipeline_template_id
        and newer.organization_id = p_organization_id
        and newer.publication_number > v_publication.publication_number
    ),
    'customization_provenance', v_customization
  );
end;
$$;

revoke all on function private.plan_pipeline_engagement(uuid, uuid, uuid[], jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.preview_pipeline_engagement(
  p_organization_id uuid,
  p_pipeline_template_version_id uuid,
  p_service_ids uuid[],
  p_existing_assets jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_pipeline_team_member(p_organization_id) then
    raise exception 'Active team membership is required.' using errcode = '42501';
  end if;
  return private.plan_pipeline_engagement(
    p_organization_id,
    p_pipeline_template_version_id,
    p_service_ids,
    p_existing_assets
  );
end;
$$;

create or replace function public.compose_engagement_from_pipeline_template(
  p_organization_id uuid,
  p_request_id uuid,
  p_pipeline_template_version_id uuid,
  p_preview_rule_sha256 text,
  p_client_id uuid,
  p_brand_id uuid,
  p_name text,
  p_engagement_type text,
  p_service_ids uuid[],
  p_lead_owner_id uuid default null,
  p_service_owners jsonb default '{}'::jsonb,
  p_start_date date default null,
  p_target_date date default null,
  p_objective text default '',
  p_existing_assets jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_version public.pipeline_template_versions%rowtype;
  v_existing public.engagement_composition_requests%rowtype;
  v_plan jsonb;
  v_payload jsonb;
  v_payload_sha256 text;
  v_engagement_id uuid;
  v_normalized_preview_sha256 text;
  v_service_owners jsonb;
  v_existing_assets jsonb;
begin
  if v_actor_id is null or not private.is_active_pipeline_team_member(p_organization_id) then
    raise exception 'Active team membership is required.' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Request id is required.' using errcode = '22023';
  end if;
  v_normalized_preview_sha256 := lower(trim(coalesce(p_preview_rule_sha256, '')));
  if v_normalized_preview_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid preview rule hash is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_service_owners, '{}'::jsonb)) <> 'object' then
    raise exception 'Service owners must be a JSON object.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_existing_assets, '[]'::jsonb)) <> 'array' then
    raise exception 'Existing assets must be a JSON array.' using errcode = '22023';
  end if;

  select version.*
  into v_version
  from public.pipeline_template_versions version
  join public.pipeline_template_publications publication
    on publication.pipeline_template_version_id = version.id
   and publication.pipeline_template_id = version.pipeline_template_id
   and publication.organization_id = version.organization_id
  where version.id = p_pipeline_template_version_id
    and version.organization_id = p_organization_id;

  if not found then
    raise exception 'Published pipeline template version is unavailable.' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(
    selected.service_id::text,
    (nullif(trim(p_service_owners ->> selected.service_id::text), '')::uuid)::text
    order by selected.service_id::text
  ), '{}'::jsonb)
  into v_service_owners
  from unnest(p_service_ids) selected(service_id)
  where nullif(trim(p_service_owners ->> selected.service_id::text), '') is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'asset_kind', trim(item.asset ->> 'asset_kind'),
    'name', trim(item.asset ->> 'name'),
    'source_url', nullif(trim(item.asset ->> 'source_url'), ''),
    'notes', coalesce(trim(item.asset ->> 'notes'), '')
  ) order by item.position), '[]'::jsonb)
  into v_existing_assets
  from jsonb_array_elements(coalesce(p_existing_assets, '[]'::jsonb))
    with ordinality item(asset, position)
  where nullif(trim(item.asset ->> 'asset_kind'), '') is not null
    and nullif(trim(item.asset ->> 'name'), '') is not null;

  v_payload := jsonb_build_object(
    'organization_id', p_organization_id,
    'pipeline_template_version_id', p_pipeline_template_version_id,
    'preview_rule_sha256', v_normalized_preview_sha256,
    'client_id', p_client_id,
    'brand_id', p_brand_id,
    'name', trim(p_name),
    'engagement_type', p_engagement_type,
    'service_ids', to_jsonb(p_service_ids),
    'lead_owner_id', p_lead_owner_id,
    'service_owners', v_service_owners,
    'start_date', p_start_date,
    'target_date', p_target_date,
    'objective', coalesce(trim(p_objective), ''),
    'existing_assets', v_existing_assets
  );
  v_payload_sha256 := encode(extensions.digest(
    convert_to(v_payload::text, 'UTF8'), 'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_request_id::text, 0)
  );

  select request.*
  into v_existing
  from public.engagement_composition_requests request
  where request.organization_id = p_organization_id
    and request.request_id = p_request_id;

  if found then
    if v_existing.normalized_payload_sha256 <> v_payload_sha256 then
      raise exception 'Request id was already used with different inputs.' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'engagement_id', v_existing.engagement_id,
      'idempotent_replay', true
    );
  end if;

  v_plan := private.plan_pipeline_engagement(
    p_organization_id,
    p_pipeline_template_version_id,
    p_service_ids,
    v_existing_assets
  );

  if v_normalized_preview_sha256 <> (v_plan ->> 'preview_rule_sha256') then
    raise exception 'Pipeline preview is stale; preview again before creation.' using errcode = '40001';
  end if;

  v_engagement_id := public.compose_engagement(
    p_client_id,
    p_brand_id,
    p_name,
    p_engagement_type,
    p_service_ids,
    p_lead_owner_id,
    v_service_owners,
    p_start_date,
    p_target_date,
    p_objective,
    v_existing_assets
  );

  insert into public.engagement_pipeline_origins (
    engagement_id,
    organization_id,
    pipeline_template_id,
    pipeline_template_version_id,
    original_selection_sha256,
    final_selection_sha256,
    was_customized,
    customization_provenance,
    preview_rule_sha256,
    created_by
  ) values (
    v_engagement_id,
    p_organization_id,
    v_version.pipeline_template_id,
    p_pipeline_template_version_id,
    v_plan ->> 'original_selection_sha256',
    v_plan ->> 'final_selection_sha256',
    (v_plan ->> 'was_customized')::boolean,
    v_plan -> 'customization_provenance',
    v_plan ->> 'preview_rule_sha256',
    v_actor_id
  );

  insert into public.engagement_composition_requests (
    organization_id,
    request_id,
    normalized_payload_sha256,
    preview_rule_sha256,
    engagement_id,
    requested_by
  ) values (
    p_organization_id,
    p_request_id,
    v_payload_sha256,
    v_plan ->> 'preview_rule_sha256',
    v_engagement_id,
    v_actor_id
  );

  return jsonb_build_object(
    'engagement_id', v_engagement_id,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.preview_pipeline_engagement(uuid, uuid, uuid[], jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.compose_engagement_from_pipeline_template(
  uuid, uuid, uuid, text, uuid, uuid, text, text, uuid[], uuid, jsonb, date, date, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.preview_pipeline_engagement(uuid, uuid, uuid[], jsonb)
  to authenticated;
grant execute on function public.compose_engagement_from_pipeline_template(
  uuid, uuid, uuid, text, uuid, uuid, text, text, uuid[], uuid, jsonb, date, date, text, jsonb
) to authenticated;

comment on function public.preview_pipeline_engagement(uuid, uuid, uuid[], jsonb) is
  'PLN3 read-only current-rule journey preview for one visible immutable service preset.';
comment on function public.compose_engagement_from_pipeline_template(
  uuid, uuid, uuid, text, uuid, uuid, text, text, uuid[], uuid, jsonb, date, date, text, jsonb
) is
  'PLN3 atomic template-backed wrapper over the canonical compose_engagement graph authority.';

commit;
