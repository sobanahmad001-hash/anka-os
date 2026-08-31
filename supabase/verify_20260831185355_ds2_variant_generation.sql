-- Rollback-safe DS2 verification. Run only after the migration is applied.

begin;

create temporary table ds2_runtime_checks (
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
  v_engagement_service_id uuid;
  v_other_service_id uuid;
  v_other_engagement_service_id uuid;
  v_model_id uuid;
  v_model_provider text;
  v_session_id uuid := gen_random_uuid();
  v_direction_id uuid := gen_random_uuid();
  v_released_version_id uuid := gen_random_uuid();
  v_draft_version_id uuid := gen_random_uuid();
  v_variant_id uuid := gen_random_uuid();
  v_matching_asset_id uuid := gen_random_uuid();
  v_mismatched_asset_id uuid := gen_random_uuid();
  v_other_session_id uuid := gen_random_uuid();
  v_other_direction_id uuid := gen_random_uuid();
  v_other_version_id uuid := gen_random_uuid();
  v_draft_rejected boolean := false;
  v_wrong_service_rejected boolean := false;
  v_ready_without_media_rejected boolean := false;
  v_mismatched_asset_rejected boolean := false;
begin
  select engagement.organization_id, engagement.id, engagement.brand_id, membership.user_id
  into v_organization_id, v_engagement_id, v_brand_id, v_actor_id
  from public.engagements engagement
  join public.organization_memberships membership
    on membership.organization_id = engagement.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  limit 1;

  select service.id
  into v_service_id
  from public.service_catalog service
  where service.organization_id = v_organization_id
    and service.department_id = 'design'
    and service.slug = 'social_assets'
    and service.is_active = true
  limit 1;

  select service.id
  into v_other_service_id
  from public.service_catalog service
  where service.organization_id = v_organization_id
    and service.department_id = 'design'
    and service.slug = 'brand_visual_identity'
    and service.is_active = true
  limit 1;

  select model.id, model.provider
  into v_model_id, v_model_provider
  from public.design_model_registry model
  where model.organization_id = v_organization_id
    and model.is_active = true
    and 'image' = any(model.supported_output_types)
  limit 1;

  if v_actor_id is null or v_service_id is null or v_other_service_id is null or v_model_id is null then
    insert into ds2_runtime_checks values
      ('released_source_variant_allowed', false),
      ('draft_source_variant_rejected', false),
      ('wrong_service_source_rejected', false),
      ('ready_without_media_rejected', false),
      ('matching_source_media_allowed', false),
      ('mismatched_source_media_rejected', false);
    return;
  end if;

  select engagement_service.id
  into v_other_engagement_service_id
  from public.engagement_services engagement_service
  where engagement_service.organization_id = v_organization_id
    and engagement_service.engagement_id = v_engagement_id
    and engagement_service.service_id = v_other_service_id;

  if v_other_engagement_service_id is null then
    insert into public.engagement_services (
      organization_id, engagement_id, service_id, status, activated_by
    ) values (
      v_organization_id, v_engagement_id, v_other_service_id, 'active', v_actor_id
    ) returning id into v_other_engagement_service_id;
  else
    update public.engagement_services set status = 'active'
    where id = v_other_engagement_service_id;
  end if;

  select engagement_service.id
  into v_engagement_service_id
  from public.engagement_services engagement_service
  where engagement_service.organization_id = v_organization_id
    and engagement_service.engagement_id = v_engagement_id
    and engagement_service.service_id = v_service_id;

  if v_engagement_service_id is null then
    insert into public.engagement_services (
      organization_id, engagement_id, service_id, status, activated_by
    ) values (
      v_organization_id, v_engagement_id, v_service_id, 'active', v_actor_id
    ) returning id into v_engagement_service_id;
  else
    update public.engagement_services set status = 'active'
    where id = v_engagement_service_id;
  end if;

  insert into public.design_workshop_sessions (
    id, organization_id, engagement_id, brand_id, engagement_service_id,
    output_family, output_brief, designer_instructions, context_manifest,
    context_checksum, status, created_by
  ) values (
    v_session_id, v_organization_id, v_engagement_id, v_brand_id, v_engagement_service_id,
    'marketing_asset', '{}'::jsonb, 'DS2 rollback verifier', '{}'::jsonb,
    repeat('a', 64), 'released', v_actor_id
  );

  insert into public.design_directions (
    id, organization_id, session_id, direction_slot
  ) values (v_direction_id, v_organization_id, v_session_id, 1);

  insert into public.design_direction_versions (
    id, organization_id, direction_id, version_number, content,
    content_checksum, distinctness_signature, created_by
  ) values
    (v_released_version_id, v_organization_id, v_direction_id, 1,
      '{"imagery_direction":"Released source"}'::jsonb, repeat('b', 64), repeat('b', 16), v_actor_id),
    (v_draft_version_id, v_organization_id, v_direction_id, 2,
      '{"imagery_direction":"Draft source"}'::jsonb, repeat('c', 64), repeat('c', 16), v_actor_id);

  insert into public.design_direction_releases (
    organization_id, engagement_id, session_id, direction_version_id, released_by
  ) values (
    v_organization_id, v_engagement_id, v_session_id, v_released_version_id, v_actor_id
  );

  insert into public.design_direction_variants (
    id, organization_id, source_direction_version_id, variant_format, status, created_by
  ) values (
    v_variant_id, v_organization_id, v_released_version_id, 'square_1x1', 'pending', v_actor_id
  );

  begin
    update public.design_direction_variants
    set status = 'ready'
    where id = v_variant_id;
  exception when check_violation then
    v_ready_without_media_rejected := true;
  end;

  begin
    insert into public.design_direction_variants (
      organization_id, source_direction_version_id, variant_format, status, created_by
    ) values (
      v_organization_id, v_draft_version_id, 'portrait_4x5', 'pending', v_actor_id
    );
  exception when check_violation then
    v_draft_rejected := true;
  end;


  insert into public.design_workshop_sessions (
    id, organization_id, engagement_id, brand_id, engagement_service_id,
    output_family, output_brief, designer_instructions, context_manifest,
    context_checksum, status, created_by
  ) values (
    v_other_session_id, v_organization_id, v_engagement_id, v_brand_id, v_other_engagement_service_id,
    'brand_system', '{}'::jsonb, 'DS2 wrong-service verifier', '{}'::jsonb,
    repeat('d', 64), 'released', v_actor_id
  );

  insert into public.design_directions (
    id, organization_id, session_id, direction_slot
  ) values (v_other_direction_id, v_organization_id, v_other_session_id, 1);

  insert into public.design_direction_versions (
    id, organization_id, direction_id, version_number, content,
    content_checksum, distinctness_signature, created_by
  ) values (
    v_other_version_id, v_organization_id, v_other_direction_id, 1,
    '{"imagery_direction":"Wrong service source"}'::jsonb,
    repeat('e', 64), repeat('e', 16), v_actor_id
  );

  insert into public.design_direction_releases (
    organization_id, engagement_id, session_id, direction_version_id, released_by
  ) values (
    v_organization_id, v_engagement_id, v_other_session_id, v_other_version_id, v_actor_id
  );

  begin
    insert into public.design_direction_variants (
      organization_id, source_direction_version_id, variant_format, status, created_by
    ) values (
      v_organization_id, v_other_version_id, 'square_1x1', 'pending', v_actor_id
    );
  exception when check_violation then
    v_wrong_service_rejected := true;
  end;

  insert into public.design_media_assets (
    id, organization_id, design_direction_version_id, media_type, status,
    model_registry_id, provider, prompt, failure_reason, generated_by
  ) values
    (v_matching_asset_id, v_organization_id, v_released_version_id, 'image', 'failed',
      v_model_id, v_model_provider, 'Matching source', 'Verifier failure fixture', v_actor_id),
    (v_mismatched_asset_id, v_organization_id, v_draft_version_id, 'image', 'failed',
      v_model_id, v_model_provider, 'Mismatched source', 'Verifier failure fixture', v_actor_id);

  update public.design_direction_variants
  set status = 'failed', design_media_asset_id = v_matching_asset_id
  where id = v_variant_id;

  begin
    update public.design_direction_variants
    set design_media_asset_id = v_mismatched_asset_id
    where id = v_variant_id;
  exception when check_violation then
    v_mismatched_asset_rejected := true;
  end;

  insert into ds2_runtime_checks values
    ('released_source_variant_allowed', exists (
      select 1 from public.design_direction_variants
      where id = v_variant_id and source_direction_version_id = v_released_version_id
    )),
    ('draft_source_variant_rejected', v_draft_rejected),
    ('wrong_service_source_rejected', v_wrong_service_rejected),
    ('ready_without_media_rejected', v_ready_without_media_rejected),
    ('matching_source_media_allowed', exists (
      select 1 from public.design_direction_variants
      where id = v_variant_id and design_media_asset_id = v_matching_asset_id and status = 'failed'
    )),
    ('mismatched_source_media_rejected', v_mismatched_asset_rejected);
end;
$$;

select jsonb_build_object(
  'variant_table_exists', to_regclass('public.design_direction_variants') is not null,
  'variant_rls_enabled', (
    select relrowsecurity from pg_class where oid = 'public.design_direction_variants'::regclass
  ),
  'team_read_policy_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'design_direction_variants'
      and policyname = 'Team can read released design direction variants'
  ),
  'source_version_fk_is_organization_safe', exists (
    select 1 from pg_constraint
    where conrelid = 'public.design_direction_variants'::regclass
      and confrelid = 'public.design_direction_versions'::regclass
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (source_direction_version_id, organization_id) REFERENCES %design_direction_versions(id, organization_id) ON DELETE CASCADE'
  ),
  'media_asset_fk_is_organization_safe', exists (
    select 1 from pg_constraint
    where conrelid = 'public.design_direction_variants'::regclass
      and confrelid = 'public.design_media_assets'::regclass
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (design_media_asset_id, organization_id) REFERENCES %design_media_assets(id, organization_id) ON DELETE SET NULL (design_media_asset_id)'
  ),
  'verified_variant_format_set_enforced', exists (
    select 1 from pg_constraint
    where conrelid = 'public.design_direction_variants'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%square_1x1%'
      and pg_get_constraintdef(oid) like '%story_9x16%'
      and pg_get_constraintdef(oid) like '%landscape_1_91x1%'
      and pg_get_constraintdef(oid) like '%banner_728x90%'
      and pg_get_constraintdef(oid) like '%banner_300x250%'
      and pg_get_constraintdef(oid) like '%portrait_4x5%'
      and pg_get_constraintdef(oid) not like '%landscape_16x9%'
  ),
  'variant_source_index_exists',
    to_regclass('public.idx_design_direction_variants_source') is not null,
  'variant_media_index_exists',
    to_regclass('public.idx_design_direction_variants_media_asset') is not null,
  'released_source_validation_trigger_exists', exists (
    select 1 from pg_trigger
    where tgrelid = 'public.design_direction_variants'::regclass
      and tgname = 'trg_design_direction_variants_validate'
      and not tgisinternal
  )
) || (select jsonb_object_agg(check_name, passed) from ds2_runtime_checks);

rollback;
