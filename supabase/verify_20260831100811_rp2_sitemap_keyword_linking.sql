-- RP2 rollback-safe verification. Run after the RP2 migration is applied.

begin;

create temporary table rp2_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_brand_id uuid;
  v_actor_id uuid;
  v_keyword_artifact_id uuid := gen_random_uuid();
  v_architecture_artifact_id uuid := gen_random_uuid();
  v_relation_id uuid;
begin
  select brand.organization_id, brand.id, membership.user_id
  into v_organization_id, v_brand_id, v_actor_id
  from public.brands brand
  join public.organization_memberships membership
    on membership.organization_id = brand.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  order by brand.created_at
  limit 1;

  if not found then
    raise exception 'RP2 verification requires one brand with an active team member';
  end if;

  insert into public.artifacts (
    id, organization_id, brand_id, artifact_type, title, created_by
  ) values
    (v_keyword_artifact_id, v_organization_id, v_brand_id,
      'keyword_strategy', 'RP2 keyword verification artifact', v_actor_id),
    (v_architecture_artifact_id, v_organization_id, v_brand_id,
      'website_architecture', 'RP2 sitemap verification artifact', v_actor_id);

  insert into public.artifact_relations (
    organization_id, source_artifact_id, target_artifact_id, relation_type, created_by
  ) values (
    v_organization_id, v_keyword_artifact_id, v_architecture_artifact_id,
    'targets_page', v_actor_id
  ) returning id into v_relation_id;

  insert into rp2_runtime_checks values (
    'keyword_to_page_relation_created',
    exists (
      select 1
      from public.artifact_relations relation
      join public.artifacts source on source.id = relation.source_artifact_id
      join public.artifacts target on target.id = relation.target_artifact_id
      where relation.id = v_relation_id
        and relation.relation_type = 'targets_page'
        and source.artifact_type = 'keyword_strategy'
        and target.artifact_type = 'website_architecture'
    )
  );
end;
$$;

select jsonb_build_object(
  'targets_page_type_available', (
    select pg_get_constraintdef(oid) like '%targets_page%'
    from pg_constraint
    where conrelid = 'public.artifact_relations'::regclass
      and conname = 'artifact_relations_relation_type_check'
  ),
  'original_relation_types_preserved', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.artifact_relations'::regclass
      and conname = 'artifact_relations_relation_type_check'
  ) like all (array['%feeds_into%', '%derived_from%', '%referenced_by%']),
  'd3_visibility_policy_preserved', (
    select pg_get_expr(polqual, polrelid)
    from pg_policy
    where polrelid = 'public.artifact_relations'::regclass
      and polname = 'Team can read visible artifact relations'
  ) like all (array['%is_team_organization_member%', '%source_artifact_id%', '%target_artifact_id%']),
  'browser_remains_read_only',
    has_table_privilege('authenticated', 'public.artifact_relations', 'select')
    and not has_table_privilege('authenticated', 'public.artifact_relations', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.artifact_relations', 'select, insert, update, delete'),
  'relation_shape_unchanged', (
    select array_agg(column_name::text order by ordinal_position) = array[
      'id', 'organization_id', 'source_artifact_id', 'target_artifact_id',
      'relation_type', 'created_by', 'created_at'
    ]::text[]
    from information_schema.columns
    where table_schema = 'public' and table_name = 'artifact_relations'
  )
) || (select jsonb_object_agg(check_name, passed) from rp2_runtime_checks);

rollback;
