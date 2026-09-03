begin;

create temporary table qts2_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into qts2_checks (check_name, passed) values
  ('success_is_atomic_and_audited', false),
  ('failure_is_audited_without_activity', false),
  ('owner_only_transcript_and_ai_content', false),
  ('wrong_department_rejected', false),
  ('message_update_rejected', false),
  ('message_delete_rejected', false),
  ('no_canonical_side_effects', false);

do $$
declare
  v_org uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_leader uuid := gen_random_uuid();
  v_connection uuid := gen_random_uuid();
  v_task public.quick_tasks;
  v_result jsonb;
  v_failure_run uuid;
  v_owner_visible boolean := false;
  v_leader_hidden boolean := false;
  v_wrong_department boolean := false;
  v_message_update_rejected boolean := false;
  v_message_delete_rejected boolean := false;
  v_activity timestamptz;
  v_expiry timestamptz;
  v_message_count integer;
  v_canonical_before bigint;
  v_canonical_after bigint;
begin
  insert into auth.users (id) values (v_owner), (v_leader);
  insert into public.organizations (id, name, slug) values
    (v_org, 'QTS2 verifier tenant', 'qts2-' || replace(v_org::text, '-', ''));
  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, department_id, status
  ) values
    (v_org, v_owner, 'team', 'contributor', 'content', 'active'),
    (v_org, v_leader, 'team', 'system_owner', null, 'active');
  insert into public.integration_connections (
    id, organization_id, provider, display_name, public_config, secret_name,
    status, last_check_status, created_by
  ) values (
    v_connection, v_org, 'openai', 'QTS2 verifier model',
    '{"model_id":"gpt-qts2-verifier"}'::jsonb, 'ANKA_OPENAI_QTS2_VERIFIER',
    'verified', 'passed', v_owner
  );
  insert into public.integration_connection_departments (
    connection_id, organization_id, department_id, created_by
  ) values (v_connection, v_org, 'content', v_owner);

  select coalesce((select count(*) from public.projects), 0)
    + coalesce((select count(*) from public.engagements), 0)
    + coalesce((select count(*) from public.tasks), 0)
    + coalesce((select count(*) from public.work_items), 0)
    + coalesce((select count(*) from public.artifacts), 0)
    + coalesce((select count(*) from public.content_requests), 0)
  into v_canonical_before;

  select * into v_task from public.create_quick_task(
    v_org, v_owner, 'QTS2 verifier', '{"notes":"private","checklist":[]}'::jsonb
  );
  select public.record_quick_task_chat_success(
    v_task.id, v_task.current_revision_id, v_owner, 'content', v_connection,
    'gpt-qts2-verifier', 'Refine this private note.',
    '{"notes":"private refined","checklist":[{"text":"Review","done":false}]}',
    '{"notes":"private refined","checklist":[{"text":"Review","done":false}]}'::jsonb,
    12, 8, 20, 25
  ) into v_result;

  update qts2_checks set passed =
    (v_result ->> 'ai_run_id')::uuid is not null
    and (v_result #>> '{task,current_revision_number}')::integer = 2
    and (v_result #>> '{revision,source_kind}') = 'quick_chat'
    and exists (
      select 1 from public.ai_runs run
      where run.id = (v_result ->> 'ai_run_id')::uuid
        and run.organization_id = v_org and run.user_id = v_owner
        and run.capability = 'quick_task_chat' and run.status = 'completed'
        and run.project_id is null and run.engagement_id is null
        and run.quick_task_id = v_task.id and run.quick_task_revision_id = v_task.current_revision_id
        and run.department_id = 'content' and run.connector_connection_id = v_connection
        and run.context_manifest ->> 'upstream_retention' = 'disabled'
    )
    and (select count(*) = 2 from public.quick_task_messages
      where quick_task_id = v_task.id and ai_run_id = (v_result ->> 'ai_run_id')::uuid)
    and exists (select 1 from public.quick_task_revisions
      where id = (v_result #>> '{revision,id}')::uuid and quick_task_id = v_task.id
        and source_kind = 'quick_chat' and ai_run_id = (v_result ->> 'ai_run_id')::uuid)
  where check_name = 'success_is_atomic_and_audited';

  select last_activity_at, expires_at into v_activity, v_expiry
  from public.quick_tasks where id = v_task.id;
  select count(*) into v_message_count from public.quick_task_messages where quick_task_id = v_task.id;
  select public.record_quick_task_chat_failure(
    v_task.id, (v_result #>> '{revision,id}')::uuid, v_owner, 'content', v_connection,
    'gpt-qts2-verifier', 'This provider call fails.', 'failed', 'synthetic failure', 10
  ) into v_failure_run;
  update qts2_checks set passed =
    exists (select 1 from public.ai_runs where id = v_failure_run
      and capability = 'quick_task_chat' and status = 'failed'
      and input_text = 'This provider call fails.' and output_text = '')
    and (select last_activity_at = v_activity and expires_at = v_expiry
      from public.quick_tasks where id = v_task.id)
    and (select count(*) = v_message_count from public.quick_task_messages where quick_task_id = v_task.id)
  where check_name = 'failure_is_audited_without_activity';

  begin
    perform public.record_quick_task_chat_failure(
      v_task.id, (v_result #>> '{revision,id}')::uuid, v_owner, 'design', v_connection,
      'gpt-qts2-verifier', 'Wrong department.', 'blocked', 'denied', 1
    );
  exception when others then
    v_wrong_department := sqlerrm like '%department membership%';
  end;
  update qts2_checks set passed = v_wrong_department where check_name = 'wrong_department_rejected';

  begin
    update public.quick_task_messages set body = 'mutated' where quick_task_id = v_task.id;
  exception when others then
    v_message_update_rejected := sqlerrm like '%append-only%';
  end;
  begin
    delete from public.quick_task_messages where quick_task_id = v_task.id;
  exception when others then
    v_message_delete_rejected := sqlerrm like '%append-only%';
  end;
  update qts2_checks set passed = v_message_update_rejected where check_name = 'message_update_rejected';
  update qts2_checks set passed = v_message_delete_rejected where check_name = 'message_delete_rejected';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select (select count(*) = 2 from public.quick_task_messages where quick_task_id = v_task.id)
    and (select count(*) = 2 from public.ai_runs where quick_task_id = v_task.id)
  into v_owner_visible;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select not exists (select 1 from public.quick_task_messages where quick_task_id = v_task.id)
    and not exists (select 1 from public.ai_runs where quick_task_id = v_task.id)
  into v_leader_hidden;
  reset role;
  update qts2_checks set passed = v_owner_visible and v_leader_hidden
  where check_name = 'owner_only_transcript_and_ai_content';

  select coalesce((select count(*) from public.projects), 0)
    + coalesce((select count(*) from public.engagements), 0)
    + coalesce((select count(*) from public.tasks), 0)
    + coalesce((select count(*) from public.work_items), 0)
    + coalesce((select count(*) from public.artifacts), 0)
    + coalesce((select count(*) from public.content_requests), 0)
  into v_canonical_after;
  update qts2_checks set passed = v_canonical_after = v_canonical_before
  where check_name = 'no_canonical_side_effects';
end;
$$;

insert into qts2_checks values ('message_rls_enabled', (
  select relrowsecurity from pg_class where oid = 'public.quick_task_messages'::regclass
));

insert into qts2_checks values ('message_policy_is_owner_only', (
  select count(*) = 1 and bool_and(
    policy.polcmd = 'r'
    and policy.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
    and policy.polwithcheck is null
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%owner_id%auth.uid%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%is_team_organization_member%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) not like '%has_organization_role%'
  ) from pg_policy policy
  where policy.polrelid = 'public.quick_task_messages'::regclass
));

insert into qts2_checks values ('leader_ai_policy_excludes_qts', (
  select count(*) = 1 and bool_and(
    lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%capability%quick_task_chat%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%<>%'
  ) from pg_policy policy
  where policy.polrelid = 'public.ai_runs'::regclass
    and policy.polname = 'Leaders can audit organization AI runs'
));

insert into qts2_checks values ('message_table_acls_are_exact',
  not has_table_privilege('anon', 'public.quick_task_messages', 'SELECT')
  and not has_table_privilege('authenticated', 'public.quick_task_messages', 'INSERT')
  and not has_table_privilege('authenticated', 'public.quick_task_messages', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.quick_task_messages', 'DELETE')
  and has_table_privilege('authenticated', 'public.quick_task_messages', 'SELECT')
  and has_table_privilege('service_role', 'public.quick_task_messages', 'SELECT')
  and has_table_privilege('service_role', 'public.quick_task_messages', 'INSERT')
);

insert into qts2_checks values ('rpc_execute_acls_are_exact', (
  select count(*) = 2 and bool_and(
    has_function_privilege('service_role', procedure_oid, 'EXECUTE')
    and not has_function_privilege('anon', procedure_oid, 'EXECUTE')
    and not has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
    and not exists (
      select 1 from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  )
  from (values
    ('public.record_quick_task_chat_success(uuid,uuid,uuid,text,uuid,text,text,text,jsonb,integer,integer,bigint,integer)'::regprocedure),
    ('public.record_quick_task_chat_failure(uuid,uuid,uuid,text,uuid,text,text,text,text,integer)'::regprocedure)
  ) procedures(procedure_oid)
  join pg_proc proc on proc.oid = procedure_oid
));

with expected(constraint_name, child_table, parent_table, child_columns, parent_columns) as (
  values
    ('ai_runs_quick_task_fkey', 'public.ai_runs'::regclass, 'public.quick_tasks'::regclass,
      array['quick_task_id','organization_id','user_id'], array['id','organization_id','owner_id']),
    ('ai_runs_quick_task_revision_fkey', 'public.ai_runs'::regclass, 'public.quick_task_revisions'::regclass,
      array['quick_task_revision_id','quick_task_id','organization_id','user_id'], array['id','quick_task_id','organization_id','owner_id']),
    ('ai_runs_connector_fkey', 'public.ai_runs'::regclass, 'public.integration_connections'::regclass,
      array['connector_connection_id','organization_id'], array['id','organization_id']),
    ('quick_task_revisions_ai_run_fkey', 'public.quick_task_revisions'::regclass, 'public.ai_runs'::regclass,
      array['ai_run_id','organization_id','owner_id'], array['id','organization_id','user_id']),
    ('quick_task_messages_task_fkey', 'public.quick_task_messages'::regclass, 'public.quick_tasks'::regclass,
      array['quick_task_id','organization_id','owner_id'], array['id','organization_id','owner_id']),
    ('quick_task_messages_revision_fkey', 'public.quick_task_messages'::regclass, 'public.quick_task_revisions'::regclass,
      array['quick_task_revision_id','quick_task_id','organization_id','owner_id'], array['id','quick_task_id','organization_id','owner_id']),
    ('quick_task_messages_ai_run_fkey', 'public.quick_task_messages'::regclass, 'public.ai_runs'::regclass,
      array['ai_run_id','organization_id','owner_id'], array['id','organization_id','user_id'])
), actual as (
  select relationship.oid, relationship.conname, relationship.conrelid, relationship.confrelid,
    array(select attribute.attname::text from unnest(relationship.conkey) with ordinality key(attnum, position)
      join pg_attribute attribute on attribute.attrelid = relationship.conrelid and attribute.attnum = key.attnum
      order by key.position) as child_columns,
    array(select attribute.attname::text from unnest(relationship.confkey) with ordinality key(attnum, position)
      join pg_attribute attribute on attribute.attrelid = relationship.confrelid and attribute.attnum = key.attnum
      order by key.position) as parent_columns
  from pg_constraint relationship where relationship.contype = 'f'
)
insert into qts2_checks
select 'qts_foreign_keys_are_tenant_exact', count(actual.oid) = 7 and bool_and(coalesce(
  actual.conrelid = expected.child_table and actual.confrelid = expected.parent_table
  and actual.child_columns = expected.child_columns and actual.parent_columns = expected.parent_columns,
  false
))
from expected left join actual
  on actual.conname = expected.constraint_name and actual.conrelid = expected.child_table;

with expected(index_name, child_table, key_columns) as (
  values
    ('idx_ai_runs_quick_task_fk', 'public.ai_runs'::regclass, array['quick_task_id','organization_id','user_id']),
    ('idx_ai_runs_quick_task_revision_fk', 'public.ai_runs'::regclass, array['quick_task_revision_id','quick_task_id','organization_id','user_id']),
    ('idx_ai_runs_connector_fk', 'public.ai_runs'::regclass, array['connector_connection_id','organization_id']),
    ('idx_quick_task_revisions_ai_run_fk', 'public.quick_task_revisions'::regclass, array['ai_run_id','organization_id','owner_id']),
    ('idx_quick_task_messages_task_owner_created', 'public.quick_task_messages'::regclass, array['quick_task_id','organization_id','owner_id']),
    ('idx_quick_task_messages_revision_fk', 'public.quick_task_messages'::regclass, array['quick_task_revision_id','quick_task_id','organization_id','owner_id']),
    ('idx_quick_task_messages_ai_run_fk', 'public.quick_task_messages'::regclass, array['ai_run_id','organization_id','owner_id'])
)
insert into qts2_checks
select 'qts_fk_indexes_exist', count(index_relation.oid) = 7 and bool_and(coalesce(
  index_meta.indrelid = expected.child_table and index_meta.indisvalid
  and array(
    select attribute.attname::text
    from unnest(index_meta.indkey::smallint[]) with ordinality key(attnum, position)
    join pg_attribute attribute on attribute.attrelid = index_meta.indrelid and attribute.attnum = key.attnum
    where key.position <= cardinality(expected.key_columns)
    order by key.position
  ) = expected.key_columns,
  false
))
from expected
left join pg_class index_relation on index_relation.relname = expected.index_name
  and index_relation.relnamespace = 'public'::regnamespace
left join pg_index index_meta on index_meta.indexrelid = index_relation.oid;

insert into qts2_checks values ('messages_are_append_only', exists (
  select 1 from pg_trigger trigger_record
  where trigger_record.tgrelid = 'public.quick_task_messages'::regclass
    and trigger_record.tgname = 'trg_quick_task_messages_append_only'
    and not trigger_record.tgisinternal
));

insert into qts2_checks values ('ai_capability_and_context_are_explicit',
  exists (select 1 from pg_constraint where conrelid = 'public.ai_runs'::regclass
    and conname = 'ai_runs_capability_check' and pg_get_constraintdef(oid) like '%quick_task_chat%')
  and exists (select 1 from pg_constraint where conrelid = 'public.ai_runs'::regclass
    and conname = 'ai_runs_quick_task_context_check' and pg_get_constraintdef(oid) like '%connector_connection_id%')
);

insert into qts2_checks values ('no_message_write_policies', not exists (
  select 1 from pg_policy where polrelid = 'public.quick_task_messages'::regclass and polcmd <> 'r'
));

select jsonb_object_agg(check_name, passed order by check_name) as qts2_verification
from qts2_checks;

do $$
declare v_failed text;
begin
  select string_agg(check_name, ', ' order by check_name) into v_failed from qts2_checks where not passed;
  if v_failed is not null then raise exception 'QTS2 verification failed: %', v_failed; end if;
end;
$$;

rollback;
