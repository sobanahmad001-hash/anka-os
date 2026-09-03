begin;

create temporary table qts1_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into qts1_checks (check_name, passed) values
  ('active_fixture_available', false),
  ('owner_can_read_content', false),
  ('leadership_metadata_only_access', false),
  ('wrong_owner_operations_rejected', false),
  ('cross_organization_create_rejected', false),
  ('optimistic_concurrency_rejected', false),
  ('revision_update_rejected', false),
  ('revision_delete_rejected', false),
  ('lifecycle_update_rejected', false),
  ('lifecycle_delete_rejected', false),
  ('create_append_fork_are_atomic_and_audited', false);

do $$
declare
  v_org uuid;
  v_owner uuid;
  v_leader uuid;
  v_other_org uuid := gen_random_uuid();
  v_initial public.quick_tasks;
  v_appended public.quick_tasks;
  v_fork public.quick_tasks;
  v_owner_visible boolean := false;
  v_leadership_metadata_only boolean := false;
  v_wrong_owner_append boolean := false;
  v_wrong_owner_fork boolean := false;
  v_cross_org_rejected boolean := false;
  v_stale_rejected boolean := false;
  v_revision_update_rejected boolean := false;
  v_revision_delete_rejected boolean := false;
  v_event_update_rejected boolean := false;
  v_event_delete_rejected boolean := false;
  v_revision_count_before integer;
