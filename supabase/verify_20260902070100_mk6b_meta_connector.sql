begin;

create temporary table mk6b_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

-- Catalog mirrors make type/default and constraint comparisons exact without
-- depending on PostgreSQL's display formatting.
create temporary table mk6b_expected_meta_connections (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  integration_connection_id uuid not null,
  brand_id uuid not null,
  facebook_page_id text not null,
  instagram_account_id text,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  token_expires_at timestamptz,
  connected_by uuid not null,
  connected_at timestamptz not null default now(),
  constraint meta_connections_pkey primary key (id),
  constraint meta_connections_id_organization_unique unique (id, organization_id),
  constraint meta_connections_registry_unique unique (integration_connection_id),
  constraint meta_connections_brand_page_unique unique (organization_id, brand_id, facebook_page_id),
  constraint meta_connections_facebook_page_id_check check (facebook_page_id ~ '^[0-9]+$'),
  constraint meta_connections_instagram_account_id_check check (
    instagram_account_id is null or instagram_account_id ~ '^[0-9]+$'
  )
) on commit drop;

create temporary table mk6b_expected_meta_snapshots (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  meta_connection_id uuid not null,
  snapshot_date date not null,
  platform text not null,
  reach integer,
  impressions integer,
  engagement integer,
  spend numeric,
  created_at timestamptz not null default now(),
  constraint meta_performance_snapshots_pkey primary key (id),
  constraint meta_performance_snapshots_platform_check
    check (platform in ('facebook', 'instagram')),
  constraint meta_performance_snapshots_reach_check check (reach is null or reach >= 0),
  constraint meta_performance_snapshots_impressions_check check (impressions is null or impressions >= 0),
  constraint meta_performance_snapshots_engagement_check check (engagement is null or engagement >= 0),
  constraint meta_performance_snapshots_spend_check check (spend is null),
  constraint meta_performance_snapshots_daily_unique
    unique (meta_connection_id, snapshot_date, platform)
) on commit drop;

create temporary table mk6b_expected_meta_sessions (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  integration_connection_id uuid not null,
  brand_id uuid not null,
  facebook_page_id text not null,
  instagram_account_id text,
  actor_id uuid not null,
  state_hash text not null,
  code_verifier_ciphertext text not null,
  code_verifier_iv text not null,
  return_path text not null default '/settings',
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint meta_oauth_sessions_pkey primary key (id),
  constraint meta_oauth_sessions_state_hash_unique unique (state_hash),
  constraint meta_oauth_sessions_state_hash_check check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint meta_oauth_sessions_facebook_page_id_check check (facebook_page_id ~ '^[0-9]+$'),
  constraint meta_oauth_sessions_instagram_account_id_check check (
    instagram_account_id is null or instagram_account_id ~ '^[0-9]+$'
  ),
  constraint meta_oauth_sessions_return_path_check check (
    return_path ~ '^/[A-Za-z0-9/_?&=.-]*$' and return_path !~ '^//'
  )
) on commit drop;

create temporary table mk6b_expected_registry_provider (
  provider text not null,
  constraint integration_connections_provider_check check (provider in (
    'github', 'figma', 'wordpress', 'openai',
    'google_analytics', 'google_search_console', 'google_ads', 'meta'
  ))
) on commit drop;
create temporary table mk6b_expected_event_contract (
  provider text not null,
  operation text not null,
  constraint integration_events_provider_check check (provider in (
    'github', 'figma', 'wordpress', 'openai',
    'google_analytics', 'google_search_console', 'google_ads', 'meta'
  )),
  constraint integration_events_operation_check check (operation in (
    'created', 'updated', 'tested', 'disabled',
    'authorization_started', 'authorized', 'reauthorized',
    'authorization_failed', 'disconnected', 'synced'
  ))
) on commit drop;

