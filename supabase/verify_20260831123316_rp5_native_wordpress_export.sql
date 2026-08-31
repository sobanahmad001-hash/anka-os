-- Rollback-safe RP5 verification. Run only after the migration is applied.

begin;

create temporary table rp5_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_engagement_id uuid;
  v_brand_id uuid;
  v_creator_id uuid;
  v_session_id uuid := gen_random_uuid();
  v_direction_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
  v_approved_design_id uuid := gen_random_uuid();
  v_draft_design_id uuid := gen_random_uuid();
  v_complete_job_id uuid := gen_random_uuid();
  v_rejected_job_id uuid := gen_random_uuid();
  v_complete_storage_path text;
  v_rejected_storage_path text;
  v_draft_rejected boolean := false;
  v_seo_rejected boolean := false;
begin
  select engagement.organization_id, engagement.id, engagement.brand_id, membership.user_id
  into v_organization_id, v_engagement_id, v_brand_id, v_creator_id
  from public.engagements engagement
  join public.organization_memberships membership
    on membership.organization_id = engagement.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  limit 1;

  if v_creator_id is null then
    raise exception 'RP5 verification requires one engagement and active team member';
  end if;

  v_complete_storage_path := v_organization_id::text || '/' || v_approved_design_id::text
    || '/' || v_complete_job_id::text || '/approved-theme.zip';
  v_rejected_storage_path := v_organization_id::text || '/' || v_draft_design_id::text
    || '/' || v_rejected_job_id::text || '/draft-theme.zip';

  insert into public.design_workshop_sessions (
    id, organization_id, engagement_id, brand_id, output_family,
    output_brief, designer_instructions, context_manifest, context_checksum,
    status, created_by
  ) values (
    v_session_id, v_organization_id, v_engagement_id, v_brand_id,
    'website_design', '{}'::jsonb, 'RP5 rollback verification',
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
    v_version_id, v_organization_id, v_direction_id, 1,
    '{"title":"RP5 direction","rationale":"Native WordPress export"}'::jsonb,
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    v_creator_id, false, null
  );

  insert into public.website_page_designs (
    id, organization_id, design_direction_version_id, slug,
    html_content, css_content, status, created_by
  ) values
    (v_approved_design_id, v_organization_id, v_version_id, 'approved-home',
     '<!doctype html><html><head><title>Approved</title><meta name="description" content="Approved page"></head><body><h1>Approved</h1></body></html>',
     'body { color: #111; }', 'approved', v_creator_id),
    (v_draft_design_id, v_organization_id, v_version_id, 'draft-home',
     '<!doctype html><html><head><title>Draft</title><meta name="description" content="Draft page"></head><body><h1>Draft</h1></body></html>',
     'body { color: #222; }', 'draft', v_creator_id);

  insert into public.wordpress_export_jobs (
    id, organization_id, website_page_design_id, status, requested_by
  ) values
    (v_complete_job_id, v_organization_id, v_approved_design_id, 'processing', v_creator_id),
    (v_rejected_job_id, v_organization_id, v_draft_design_id, 'processing', v_creator_id);

  begin
    perform public.complete_native_wordpress_export(
      v_complete_job_id,
      v_organization_id,
      v_complete_storage_path,
      repeat('a', 64),
      '{"title_matches":true,"meta_description_matches":true,"heading_hierarchy_preserved":true,"image_alt_text_preserved":false,"all_checks_passed":false}'::jsonb
    );
  exception when others then
    v_seo_rejected := true;
  end;

  insert into rp5_runtime_checks values (
    'seo_gate_blocks_partial_completion',
    v_seo_rejected
    and exists (
      select 1 from public.website_page_designs
      where id = v_approved_design_id and status = 'approved'
    )
    and exists (
      select 1 from public.wordpress_export_jobs
      where id = v_complete_job_id and status = 'processing'
    )
  );

  perform public.complete_native_wordpress_export(
    v_complete_job_id,
    v_organization_id,
    v_complete_storage_path,
    repeat('a', 64),
    '{"title_matches":true,"meta_description_matches":true,"heading_hierarchy_preserved":true,"image_alt_text_preserved":true,"all_checks_passed":true}'::jsonb
  );

  begin
    perform public.complete_native_wordpress_export(
      v_rejected_job_id,
      v_organization_id,
      v_rejected_storage_path,
      repeat('b', 64),
      '{"title_matches":true,"meta_description_matches":true,"heading_hierarchy_preserved":true,"image_alt_text_preserved":true,"all_checks_passed":true}'::jsonb
    );
  exception when others then
    v_draft_rejected := true;
  end;

  insert into rp5_runtime_checks values (
    'only_approved_designs_complete',
    v_draft_rejected
    and exists (
      select 1 from public.website_page_designs
      where id = v_draft_design_id and status = 'draft'
        and exported_at is null and wordpress_export_url is null
    )
    and exists (
      select 1 from public.wordpress_export_jobs
      where id = v_rejected_job_id and status = 'processing'
    )
  );

  insert into rp5_runtime_checks values (
    'successful_completion_is_atomic',
    exists (
      select 1 from public.website_page_designs
      where id = v_approved_design_id and status = 'exported'
        and exported_at is not null
        and wordpress_export_url = 'storage://wordpress-theme-exports/' || v_complete_storage_path
    )
    and exists (
      select 1 from public.wordpress_export_jobs
      where id = v_complete_job_id and status = 'complete'
        and storage_path = v_complete_storage_path
        and artifact_sha256 = repeat('a', 64)
        and completed_at is not null
    )
  );

  insert into rp5_runtime_checks values (
    'seo_verification_is_persisted',
    exists (
      select 1 from public.wordpress_export_jobs
      where id = v_complete_job_id
        and seo_verification @> '{"title_matches":true,"meta_description_matches":true,"heading_hierarchy_preserved":true,"image_alt_text_preserved":true,"all_checks_passed":true}'::jsonb
    )
  );
end;
$$;

select jsonb_build_object(
  'wordpress_export_jobs_exists', to_regclass('public.wordpress_export_jobs') is not null,
  'native_provider_is_default', (
    select column_default like '%native%'
    from information_schema.columns
    where table_schema = 'public' and table_name = 'wordpress_export_jobs'
      and column_name = 'provider'
  ),
  'canonical_slug_is_used',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'website_page_designs'
        and column_name = 'slug'
    )
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'website_page_designs'
        and column_name = 'page_slug'
    ),
  'theme_bucket_is_private', exists (
    select 1 from storage.buckets
    where id = 'wordpress-theme-exports' and public = false
      and allowed_mime_types = array['application/zip']::text[]
  ),
  'rls_enabled', (
    select relrowsecurity from pg_class
    where oid = 'public.wordpress_export_jobs'::regclass
  ),
  'browser_is_read_only',
    has_table_privilege('authenticated', 'public.wordpress_export_jobs', 'select')
    and not has_table_privilege('authenticated', 'public.wordpress_export_jobs', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.wordpress_export_jobs', 'select, insert, update, delete'),
  'completion_function_is_service_only',
    has_function_privilege('service_role', 'public.complete_native_wordpress_export(uuid,uuid,text,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.complete_native_wordpress_export(uuid,uuid,text,text,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.complete_native_wordpress_export(uuid,uuid,text,text,jsonb)', 'execute')
) || (select jsonb_object_agg(check_name, passed) from rp5_runtime_checks);

rollback;
