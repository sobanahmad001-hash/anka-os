-- MK2 rollback-safe runtime verification. Run after the MK2 migration is applied.

begin;

create temporary table mk2_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_brand_id uuid;
  v_client_id uuid;
  v_actor_id uuid;
  v_other_brand_id uuid := gen_random_uuid();
  v_root_id uuid := gen_random_uuid();
  v_child_id uuid := gen_random_uuid();
  v_connection_id uuid := gen_random_uuid();
  v_other_organization_id uuid := gen_random_uuid();
  v_other_client_id uuid := gen_random_uuid();
  v_hidden_brand_id uuid := gen_random_uuid();
  v_hidden_actor_id uuid := gen_random_uuid();
  v_hidden_page_id uuid := gen_random_uuid();
  v_hidden_audit_id uuid := gen_random_uuid();
  v_rejected boolean;
  v_visible_pages integer;
  v_hidden_pages integer;
  v_visible_health integer;
  v_hidden_health integer;
  v_visible_audits integer;
  v_hidden_audits integer;
begin
  select brand.organization_id, brand.id, brand.client_id, membership.user_id
  into v_organization_id, v_brand_id, v_client_id, v_actor_id
  from public.brands brand
  join public.organization_memberships membership
    on membership.organization_id = brand.organization_id
   and membership.member_kind = 'team' and membership.status = 'active'
  limit 1;
  if not found then raise exception 'MK2 verification requires one brand and active team member'; end if;

  insert into public.brands (id, organization_id, client_id, name, created_by)
  values (v_other_brand_id, v_organization_id, v_client_id, 'MK2 sibling brand', v_actor_id);

  insert into public.integration_connections (
    id, organization_id, provider, display_name, public_config, status, created_by
  ) values (
    v_connection_id, v_organization_id, 'google_search_console', 'MK2 verification connector',
    '{"site_url":"sc-domain:example.com"}'::jsonb, 'verified', v_actor_id
  );

  insert into public.tracked_pages (
    id, organization_id, brand_id, page_url, page_type, parent_page_id, created_by
  ) values
    (v_root_id, v_organization_id, v_brand_id, 'https://example.com/', 'homepage', null, v_actor_id),
    (v_child_id, v_organization_id, v_brand_id, 'https://example.com/service', 'service', v_root_id, v_actor_id);

  insert into public.tracked_page_audits (
    organization_id, tracked_page_id, audit_date, indexed, index_status,
    core_web_vitals_mobile, schema_valid, issues, notes, source_type, source_details, created_by
  ) values (
    v_organization_id, v_child_id, current_date - 1, false, 'discovered_not_indexed',
    62, false, array['missing_alt_text'], 'Manual audit', 'manual', '{}'::jsonb, v_actor_id
  );
  insert into public.tracked_page_audits (
    organization_id, tracked_page_id, audit_date, indexed, index_status,
    issues, source_type, source_connection_id, source_details, created_by
  ) values (
    v_organization_id, v_child_id, current_date, true, 'indexed', '{}',
    'search_console', v_connection_id, '{"verdict":"PASS"}'::jsonb, v_actor_id
  );

  insert into mk2_runtime_checks values
    ('historical_snapshots_preserved', (
      select count(*) = 2 and count(distinct audit_date) = 2
      from public.tracked_page_audits where tracked_page_id = v_child_id
    )),
    ('latest_health_is_live', (
      select index_status = 'indexed' and source_type = 'search_console'
        and open_issue_count = 0 and needs_attention = false
      from public.tracked_page_current_health where tracked_page_id = v_child_id
    )),
    ('mixed_provenance_preserved', (
      select count(distinct source_type) = 2
      from public.tracked_page_audits where tracked_page_id = v_child_id
    ));

  v_rejected := false;
  begin
    update public.tracked_pages set parent_page_id = v_child_id where id = v_root_id;
  exception when others then v_rejected := sqlerrm like '%cycle%'; end;
  insert into mk2_runtime_checks values ('hierarchy_cycle_rejected', v_rejected);

  v_rejected := false;
  begin
    update public.tracked_pages set brand_id = v_other_brand_id where id = v_root_id;
  exception when foreign_key_violation then v_rejected := true; end;
  insert into mk2_runtime_checks values ('cross_brand_parent_rejected', v_rejected);

  insert into auth.users (id) values (v_hidden_actor_id);
  insert into public.organizations (id, name, slug)
  values (v_other_organization_id, 'MK2 hidden organization', 'mk2-' || v_other_organization_id);
  insert into public.agency_clients (id, organization_id, name, created_by)
  values (v_other_client_id, v_other_organization_id, 'MK2 hidden client', v_hidden_actor_id);
  insert into public.brands (id, organization_id, client_id, name, created_by)
  values (v_hidden_brand_id, v_other_organization_id, v_other_client_id, 'MK2 hidden brand', v_hidden_actor_id);
  insert into public.tracked_pages (id, organization_id, brand_id, page_url, page_type, created_by)
  values (v_hidden_page_id, v_other_organization_id, v_hidden_brand_id, 'https://hidden.example/page', 'other', v_hidden_actor_id);
  insert into public.tracked_page_audits (
    id, organization_id, tracked_page_id, audit_date, indexed, index_status,
    issues, source_type, created_by
  ) values (
    v_hidden_audit_id, v_other_organization_id, v_hidden_page_id, current_date,
    false, 'excluded', array['hidden_issue'], 'manual', v_hidden_actor_id
  );

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_visible_pages from public.tracked_pages where id = v_child_id;
  select count(*) into v_hidden_pages from public.tracked_pages where id = v_hidden_page_id;
  select count(*) into v_visible_health from public.tracked_page_current_health where tracked_page_id = v_child_id;
  select count(*) into v_hidden_health from public.tracked_page_current_health where tracked_page_id = v_hidden_page_id;
  select count(*) into v_visible_audits from public.tracked_page_audits where tracked_page_id = v_child_id;
  select count(*) into v_hidden_audits from public.tracked_page_audits where tracked_page_id = v_hidden_page_id;
  reset role;
  insert into mk2_runtime_checks values ('table_and_view_cross_org_isolation',
    v_visible_pages = 1 and v_hidden_pages = 0 and v_visible_health = 1 and v_hidden_health = 0);
  insert into mk2_runtime_checks values ('audit_table_cross_org_isolation',
    v_visible_audits = 2 and v_hidden_audits = 0);