insert into mk6b_checks values
  ('exact_tables_and_relkind', (
    select count(*) = 3 and bool_and(c.relkind = 'r')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('meta_connections', 'meta_performance_snapshots', 'meta_oauth_sessions')
  )),
  ('exact_columns_types_nullability_defaults', (
    with pairs(actual_oid, expected_oid) as (values
      ('public.meta_connections'::regclass, 'pg_temp.mk6b_expected_meta_connections'::regclass),
      ('public.meta_performance_snapshots'::regclass, 'pg_temp.mk6b_expected_meta_snapshots'::regclass),
      ('public.meta_oauth_sessions'::regclass, 'pg_temp.mk6b_expected_meta_sessions'::regclass)
    ), actual as (
      select p.expected_oid, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) data_type,
        a.attnotnull, a.attidentity, a.attgenerated,
        coalesce(pg_get_expr(d.adbin, d.adrelid, false), '') default_expression
      from pairs p join pg_attribute a on a.attrelid = p.actual_oid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attnum > 0 and not a.attisdropped
    ), expected as (
      select p.expected_oid, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) data_type,
        a.attnotnull, a.attidentity, a.attgenerated,
        coalesce(pg_get_expr(d.adbin, d.adrelid, false), '') default_expression
      from pairs p join pg_attribute a on a.attrelid = p.expected_oid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attnum > 0 and not a.attisdropped
    )
    select not exists ((select * from actual except select * from expected)
      union all (select * from expected except select * from actual))
  )),
  ('exact_table_constraints', (
    with pairs(actual_oid, expected_oid) as (values
      ('public.meta_connections'::regclass, 'pg_temp.mk6b_expected_meta_connections'::regclass),
      ('public.meta_performance_snapshots'::regclass, 'pg_temp.mk6b_expected_meta_snapshots'::regclass),
      ('public.meta_oauth_sessions'::regclass, 'pg_temp.mk6b_expected_meta_sessions'::regclass)
    ), actual as (
      select p.expected_oid, c.conname, c.contype, c.convalidated, c.confupdtype,
        c.confdeltype, c.confmatchtype, c.conkey, c.confkey,
        coalesce(array_length(c.confdelsetcols, 1), 0) delete_set_columns,
        pg_get_constraintdef(c.oid, false) definition
      from pairs p join pg_constraint c on c.conrelid = p.actual_oid
      where c.contype <> 'f'
    ), expected as (
      select p.expected_oid, c.conname, c.contype, c.convalidated, c.confupdtype,
        c.confdeltype, c.confmatchtype, c.conkey, c.confkey,
        coalesce(array_length(c.confdelsetcols, 1), 0) delete_set_columns,
        pg_get_constraintdef(c.oid, false) definition
      from pairs p join pg_constraint c on c.conrelid = p.expected_oid
      where c.contype <> 'f'
    )
    select not exists ((select * from actual except select * from expected)
      union all (select * from expected except select * from actual))
  )),
  ('exact_foreign_keys', (
    with expected(
      table_name, constraint_name, local_columns, referenced_schema,
      referenced_table, referenced_columns, update_action, delete_action,
      match_type, validated, is_deferrable, is_initially_deferred, delete_set_columns
    ) as (values
      ('meta_connections', 'meta_connections_connected_by_fkey',
        array['connected_by']::text[], 'auth', 'users', array['id']::text[],
        'a', 'r', 's', true, false, false, 0),
      ('meta_connections', 'meta_connections_brand_fk',
        array['brand_id', 'organization_id']::text[], 'public', 'brands',
        array['id', 'organization_id']::text[],
        'a', 'c', 's', true, false, false, 0),
      ('meta_connections', 'meta_connections_registry_fk',
        array['integration_connection_id', 'organization_id']::text[],
        'public', 'integration_connections', array['id', 'organization_id']::text[],
        'a', 'c', 's', true, false, false, 0),
      ('meta_performance_snapshots', 'meta_performance_snapshots_connection_fk',
        array['meta_connection_id', 'organization_id']::text[],
        'public', 'meta_connections', array['id', 'organization_id']::text[],
        'a', 'c', 's', true, false, false, 0),
      ('meta_oauth_sessions', 'meta_oauth_sessions_actor_id_fkey',
        array['actor_id']::text[], 'auth', 'users', array['id']::text[],
        'a', 'c', 's', true, false, false, 0),
      ('meta_oauth_sessions', 'meta_oauth_sessions_brand_fk',
        array['brand_id', 'organization_id']::text[], 'public', 'brands',
        array['id', 'organization_id']::text[],
        'a', 'c', 's', true, false, false, 0),
      ('meta_oauth_sessions', 'meta_oauth_sessions_registry_fk',
        array['integration_connection_id', 'organization_id']::text[],
        'public', 'integration_connections', array['id', 'organization_id']::text[],
        'a', 'c', 's', true, false, false, 0)
    ), actual as (
      select child.relname::text, c.conname::text,
        array(select a.attname::text
          from unnest(c.conkey) with ordinality key_column(attnum, position)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum
          order by key_column.position),
        parent_namespace.nspname::text, parent.relname::text,
        array(select a.attname::text
          from unnest(c.confkey) with ordinality key_column(attnum, position)
          join pg_attribute a on a.attrelid = c.confrelid and a.attnum = key_column.attnum
          order by key_column.position),
        c.confupdtype::text, c.confdeltype::text, c.confmatchtype::text, c.convalidated,
        c.condeferrable, c.condeferred,
        coalesce(array_length(c.confdelsetcols, 1), 0)
      from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace parent_namespace on parent_namespace.oid = parent.relnamespace
      where c.contype = 'f'
        and c.conrelid in (
          'public.meta_connections'::regclass,
          'public.meta_performance_snapshots'::regclass,
          'public.meta_oauth_sessions'::regclass
        )
    )
    select not exists ((select * from actual except select * from expected)
      union all (select * from expected except select * from actual))
  )),
  ('exact_provider_and_event_constraints', (
    select
      (select c.convalidated and pg_get_constraintdef(c.oid, false) = (
        select pg_get_constraintdef(e.oid, false)
        from pg_constraint e
        where e.conrelid = 'pg_temp.mk6b_expected_registry_provider'::regclass
          and e.conname = 'integration_connections_provider_check'
      ) from pg_constraint c
      where c.conrelid = 'public.integration_connections'::regclass
        and c.conname = 'integration_connections_provider_check'
        and c.contype = 'c')
      and
      (select c.convalidated and pg_get_constraintdef(c.oid, false) = (
        select pg_get_constraintdef(e.oid, false)
        from pg_constraint e
        where e.conrelid = 'pg_temp.mk6b_expected_event_contract'::regclass
          and e.conname = 'integration_events_provider_check'
      ) from pg_constraint c
      where c.conrelid = 'public.integration_events'::regclass
        and c.conname = 'integration_events_provider_check'
        and c.contype = 'c')
      and
      (select c.convalidated and pg_get_constraintdef(c.oid, false) = (
        select pg_get_constraintdef(e.oid, false)
        from pg_constraint e
        where e.conrelid = 'pg_temp.mk6b_expected_event_contract'::regclass
          and e.conname = 'integration_events_operation_check'
      ) from pg_constraint c
      where c.conrelid = 'public.integration_events'::regclass
        and c.conname = 'integration_events_operation_check'
        and c.contype = 'c')
  )),
  ('exact_rls_policy_contract', (
    select
      (select count(*) = 1 from pg_policy where polrelid = 'public.meta_connections'::regclass)
      and (select count(*) = 1 from pg_policy where polrelid = 'public.meta_performance_snapshots'::regclass)
      and (select count(*) = 0 from pg_policy where polrelid = 'public.meta_oauth_sessions'::regclass)
      and exists (
        select 1 from pg_policy
        where polrelid = 'public.meta_connections'::regclass
          and polname = 'Team can read own Meta connection metadata'
          and polpermissive
          and polcmd = 'r'
          and polroles = array['authenticated'::regrole::oid]
          and pg_get_expr(polqual, polrelid, false) = 'is_team_organization_member(organization_id)'
          and polwithcheck is null)
      and exists (
        select 1 from pg_policy
        where polrelid = 'public.meta_performance_snapshots'::regclass
          and polname = 'Team can read own Meta performance snapshots'
          and polpermissive
          and polcmd = 'r'
          and polroles = array['authenticated'::regrole::oid]
          and pg_get_expr(polqual, polrelid, false) = 'is_team_organization_member(organization_id)'
          and polwithcheck is null)
      and (select count(*) = 3 and bool_and(relrowsecurity) and not bool_or(relforcerowsecurity)
        from pg_class where oid in (
          'public.meta_connections'::regclass,
          'public.meta_performance_snapshots'::regclass,
          'public.meta_oauth_sessions'::regclass
        ))
  ));

