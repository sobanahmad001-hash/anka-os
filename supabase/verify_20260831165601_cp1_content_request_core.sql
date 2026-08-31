begin;

create temporary table cp1_core_checks (
  check_name text primary key,
  passed boolean not null
);
grant select, insert on cp1_core_checks to authenticated;

create temporary table cp1_core_fixture_ids (
  organization_id uuid not null,
  unlinked_request_id uuid not null,
  linked_request_id uuid not null,
  general_request_id uuid not null,
  event_id uuid not null
);
grant select on cp1_core_fixture_ids to authenticated;

insert into cp1_core_checks values
  ('cp1_core_tables_exist', (
    select count(*) = 2
    from unnest(array[
      'public.content_requests', 'public.content_request_assets'
    ]) name
    where to_regclass(name) is not null
  )),
  ('cp1_core_rls_enabled', (
    select bool_and(relrowsecurity)
    from pg_class
    where oid = any(array[
      'public.content_requests'::regclass,
      'public.content_request_assets'::regclass
    ])
  )),
  ('cp1_core_browser_read_only', (
    select bool_and(
      has_table_privilege('authenticated', oid, 'select')
      and not has_table_privilege('authenticated', oid, 'insert, update, delete')
      and not has_table_privilege('anon', oid, 'select, insert, update, delete')
    )
    from pg_class
    where oid = any(array[
      'public.content_requests'::regclass,
      'public.content_request_assets'::regclass
    ])
  )),
  ('cp1_core_org_scoped_read_policies', (
    select count(*) = 2
    from pg_policies
    where schemaname = 'public'
      and tablename in ('content_requests', 'content_request_assets')
      and cmd = 'SELECT'
      and qual like '%is_team_organization_member(organization_id)%'
  )),
  ('cp1_core_event_fk_sets_only_event_null', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.content_requests'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (linked_event_id, organization_id)%ON DELETE SET NULL (linked_event_id)'
  )),
  ('cp1_core_asset_exactly_one_output', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.content_request_assets'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%design_media_asset_id IS NOT NULL%figma_handoff_url IS NULL%'
      and pg_get_constraintdef(oid) like '%design_media_asset_id IS NULL%figma_handoff_url IS NOT NULL%'
  )),
  ('cp1_core_format_constraint_complete', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.content_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%reel%'
      and pg_get_constraintdef(oid) like '%carousel%'
      and pg_get_constraintdef(oid) like '%single_image%'
      and pg_get_constraintdef(oid) like '%stories%'
      and pg_get_constraintdef(oid) like '%carousel_stories%'
      and pg_get_constraintdef(oid) like '%reel_carousel%'
      and pg_get_constraintdef(oid) like '%web_design_element%'
  )),
  ('cp1_core_service_only_writer', (
    select has_function_privilege(
      'service_role',
      'public.create_content_request(uuid,text,uuid,uuid,uuid,text,text,text,uuid,uuid,boolean,text,integer)',
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'public.create_content_request(uuid,text,uuid,uuid,uuid,text,text,text,uuid,uuid,boolean,text,integer)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.create_content_request(uuid,text,uuid,uuid,uuid,text,text,text,uuid,uuid,boolean,text,integer)',
      'execute'
    )
  )),
  ('cp1_core_immutable_fields_trigger_exists', exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.content_requests'::regclass
      and tgname = 'content_requests_immutable_core'
      and not tgisinternal
  ));

do $$
declare
  v_actor_id uuid;
  v_org_id uuid := gen_random_uuid();
  v_client_id uuid := gen_random_uuid();
  v_brand_id uuid := gen_random_uuid();
  v_engagement_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_unlinked jsonb;
  v_linked jsonb;
  v_general jsonb;
  v_immutable_rejected boolean := false;