begin
  select owner.organization_id, owner.user_id, leader.user_id
  into v_org, v_owner, v_leader
  from public.organization_memberships owner
  join public.organization_memberships leader
    on leader.organization_id = owner.organization_id
   and leader.user_id <> owner.user_id
   and leader.member_kind = 'team'
   and leader.status = 'active'
   and leader.role in ('system_owner', 'operations_admin', 'executive')
  where owner.member_kind = 'team'
    and owner.status = 'active'
  order by owner.created_at, leader.created_at
  limit 1;

  if not found then return; end if;
  update qts1_checks set passed = true where check_name = 'active_fixture_available';

  insert into public.organizations (id, name, slug)
  values (v_other_org, 'QTS1 verifier tenant', 'qts1-verifier-' || replace(v_other_org::text, '-', ''));

  select * into v_initial from public.create_quick_task(
    v_org, v_owner, 'QTS1 verifier', '{"notes":"private"}'::jsonb
  );
  select * into v_appended from public.append_quick_task_revision(
    v_initial.id, v_owner, v_initial.current_revision_id,
    'QTS1 verifier', '{"notes":"private v2"}'::jsonb
  );

  select count(*) into v_revision_count_before
  from public.quick_task_revisions where quick_task_id = v_initial.id;

  begin
    perform public.append_quick_task_revision(
      v_initial.id, v_leader, v_appended.current_revision_id,
      'wrong owner', '{"notes":"denied"}'::jsonb
    );
  exception when others then
    v_wrong_owner_append := sqlerrm like '%Owned Quick Task not found%';
  end;
  begin
    perform public.fork_quick_task(v_initial.id, v_appended.current_revision_id, v_leader, 'wrong owner fork');
  exception when others then
    v_wrong_owner_fork := sqlerrm like '%Forkable owned Quick Task not found%';
  end;
  update qts1_checks set passed = v_wrong_owner_append and v_wrong_owner_fork
    and (select count(*) = v_revision_count_before from public.quick_task_revisions where quick_task_id = v_initial.id)
  where check_name = 'wrong_owner_operations_rejected';

  begin
    perform public.create_quick_task(v_other_org, v_owner, 'cross tenant', '{}'::jsonb);
  exception when others then
    v_cross_org_rejected := sqlerrm like '%Active team membership required%';
  end;
  update qts1_checks set passed = v_cross_org_rejected
    and not exists (select 1 from public.quick_tasks where organization_id = v_other_org)
  where check_name = 'cross_organization_create_rejected';

  begin
    perform public.append_quick_task_revision(
      v_initial.id, v_owner, v_initial.current_revision_id,
      'stale write', '{"notes":"denied"}'::jsonb
    );
  exception when others then
    v_stale_rejected := sqlerrm like '%changed; reload%';
  end;
  update qts1_checks set passed = v_stale_rejected
    and (select count(*) = v_revision_count_before from public.quick_task_revisions where quick_task_id = v_initial.id)
  where check_name = 'optimistic_concurrency_rejected';

  select * into v_fork from public.fork_quick_task(
    v_initial.id, v_appended.current_revision_id, v_owner, 'QTS1 verifier fork'
  );

  begin
    update public.quick_task_revisions set content = '{}'::jsonb where id = v_appended.current_revision_id;
  exception when others then
    v_revision_update_rejected := sqlerrm like '%append-only%';
  end;
  begin
    delete from public.quick_task_revisions where id = v_appended.current_revision_id;
  exception when others then
    v_revision_delete_rejected := sqlerrm like '%append-only%';
  end;
  begin
    update public.quick_task_lifecycle_events set revision_number = null where quick_task_id = v_initial.id;
  exception when others then
    v_event_update_rejected := sqlerrm like '%append-only%';
  end;
  begin
    delete from public.quick_task_lifecycle_events where quick_task_id = v_initial.id;
  exception when others then
    v_event_delete_rejected := sqlerrm like '%append-only%';
  end;
  update qts1_checks set passed = v_revision_update_rejected where check_name = 'revision_update_rejected';
  update qts1_checks set passed = v_revision_delete_rejected where check_name = 'revision_delete_rejected';
  update qts1_checks set passed = v_event_update_rejected where check_name = 'lifecycle_update_rejected';
  update qts1_checks set passed = v_event_delete_rejected where check_name = 'lifecycle_delete_rejected';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists (select 1 from public.quick_tasks where id = v_initial.id)
    and exists (
      select 1 from public.quick_task_revisions
      where quick_task_id = v_initial.id and content ->> 'notes' = 'private v2'
    ) into v_owner_visible;
  reset role;
  update qts1_checks set passed = v_owner_visible where check_name = 'owner_can_read_content';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists (
      select 1 from public.quick_task_lifecycle_events
      where quick_task_id in (v_initial.id, v_fork.id)
    )
    and not exists (select 1 from public.quick_tasks where id in (v_initial.id, v_fork.id))
    and not exists (select 1 from public.quick_task_revisions where quick_task_id in (v_initial.id, v_fork.id))
  into v_leadership_metadata_only;
  reset role;
  update qts1_checks set passed = v_leadership_metadata_only
  where check_name = 'leadership_metadata_only_access';

  update qts1_checks set passed =
    (select count(*) = 2 from public.quick_task_revisions where quick_task_id = v_initial.id)
    and (select count(*) = 1 from public.quick_task_revisions where quick_task_id = v_fork.id)
    and exists (select 1 from public.quick_task_lifecycle_events where quick_task_id = v_initial.id and event_type = 'created' and revision_number = 1)
    and exists (select 1 from public.quick_task_lifecycle_events where quick_task_id = v_initial.id and event_type = 'revision_appended' and revision_number = 2)
    and exists (select 1 from public.quick_task_lifecycle_events where quick_task_id = v_initial.id and event_type = 'forked_to' and related_quick_task_id = v_fork.id)
    and exists (select 1 from public.quick_task_lifecycle_events where quick_task_id = v_fork.id and event_type = 'forked_from' and related_quick_task_id = v_initial.id)
    and v_fork.forked_from_quick_task_id = v_initial.id
    and v_fork.forked_from_revision_id = v_appended.current_revision_id
  where check_name = 'create_append_fork_are_atomic_and_audited';
end;
$$;

insert into qts1_checks values ('rls_enabled_on_all_tables', (
  select count(*) = 3 and bool_and(relrowsecurity)
  from pg_class where oid in (
    'public.quick_tasks'::regclass,
    'public.quick_task_revisions'::regclass,
    'public.quick_task_lifecycle_events'::regclass
  )
));

insert into qts1_checks values ('events_are_metadata_only', not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'quick_task_lifecycle_events'
    and column_name in ('content', 'title', 'body', 'payload')
));