create temporary table mk6b_expected_table_acl (
  table_name text, grantee text, privilege_type text, is_grantable boolean,
  primary key (table_name, grantee, privilege_type)
) on commit drop;
insert into mk6b_expected_table_acl values
  ('meta_performance_snapshots', 'authenticated', 'SELECT', false);
insert into mk6b_expected_table_acl
select table_name, 'service_role', privilege_type, false
from unnest(array['meta_connections', 'meta_performance_snapshots', 'meta_oauth_sessions']) table_name
cross join unnest(array[
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
]) privilege_type;
insert into mk6b_expected_table_acl
select c.relname::text, pg_get_userbyid(c.relowner), privilege_type, false
from pg_class c
cross join unnest(array[
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
]) privilege_type
where c.oid in (
  'public.meta_connections'::regclass,
  'public.meta_performance_snapshots'::regclass,
  'public.meta_oauth_sessions'::regclass
);

create temporary table mk6b_expected_column_acl (
  table_name text, column_name text, grantee text, privilege_type text, is_grantable boolean,
  primary key (table_name, column_name, grantee, privilege_type)
) on commit drop;
insert into mk6b_expected_column_acl
select 'meta_connections', column_name, 'authenticated', 'SELECT', false
from unnest(array[
  'id', 'organization_id', 'integration_connection_id', 'brand_id',
  'facebook_page_id', 'instagram_account_id', 'token_expires_at',
  'connected_by', 'connected_at'
]) column_name;

