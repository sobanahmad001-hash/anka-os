begin;

create temporary table cp5_checks (
  check_name text primary key,
  passed boolean not null
);

grant select, insert on cp5_checks to authenticated;

insert into cp5_checks values
  ('artifact_version_comments_table_exists', to_regclass('public.artifact_version_comments') is not null),
  ('artifact_version_comments_rls_enabled', (
    select relrowsecurity
    from pg_class
    where oid = 'public.artifact_version_comments'::regclass
  )),
  ('artifact_version_comments_browser_is_read_only', (
    select has_table_privilege('authenticated', 'public.artifact_version_comments', 'select')
      and not has_table_privilege('authenticated', 'public.artifact_version_comments', 'insert')
      and not has_table_privilege('authenticated', 'public.artifact_version_comments', 'update')
      and not has_table_privilege('authenticated', 'public.artifact_version_comments', 'delete')
      and not has_table_privilege('anon', 'public.artifact_version_comments', 'select')
      and not has_table_privilege('anon', 'public.artifact_version_comments', 'insert')
      and not has_table_privilege('anon', 'public.artifact_version_comments', 'update')
      and not has_table_privilege('anon', 'public.artifact_version_comments', 'delete')
  )),
  ('artifact_version_comments_uses_request_fk', exists (
    select 1 from pg_constraint
    where conrelid = 'public.artifact_version_comments'::regclass
      and conname = 'artifact_version_comments_content_request_fk'
      and contype = 'f'
  )),
  ('artifact_version_comments_tracks_exactly_one_target', exists (
    select 1 from pg_constraint
    where conrelid = 'public.artifact_version_comments'::regclass
      and conname = 'artifact_version_comments_exactly_one_target'
      and pg_get_constraintdef(oid) like '%content_request_id%'
  )),
  ('artifact_version_comments_append_only_trigger_exists', exists (
    select 1 from pg_trigger
    where tgrelid = 'public.artifact_version_comments'::regclass
      and tgname = 'trg_artifact_version_comments_append_only'
  )),
  ('artifact_relations_table_exists', to_regclass('public.artifact_relations') is not null),
  ('artifact_relations_has_request_target_column', exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'artifact_relations'
      and column_name = 'target_content_request_id'
  )),
  ('artifact_relations_enforces_single_target', exists (
    select 1 from pg_constraint
    where conrelid = 'public.artifact_relations'::regclass
      and conname = 'artifact_relations_exactly_one_target'
      and pg_get_constraintdef(oid) like '%target_content_request_id%'
  )),
  ('artifact_relations_request_link_is_unique_per_type', exists (
    select 1
    from pg_indexes
    where schemaname = 'public' and indexname = 'artifact_relations_unique_request_link'
  )),
  ('artifact_relations_browser_is_read_only', (
    select has_table_privilege('authenticated', 'public.artifact_relations', 'select')
      and not has_table_privilege('authenticated', 'public.artifact_relations', 'insert')
      and not has_table_privilege('authenticated', 'public.artifact_relations', 'update')
      and not has_table_privilege('authenticated', 'public.artifact_relations', 'delete')
      and not has_table_privilege('anon', 'public.artifact_relations', 'select')
      and not has_table_privilege('anon', 'public.artifact_relations', 'insert')
      and not has_table_privilege('anon', 'public.artifact_relations', 'update')
      and not has_table_privilege('anon', 'public.artifact_relations', 'delete')
  )),
  ('artifact_relations_policy_checks_target_readability', exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'artifact_relations'
      and cmd = 'SELECT'
      and qual like '%content_request_id%'
  ));

do $$
DECLARE
  v_actor uuid;
  v_org uuid;
  v_brand uuid;
  v_artifact uuid := gen_random_uuid();
  v_artifact_target uuid := gen_random_uuid();
  v_artifact_version uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_relation uuid;
  v_comment uuid;
  v_dual_target_rejected boolean := false;
  v_zero_target_rejected boolean := false;
  v_comment_dual_target_rejected boolean := false;
  v_comment_zero_target_rejected boolean := false;
  v_visible_request_rows integer;
  v_visible_relation_rows integer;
  v_visible_comment_rows integer;
  v_comment_rows integer;
  v_other_request_rows integer;
  v_other_relation_rows integer;
  v_other_comment_rows integer;
  v_other_actor uuid;
