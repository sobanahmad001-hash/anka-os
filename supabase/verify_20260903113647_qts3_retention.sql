begin;

create temporary table qts3_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into qts3_checks (check_name, passed) values
  ('preserve_unpreserve_are_idempotent', false),
  ('discard_restore_are_idempotent', false),
  ('reads_do_not_extend_expiry', false),
  ('failed_lifecycle_does_not_extend_expiry', false),
  ('failed_ai_does_not_extend_expiry', false),
  ('only_due_active_rows_expire', false),
  ('preserved_and_promoted_never_expire', false),
  ('expiry_batch_is_bounded_and_idempotent', false),
  ('restore_after_window_rejected', false),
  ('purge_before_window_rejected', false),
  ('purge_removes_all_payload_and_redacts_ai', false),
  ('purge_retains_content_free_tombstone', false),
  ('purge_is_idempotent', false),
  ('purge_batch_is_bounded_and_idempotent', false),
  ('promoted_rows_never_purge', false),
  ('wrong_owner_and_cross_tenant_rejected', false),
  ('history_is_append_only_outside_controlled_purge', false),
  ('leadership_visibility_remains_metadata_only', false),
  ('no_canonical_side_effects', false);

do $$
declare
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_peer uuid := gen_random_uuid();
  v_leader uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_connection uuid := gen_random_uuid();
  v_cycle public.quick_tasks;
  v_preserved public.quick_tasks;
  v_promoted public.quick_tasks;
  v_owner_expire public.quick_tasks;
  v_batch_one public.quick_tasks;
  v_batch_two public.quick_tasks;
  v_closed public.quick_tasks;
  v_purge public.quick_tasks;
  v_other_task public.quick_tasks;
  v_chat jsonb;
  v_batch jsonb;
  v_activity timestamptz;
  v_expiry timestamptz;
  v_recovery timestamptz;
  v_purged_at timestamptz;
  v_checksum text;
  v_failure_run uuid;
  v_read_ok boolean := false;
  v_failed_call boolean := false;
  v_restore_failed boolean := false;
  v_early_purge_failed boolean := false;
  v_promoted_purge_failed boolean := false;
  v_wrong_owner_failed boolean := false;
  v_cross_tenant_failed boolean := false;
  v_revision_update_failed boolean := false;
  v_revision_delete_failed boolean := false;
  v_message_update_failed boolean := false;
  v_message_delete_failed boolean := false;
  v_leader_metadata boolean := false;
  v_owner_tombstone boolean := false;
  v_canonical_before bigint;
  v_canonical_after bigint;