insert into mk6b_checks values
  ('exact_table_acls_pg17', (
    with actual as (
      select c.relname::text table_name,
        case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end grantee,
        x.privilege_type, x.is_grantable
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
      where n.nspname = 'public'
        and c.relname in ('meta_connections', 'meta_performance_snapshots', 'meta_oauth_sessions')
    )
    select not exists ((select * from actual except select * from mk6b_expected_table_acl)
      union all (select * from mk6b_expected_table_acl except select * from actual))
  )),
  ('exact_column_acls_via_pg_attribute', (
    with actual as (
      select c.relname::text table_name, a.attname::text column_name,
        case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end grantee,
        x.privilege_type, x.is_grantable
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral aclexplode(coalesce(a.attacl, '{}'::aclitem[])) x
      where n.nspname = 'public'
        and c.relname in ('meta_connections', 'meta_performance_snapshots', 'meta_oauth_sessions')
    )
    select not exists ((select * from actual except select * from mk6b_expected_column_acl)
      union all (select * from mk6b_expected_column_acl except select * from actual))
  )),
  ('no_sequence_or_table_function_acl_surface', (
    not exists (
      select 1
      from pg_depend d
      join pg_class sequence_record on sequence_record.oid = d.objid and sequence_record.relkind = 'S'
      where d.refobjid in (
        'public.meta_connections'::regclass,
        'public.meta_performance_snapshots'::regclass,
        'public.meta_oauth_sessions'::regclass
      ) and d.deptype in ('a', 'i')
    )
    and not exists (
      select 1 from pg_trigger
      where tgrelid in (
        'public.meta_connections'::regclass,
        'public.meta_performance_snapshots'::regclass,
        'public.meta_oauth_sessions'::regclass
      ) and not tgisinternal
    )
  )),
  ('exact_nonconstraint_indexes', (
    with expected(index_name, table_name, columns, predicate) as (values
      ('idx_meta_oauth_sessions_connection', 'meta_oauth_sessions',
        array['integration_connection_id']::text[], null::text),
      ('idx_meta_oauth_sessions_actor', 'meta_oauth_sessions',
        array['actor_id']::text[], null::text),
      ('idx_meta_oauth_sessions_expiry', 'meta_oauth_sessions',
        array['expires_at']::text[], null::text)
    ), actual as (
      select ic.relname::text index_name, tc.relname::text table_name,
        array(select pg_get_indexdef(i.indexrelid, position, false)
          from generate_series(1, i.indnkeyatts) position order by position) columns,
        case when i.indpred is null then null
          else pg_get_expr(i.indpred, i.indrelid, false) end predicate
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      join pg_class tc on tc.oid = i.indrelid
      where i.indrelid in (
        'public.meta_connections'::regclass,
        'public.meta_performance_snapshots'::regclass,
        'public.meta_oauth_sessions'::regclass
      )
        and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
        and i.indisvalid and i.indisready and i.indislive
        and not i.indisunique and not i.indisprimary and not i.indisexclusion
        and i.indimmediate and i.indexprs is null
        and (select amname from pg_am where oid = ic.relam) = 'btree'
    )
    select not exists ((select * from actual except select * from expected)
      union all (select * from expected except select * from actual))
  )),
  ('all_constraint_and_supporting_indexes_live', (
    select count(*) = 11
      and bool_and(indisvalid) and bool_and(indisready) and bool_and(indislive)
    from pg_index
    where indrelid in (
      'public.meta_connections'::regclass,
      'public.meta_performance_snapshots'::regclass,
      'public.meta_oauth_sessions'::regclass
    )
  ));

