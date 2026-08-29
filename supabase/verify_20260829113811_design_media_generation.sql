-- Rollback-safe Design media verification. Run only after the migration is applied.

begin;

create temporary table design_media_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_engagement_id uuid;
  v_brand_id uuid;
  v_creator_id uuid;
  v_denied_id uuid := gen_random_uuid();
  v_session_id uuid := gen_random_uuid();
  v_direction_id uuid := gen_random_uuid();
  v_version_1_id uuid := gen_random_uuid();
  v_version_2_id uuid := gen_random_uuid();
  v_image_asset_id uuid := gen_random_uuid();
  v_video_asset_id uuid := gen_random_uuid();
  v_model_id uuid;
  v_count integer;
begin
  select engagement.organization_id, engagement.id, engagement.brand_id, membership.user_id
  into v_organization_id, v_engagement_id, v_brand_id, v_creator_id
  from public.engagements engagement
  join public.organization_memberships membership
    on membership.organization_id = engagement.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  limit 1;

  select id into v_model_id
  from public.design_model_registry
  where organization_id = v_organization_id
    and provider = 'openai'
    and model_id = 'gpt-image-2'
    and supported_output_types @> array['image']::text[];

  if v_creator_id is null or v_model_id is null then
    insert into design_media_runtime_checks values
      ('exact_version_isolation', false),
      ('d2_media_visibility_inherited', false),
      ('video_placeholder_persists_exact_message', false);
    return;
  end if;

  insert into auth.users (id) values (v_denied_id);
  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, department_id, status
  ) values (
    v_organization_id, v_denied_id, 'team', 'contributor', 'marketing', 'active'
  );

  insert into public.design_workshop_sessions (
    id, organization_id, engagement_id, brand_id, output_family,
    output_brief, designer_instructions, context_manifest, context_checksum,
    status, created_by
  ) values (
    v_session_id, v_organization_id, v_engagement_id, v_brand_id,
    'brand_identity', '{}'::jsonb, 'Design media rollback verification',
    '{}'::jsonb, encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    'comparison', v_creator_id
  );

  insert into public.design_directions (
    id, organization_id, session_id, direction_slot
  ) values (v_direction_id, v_organization_id, v_session_id, 1);

  insert into public.design_direction_versions (
    id, organization_id, direction_id, version_number, content,
    content_checksum, distinctness_signature, created_by,
    is_experimental, experiment_visibility
  ) values (
    v_version_1_id, v_organization_id, v_direction_id, 1,
    '{"title":"Media V1","rationale":"Exact-version control"}'::jsonb,
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    v_creator_id, false, null
  );

  insert into public.design_direction_versions (
    id, organization_id, direction_id, version_number, parent_version_id,
    content, content_checksum, distinctness_signature, created_by,
    is_experimental, experiment_visibility
  ) values (
    v_version_2_id, v_organization_id, v_direction_id, 2, v_version_1_id,
    '{"title":"Media V2","rationale":"Private experiment"}'::jsonb,
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    v_creator_id, true, array[]::uuid[]
  );

  insert into public.design_media_assets (
    id, organization_id, design_direction_version_id, media_type, status,
    model_registry_id, provider, storage_path, prompt, generated_by
  ) values (
    v_image_asset_id, v_organization_id, v_version_1_id, 'image', 'ready',
    v_model_id, 'openai',
    v_organization_id::text || '/' || v_version_1_id::text || '/' || v_image_asset_id::text || '.png',
    'Version one key visual', v_creator_id
  );

  insert into public.design_media_assets (
    id, organization_id, design_direction_version_id, media_type, status,
    prompt, failure_reason, generated_by
  ) values (
    v_video_asset_id, v_organization_id, v_version_2_id, 'video', 'unavailable',
    'Version two motion concept',
    'Video generation is not yet configured. An API key and provider need to be added before this works.',
    v_creator_id
  );

  insert into design_media_runtime_checks values ('exact_version_isolation',
    exists (
      select 1 from public.design_media_assets
      where id = v_image_asset_id and design_direction_version_id = v_version_1_id
    )
    and not exists (
      select 1 from public.design_media_assets
      where id = v_image_asset_id and design_direction_version_id = v_version_2_id
    )
  );

  insert into design_media_runtime_checks values ('video_placeholder_persists_exact_message',
    exists (
      select 1 from public.design_media_assets
      where id = v_video_asset_id and media_type = 'video' and status = 'unavailable'
        and provider is null and model_registry_id is null and storage_path is null
        and failure_reason = 'Video generation is not yet configured. An API key and provider need to be added before this works.'
    )
  );

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_denied_id, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select count(*) into v_count from public.design_media_assets where id = v_video_asset_id;
  reset role;
  insert into design_media_runtime_checks values ('d2_media_visibility_inherited', v_count = 0);
end;
$$;

select jsonb_build_object(
  'private_bucket', exists (
    select 1 from storage.buckets
    where id = 'design-generated-media' and not public
      and file_size_limit = 10485760
      and allowed_mime_types = array['image/png']::text[]
  ),
  'rls_enabled', (
    select relrowsecurity from pg_class where oid = 'public.design_media_assets'::regclass
  ),
  'browser_is_read_only',
    has_table_privilege('authenticated', 'public.design_media_assets', 'select')
    and not has_table_privilege('authenticated', 'public.design_media_assets', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.design_media_assets', 'select, insert, update, delete'),
  'image_registry_seeded', exists (
    select 1 from public.design_model_registry
    where provider = 'openai' and model_id = 'gpt-image-2'
      and supported_output_types @> array['image']::text[]
  )
) || (select jsonb_object_agg(check_name, passed) from design_media_runtime_checks);

rollback;