begin
  insert into auth.users (id) values
    (v_owner), (v_peer), (v_leader), (v_other_owner);
  insert into public.organizations (id, name, slug) values
    (v_org, 'QTS3 verifier tenant', 'qts3-' || replace(v_org::text, '-', '')),
    (v_other_org, 'QTS3 other tenant', 'qts3-other-' || replace(v_other_org::text, '-', ''));
  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, department_id, status
  ) values
    (v_org, v_owner, 'team', 'contributor', 'content', 'active'),
    (v_org, v_peer, 'team', 'contributor', 'content', 'active'),
    (v_org, v_leader, 'team', 'system_owner', null, 'active'),
    (v_other_org, v_other_owner, 'team', 'contributor', 'content', 'active');
  insert into public.integration_connections (
    id, organization_id, provider, display_name, public_config, secret_name,
    status, last_check_status, created_by
  ) values (
    v_connection, v_org, 'openai', 'QTS3 verifier model',
    '{"model_id":"gpt-qts3-verifier"}'::jsonb, 'ANKA_OPENAI_QTS3_VERIFIER',
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

  select * into v_cycle from public.create_quick_task(
    v_org, v_owner, 'Lifecycle cycle', '{"notes":"cycle","checklist":[]}'::jsonb
  );
  select last_activity_at, expires_at into v_activity, v_expiry
  from public.quick_tasks where id = v_cycle.id;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  perform id, title from public.quick_tasks where id = v_cycle.id;
  perform content from public.quick_task_revisions where id = v_cycle.current_revision_id;
  reset role;
  select last_activity_at = v_activity and expires_at = v_expiry
  into v_read_ok from public.quick_tasks where id = v_cycle.id;
  update qts3_checks set passed = v_read_ok where check_name = 'reads_do_not_extend_expiry';

  perform public.preserve_quick_task(v_cycle.id, v_owner);
  perform public.preserve_quick_task(v_cycle.id, v_owner);
  update public.quick_tasks set last_activity_at = now() - interval '1 day'
  where id = v_cycle.id;
  perform public.unpreserve_quick_task(v_cycle.id, v_owner);
  perform public.unpreserve_quick_task(v_cycle.id, v_owner);
  update qts3_checks set passed =
    (select state = 'active' and expires_at = last_activity_at + interval '30 days'
      and preserved_at is null and recoverable_until is null
      from public.quick_tasks where id = v_cycle.id)
    and (select count(*) = 1 from public.quick_task_lifecycle_events
      where quick_task_id = v_cycle.id and event_type = 'preserved')
    and (select count(*) = 1 from public.quick_task_lifecycle_events
      where quick_task_id = v_cycle.id and event_type = 'unpreserved')
  where check_name = 'preserve_unpreserve_are_idempotent';

  perform public.discard_quick_task(v_cycle.id, v_owner);
  select recoverable_until into v_recovery from public.quick_tasks where id = v_cycle.id;
  perform public.discard_quick_task(v_cycle.id, v_owner);
  perform public.restore_quick_task(v_cycle.id, v_owner);
  perform public.restore_quick_task(v_cycle.id, v_owner);
  update qts3_checks set passed =
    (select state = 'active' and expires_at = last_activity_at + interval '30 days'
      and recoverable_until is null and discarded_at is null
      from public.quick_tasks where id = v_cycle.id)
    and v_recovery is not null
    and (select count(*) = 1 from public.quick_task_lifecycle_events
      where quick_task_id = v_cycle.id and event_type = 'discarded')
    and (select count(*) = 1 from public.quick_task_lifecycle_events
      where quick_task_id = v_cycle.id and event_type = 'restored')
  where check_name = 'discard_restore_are_idempotent';

  select last_activity_at, expires_at into v_activity, v_expiry
  from public.quick_tasks where id = v_cycle.id;
  begin
    perform public.expire_quick_task(v_cycle.id, v_owner);
  exception when others then
    v_failed_call := sqlerrm like '%not due%';
  end;
  update qts3_checks set passed = v_failed_call
    and (select last_activity_at = v_activity and expires_at = v_expiry
      from public.quick_tasks where id = v_cycle.id)
  where check_name = 'failed_lifecycle_does_not_extend_expiry';

  select public.record_quick_task_chat_failure(
    v_cycle.id, v_cycle.current_revision_id, v_owner, 'content', v_connection,
    'gpt-qts3-verifier', 'Failed AI must not extend.', 'failed', 'synthetic', 1
  ) into strict v_failure_run;
  update qts3_checks set passed =
    (select last_activity_at = v_activity and expires_at = v_expiry
      from public.quick_tasks where id = v_cycle.id)
  where check_name = 'failed_ai_does_not_extend_expiry';

  begin perform public.preserve_quick_task(v_cycle.id, v_peer);
  exception when others then v_wrong_owner_failed := sqlerrm like '%Owned Quick Task%'; end;
  begin perform public.preserve_quick_task(v_cycle.id, v_other_owner);
  exception when others then v_cross_tenant_failed := sqlerrm like '%Owned Quick Task%'; end;
  update qts3_checks set passed = v_wrong_owner_failed and v_cross_tenant_failed
  where check_name = 'wrong_owner_and_cross_tenant_rejected';

  select * into v_preserved from public.create_quick_task(
    v_org, v_owner, 'Preserved', '{"notes":"keep","checklist":[]}'::jsonb
  );
  perform public.preserve_quick_task(v_preserved.id, v_owner);

  select * into v_promoted from public.create_quick_task(
    v_org, v_owner, 'Promoted fixture', '{"notes":"provenance","checklist":[]}'::jsonb
  );
  update public.quick_tasks set
    state = 'promoted', promoted_at = now(), expires_at = null
  where id = v_promoted.id;

  select * into v_owner_expire from public.create_quick_task(
    v_org, v_owner, 'Owner expiry', '{"notes":"due","checklist":[]}'::jsonb
  );
  update public.quick_tasks set
    last_activity_at = now() - interval '31 days',
    expires_at = now() - interval '1 day'
  where id = v_owner_expire.id;
  perform public.expire_quick_task(v_owner_expire.id, v_owner);
  perform public.expire_quick_task(v_owner_expire.id, v_owner);
  update qts3_checks set passed =
    (select state = 'expired' and recoverable_until = expired_at + interval '30 days'
      from public.quick_tasks where id = v_owner_expire.id)
    and (select count(*) = 1 from public.quick_task_lifecycle_events
      where quick_task_id = v_owner_expire.id and event_type = 'expired')
  where check_name = 'only_due_active_rows_expire';

  select * into v_batch_one from public.create_quick_task(
    v_org, v_owner, 'Batch one', '{"notes":"one","checklist":[]}'::jsonb
  );
  select * into v_batch_two from public.create_quick_task(
    v_org, v_owner, 'Batch two', '{"notes":"two","checklist":[]}'::jsonb
  );
  update public.quick_tasks set
    last_activity_at = now() - interval '31 days',
    expires_at = now() - interval '1 day'
  where id in (v_batch_one.id, v_batch_two.id);
  select public.expire_due_quick_tasks(1) into v_batch;
  update qts3_checks set passed = (v_batch ->> 'processed')::integer = 1
  where check_name = 'expiry_batch_is_bounded_and_idempotent';
  select public.expire_due_quick_tasks(1) into v_batch;
  update qts3_checks set passed = passed and (v_batch ->> 'processed')::integer = 1
  where check_name = 'expiry_batch_is_bounded_and_idempotent';
  select public.expire_due_quick_tasks(1) into v_batch;
  update qts3_checks set passed = passed and (v_batch ->> 'processed')::integer = 0
  where check_name = 'expiry_batch_is_bounded_and_idempotent';

  perform public.expire_due_quick_tasks(100);
  update qts3_checks set passed =
    (select state = 'preserved' and expires_at is null and purged_at is null
      from public.quick_tasks where id = v_preserved.id)
    and (select state = 'promoted' and promoted_at is not null and purged_at is null
      from public.quick_tasks where id = v_promoted.id)
  where check_name = 'preserved_and_promoted_never_expire';

  select * into v_closed from public.create_quick_task(
    v_org, v_owner, 'Closed recovery', '{"notes":"closed","checklist":[]}'::jsonb
  );
  perform public.discard_quick_task(v_closed.id, v_owner);
  update public.quick_tasks set
    discarded_at = now() - interval '31 days',
    recoverable_until = now() - interval '1 day'
  where id = v_closed.id;
  begin perform public.restore_quick_task(v_closed.id, v_owner);
  exception when others then v_restore_failed := sqlerrm like '%window has closed%'; end;
  update qts3_checks set passed = v_restore_failed
    and (select state = 'discarded' and recoverable_until < now()
      from public.quick_tasks where id = v_closed.id)
  where check_name = 'restore_after_window_rejected';
  perform public.purge_quick_task(v_closed.id, v_owner);

  perform public.discard_quick_task(v_cycle.id, v_owner);
  begin perform public.purge_quick_task(v_cycle.id, v_owner);
  exception when others then v_early_purge_failed := sqlerrm like '%still open%'; end;
  update qts3_checks set passed = v_early_purge_failed
    and (select purged_at is null and current_revision_id is not null
      from public.quick_tasks where id = v_cycle.id)
  where check_name = 'purge_before_window_rejected';

  select * into v_purge from public.create_quick_task(
    v_org, v_owner, 'Secret title', '{"notes":"secret original","checklist":[]}'::jsonb
  );
  select public.record_quick_task_chat_success(
    v_purge.id, v_purge.current_revision_id, v_owner, 'content', v_connection,
    'gpt-qts3-verifier', 'secret prompt', 'secret output',
    '{"notes":"secret generated","checklist":[]}'::jsonb,
    2, 3, 5, 10
  ) into v_chat;
  select * into v_purge from public.quick_tasks where id = v_purge.id;
  perform public.record_quick_task_chat_failure(
    v_purge.id, v_purge.current_revision_id, v_owner, 'content', v_connection,
    'gpt-qts3-verifier', 'secret failed prompt', 'failed', 'synthetic', 1
  );

  begin update public.quick_task_revisions set content = '{}' where quick_task_id = v_purge.id;
  exception when others then v_revision_update_failed := sqlerrm like '%append-only%'; end;
  begin delete from public.quick_task_revisions where quick_task_id = v_purge.id;
  exception when others then v_revision_delete_failed := sqlerrm like '%append-only%'; end;
  begin update public.quick_task_messages set body = 'changed' where quick_task_id = v_purge.id;
  exception when others then v_message_update_failed := sqlerrm like '%append-only%'; end;
  begin delete from public.quick_task_messages where quick_task_id = v_purge.id;
  exception when others then v_message_delete_failed := sqlerrm like '%append-only%'; end;
  update qts3_checks set passed =
    v_revision_update_failed and v_revision_delete_failed
    and v_message_update_failed and v_message_delete_failed
  where check_name = 'history_is_append_only_outside_controlled_purge';

  select content_sha256 into v_checksum from public.quick_task_revisions
  where id = v_purge.current_revision_id;
  perform public.discard_quick_task(v_purge.id, v_owner);
  update public.quick_tasks set
    discarded_at = now() - interval '31 days',
    recoverable_until = now() - interval '1 day'
  where id = v_purge.id;
  select (public.purge_quick_task(v_purge.id, v_owner)).purged_at into v_purged_at;

  update qts3_checks set passed =
    not exists (select 1 from public.quick_task_revisions where quick_task_id = v_purge.id)
    and not exists (select 1 from public.quick_task_messages where quick_task_id = v_purge.id)
    and (select count(*) = 2 and bool_and(
      input_text = '' and output_text = '' and redacted_at is not null
      and quick_task_revision_id is null
      and context_manifest = '{"purpose":"quick_task_sandbox_revision","redacted":true,"upstream_retention":"disabled"}'::jsonb
    ) from public.ai_runs where quick_task_id = v_purge.id)
  where check_name = 'purge_removes_all_payload_and_redacts_ai';

  update qts3_checks set passed =
    (select title = '[purged]' and current_revision_id is null
      and purged_at is not null and final_content_sha256 = v_checksum
      and purge_reason = 'owner_due_purge'
      from public.quick_tasks where id = v_purge.id)
    and exists (
      select 1 from public.quick_task_lifecycle_events
      where quick_task_id = v_purge.id and event_type = 'purged'
        and actor_kind = 'owner' and actor_id = v_owner
        and reason = 'owner_due_purge'
    )
  where check_name = 'purge_retains_content_free_tombstone';

  perform public.purge_quick_task(v_purge.id, v_owner);
  update qts3_checks set passed =
    (select purged_at = v_purged_at from public.quick_tasks where id = v_purge.id)
    and (select count(*) = 1 from public.quick_task_lifecycle_events
      where quick_task_id = v_purge.id and event_type = 'purged')
  where check_name = 'purge_is_idempotent';

  update public.quick_tasks set
    expired_at = now() - interval '31 days',
    recoverable_until = now() - interval '1 day'
  where id in (v_batch_one.id, v_batch_two.id);
  select public.purge_due_quick_tasks(1) into v_batch;
  update qts3_checks set passed = (v_batch ->> 'processed')::integer = 1
  where check_name = 'purge_batch_is_bounded_and_idempotent';
  select public.purge_due_quick_tasks(1) into v_batch;
  update qts3_checks set passed = passed and (v_batch ->> 'processed')::integer = 1
  where check_name = 'purge_batch_is_bounded_and_idempotent';
  select public.purge_due_quick_tasks(1) into v_batch;
  update qts3_checks set passed = passed and (v_batch ->> 'processed')::integer = 0
    and (select count(*) = 2 from public.quick_tasks
      where id in (v_batch_one.id, v_batch_two.id) and purged_at is not null)
  where check_name = 'purge_batch_is_bounded_and_idempotent';

  begin perform public.purge_quick_task(v_promoted.id, v_owner);
  exception when others then v_promoted_purge_failed := sqlerrm like '%never purged%'; end;
  perform public.purge_due_quick_tasks(100);
  update qts3_checks set passed = v_promoted_purge_failed
    and (select state = 'promoted' and purged_at is null and current_revision_id is not null
      from public.quick_tasks where id = v_promoted.id)
  where check_name = 'promoted_rows_never_purge';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_leader, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select exists (
    select 1 from public.quick_task_lifecycle_events
    where organization_id = v_org and quick_task_id = v_purge.id
  ) and not exists (
    select 1 from public.quick_tasks where organization_id = v_org
  ) and not exists (
    select 1 from public.quick_task_revisions where organization_id = v_org
  ) and not exists (
    select 1 from public.quick_task_messages where organization_id = v_org
  ) into v_leader_metadata;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select exists (
    select 1 from public.quick_tasks where id = v_purge.id
      and title = '[purged]' and final_content_sha256 = v_checksum
  ) and not exists (
    select 1 from public.ai_runs where quick_task_id = v_purge.id
  ) into v_owner_tombstone;
  reset role;
  update qts3_checks set passed = v_leader_metadata and v_owner_tombstone
  where check_name = 'leadership_visibility_remains_metadata_only';

  select * into v_other_task from public.create_quick_task(
    v_other_org, v_other_owner, 'Other tenant', '{"notes":"isolated","checklist":[]}'::jsonb
  );
  if v_other_task.organization_id <> v_other_org then
    raise exception 'Cross-tenant fixture failed.';
  end if;

  select coalesce((select count(*) from public.projects), 0)
    + coalesce((select count(*) from public.engagements), 0)
    + coalesce((select count(*) from public.tasks), 0)
    + coalesce((select count(*) from public.work_items), 0)
    + coalesce((select count(*) from public.artifacts), 0)
    + coalesce((select count(*) from public.content_requests), 0)
  into v_canonical_after;
  update qts3_checks set passed = v_canonical_after = v_canonical_before
  where check_name = 'no_canonical_side_effects';
end;
$$;

with expected(constraint_name, required_parts) as (
  values
    ('quick_tasks_expiry_shape_check', array[
      'state = ''active''', 'expires_at is not null', 'expires_at >= last_activity_at',
      'recoverable_until is null', 'state <> ''active''', 'expires_at is null'
    ]),
    ('quick_tasks_preserved_shape_check', array['state = ''preserved''', 'preserved_at is not null']),
    ('quick_tasks_discarded_shape_check', array['state = ''discarded''', 'discarded_at is not null']),
    ('quick_tasks_expired_shape_check', array['state = ''expired''', 'expired_at is not null']),
    ('quick_tasks_recovery_shape_check', array[
      'state = any', 'expired', 'discarded', 'recoverable_until is not null',
      'recoverable_until >= coalesce(expired_at, discarded_at)', 'recoverable_until is null'
    ]),
    ('quick_tasks_purge_shape_check', array[
      'purged_at is null', 'current_revision_id is not null', 'purge_reason is null',
      'final_content_sha256 is null', 'purged_at is not null', 'state = any',
      'expired', 'discarded', 'current_revision_id is null', 'title = ''[purged]''',
      'purge_reason is not null', 'final_content_sha256 is not null', '^[0-9a-f]{64}$'
    ])
), actual as (
  select conname as constraint_name, lower(pg_get_constraintdef(oid)) as definition
  from pg_constraint
  where conrelid = 'public.quick_tasks'::regclass
    and conname like 'quick_tasks_%_shape_check'
)
insert into qts3_checks
select 'lifecycle_constraints_are_exact', (select count(*) = 6 from actual)
  and count(actual.constraint_name) = 6 and bool_and(
  coalesce((
    select bool_and(actual.definition like '%' || required_part || '%')
    from unnest(expected.required_parts) required_part
  ), false)
)
from expected left join actual using (constraint_name);

insert into qts3_checks values ('lifecycle_audit_is_content_free',
  not exists (
    select 1 from pg_attribute
    where attrelid = 'public.quick_task_lifecycle_events'::regclass
      and not attisdropped and attname in ('title', 'content', 'body', 'input_text', 'output_text')
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.quick_task_lifecycle_events'::regclass
      and conname = 'quick_task_lifecycle_events_actor_shape_check'
  )
);

insert into qts3_checks values ('owner_content_rls_remains_exact', (
  select count(*) = 3 and bool_and(
    policy.polcmd = 'r'
    and policy.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
    and policy.polwithcheck is null
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%owner_id%auth.uid%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%is_team_organization_member%'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) not like '%has_organization_role%'
  )
  from pg_policy policy
  where policy.polrelid in (
    'public.quick_tasks'::regclass,
    'public.quick_task_revisions'::regclass,
    'public.quick_task_messages'::regclass
  )
));

insert into qts3_checks values ('leadership_event_policy_remains_metadata_only', (
  select count(*) = 1 and bool_and(
    policy.polcmd = 'r'
    and lower(pg_get_expr(policy.polqual, policy.polrelid)) like '%has_organization_role%'
  )
  from pg_policy policy
  where policy.polrelid = 'public.quick_task_lifecycle_events'::regclass
));

with scoped(table_oid) as (
  values
    ('public.quick_tasks'::regclass),
    ('public.quick_task_revisions'::regclass),
    ('public.quick_task_messages'::regclass),
    ('public.quick_task_lifecycle_events'::regclass)
), direct_grants as (
  select scoped.table_oid, acl.grantee, acl.privilege_type
  from scoped
  join pg_class relation on relation.oid = scoped.table_oid
  cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
)
insert into qts3_checks
select 'table_acls_remain_read_only', count(*) = 4 and bool_and(
  not exists (select 1 from direct_grants grant_row
    where grant_row.table_oid = scoped.table_oid and grant_row.grantee = 0)
  and not exists (select 1 from direct_grants grant_row
    where grant_row.table_oid = scoped.table_oid
      and grant_row.grantee = (select oid from pg_roles where rolname = 'anon'))
  and coalesce((select array_agg(distinct grant_row.privilege_type order by grant_row.privilege_type)
    from direct_grants grant_row where grant_row.table_oid = scoped.table_oid
      and grant_row.grantee = (select oid from pg_roles where rolname = 'authenticated')), '{}'::text[])
    = array['SELECT']
  and coalesce((select array_agg(distinct grant_row.privilege_type order by grant_row.privilege_type)
    from direct_grants grant_row where grant_row.table_oid = scoped.table_oid
      and grant_row.grantee = (select oid from pg_roles where rolname = 'service_role')), '{}'::text[])
    = array['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']
)
from scoped;

insert into qts3_checks values ('lifecycle_rpc_acls_are_exact', (
  select count(*) = 8 and bool_and(
    has_function_privilege('service_role', procedure_oid, 'EXECUTE')
    and not has_function_privilege('anon', procedure_oid, 'EXECUTE')
    and not has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
    and not exists (
      select 1 from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  )
  from (values
    ('public.preserve_quick_task(uuid,uuid)'::regprocedure),
    ('public.unpreserve_quick_task(uuid,uuid)'::regprocedure),
    ('public.discard_quick_task(uuid,uuid)'::regprocedure),
    ('public.restore_quick_task(uuid,uuid)'::regprocedure),
    ('public.expire_quick_task(uuid,uuid)'::regprocedure),
    ('public.purge_quick_task(uuid,uuid)'::regprocedure),
    ('public.expire_due_quick_tasks(integer)'::regprocedure),
    ('public.purge_due_quick_tasks(integer)'::regprocedure)
  ) procedures(procedure_oid)
  join pg_proc proc on proc.oid = procedure_oid
));

insert into qts3_checks values ('lifecycle_helper_acls_are_exact', (
  select count(*) = 4 and bool_and(
    has_function_privilege('service_role', procedure_oid, 'EXECUTE')
    and not has_function_privilege('anon', procedure_oid, 'EXECUTE')
    and not has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
    and not exists (
      select 1 from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  )
  from (values
    ('private.reject_quick_task_history_mutation()'::regprocedure),
    ('private.require_owned_quick_task_lifecycle(uuid,uuid)'::regprocedure),
    ('private.apply_quick_task_expiry(uuid,uuid,text,text)'::regprocedure),
    ('private.apply_quick_task_purge(uuid,uuid,text,text)'::regprocedure)
  ) procedures(procedure_oid)
  join pg_proc proc on proc.oid = procedure_oid
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
      array['related_quick_task_id','organization_id','owner_id'], array['id','organization_id','owner_id']),
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
    array(select attribute.attname::text
      from unnest(relationship.conkey) with ordinality key(attnum, position)
      join pg_attribute attribute on attribute.attrelid = relationship.conrelid
        and attribute.attnum = key.attnum order by key.position) as child_columns,
    array(select attribute.attname::text
      from unnest(relationship.confkey) with ordinality key(attnum, position)
      join pg_attribute attribute on attribute.attrelid = relationship.confrelid
        and attribute.attnum = key.attnum order by key.position) as parent_columns
  from pg_constraint relationship where relationship.contype = 'f'
)
insert into qts3_checks
select 'composite_foreign_keys_remain_exact', count(actual.oid) = 13 and bool_and(coalesce(
  actual.conrelid = expected.child_table and actual.confrelid = expected.parent_table
  and actual.child_columns = expected.child_columns
  and actual.parent_columns = expected.parent_columns,
  false
))
from expected left join actual
  on actual.conname = expected.constraint_name and actual.conrelid = expected.child_table;

with expected(index_name, child_table, key_columns) as (
  values
    ('idx_quick_tasks_current_revision', 'public.quick_tasks'::regclass, array['current_revision_id','id','organization_id','owner_id']),
    ('idx_quick_tasks_fork_source', 'public.quick_tasks'::regclass, array['forked_from_quick_task_id','organization_id','owner_id']),
    ('idx_quick_tasks_fork_revision', 'public.quick_tasks'::regclass, array['forked_from_revision_id','forked_from_quick_task_id','organization_id','owner_id']),
    ('idx_quick_task_revisions_task_owner', 'public.quick_task_revisions'::regclass, array['quick_task_id','organization_id','owner_id']),
    ('idx_quick_task_lifecycle_events_task_owner', 'public.quick_task_lifecycle_events'::regclass, array['quick_task_id','organization_id','owner_id']),
    ('idx_quick_task_lifecycle_events_related', 'public.quick_task_lifecycle_events'::regclass, array['related_quick_task_id','organization_id','owner_id']),
    ('idx_ai_runs_quick_task_fk', 'public.ai_runs'::regclass, array['quick_task_id','organization_id','user_id']),
    ('idx_ai_runs_quick_task_revision_fk', 'public.ai_runs'::regclass, array['quick_task_revision_id','quick_task_id','organization_id','user_id']),
    ('idx_ai_runs_connector_fk', 'public.ai_runs'::regclass, array['connector_connection_id','organization_id']),
    ('idx_quick_task_revisions_ai_run_fk', 'public.quick_task_revisions'::regclass, array['ai_run_id','organization_id','owner_id']),
    ('idx_quick_task_messages_task_owner_created', 'public.quick_task_messages'::regclass, array['quick_task_id','organization_id','owner_id']),
    ('idx_quick_task_messages_revision_fk', 'public.quick_task_messages'::regclass, array['quick_task_revision_id','quick_task_id','organization_id','owner_id']),
    ('idx_quick_task_messages_ai_run_fk', 'public.quick_task_messages'::regclass, array['ai_run_id','organization_id','owner_id'])
)
insert into qts3_checks
select 'composite_fk_supporting_indexes_remain_exact',
  count(index_relation.oid) = 13 and bool_and(coalesce(
    index_meta.indrelid = expected.child_table and index_meta.indisvalid
    and array(
      select attribute.attname::text
      from unnest(index_meta.indkey::smallint[]) with ordinality key(attnum, position)
      join pg_attribute attribute on attribute.attrelid = index_meta.indrelid
        and attribute.attnum = key.attnum
      where key.position <= cardinality(expected.key_columns)
      order by key.position
    ) = expected.key_columns,
    false
  ))
from expected
left join pg_class index_relation on index_relation.relname = expected.index_name
  and index_relation.relnamespace = 'public'::regnamespace
left join pg_index index_meta on index_meta.indexrelid = index_relation.oid;

with expected(index_name, key_columns, required_predicate_parts) as (
  values
    ('idx_quick_tasks_expiry_candidates', array['expires_at','id'],
      array['state = ''active''','purged_at is null']),
    ('idx_quick_tasks_purge_candidates', array['recoverable_until','id'],
      array['state = any','expired','discarded','purged_at is null'])
), actual as (
  select index_relation.relname as index_name,
    array(
      select attribute.attname::text
      from unnest(index_meta.indkey::smallint[]) with ordinality key(attnum, position)
      join pg_attribute attribute on attribute.attrelid = index_meta.indrelid
        and attribute.attnum = key.attnum
      order by key.position
    ) as key_columns,
    lower(pg_get_expr(index_meta.indpred, index_meta.indrelid)) as predicate,
    index_meta.indisvalid
  from pg_class index_relation
  join pg_index index_meta on index_meta.indexrelid = index_relation.oid
  where index_relation.relnamespace = 'public'::regnamespace
    and index_relation.relname in (
      'idx_quick_tasks_expiry_candidates',
      'idx_quick_tasks_purge_candidates'
    )
)
insert into qts3_checks
select 'retention_indexes_are_exact', count(actual.index_name) = 2 and bool_and(
  actual.indisvalid
  and actual.key_columns = expected.key_columns
  and (
    select bool_and(actual.predicate like '%' || predicate_part || '%')
    from unnest(expected.required_predicate_parts) predicate_part
  )
)
from expected left join actual using (index_name);

insert into qts3_checks values ('controlled_purge_guard_is_exact',
  pg_get_functiondef('private.reject_quick_task_history_mutation()'::regprocedure)
    like '%quick_task_controlled_purge%'
  and pg_get_functiondef('private.reject_quick_task_history_mutation()'::regprocedure)
    like '%quick_task_revisions%'
  and pg_get_functiondef('private.reject_quick_task_history_mutation()'::regprocedure)
    like '%quick_task_messages%'
  and pg_get_functiondef('private.reject_quick_task_history_mutation()'::regprocedure)
    not like '%quick_task_lifecycle_events%'
);

insert into qts3_checks values ('ai_redaction_shape_is_exact', exists (
  select 1 from pg_constraint
  where conrelid = 'public.ai_runs'::regclass
    and conname = 'ai_runs_quick_task_context_check'
    and lower(pg_get_constraintdef(oid)) like '%redacted_at is not null%'
    and lower(pg_get_constraintdef(oid)) like '%quick_task_revision_id is null%'
    and lower(pg_get_constraintdef(oid)) like '%input_text = ''''%'
    and lower(pg_get_constraintdef(oid)) like '%output_text = ''''%'
));

insert into qts3_checks values ('no_qts_write_policies_exist', not exists (
  select 1 from pg_policy
  where polrelid in (
    'public.quick_tasks'::regclass,
    'public.quick_task_revisions'::regclass,
    'public.quick_task_messages'::regclass,
    'public.quick_task_lifecycle_events'::regclass
  ) and polcmd <> 'r'
));

select jsonb_object_agg(check_name, passed order by check_name) as qts3_verification
from qts3_checks;

do $$
declare v_failed text;
begin
  select string_agg(check_name, ', ' order by check_name)
  into v_failed from qts3_checks where not passed;
  if v_failed is not null then
    raise exception 'QTS3 verification failed: %', v_failed;
  end if;
end;
$$;

rollback;