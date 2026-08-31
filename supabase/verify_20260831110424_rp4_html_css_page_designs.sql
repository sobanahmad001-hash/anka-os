-- Rollback-safe RP4 verification. Run only after the migration is applied.

begin;

create temporary table rp4_runtime_checks (
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
  v_version_id uuid := gen_random_uuid();
  v_private_version_id uuid := gen_random_uuid();
  v_design_1_id uuid := gen_random_uuid();
  v_design_2_id uuid := gen_random_uuid();
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

  if v_creator_id is null then
    raise exception 'RP4 verification requires one engagement and active team member';
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
    'website_design', '{}'::jsonb, 'RP4 rollback verification',
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
  ) values
    (v_version_id, v_organization_id, v_direction_id, 1,
     '{"title":"RP4 public direction","rationale":"Page generation"}'::jsonb,
     encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
     encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
     v_creator_id, false, null),
    (v_private_version_id, v_organization_id, v_direction_id, 2,
     '{"title":"RP4 private direction","rationale":"Visibility inheritance"}'::jsonb,
     encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
     encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
     v_creator_id, true, array[]::uuid[]);

  insert into public.website_page_designs (
    id, organization_id, design_direction_version_id, slug,
    html_content, css_content, created_by
  ) values
    (v_design_1_id, v_organization_id, v_version_id, 'home',
     '<!doctype html><html><head><title>Home</title><meta name="description" content="Home page"></head><body><h1>Home</h1></body></html>',
     'body { color: #111; }', v_creator_id),
    (v_design_2_id, v_organization_id, v_version_id, 'home',
     '<!doctype html><html><head><title>Home B</title><meta name="description" content="Alternative"></head><body><h1>Home B</h1></body></html>',
     'body { color: #222; }', v_creator_id);

  insert into rp4_runtime_checks values (
    'multiple_attempts_are_append_created',
    (select count(*) = 2 from public.website_page_designs
      where design_direction_version_id = v_version_id and slug = 'home')
  );

  insert into public.website_page_designs (
    organization_id, design_direction_version_id, slug,
    html_content, css_content, created_by
  ) values (
    v_organization_id, v_private_version_id, 'private-page',
    '<!doctype html><html><head><title>Private</title><meta name="description" content="Private"></head><body><h1>Private</h1></body></html>',
    'body { color: #333; }', v_creator_id
  );

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_denied_id, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select count(*) into v_count
  from public.website_page_designs
  where design_direction_version_id = v_private_version_id;
  reset role;

  insert into rp4_runtime_checks values (
    'd2_visibility_is_inherited', v_count = 0
  );

  insert into rp4_runtime_checks values (
    'new_attempt_defaults_to_draft',
    exists (
      select 1 from public.website_page_designs
      where id = v_design_1_id and status = 'draft'
        and exported_at is null and wordpress_export_url is null
    )
  );
end;
$$;

select jsonb_build_object(
  'slug_column_is_canonical',
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
  'rls_enabled', (
    select relrowsecurity from pg_class
    where oid = 'public.website_page_designs'::regclass
  ),
  'browser_is_read_only',
    has_table_privilege('authenticated', 'public.website_page_designs', 'select')
    and not has_table_privilege('authenticated', 'public.website_page_designs', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.website_page_designs', 'select, insert, update, delete'),
  'html_css_model_registered', exists (
    select 1 from public.design_model_registry
    where provider = 'openai' and model_id = 'gpt-5.4'
      and supported_output_types @> array['html_css']::text[]
  )
) || (select jsonb_object_agg(check_name, passed) from rp4_runtime_checks);

rollback;
