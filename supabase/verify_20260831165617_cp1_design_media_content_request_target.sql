begin;

create temporary table cp1_media_checks (
  check_name text primary key,
  passed boolean not null
);

insert into cp1_media_checks values
  ('cp1_media_content_request_column_exists', exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'design_media_assets'
      and column_name = 'content_request_id'
      and is_nullable = 'YES'
  )),
  ('cp1_media_direction_target_is_nullable', exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'design_media_assets'
      and column_name = 'design_direction_version_id'
      and is_nullable = 'YES'
  )),
  ('cp1_media_exactly_one_target_constraint', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.design_media_assets'::regclass
      and conname = 'design_media_assets_exactly_one_target'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%design_direction_version_id IS NOT NULL%content_request_id IS NULL%'
      and pg_get_constraintdef(oid) like '%design_direction_version_id IS NULL%content_request_id IS NOT NULL%'
  )),
  ('cp1_media_composite_content_request_fk', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.design_media_assets'::regclass
      and conname = 'design_media_assets_content_request_org_fkey'
      and contype = 'f'
      and array_length(conkey, 1) = 2
  )),
  ('cp1_media_original_direction_fk_preserved', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.design_media_assets'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (design_direction_version_id, organization_id)%design_direction_versions%'
  )),
  ('cp1_media_request_target_indexed', exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_design_media_assets_content_request_fk'
      and indexdef like '%(content_request_id, organization_id)%'
  )),
  ('cp1_media_rls_covers_both_targets', exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'design_media_assets'
      and cmd = 'SELECT'
      and qual like '%design_direction_versions%'
      and qual like '%content_requests%'
      and qual like '%is_team_organization_member(organization_id)%'
  )),
  ('cp1_media_auto_attachment_trigger_exists', exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.design_media_assets'::regclass
      and tgname = 'design_media_assets_attach_content_request'
      and not tgisinternal
  )),
  ('cp1_media_attachment_target_guard_exists', exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.content_request_assets'::regclass
      and tgname = 'content_request_assets_enforce_target'
      and not tgisinternal
  ));

do $$
declare
  v_actor_id uuid;
  v_direction_version_id uuid;
  v_organization_id uuid;
  v_engagement_id uuid;
  v_brand_id uuid;
  v_model_id uuid;
  v_request_id uuid;
  v_old_asset_id uuid := gen_random_uuid();
  v_new_asset_id uuid := gen_random_uuid();
  v_rejected_both boolean := false;
  v_rejected_neither boolean := false;
  v_rejected_direction_attachment boolean := false;
  v_rejected_figma_attachment boolean := false;
begin
  select id into v_actor_id from auth.users order by created_at limit 1;
  select version.id, version.organization_id
    into v_direction_version_id, v_organization_id
  from public.design_direction_versions version
  where version.is_experimental = false
  order by version.created_at
  limit 1;
  select request_engagement.id, request_engagement.brand_id
    into v_engagement_id, v_brand_id
  from public.engagements request_engagement
  where request_engagement.organization_id = v_organization_id
  order by request_engagement.created_at
  limit 1;
  select model.id into v_model_id
  from public.design_model_registry model
  where model.organization_id = v_organization_id
    and model.is_active
    and 'image' = any(model.supported_output_types)
  order by model.created_at
  limit 1;

  if v_actor_id is null or v_direction_version_id is null or v_engagement_id is null or v_model_id is null then
    raise exception 'CP1 media verifier needs an auth user, direction version, engagement, and active image model';
  end if;

  insert into public.content_requests (
    organization_id, mode, engagement_id, brand_id, output_path,
    format, brief, created_by
  ) values (
    v_organization_id, 'project', v_engagement_id, v_brand_id,
    'internal_engine', 'single_image', 'CP1 ad-hoc media verifier.', v_actor_id
  ) returning id into v_request_id;

  -- Regression proof for PR #39's original direction-scoped insert path.
  insert into public.design_media_assets (
    id, organization_id, design_direction_version_id, media_type, status,
    model_registry_id, provider, prompt, generated_by
  ) values (
    v_old_asset_id, v_organization_id, v_direction_version_id, 'image', 'generating',
    v_model_id, 'openai', 'Original Design Workshop generation path.', v_actor_id
  );

  insert into public.design_media_assets (
    id, organization_id, content_request_id, media_type, status,
    model_registry_id, provider, prompt, generated_by
  ) values (
    v_new_asset_id, v_organization_id, v_request_id, 'image', 'generating',
    v_model_id, 'openai', 'Ad-hoc CP1 generation path.', v_actor_id
  );

  begin
    insert into public.design_media_assets (
      organization_id, design_direction_version_id, content_request_id,
      media_type, status, model_registry_id, provider, prompt, generated_by
    ) values (
      v_organization_id, v_direction_version_id, v_request_id,
      'image', 'generating', v_model_id, 'openai', 'Must fail.', v_actor_id
    );
  exception when check_violation then
    v_rejected_both := true;
  end;

  begin
    insert into public.design_media_assets (
      organization_id, media_type, status, model_registry_id,
      provider, prompt, generated_by
    ) values (
      v_organization_id, 'image', 'generating', v_model_id,
      'openai', 'Must fail.', v_actor_id
    );
  exception when check_violation then
    v_rejected_neither := true;
  end;

  begin
    insert into public.content_request_assets(
      organization_id, content_request_id, design_media_asset_id
    ) values (
      v_organization_id, v_request_id, v_old_asset_id
    );
  exception when others then
    v_rejected_direction_attachment := true;
  end;

  begin
    insert into public.content_request_assets(
      organization_id, content_request_id, figma_handoff_url
    ) values (
      v_organization_id, v_request_id, 'https://figma.example.invalid/handoff'
    );
  exception when others then
    v_rejected_figma_attachment := true;
  end;

  insert into cp1_media_checks values
    ('cp1_media_original_direction_insert_unchanged', exists (
      select 1
      from public.design_media_assets
      where id = v_old_asset_id
        and design_direction_version_id = v_direction_version_id
        and content_request_id is null
    )),
    ('cp1_media_content_request_insert_works', exists (
      select 1
      from public.design_media_assets
      where id = v_new_asset_id
        and content_request_id = v_request_id
        and design_direction_version_id is null
    )),
    ('cp1_media_content_request_asset_auto_attached', exists (
      select 1
      from public.content_request_assets
      where content_request_id = v_request_id
        and design_media_asset_id = v_new_asset_id
        and organization_id = v_organization_id
    )),
    ('cp1_media_both_targets_rejected', v_rejected_both),
    ('cp1_media_neither_target_rejected', v_rejected_neither),
    ('cp1_media_direction_asset_cross_attach_rejected', v_rejected_direction_attachment),
    ('cp1_media_figma_on_internal_request_rejected', v_rejected_figma_attachment),
    ('cp1_media_direction_asset_not_attached_to_request', not exists (
      select 1
      from public.content_request_assets
      where design_media_asset_id = v_old_asset_id
    ));
end $$;

select check_name, passed from cp1_media_checks order by check_name;

do $$
begin
  if exists (select 1 from cp1_media_checks where not passed) then
    raise exception 'One or more CP1 Design Media verification checks failed';
  end if;
end $$;

rollback;