do $$
declare
  v_actor uuid;
  v_org_a constant uuid := '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25';
  v_org_b uuid := gen_random_uuid();
  v_client_a uuid := gen_random_uuid();
  v_client_b uuid := gen_random_uuid();
  v_brand_a uuid := gen_random_uuid();
  v_brand_b uuid := gen_random_uuid();
  v_registry_a uuid := gen_random_uuid();
  v_registry_b uuid := gen_random_uuid();
  v_registry_cross_a uuid := gen_random_uuid();
  v_registry_cross_b uuid := gen_random_uuid();
  v_meta_a uuid := gen_random_uuid();
  v_meta_b uuid := gen_random_uuid();
  v_snapshot_a uuid := gen_random_uuid();
  v_snapshot_b uuid := gen_random_uuid();
  v_cross_brand boolean := false;
  v_cross_registry boolean := false;
  v_cross_snapshot boolean := false;
  v_cross_session_brand boolean := false;
  v_cross_session_registry boolean := false;
  v_unknown_session_actor boolean := false;
  v_negative_reach boolean := false;
  v_negative_impressions boolean := false;
  v_negative_engagement boolean := false;
  v_nonnull_spend boolean := false;
  v_visible integer;
  v_hidden integer;
  v_secret_denied boolean := false;
  v_session_denied boolean := false;
  v_connection_write_denied boolean := false;
  v_snapshot_write_denied boolean := false;