BEGIN
  select m.user_id, m.organization_id, b.id
    into v_actor, v_org, v_brand
  from public.organization_memberships m
  join public.brands b on b.organization_id = m.organization_id
  where m.member_kind = 'team'
    and m.status = 'active'
  limit 1;

  if v_actor is null then
    insert into cp5_checks values
      ('fixture_ready', false),
      ('request_comment_visible_with_rls', false),
      ('request_relation_visible_with_rls', false),
      ('dual_targets_are_rejected', false),
      ('zero_targets_are_rejected', false),
      ('comment_targets_are_dual_rejected', false),
      ('comment_targets_are_zero_rejected', false),
      ('request_scope_hidden_from_unaffiliated_jwt', false),
      ('content_request_comment_ignores_version_columns', false);
    return;
  end if;

  insert into public.artifacts (
    id, organization_id, brand_id, artifact_type, title, created_by
  ) values (
    v_artifact, v_org, v_brand, 'discovery', 'CP5 verifier source artifact', v_actor
  );

  insert into public.artifacts (
    id, organization_id, brand_id, artifact_type, title, created_by
  ) values (
    v_artifact_target, v_org, v_brand, 'discovery', 'CP5 verifier dual-target artifact', v_actor
  );

  insert into public.artifact_versions (
    id, organization_id, artifact_id, version_number, content, content_checksum, change_summary, created_by
  ) values (
    v_artifact_version, v_org, v_artifact, 1, '{}'::jsonb, lpad('a', 64, 'a'), 'cp5 verifier fixture', v_actor
  );

  insert into public.content_requests (
    id, organization_id, mode, output_path, format, brief, created_by
  ) values (
    v_request, v_org, 'general', 'figma_handoff', 'reel', 'Proofing target check', v_actor
  );

  insert into public.artifact_version_comments (
    organization_id, content_request_id, author_id, body
  ) values (
    v_org, v_request, v_actor, 'First request comment for CP5 verifier.'
  ) returning id into v_comment;

  begin
    insert into public.artifact_version_comments (
      organization_id, artifact_version_id, content_request_id, author_id, body
    ) values (v_org, v_artifact_version, v_request, v_actor, 'invalid dual target check');
  exception when check_violation then
    v_comment_dual_target_rejected := sqlstate = '23514';
  when others then
    v_comment_dual_target_rejected := false;
  end;

  begin
    insert into public.artifact_version_comments (
      organization_id, author_id, body
    ) values (v_org, v_actor, 'invalid zero target check');
  exception when check_violation then
    v_comment_zero_target_rejected := sqlstate = '23514';
  when others then
    v_comment_zero_target_rejected := false;
  end;

  begin
    insert into public.artifact_relations (
      organization_id, source_artifact_id, target_artifact_id, target_content_request_id, relation_type, created_by
    ) values (
      v_org, v_artifact, v_artifact_target, v_request, 'targets_page', v_actor
    );
  exception when check_violation then
    v_dual_target_rejected := sqlstate = '23514';
  when others then
    v_dual_target_rejected := false;
  end;

  begin
    insert into public.artifact_relations (
      organization_id, source_artifact_id, relation_type, created_by
    ) values (
      v_org, v_artifact, 'targets_page', v_actor
    );
  exception when check_violation then
    v_zero_target_rejected := sqlstate = '23514';
  when others then
    v_zero_target_rejected := false;
  end;

  insert into public.artifact_relations (
    organization_id, source_artifact_id, target_content_request_id, relation_type, created_by
  ) values (
    v_org, v_artifact, v_request, 'targets_page', v_actor
  ) returning id into v_relation;

  select count(*) into v_comment_rows
  from public.artifact_version_comments
  where id = v_comment and content_request_id = v_request;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  select count(*) into v_visible_request_rows
  from public.content_requests
  where id = v_request;

  select count(*) into v_visible_relation_rows
  from public.artifact_relations
  where id = v_relation;

  select count(*) into v_visible_comment_rows
  from public.artifact_version_comments
  where id = v_comment;

  v_other_actor := gen_random_uuid();
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_other_actor::text, 'role', 'authenticated')::text,
    true
  );

  select count(*) into v_other_request_rows
  from public.content_requests
  where id = v_request;

  select count(*) into v_other_relation_rows
  from public.artifact_relations
  where id = v_relation;

  select count(*) into v_other_comment_rows
  from public.artifact_version_comments
  where content_request_id = v_request;

  reset role;

  insert into cp5_checks values
    ('fixture_ready', true),
    ('request_comment_visible_with_rls', v_visible_comment_rows = 1),
    ('request_relation_visible_with_rls', v_visible_relation_rows = 1),
    ('dual_targets_are_rejected', v_dual_target_rejected),
    ('zero_targets_are_rejected', v_zero_target_rejected),
    ('comment_targets_are_dual_rejected', v_comment_dual_target_rejected),
    ('comment_targets_are_zero_rejected', v_comment_zero_target_rejected),
    ('request_scope_hidden_from_unaffiliated_jwt',
      v_other_request_rows = 0 and v_other_relation_rows = 0 and v_other_comment_rows = 0
    ),
    ('content_request_comment_ignores_version_columns', v_comment_rows = 1 and v_visible_request_rows = 1);
END $$;

select check_name, passed from cp5_checks order by check_name;

do $$
BEGIN
  if exists (select 1 from cp5_checks where not passed) then
    raise exception 'One or more CP5 verification checks failed';
  end if;
END $$;

rollback;