insert into qts1_checks values ('table_acls_are_exact', (
  select bool_and(
    not has_table_privilege('anon', relation_name, 'SELECT')
    and not has_table_privilege('anon', relation_name, 'INSERT')
    and not has_table_privilege('anon', relation_name, 'UPDATE')
    and not has_table_privilege('anon', relation_name, 'DELETE')
    and not has_table_privilege('anon', relation_name, 'TRUNCATE')
    and not has_table_privilege('anon', relation_name, 'REFERENCES')
    and not has_table_privilege('anon', relation_name, 'TRIGGER')
    and has_table_privilege('authenticated', relation_name, 'SELECT')
    and not has_table_privilege('authenticated', relation_name, 'INSERT')
    and not has_table_privilege('authenticated', relation_name, 'UPDATE')
    and not has_table_privilege('authenticated', relation_name, 'DELETE')
    and not has_table_privilege('authenticated', relation_name, 'TRUNCATE')
    and not has_table_privilege('authenticated', relation_name, 'REFERENCES')
    and not has_table_privilege('authenticated', relation_name, 'TRIGGER')
    and has_table_privilege('service_role', relation_name, 'SELECT')
    and has_table_privilege('service_role', relation_name, 'INSERT')
    and has_table_privilege('service_role', relation_name, 'UPDATE')
    and has_table_privilege('service_role', relation_name, 'DELETE')
    and has_table_privilege('service_role', relation_name, 'TRUNCATE')
    and has_table_privilege('service_role', relation_name, 'REFERENCES')
    and has_table_privilege('service_role', relation_name, 'TRIGGER')
  )
  from (values
    ('public.quick_tasks'),
    ('public.quick_task_revisions'),
    ('public.quick_task_lifecycle_events')
  ) tables(relation_name)
));