end;
$$;

select jsonb_build_object(
  'tables_and_rls_exist', (
    select count(*) = 2 and bool_and(relrowsecurity)
    from pg_class where oid in ('public.tracked_pages'::regclass, 'public.tracked_page_audits'::regclass)
  ),
  'browser_is_read_only',
    has_table_privilege('authenticated', 'public.tracked_pages', 'select')
    and has_table_privilege('authenticated', 'public.tracked_page_audits', 'select')
    and not has_table_privilege('authenticated', 'public.tracked_pages', 'insert, update, delete')
    and not has_table_privilege('authenticated', 'public.tracked_page_audits', 'insert, update, delete'),
  'current_health_is_security_invoker', (
    select coalesce(reloptions @> array['security_invoker=true'], false)
    from pg_class where oid = 'public.tracked_page_current_health'::regclass
  ),
  'audits_are_append_only_for_service_role',
    has_table_privilege('service_role', 'public.tracked_page_audits', 'select, insert')
    and not has_table_privilege('service_role', 'public.tracked_page_audits', 'update, delete'),
  'no_cached_health_columns', not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('tracked_pages', 'tracked_page_audits')
      and column_name in ('needs_attention', 'open_issue_count', 'days_since_audit', 'trend')
  )
) || (select jsonb_object_agg(check_name, passed) from mk2_runtime_checks);

rollback;
