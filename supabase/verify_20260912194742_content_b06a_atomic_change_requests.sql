-- Content B06a rollback-only schema, privilege, policy, and runtime verification.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table b06a_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into b06a_checks values
  ('request_metadata_columns_present', (
    select count(*) = 2
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'artifact_version_comments'
      and column_name in ('approval_request_id', 'request_change_key')
  )),
  ('request_metadata_constraint_present', exists (
    select 1 from pg_constraint
    where conrelid = 'public.artifact_version_comments'::regclass
      and conname = 'artifact_version_comments_request_change_metadata_check'
  )),
  ('tenant_safe_request_foreign_key_present', exists (
    select 1 from pg_constraint
    where conrelid = 'public.artifact_version_comments'::regclass
      and conname = 'artifact_version_comments_approval_request_fk'
      and contype = 'f'
  )),
  ('exact_replay_key_is_unique', to_regclass('public.artifact_version_comments_request_change_replay_key') is not null),
  ('rpc_is_service_role_only',
    has_function_privilege('service_role', 'public.request_artifact_approval_changes(uuid,uuid,text,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.request_artifact_approval_changes(uuid,uuid,text,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.request_artifact_approval_changes(uuid,uuid,text,uuid)', 'EXECUTE')
  ),
  ('rpc_is_security_invoker_with_fixed_search_path', (
    select not prosecdef and proconfig = array['search_path=""']
    from pg_proc
    where oid = 'public.request_artifact_approval_changes(uuid,uuid,text,uuid)'::regprocedure
  )),
  ('rpc_uses_canonical_atomic_lock_order', (
    select pg_get_functiondef('public.request_artifact_approval_changes(uuid,uuid,text,uuid)'::regprocedure)
      ~ 'artifact_approval_requests[[:space:][:print:]]*for update'
    and pg_get_functiondef('public.request_artifact_approval_changes(uuid,uuid,text,uuid)'::regprocedure)
      ~ 'organizations[[:space:][:print:]]*for share'
    and pg_get_functiondef('public.request_artifact_approval_changes(uuid,uuid,text,uuid)'::regprocedure)
      ~ 'organization_memberships[[:space:][:print:]]*for share'
    and pg_get_functiondef('public.request_artifact_approval_changes(uuid,uuid,text,uuid)'::regprocedure)
      ~ 'artifact_approval_signoffs[[:space:][:print:]]*for update'
  )),
  ('no_formal_decision_enum_or_parallel_review_table',
    to_regclass('public.artifact_approval_change_requests') is null
    and not exists (
      select 1 from pg_type type
      join pg_namespace namespace on namespace.oid = type.typnamespace
      where namespace.nspname = 'public' and type.typname like '%change%decision%'
    )
  );

do $$
declare
  org_id uuid;
  engagement_id uuid;
  brand_id uuid;
  requester_id uuid;
  actor_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  artifact_id uuid := gen_random_uuid();
  version_id uuid := gen_random_uuid();
  request_id uuid;
  first_key uuid := gen_random_uuid();
  second_key uuid := gen_random_uuid();
  result jsonb;
  replay jsonb;
  denied boolean;
