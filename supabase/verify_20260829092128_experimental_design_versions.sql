-- Review-database verification for D2 experimental design direction versions.
-- All fixtures are rolled back.

begin;

create temporary table d2_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_direction_id uuid;
  v_parent_id uuid;
  v_creator_id uuid;
  v_invited_id uuid;
  v_denied_id uuid;
  v_experiment_id uuid := gen_random_uuid();
  v_promoted_id uuid := gen_random_uuid();
  v_comment_id uuid := gen_random_uuid();
  v_next_version integer;
  v_checksum text := encode(digest(gen_random_uuid()::text, 'sha256'), 'hex');
  v_signature text := encode(digest(gen_random_uuid()::text, 'sha256'), 'hex');
  v_content jsonb := jsonb_build_object(
    'title', 'D2 runtime experiment',
    'rationale', 'Proves private experiment visibility and immutable promotion.'
  );
  v_count integer;
begin
  select version.organization_id, version.direction_id, version.id,
    version.version_number + 1
  into v_organization_id, v_direction_id, v_parent_id, v_next_version
  from public.design_direction_versions version
  where not version.is_experimental
  order by version.created_at
  limit 1;

  select members[1], members[2], members[3]
  into v_creator_id, v_invited_id, v_denied_id
  from (
    select array_agg(membership.user_id order by membership.created_at) members
    from public.organization_memberships membership
    where membership.organization_id = v_organization_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) roster;

  if v_parent_id is null or v_denied_id is null then
    insert into d2_runtime_checks values
      ('uninvited_experiment_hidden', false),
      ('uninvited_proofing_hidden', false),
      ('invited_experiment_visible', false),
      ('nonexperimental_visibility_unchanged', false),
      ('promotion_created_immutable_child', false);
    return;
  end if;

  insert into public.design_direction_versions (
    id, organization_id, direction_id, version_number, parent_version_id,
    content, content_checksum, distinctness_signature, created_by,
    is_experimental, experiment_visibility
  ) values (
    v_experiment_id, v_organization_id, v_direction_id, v_next_version, v_parent_id,
    v_content, v_checksum, v_signature, v_creator_id, true, array[v_invited_id]
  );

  insert into public.artifact_version_comments (
    id, organization_id, design_direction_version_id, author_id, body
  ) values (
    v_comment_id, v_organization_id, v_experiment_id, v_creator_id,
    'D2 private experiment proofing comment'
  );

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_denied_id, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select count(*) into v_count from public.design_direction_versions where id = v_experiment_id;
  reset role;
  insert into d2_runtime_checks values ('uninvited_experiment_hidden', v_count = 0);

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_denied_id, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select count(*) into v_count from public.artifact_version_comments where id = v_comment_id;
  reset role;
  insert into d2_runtime_checks values ('uninvited_proofing_hidden', v_count = 0);

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_invited_id, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select count(*) into v_count from public.design_direction_versions where id = v_experiment_id;
  reset role;
  insert into d2_runtime_checks values ('invited_experiment_visible', v_count = 1);

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_denied_id, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select count(*) into v_count from public.design_direction_versions where id = v_parent_id;
  reset role;
  insert into d2_runtime_checks values ('nonexperimental_visibility_unchanged', v_count = 1);

  insert into public.design_direction_versions (
    id, organization_id, direction_id, version_number, parent_version_id,
    content, content_checksum, distinctness_signature, created_by,
    is_experimental, experiment_visibility
  ) values (
    v_promoted_id, v_organization_id, v_direction_id, v_next_version + 1, v_experiment_id,
    v_content, v_checksum, v_signature, v_invited_id, false, null
  );

  insert into d2_runtime_checks values (
    'promotion_created_immutable_child',
    exists (
      select 1 from public.design_direction_versions promoted
      join public.design_direction_versions experiment on experiment.id = promoted.parent_version_id
      where promoted.id = v_promoted_id
        and not promoted.is_experimental
        and experiment.id = v_experiment_id
        and experiment.is_experimental
        and promoted.content = experiment.content
    )
  );
end;
$$;

select jsonb_build_object(
  'columns_and_defaults_correct',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'design_direction_versions'
        and column_name = 'is_experimental' and is_nullable = 'NO' and column_default = 'false'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'design_direction_versions'
        and column_name = 'experiment_visibility' and data_type = 'ARRAY' and is_nullable = 'YES'
    ),
  'main_comparison_index_is_partial', exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'design_direction_versions'
      and indexname = 'idx_design_direction_versions_main_comparison'
      and indexdef like '%WHERE (NOT is_experimental)%'
  ),
  'versions_remain_immutable', exists (
    select 1 from pg_trigger
    where tgrelid = 'public.design_direction_versions'::regclass
      and tgname = 'trg_design_direction_versions_immutable' and not tgisinternal
  ),
  'experiments_blocked_from_decisions', (
    select count(*) = 2 from pg_trigger
    where tgname in ('trg_design_selections_reject_experimental', 'trg_design_releases_reject_experimental')
      and not tgisinternal
  )
) || (select jsonb_object_agg(check_name, passed) from d2_runtime_checks);

rollback;