begin
  select user_id into v_actor
  from public.organization_memberships
  where organization_id = v_org_a and member_kind = 'team' and status = 'active'
  order by created_at limit 1;
  if v_actor is null then
    insert into mk6b_checks values ('rollback_runtime_fixtures_available', false);
    return;
  end if;

  insert into public.organizations(id, name, slug)
  values (v_org_b, 'MK6b verifier other tenant', 'mk6b-' || replace(v_org_b::text, '-', ''));
  insert into public.agency_clients(id, organization_id, name)
  values (v_client_a, v_org_a, 'MK6b verifier A'), (v_client_b, v_org_b, 'MK6b verifier B');
  insert into public.brands(id, organization_id, client_id, name)
  values (v_brand_a, v_org_a, v_client_a, 'MK6b brand A'),
         (v_brand_b, v_org_b, v_client_b, 'MK6b brand B');
  insert into public.integration_connections(
    id, organization_id, provider, display_name, status, created_by
  ) values
    (v_registry_a, v_org_a, 'meta', 'MK6b verifier A ' || v_registry_a, 'verified', v_actor),
    (v_registry_b, v_org_b, 'meta', 'MK6b verifier B ' || v_registry_b, 'verified', v_actor),
    (v_registry_cross_a, v_org_a, 'meta', 'MK6b cross A ' || v_registry_cross_a, 'verified', v_actor),
    (v_registry_cross_b, v_org_b, 'meta', 'MK6b cross B ' || v_registry_cross_b, 'verified', v_actor);
  insert into public.meta_connections(
    id, organization_id, integration_connection_id, brand_id, facebook_page_id,
    access_token_ciphertext, access_token_iv, connected_by
  ) values
    (v_meta_a, v_org_a, v_registry_a, v_brand_a, '10001', 'cipher-a', 'iv-a', v_actor),
    (v_meta_b, v_org_b, v_registry_b, v_brand_b, '20001', 'cipher-b', 'iv-b', v_actor);
  insert into public.meta_performance_snapshots(
    id, organization_id, meta_connection_id, snapshot_date, platform,
    reach, impressions, engagement, spend
  ) values
    (v_snapshot_a, v_org_a, v_meta_a, current_date - 1, 'facebook', 1, 2, 3, null),
    (v_snapshot_b, v_org_b, v_meta_b, current_date - 1, 'facebook', 4, 5, 6, null);
  insert into public.meta_oauth_sessions(
    organization_id, integration_connection_id, brand_id, facebook_page_id,
    actor_id, state_hash, code_verifier_ciphertext, code_verifier_iv
  ) values
    (v_org_a, v_registry_a, v_brand_a, '10001', v_actor,
      repeat('a', 64), 'verifier-a', 'iv-a'),
    (v_org_b, v_registry_b, v_brand_b, '20001', v_actor,
      repeat('b', 64), 'verifier-b', 'iv-b');

  begin
    insert into public.meta_connections(
      organization_id, integration_connection_id, brand_id, facebook_page_id,
      access_token_ciphertext, access_token_iv, connected_by
    ) values (v_org_a, v_registry_cross_a, v_brand_b, '10002', 'x', 'y', v_actor);
  exception when foreign_key_violation then v_cross_brand := true; end;
  begin
    insert into public.meta_connections(
      organization_id, integration_connection_id, brand_id, facebook_page_id,
      access_token_ciphertext, access_token_iv, connected_by
    ) values (v_org_a, v_registry_cross_b, v_brand_a, '10003', 'x', 'y', v_actor);
  exception when foreign_key_violation then v_cross_registry := true; end;
  begin
    insert into public.meta_performance_snapshots(
      organization_id, meta_connection_id, snapshot_date, platform
    ) values (v_org_b, v_meta_a, current_date - 2, 'facebook');
  exception when foreign_key_violation then v_cross_snapshot := true; end;
  begin
    insert into public.meta_oauth_sessions(
      organization_id, integration_connection_id, brand_id, facebook_page_id,
      actor_id, state_hash, code_verifier_ciphertext, code_verifier_iv
    ) values (
      v_org_a, v_registry_a, v_brand_b, '10004', v_actor,
      repeat('c', 64), 'x', 'y'
    );
  exception when foreign_key_violation then v_cross_session_brand := true; end;
  begin
    insert into public.meta_oauth_sessions(
      organization_id, integration_connection_id, brand_id, facebook_page_id,
      actor_id, state_hash, code_verifier_ciphertext, code_verifier_iv
    ) values (
      v_org_a, v_registry_b, v_brand_a, '10005', v_actor,
      repeat('d', 64), 'x', 'y'
    );
  exception when foreign_key_violation then v_cross_session_registry := true; end;
  begin
    insert into public.meta_oauth_sessions(
      organization_id, integration_connection_id, brand_id, facebook_page_id,
      actor_id, state_hash, code_verifier_ciphertext, code_verifier_iv
    ) values (
      v_org_a, v_registry_a, v_brand_a, '10006', gen_random_uuid(),
      repeat('e', 64), 'x', 'y'
    );
  exception when foreign_key_violation then v_unknown_session_actor := true; end;

  insert into public.meta_performance_snapshots(
    organization_id, meta_connection_id, snapshot_date, platform
  ) values (v_org_a, v_meta_a, current_date - 1, 'facebook')
  on conflict (meta_connection_id, snapshot_date, platform) do nothing;

  begin
    insert into public.meta_performance_snapshots(
      organization_id, meta_connection_id, snapshot_date, platform, reach
    ) values (v_org_a, v_meta_a, current_date - 3, 'facebook', -1);
  exception when check_violation then v_negative_reach := true; end;
  begin
    insert into public.meta_performance_snapshots(
      organization_id, meta_connection_id, snapshot_date, platform, impressions
    ) values (v_org_a, v_meta_a, current_date - 3, 'instagram', -1);
  exception when check_violation then v_negative_impressions := true; end;
  begin
    insert into public.meta_performance_snapshots(
      organization_id, meta_connection_id, snapshot_date, platform, engagement
    ) values (v_org_a, v_meta_a, current_date - 4, 'facebook', -1);
  exception when check_violation then v_negative_engagement := true; end;
  begin
    insert into public.meta_performance_snapshots(
      organization_id, meta_connection_id, snapshot_date, platform, spend
    ) values (v_org_a, v_meta_a, current_date - 4, 'instagram', 0);
  exception when check_violation then v_nonnull_spend := true; end;

  insert into mk6b_checks values
    ('cross_tenant_foreign_keys_reject',
      v_cross_brand and v_cross_registry and v_cross_snapshot
      and v_cross_session_brand and v_cross_session_registry),
    ('oauth_actor_foreign_key_rejects_unknown_user', v_unknown_session_actor),
    ('snapshot_idempotency_runtime', (
      select count(*) = 1 from public.meta_performance_snapshots
      where meta_connection_id = v_meta_a and snapshot_date = current_date - 1 and platform = 'facebook'
    )),
    ('negative_metrics_reject_runtime',
      v_negative_reach and v_negative_impressions and v_negative_engagement),
    ('spend_is_always_null_runtime',
      v_nonnull_spend and not exists (
        select 1 from public.meta_performance_snapshots where spend is not null
      ));

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  select count(*) into v_visible from public.meta_connections
    where id = v_meta_a and facebook_page_id = '10001';
  select count(*) into v_hidden from public.meta_connections where id = v_meta_b;
  v_visible := v_visible + (select count(*) from public.meta_performance_snapshots where id = v_snapshot_a);
  v_hidden := v_hidden + (select count(*) from public.meta_performance_snapshots where id = v_snapshot_b);
  begin
    perform access_token_ciphertext from public.meta_connections where id = v_meta_a;
  exception when insufficient_privilege then v_secret_denied := true; end;
  begin
    perform id from public.meta_oauth_sessions;
  exception when insufficient_privilege then v_session_denied := true; end;
  begin
    update public.meta_connections set facebook_page_id = '99999' where id = v_meta_a;
  exception when insufficient_privilege then v_connection_write_denied := true; end;
  begin
    delete from public.meta_performance_snapshots where id = v_snapshot_a;
  exception when insufficient_privilege then v_snapshot_write_denied := true; end;
  reset role;

  insert into mk6b_checks values
    ('rls_tenant_visibility_runtime', v_visible = 2 and v_hidden = 0),
    ('browser_credentials_sessions_writes_denied_runtime',
      v_secret_denied and v_session_denied
      and v_connection_write_denied and v_snapshot_write_denied);

  -- One registry deletion must cascade through credentials/sessions and then snapshots.
  delete from public.integration_connections where id = v_registry_a;
  insert into mk6b_checks values ('registry_cascade_runtime', (
    not exists (select 1 from public.meta_connections where id = v_meta_a)
    and not exists (select 1 from public.meta_performance_snapshots where id = v_snapshot_a)
    and not exists (select 1 from public.meta_oauth_sessions where integration_connection_id = v_registry_a)
  ));

  -- Brand deletion must cascade provider state while leaving the canonical registry row.
  delete from public.brands where id = v_brand_b;
  insert into mk6b_checks values ('brand_cascade_runtime', (
    exists (select 1 from public.integration_connections where id = v_registry_b)
    and not exists (select 1 from public.meta_connections where id = v_meta_b)
    and not exists (select 1 from public.meta_performance_snapshots where id = v_snapshot_b)
    and not exists (select 1 from public.meta_oauth_sessions where integration_connection_id = v_registry_b)
  ));
end
$$;

select check_name, passed from mk6b_checks order by check_name;

do $$
begin
  if exists (select 1 from mk6b_checks where not passed) then
    raise exception 'One or more MK6b verification checks failed';
  end if;
end
$$;

rollback;