begin
  select engagement.organization_id, engagement.id, engagement.brand_id, membership.user_id
  into org_id, engagement_id, brand_id, requester_id
  from public.engagements engagement
  join public.organizations organization
    on organization.id = engagement.organization_id and organization.status = 'active'
  join public.organization_memberships membership
    on membership.organization_id = engagement.organization_id
   and membership.member_kind = 'team' and membership.status = 'active'
  limit 1;
  if requester_id is null then
    raise exception 'B06a verification requires one engagement in an active organization and one active team member';
  end if;

  insert into auth.users(id) values(actor_id), (second_id);
  insert into public.organization_memberships(
    organization_id, user_id, member_kind, role, department_id, status
  ) values
    (org_id, actor_id, 'team', 'contributor', 'content', 'active'),
    (org_id, second_id, 'team', 'contributor', 'content', 'active');

  insert into public.artifacts(
    id, organization_id, engagement_id, brand_id, artifact_type, title, created_by
  ) values (
    artifact_id, org_id, engagement_id, brand_id, 'content', 'B06a rollback verifier', requester_id
  );
  insert into public.artifact_versions(
    id, organization_id, artifact_id, version_number, content, content_checksum, created_by
  ) values (
    version_id, org_id, artifact_id, 1, '{"body":"B06a"}'::jsonb,
    encode(digest('b06a-' || gen_random_uuid(), 'sha256'), 'hex'), requester_id
  );

  request_id := (public.create_artifact_approval_request(
    version_id, 'parallel', array[actor_id, second_id], requester_id
  )->>'id')::uuid;

  set local role service_role;
  result := public.request_artifact_approval_changes(request_id, actor_id, 'Correct exact claim', first_key);
  replay := public.request_artifact_approval_changes(request_id, actor_id, 'Correct exact claim', first_key);
  reset role;
  insert into b06a_checks values ('exact_retry_replays_one_immutable_comment',
    not (result->>'idempotent_replay')::boolean
    and (replay->>'idempotent_replay')::boolean
    and result->>'id' = replay->>'id'
    and (select count(*) = 1 from public.artifact_version_comments
      where approval_request_id = request_id and author_id = actor_id and request_change_key = first_key)
  );

  denied := false;
  set local role service_role;
  begin
    perform public.request_artifact_approval_changes(request_id, actor_id, 'Different intent', first_key);
  exception when unique_violation then denied := true;
  end;
  reset role;
  insert into b06a_checks values ('changed_intent_with_same_key_is_denied', denied);

  set local role service_role;
  result := public.request_artifact_approval_changes(request_id, actor_id, 'Correct exact claim', second_key);
  reset role;
  insert into b06a_checks values ('deliberate_new_feedback_uses_new_key',
    not (result->>'idempotent_replay')::boolean
    and (select count(*) = 2 from public.artifact_version_comments
      where approval_request_id = request_id and author_id = actor_id)
  );


  update public.organization_memberships set status = 'suspended'
    where organization_id = org_id and user_id = actor_id;
  denied := false;
  set local role service_role;
  begin
    perform public.request_artifact_approval_changes(request_id, actor_id, 'Inactive actor', gen_random_uuid());
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  insert into b06a_checks values ('inactive_member_is_denied_at_write_time', denied);
  update public.organization_memberships set status = 'active'
    where organization_id = org_id and user_id = actor_id;

  update public.organizations set status = 'suspended' where id = org_id;
  denied := false;
  set local role service_role;
  begin
    perform public.request_artifact_approval_changes(request_id, actor_id, 'Inactive organization', gen_random_uuid());
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  insert into b06a_checks values ('inactive_organization_is_denied_at_write_time', denied);
  update public.organizations set status = 'active' where id = org_id;

  perform public.sign_off_artifact_approval(request_id, actor_id);
  denied := false;
  set local role service_role;
  begin
    perform public.request_artifact_approval_changes(request_id, actor_id, 'Already signed', gen_random_uuid());
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  insert into b06a_checks values ('signed_named_approver_is_denied', denied);

  update public.artifact_approval_requests set status = 'cancelled' where id = request_id;
  denied := false;
  set local role service_role;
  begin
    perform public.request_artifact_approval_changes(request_id, actor_id, 'Too late', gen_random_uuid());
  exception when sqlstate '55000' then denied := true;
  end;
  reset role;
  insert into b06a_checks values ('nonpending_request_is_denied', denied);
end;
$$;

insert into b06a_checks values ('request_metadata_is_append_only',
  pg_get_functiondef('private.enforce_artifact_version_comment_append_only()'::regprocedure)
    like '%new.approval_request_id is distinct from old.approval_request_id%'
  and pg_get_functiondef('private.enforce_artifact_version_comment_append_only()'::regprocedure)
    like '%new.request_change_key is distinct from old.request_change_key%'
);

select * from b06a_checks order by check_name;

do $$
declare failures text;
begin
  select string_agg(check_name, ', ' order by check_name)
  into failures from b06a_checks where not passed;
  if failures is not null then raise exception 'B06a verifier failed: %', failures; end if;
end;
$$;

rollback;
