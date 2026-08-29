-- Review-database verification for D3 artifact relations. All fixtures and the
-- temporary artifact-visibility restriction are rolled back.

begin;

create temporary table d3_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_brand_id uuid;
  v_actor_id uuid;
  v_source_id uuid := gen_random_uuid();
  v_target_id uuid := gen_random_uuid();
  v_relation_id uuid;
  v_source_visible integer;
  v_target_visible integer;
  v_rollup_visible integer;
begin
  select brand.organization_id, brand.id, membership.user_id
  into v_organization_id, v_brand_id, v_actor_id
  from public.brands brand
  join public.organization_memberships membership
    on membership.organization_id = brand.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  limit 1;

  if not found then
    insert into d3_runtime_checks values
      ('cross_type_relation_created', false),
      ('inaccessible_target_hidden_from_rollup', false);
    return;
  end if;

  insert into public.artifacts (
    id, organization_id, brand_id, artifact_type, title, created_by
  ) values
    (v_source_id, v_organization_id, v_brand_id, 'discovery', 'D3 visible source', v_actor_id),
    (v_target_id, v_organization_id, v_brand_id, 'channel_strategy', 'D3 restricted target', v_actor_id);

  insert into public.artifact_relations (
    organization_id, source_artifact_id, target_artifact_id, relation_type, created_by
  ) values (
    v_organization_id, v_source_id, v_target_id, 'feeds_into', v_actor_id
  ) returning id into v_relation_id;

  insert into d3_runtime_checks values (
    'cross_type_relation_created',
    exists (
      select 1
      from public.artifact_relations relation
      join public.artifacts source on source.id = relation.source_artifact_id
      join public.artifacts target on target.id = relation.target_artifact_id
      where relation.id = v_relation_id
        and source.artifact_type <> target.artifact_type
    )
  );

  -- Model an existing artifact-level denial without permanently changing the
  -- accepted artifact schema or policy. The D3 relation policy must inherit it.
  execute format(
    'alter policy "Team can read artifacts" on public.artifacts using '
    || '(public.is_team_organization_member(organization_id) and id <> %L::uuid)',
    v_target_id
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor_id, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  select count(*) into v_source_visible
  from public.artifacts where id = v_source_id;
  select count(*) into v_target_visible
  from public.artifacts where id = v_target_id;
  select count(*) into v_rollup_visible
  from public.artifact_relations relation
  join public.artifacts target on target.id = relation.target_artifact_id
    and target.organization_id = relation.organization_id
  where relation.id = v_relation_id;

  reset role;

  insert into d3_runtime_checks values (
    'inaccessible_target_hidden_from_rollup',
    v_source_visible = 1 and v_target_visible = 0 and v_rollup_visible = 0
  );
end;
$$;

select jsonb_build_object(
  'exact_relation_columns', (
    select array_agg(column_name order by ordinal_position) = array[
      'id', 'organization_id', 'source_artifact_id', 'target_artifact_id',
      'relation_type', 'created_by', 'created_at'
    ]::text[]
    from information_schema.columns
    where table_schema = 'public' and table_name = 'artifact_relations'
  ),
  'rls_enabled', (
    select relrowsecurity
    from pg_class
    where oid = 'public.artifact_relations'::regclass
  ),
  'browser_is_read_only',
    has_table_privilege('authenticated', 'public.artifact_relations', 'select')
    and not has_table_privilege('authenticated', 'public.artifact_relations', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.artifact_relations', 'select, insert, update, delete'),
  'both_artifact_fks_are_organization_consistent', (
    select count(*) = 2
    from pg_constraint
    where conrelid = 'public.artifact_relations'::regclass
      and contype = 'f'
      and confrelid = 'public.artifacts'::regclass
      and array_length(conkey, 1) = 2
  ),
  'exact_relation_types', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.artifact_relations'::regclass
      and conname = 'artifact_relations_relation_type_check'
  ) like all (array['%feeds_into%', '%derived_from%', '%referenced_by%']),
  'no_rollup_columns_stored', not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'artifact_relations'
      and column_name in ('related_count', 'incoming_count', 'outgoing_count', 'rollup')
  )
) || (select jsonb_object_agg(check_name, passed) from d3_runtime_checks);

rollback;