begin
  select id into v_actor_id from auth.users order by created_at limit 1;
  if v_actor_id is null then
    raise exception 'CP1 verifier needs one existing auth user';
  end if;

  insert into public.organizations(id, name, slug)
  values (v_org_id, 'CP1 verifier org', 'cp1-verifier-' || substr(v_org_id::text, 1, 8));
  insert into public.agency_clients(id, organization_id, name, created_by)
  values (v_client_id, v_org_id, 'CP1 verifier client', v_actor_id);
  insert into public.brands(id, organization_id, client_id, name, created_by)
  values (v_brand_id, v_org_id, v_client_id, 'CP1 verifier brand', v_actor_id);
  insert into public.engagements(
    id, organization_id, client_id, brand_id, name, engagement_type, status, created_by
  ) values (
    v_engagement_id, v_org_id, v_client_id, v_brand_id,
    'CP1 verifier engagement', 'retainer', 'active', v_actor_id
  );
  insert into public.external_events(
    id, organization_id, brand_id, event_name, event_category,
    start_date, created_by
  ) values (
    v_event_id, v_org_id, v_brand_id, 'CP1 verifier event', 'conference',
    current_date + 30, v_actor_id
  );

  select public.create_content_request(
    v_org_id, 'project', v_engagement_id, v_brand_id, null,
    'internal_engine', 'single_image', 'Routine post with no event.', null,
    v_actor_id, false, 'social', 0
  ) into v_unlinked;

  select public.create_content_request(
    v_org_id, 'project', v_engagement_id, v_brand_id, v_event_id,
    'internal_engine', 'carousel', 'Event-linked carousel.', null,
    v_actor_id, true, 'social', 14
  ) into v_linked;

  select public.create_content_request(
    v_org_id, 'general', null, v_brand_id, null,
    'figma_handoff', 'stories', 'General-mode stories request.', null,
    v_actor_id, false, 'social', 0
  ) into v_general;

  begin
    update public.content_requests
    set brief = 'This rewrite must fail.'
    where id = (v_unlinked->'request'->>'id')::uuid;
  exception when others then
    v_immutable_rejected := true;
  end;

  insert into cp1_core_fixture_ids values (
    v_org_id,
    (v_unlinked->'request'->>'id')::uuid,
    (v_linked->'request'->>'id')::uuid,
    (v_general->'request'->>'id')::uuid,
    v_event_id
  );

  insert into cp1_core_checks values
    ('cp1_core_unlinked_request_round_trip', (
      select mode = 'project'
        and engagement_id = v_engagement_id
        and brand_id = v_brand_id
        and linked_event_id is null
      from public.content_requests
      where id = (v_unlinked->'request'->>'id')::uuid
    )),
    ('cp1_core_linked_request_round_trip', (
      select linked_event_id = v_event_id
      from public.content_requests
      where id = (v_linked->'request'->>'id')::uuid
    )),
    ('cp1_core_optional_mk1_link_created', (
      select count(*) = 1
        and bool_and(content_type = 'social')
        and bool_and(lead_time_days = 14)
      from public.content_event_links
      where external_event_id = v_event_id
    )),
    ('cp1_core_general_request_has_no_engagement', (
      select mode = 'general' and engagement_id is null and brand_id = v_brand_id
      from public.content_requests
      where id = (v_general->'request'->>'id')::uuid
    )),
    ('cp1_core_brief_update_rejected', v_immutable_rejected);
end $$;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id from auth.users order by created_at limit 1),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
insert into cp1_core_checks values
  ('cp1_core_general_cross_org_hidden', not exists (
    select 1
    from public.content_requests
    where id = (select general_request_id from cp1_core_fixture_ids)
  )),
  ('cp1_core_project_cross_org_hidden', not exists (
    select 1
    from public.content_requests
    where id = (select unlinked_request_id from cp1_core_fixture_ids)
  ));
reset role;

select check_name, passed from cp1_core_checks order by check_name;

do $$
begin
  if exists (select 1 from cp1_core_checks where not passed) then
    raise exception 'One or more CP1 core verification checks failed';
  end if;
end $$;

rollback;
