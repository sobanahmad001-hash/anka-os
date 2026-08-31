-- Rollback-safe DS5 verification. Run only after explicit live-database approval.

begin;

create temporary table ds5_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_engagement_id uuid;
  v_brand_id uuid;
  v_actor_id uuid;
  v_service_id uuid;
  v_artifact_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
  v_source_artifact_id uuid;
begin
  select engagement_service.organization_id, engagement_service.engagement_id,
         engagement.brand_id, membership.user_id, service.id
  into v_organization_id, v_engagement_id, v_brand_id, v_actor_id, v_service_id
  from public.engagement_services engagement_service
  join public.service_catalog service
    on service.id = engagement_service.service_id
   and service.organization_id = engagement_service.organization_id
  join public.engagements engagement
    on engagement.id = engagement_service.engagement_id
   and engagement.organization_id = engagement_service.organization_id
  join public.organization_memberships membership
    on membership.organization_id = engagement_service.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  where engagement_service.status = 'active'
    and service.slug = 'design_systems'
    and service.department_id = 'design'
    and service.is_active
  limit 1;

  if v_actor_id is null then
    select service.organization_id, engagement.id, engagement.brand_id,
           membership.user_id, service.id
    into v_organization_id, v_engagement_id, v_brand_id, v_actor_id, v_service_id
    from public.service_catalog service
    join public.engagements engagement
      on engagement.organization_id = service.organization_id
     and engagement.status in ('planning', 'active')
    join public.organization_memberships membership
      on membership.organization_id = service.organization_id
     and membership.member_kind = 'team'
     and membership.status = 'active'
    where service.slug = 'design_systems'
      and service.department_id = 'design'
      and service.is_active
    limit 1;

    if v_actor_id is null then
      insert into ds5_runtime_checks values
        ('released_version_persists', false),
        ('d3_relation_targets_design_system', false);
      return;
    end if;

    insert into public.engagement_services (
      organization_id, engagement_id, service_id, status, activated_by
    ) values (
      v_organization_id, v_engagement_id, v_service_id, 'active', v_actor_id
    )
    on conflict (engagement_id, service_id) do update
      set status = 'active', activated_by = excluded.activated_by, activated_at = now();
  end if;

  insert into public.artifacts (
    id, organization_id, brand_id, engagement_id, artifact_type, title, created_by
  ) values (
    v_artifact_id, v_organization_id, v_brand_id, v_engagement_id,
    'design_system', 'DS5 rollback verifier', v_actor_id
  );

  insert into public.artifact_versions (
    id, organization_id, artifact_id, version_number, content, content_checksum,
    change_summary, ai_use_allowed, data_classification, created_by
  ) values (
    v_version_id, v_organization_id, v_artifact_id, 1,
    jsonb_build_object(
      'color_tokens', jsonb_build_array(jsonb_build_object('name', 'Verifier', 'value', '#123456')),
      'typography_scale', jsonb_build_array(jsonb_build_object('name', 'Body', 'font', 'Inter', 'size', '16px', 'weight', '400')),
      'components', jsonb_build_array(jsonb_build_object('name', 'Button', 'description', 'Action', 'usage_notes', 'Use once')),
      'usage_rules', 'Verifier rule'
    ),
    repeat('d', 64), 'DS5 rollback verification', false, 'internal', v_actor_id
  );

  insert into public.artifact_approvals (
    organization_id, artifact_id, artifact_version_id, engagement_id, notes, approved_by
  ) values (
    v_organization_id, v_artifact_id, v_version_id, v_engagement_id,
    'DS5 rollback verification', v_actor_id
  );

  select artifact.id into v_source_artifact_id
  from public.artifacts artifact
  where artifact.organization_id = v_organization_id
    and artifact.id <> v_artifact_id
  limit 1;

  if v_source_artifact_id is null then
    v_source_artifact_id := gen_random_uuid();
    insert into public.artifacts (
      id, organization_id, brand_id, engagement_id, artifact_type, title, created_by
    ) values (
      v_source_artifact_id, v_organization_id, v_brand_id, v_engagement_id,
      'discovery', 'DS5 verifier relation source', v_actor_id
    );
  end if;

  insert into public.artifact_relations (
    organization_id, source_artifact_id, target_artifact_id, relation_type, created_by
  ) values (
    v_organization_id, v_source_artifact_id, v_artifact_id, 'derived_from', v_actor_id
  );

  insert into ds5_runtime_checks values
    ('released_version_persists', exists (
      select 1
      from public.artifact_versions version
      join public.artifact_approvals approval on approval.artifact_version_id = version.id
      where version.id = v_version_id and version.artifact_id = v_artifact_id
    )),
    ('d3_relation_targets_design_system', v_source_artifact_id is not null and exists (
      select 1 from public.artifact_relations relation
      where relation.source_artifact_id = v_source_artifact_id
        and relation.target_artifact_id = v_artifact_id
    ));
end;
$$;

select jsonb_build_object(
  'design_system_type_registered', exists (
    select 1 from pg_constraint
    where conrelid = 'public.artifacts'::regclass
      and conname = 'artifacts_artifact_type_check'
      and pg_get_constraintdef(oid) like '%design_system%'
  ),
  'artifact_rls_unchanged', (
    select relrowsecurity from pg_class where oid = 'public.artifacts'::regclass
  ) and exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'artifacts'
      and qual like '%is_team_organization_member%'
  ),
  'artifact_browser_read_only',
    has_table_privilege('authenticated', 'public.artifacts', 'select')
    and not has_table_privilege('authenticated', 'public.artifacts', 'insert')
    and not has_table_privilege('authenticated', 'public.artifacts', 'update')
    and not has_table_privilege('authenticated', 'public.artifacts', 'delete'),
  'released_version_persists', coalesce((select passed from ds5_runtime_checks where check_name = 'released_version_persists'), false),
  'd3_relation_targets_design_system', coalesce((select passed from ds5_runtime_checks where check_name = 'd3_relation_targets_design_system'), false)
) as ds5_verification;

rollback;
