-- Rollback-safe DS3 Multi-Page Flows verification. Run only after the DS3 migration is applied.

begin;

create temporary table ds3_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_engagement_id uuid;
  v_creator_id uuid;
  v_flow_id uuid := gen_random_uuid();
  v_session_id uuid := gen_random_uuid();
  v_no_flow_session_id uuid := gen_random_uuid();
begin
  select engagement.organization_id, engagement.id, membership.user_id
  into v_organization_id, v_engagement_id, v_creator_id
  from public.engagements engagement
  join public.organization_memberships membership
    on membership.organization_id = engagement.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  limit 1;

  if v_creator_id is null then
    insert into ds3_checks values
      ('flow_insert_and_session_link_work', false),
      ('session_without_flow_remains_valid', false);
    return;
  end if;

  insert into public.design_page_flows (
    id, organization_id, engagement_id, flow_name, created_by
  ) values (
    v_flow_id, v_organization_id, v_engagement_id, 'DS3 rollback verifier', v_creator_id
  );

  insert into public.design_workshop_sessions (
    id, organization_id, engagement_id, brand_id, output_family, output_brief,
    designer_instructions, context_manifest, context_checksum, created_by, page_flow_id, page_slug
  )
  select v_session_id, engagement.organization_id, engagement.id, engagement.brand_id, 'website_design',
    '{}'::jsonb, 'DS3 flow verification', '{}'::jsonb,
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'), v_creator_id, v_flow_id, 'homepage'
  from public.engagements engagement where engagement.id = v_engagement_id;

  insert into ds3_checks values ('flow_insert_and_session_link_work', exists (
    select 1 from public.design_workshop_sessions
    where id = v_session_id and page_flow_id = v_flow_id and page_slug = 'homepage'
  ));

  insert into public.design_workshop_sessions (
    id, organization_id, engagement_id, brand_id, output_family, output_brief,
    designer_instructions, context_manifest, context_checksum, created_by
  )
  select v_no_flow_session_id, engagement.organization_id, engagement.id, engagement.brand_id, 'website_design',
    '{}'::jsonb, 'DS3 no-flow regression verification', '{}'::jsonb,
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'), v_creator_id
  from public.engagements engagement where engagement.id = v_engagement_id;

  insert into ds3_checks values ('session_without_flow_remains_valid', exists (
    select 1 from public.design_workshop_sessions
    where id = v_no_flow_session_id and page_flow_id is null and page_slug is null
  ));end;
$$;

select jsonb_build_object(
  'design_page_flows_exists', to_regclass('public.design_page_flows') is not null,
  'design_page_flows_rls_enabled', coalesce((select relrowsecurity from pg_class where oid = 'public.design_page_flows'::regclass), false),
  'flow_browser_read_only',
    has_table_privilege('authenticated', 'public.design_page_flows', 'select')
    and not has_table_privilege('authenticated', 'public.design_page_flows', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.design_page_flows', 'select, insert, update, delete'),
  'session_columns_nullable', (
    select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'design_workshop_sessions'
      and column_name in ('page_flow_id', 'page_slug') and is_nullable = 'YES'
  ),
  'flow_fk_is_organization_scoped', exists (
    select 1 from pg_constraint
    where conrelid = 'public.design_workshop_sessions'::regclass
      and conname = 'design_workshop_sessions_flow_fk'
      and pg_get_constraintdef(oid) ilike '%FOREIGN KEY (page_flow_id, organization_id)%REFERENCES design_page_flows(id, organization_id)%'
  ),
  'flow_requires_slug', exists (
    select 1 from pg_constraint
    where conrelid = 'public.design_workshop_sessions'::regclass
      and conname = 'design_workshop_sessions_flow_requires_slug'
      and pg_get_constraintdef(oid) ilike '%page_flow_id IS NULL OR page_slug IS NOT NULL%'
  )
) || (select jsonb_object_agg(check_name, passed) from ds3_checks);

rollback;