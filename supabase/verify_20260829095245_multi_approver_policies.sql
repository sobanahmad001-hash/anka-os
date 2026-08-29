-- D4 rollback-safe runtime verification. Run after the D4 migration is applied.

begin;

create temporary table d4_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_engagement_id uuid;
  v_brand_id uuid;
  v_requester_id uuid;
  v_first_id uuid := gen_random_uuid();
  v_second_id uuid := gen_random_uuid();
  v_artifact_id uuid := gen_random_uuid();
  v_sequential_version_id uuid := gen_random_uuid();
  v_parallel_version_id uuid := gen_random_uuid();
  v_sequential_request_id uuid;
  v_parallel_request_id uuid;
  v_rejected boolean;
begin
  select engagement.organization_id, engagement.id, engagement.brand_id, membership.user_id
  into v_organization_id, v_engagement_id, v_brand_id, v_requester_id
  from public.engagements engagement
  join public.organization_memberships membership
    on membership.organization_id = engagement.organization_id
   and membership.member_kind = 'team' and membership.status = 'active'
  limit 1;
  if v_requester_id is null then
    raise exception 'D4 verification requires one engagement and active team member';
  end if;

  insert into auth.users (id) values (v_first_id), (v_second_id);
  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, department_id, status
  ) values
    (v_organization_id, v_first_id, 'team', 'contributor', 'content', 'active'),
    (v_organization_id, v_second_id, 'team', 'contributor', 'marketing', 'active');

  insert into public.artifacts (
    id, organization_id, engagement_id, brand_id, artifact_type, title, created_by
  ) values (
    v_artifact_id, v_organization_id, v_engagement_id, v_brand_id,
    'discovery', 'D4 rollback verification artifact', v_requester_id
  );
  insert into public.artifact_versions (
    id, organization_id, artifact_id, version_number, content, content_checksum, created_by
  ) values
    (v_sequential_version_id, v_organization_id, v_artifact_id, 1,
      '{"policy":"sequential"}'::jsonb, encode(digest('d4-sequential-' || gen_random_uuid(), 'sha256'), 'hex'), v_requester_id),
    (v_parallel_version_id, v_organization_id, v_artifact_id, 2,
      '{"policy":"parallel"}'::jsonb, encode(digest('d4-parallel-' || gen_random_uuid(), 'sha256'), 'hex'), v_requester_id);

  v_sequential_request_id := (public.create_artifact_approval_request(
    v_sequential_version_id, 'sequential', array[v_first_id, v_second_id], v_requester_id
  )->>'id')::uuid;

  v_rejected := false;
  begin
    perform public.sign_off_artifact_approval(v_sequential_request_id, v_second_id);
  exception when others then
    v_rejected := sqlerrm like '%Earlier sequential approvers%';
  end;
  insert into d4_runtime_checks values ('sequential_out_of_order_rejected', v_rejected);

  v_rejected := false;
  begin
    perform public.sign_off_artifact_approval(v_sequential_request_id, v_requester_id);
  exception when others then
    v_rejected := sqlerrm like '%Only a named approver%';
  end;
  insert into d4_runtime_checks values ('unnamed_user_rejected', v_rejected);

  perform public.sign_off_artifact_approval(v_sequential_request_id, v_first_id);
  perform public.sign_off_artifact_approval(v_sequential_request_id, v_second_id);
  insert into d4_runtime_checks values ('sequential_completed_with_one_final_approval',
    (select status = 'completed' from public.artifact_approval_requests where id = v_sequential_request_id)
    and (select count(*) = 1 from public.artifact_approvals where artifact_version_id = v_sequential_version_id)
  );

  v_parallel_request_id := (public.create_artifact_approval_request(
    v_parallel_version_id, 'parallel', array[v_first_id, v_second_id], v_requester_id
  )->>'id')::uuid;
  perform public.sign_off_artifact_approval(v_parallel_request_id, v_second_id);
  perform public.sign_off_artifact_approval(v_parallel_request_id, v_first_id);
  insert into d4_runtime_checks values ('parallel_completed_in_reverse_order',
    (select status = 'completed' from public.artifact_approval_requests where id = v_parallel_request_id)
    and (select count(*) = 1 from public.artifact_approvals where artifact_version_id = v_parallel_version_id)
  );

  insert into d4_runtime_checks values ('final_approvals_attributed_to_final_signers',
    (select approved_by = v_second_id from public.artifact_approvals where artifact_version_id = v_sequential_version_id)
    and (select approved_by = v_first_id from public.artifact_approvals where artifact_version_id = v_parallel_version_id)
  );
end;
$$;

select jsonb_build_object(
  'exact_request_columns', (
    select array_agg(column_name::text order by ordinal_position) = array[
      'id', 'organization_id', 'artifact_version_id', 'approval_policy',
      'status', 'requested_by', 'created_at'
    ]::text[] from information_schema.columns
    where table_schema = 'public' and table_name = 'artifact_approval_requests'
  ),
  'exact_signoff_columns', (
    select array_agg(column_name::text order by ordinal_position) = array[
      'id', 'organization_id', 'request_id', 'required_approver_id',
      'sequence_position', 'signed_off_at'
    ]::text[] from information_schema.columns
    where table_schema = 'public' and table_name = 'artifact_approval_signoffs'
  ),
  'rls_enabled', (
    select bool_and(relrowsecurity) from pg_class
    where oid in ('public.artifact_approval_requests'::regclass, 'public.artifact_approval_signoffs'::regclass)
  ),
  'browser_is_read_only',
    has_table_privilege('authenticated', 'public.artifact_approval_requests', 'select')
    and has_table_privilege('authenticated', 'public.artifact_approval_signoffs', 'select')
    and not has_table_privilege('authenticated', 'public.artifact_approval_requests', 'insert, update, delete')
    and not has_table_privilege('authenticated', 'public.artifact_approval_signoffs', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.artifact_approval_requests', 'select, insert, update, delete')
    and not has_table_privilege('anon', 'public.artifact_approval_signoffs', 'select, insert, update, delete'),
  'artifact_approvals_shape_preserved', (
    select array_agg(column_name::text order by ordinal_position) = array[
      'id', 'organization_id', 'artifact_id', 'artifact_version_id', 'engagement_id',
      'decision', 'notes', 'approved_by', 'approved_at'
    ]::text[] from information_schema.columns
    where table_schema = 'public' and table_name = 'artifact_approvals'
  ) and exists (
    select 1 from pg_constraint
    where conrelid = 'public.artifact_approvals'::regclass
      and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (artifact_version_id)'
  )
) || (select jsonb_object_agg(check_name, passed) from d4_runtime_checks);

rollback;