insert into qts1_checks values ('rpc_execute_acls_are_exact', (
  select count(*) = 3 and bool_and(
    has_function_privilege('service_role', procedure_oid, 'EXECUTE')
    and not has_function_privilege('anon', procedure_oid, 'EXECUTE')
    and not has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
    and not exists (
      select 1 from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  )
  from (values
    ('public.create_quick_task(uuid,uuid,text,jsonb)'::regprocedure),
    ('public.append_quick_task_revision(uuid,uuid,uuid,text,jsonb)'::regprocedure),
    ('public.fork_quick_task(uuid,uuid,uuid,text)'::regprocedure)
  ) procedures(procedure_oid)
  join pg_proc proc on proc.oid = procedure_oid
));

with expected(table_oid, policy_name) as (
  values
    ('public.quick_tasks'::regclass, 'Owners can read their Quick Tasks'),
    ('public.quick_task_revisions'::regclass, 'Owners can read their Quick Task revisions')
)
insert into qts1_checks
select 'owner_content_policies_are_exact', count(policy.oid) = 2 and bool_and(coalesce(
    policy.polrelid = expected.table_oid
    and policy.polname = expected.policy_name
    and policy.polcmd = 'r'
    and policy.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
    and policy.polwithcheck is null
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%owner_id%auth.uid%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%is_team_organization_member%organization_id%'
  , false))
from expected
left join pg_policy policy
  on policy.polrelid = expected.table_oid and policy.polname = expected.policy_name;

insert into qts1_checks values ('leadership_event_policy_is_exact', (
  select count(*) = 1 and bool_and(
    policy.polcmd = 'r'
    and policy.polname = 'Owners and leaders can read Quick Task lifecycle metadata'
    and policy.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
    and policy.polwithcheck is null
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%owner_id%auth.uid%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%has_organization_role%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%system_owner%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%operations_admin%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%executive%'
  )
  from pg_policy policy
  where policy.polrelid = 'public.quick_task_lifecycle_events'::regclass
));

insert into qts1_checks values ('no_write_policies_exist', not exists (
  select 1 from pg_policy
  where polrelid in (
    'public.quick_tasks'::regclass,
    'public.quick_task_revisions'::regclass,
    'public.quick_task_lifecycle_events'::regclass
  ) and polcmd <> 'r'
));

with expected(constraint_name, child_table, parent_table, child_columns, parent_columns) as (
  values
    ('quick_tasks_current_revision_fkey', 'public.quick_tasks'::regclass, 'public.quick_task_revisions'::regclass,
      array['current_revision_id','id','organization_id','owner_id'], array['id','quick_task_id','organization_id','owner_id']),
    ('quick_tasks_forked_from_task_fkey', 'public.quick_tasks'::regclass, 'public.quick_tasks'::regclass,
      array['forked_from_quick_task_id','organization_id','owner_id'], array['id','organization_id','owner_id']),
    ('quick_tasks_forked_from_revision_fkey', 'public.quick_tasks'::regclass, 'public.quick_task_revisions'::regclass,
      array['forked_from_revision_id','forked_from_quick_task_id','organization_id','owner_id'], array['id','quick_task_id','organization_id','owner_id']),
    ('quick_task_revisions_task_fkey', 'public.quick_task_revisions'::regclass, 'public.quick_tasks'::regclass,
      array['quick_task_id','organization_id','owner_id'], array['id','organization_id','owner_id']),
    ('quick_task_lifecycle_events_task_fkey', 'public.quick_task_lifecycle_events'::regclass, 'public.quick_tasks'::regclass,
      array['quick_task_id','organization_id','owner_id'], array['id','organization_id','owner_id']),
    ('quick_task_lifecycle_events_related_task_fkey', 'public.quick_task_lifecycle_events'::regclass, 'public.quick_tasks'::regclass,
      array['related_quick_task_id','organization_id','owner_id'], array['id','organization_id','owner_id'])
), actual as (
  select constraint.oid, constraint.conname, constraint.conrelid, constraint.confrelid,
    array(select attribute.attname::text from unnest(constraint.conkey) with ordinality key(attnum, position)
      join pg_attribute attribute on attribute.attrelid = constraint.conrelid and attribute.attnum = key.attnum
      order by key.position) as child_columns,
    array(select attribute.attname::text from unnest(constraint.confkey) with ordinality key(attnum, position)
      join pg_attribute attribute on attribute.attrelid = constraint.confrelid and attribute.attnum = key.attnum
      order by key.position) as parent_columns
  from pg_constraint constraint where constraint.contype = 'f'
)
insert into qts1_checks
select 'composite_foreign_keys_are_exact', count(actual.oid) = 6 and bool_and(coalesce(
  actual.conrelid = expected.child_table
  and actual.confrelid = expected.parent_table
  and actual.child_columns = expected.child_columns
  and actual.parent_columns = expected.parent_columns
  and exists (
    select 1 from pg_index parent_index
    where parent_index.indrelid = actual.confrelid
      and parent_index.indisunique
      and parent_index.indisvalid
      and parent_index.indnkeyatts = cardinality(expected.parent_columns)
      and array(
        select attribute.attname::text
        from unnest(parent_index.indkey::smallint[]) with ordinality key(attnum, position)
        join pg_attribute attribute
          on attribute.attrelid = parent_index.indrelid and attribute.attnum = key.attnum
        where key.position <= parent_index.indnkeyatts
        order by key.position
      ) = expected.parent_columns
  ), false))
from expected left join actual on actual.conname = expected.constraint_name and actual.conrelid = expected.child_table;

with expected(index_name, child_table, columns_fragment) as (
  values
    ('idx_quick_tasks_current_revision', 'public.quick_tasks'::regclass, '(current_revision_id, id, organization_id, owner_id)'),
    ('idx_quick_tasks_fork_source', 'public.quick_tasks'::regclass, '(forked_from_quick_task_id, organization_id, owner_id)'),
    ('idx_quick_tasks_fork_revision', 'public.quick_tasks'::regclass, '(forked_from_revision_id, forked_from_quick_task_id, organization_id, owner_id)'),
    ('idx_quick_task_revisions_task_owner', 'public.quick_task_revisions'::regclass, '(quick_task_id, organization_id, owner_id)'),
    ('idx_quick_task_lifecycle_events_task_owner', 'public.quick_task_lifecycle_events'::regclass, '(quick_task_id, organization_id, owner_id)'),
    ('idx_quick_task_lifecycle_events_related', 'public.quick_task_lifecycle_events'::regclass, '(related_quick_task_id, organization_id, owner_id)')
)
insert into qts1_checks
select 'composite_fk_supporting_indexes_are_exact', count(index_relation.oid) = 6 and bool_and(
  lower(pg_get_indexdef(index_relation.oid)) like '%' || expected.columns_fragment || '%'
  and index_meta.indisvalid
  and index_meta.indrelid = expected.child_table
)
from expected
left join pg_class index_relation
  on index_relation.relname = expected.index_name
 and index_relation.relnamespace = 'public'::regnamespace
left join pg_index index_meta on index_meta.indexrelid = index_relation.oid;

insert into qts1_checks values ('retention_defaults_are_exact',
  lower(pg_get_expr((select adbin from pg_attrdef where adrelid = 'public.quick_tasks'::regclass
    and adnum = (select attnum from pg_attribute where attrelid = 'public.quick_tasks'::regclass and attname = 'expires_at')), 'public.quick_tasks'::regclass))
    like '%30 days%'
);

select jsonb_object_agg(check_name, passed order by check_name) as qts1_verification
from qts1_checks;

do $$
declare v_failed text;
begin
  select string_agg(check_name, ', ' order by check_name) into v_failed
  from qts1_checks where not passed;
  if v_failed is not null then
    raise exception 'QTS1 verification failed: %', v_failed;
  end if;
end;
$$;

rollback;
