-- Fail-closed, rollback-only verification for Design B03A.
begin;

do $$
declare
  role_name text;
  privilege_name text;
  expected boolean;
begin
  if to_regclass('public.design_image_generation_jobs') is null then
    raise exception 'B03A durable generation ledger is missing';
  end if;

  if not coalesce((
    select relrowsecurity and not relforcerowsecurity
    from pg_class where oid = 'public.design_image_generation_jobs'::regclass
  ), false) then raise exception 'B03A RLS state is invalid'; end if;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'design_image_generation_jobs') <> 1
    or not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'design_image_generation_jobs'
        and policyname = 'design_image_generation_jobs_select_visible_direction'
        and cmd = 'SELECT' and permissive = 'PERMISSIVE'
        and roles = array['authenticated']::name[]
        and qual like '%is_team_organization_member%'
        and qual like '%design_direction_versions%'
        and with_check is null
    ) then raise exception 'B03A exact SELECT policy is missing'; end if;

  if exists (
    select 1 from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid = 'public.design_image_generation_jobs'::regclass and acl.grantee = 0
  ) then raise exception 'B03A PUBLIC unexpectedly has table privileges'; end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      expected := role_name = 'service_role' or (role_name = 'authenticated' and privilege_name = 'SELECT');
      if has_table_privilege(role_name, 'public.design_image_generation_jobs', privilege_name)
        is distinct from expected then
        raise exception 'B03A unexpected %.% privilege', role_name, privilege_name;
      end if;
    end loop;
  end loop;

  if exists (
    with expected_constraints(name, kind) as (values
      ('design_image_generation_jobs_org_operation_key_unique','u'),
      ('design_image_generation_jobs_id_org_unique','u'),
      ('design_image_generation_jobs_media_org_unique','u'),
      ('design_image_generation_jobs_retry_org_unique','u'),
      ('design_image_generation_jobs_direction_version_fk','f'),
      ('design_image_generation_jobs_model_registry_fk','f'),
      ('design_image_generation_jobs_media_asset_fk','f'),
      ('design_image_generation_jobs_retry_fk','f'),
      ('design_image_generation_jobs_status_check','c'),
      ('design_image_generation_jobs_failure_phase_check','c'),
      ('design_image_generation_jobs_lifecycle_check','c')
    )
    select 1 from expected_constraints expected_constraint
    where not exists (
      select 1 from pg_constraint actual
      where actual.conrelid = 'public.design_image_generation_jobs'::regclass
        and actual.conname = expected_constraint.name
        and actual.contype = expected_constraint.kind::"char"
        and actual.convalidated
    )
  ) then raise exception 'B03A constraint set is incomplete'; end if;

  if exists (
    with expected_indexes(name) as (values
      ('design_image_generation_jobs_direction_history_idx'),
      ('design_image_generation_jobs_model_registry_fk_idx'),
      ('design_image_generation_jobs_requested_by_idx'),
      ('design_image_generation_jobs_active_idx')
    )
    select 1 from expected_indexes expected_index
    left join pg_class index_class on index_class.relname = expected_index.name
      and index_class.relnamespace = 'public'::regnamespace
    left join pg_index index_metadata on index_metadata.indexrelid = index_class.oid
    where index_metadata.indexrelid is null
      or not index_metadata.indisvalid or not index_metadata.indisready
  ) then raise exception 'B03A required index is missing or invalid'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.design_image_generation_jobs'::regclass
      and tgname = 'guard_design_image_generation_job_trigger'
      and not tgisinternal and tgenabled = 'O'
  ) then raise exception 'B03A lifecycle guard trigger is missing or disabled'; end if;

  if not coalesce((
    select not prosecdef and provolatile = 'v' and proconfig = array['search_path=""']::text[]
    from pg_proc
    where oid = 'private.guard_design_image_generation_job()'::regprocedure
  ), false) then raise exception 'B03A lifecycle guard security metadata is invalid'; end if;

  foreach role_name in array array['public', 'anon', 'authenticated', 'service_role'] loop
    expected := role_name = 'service_role';
    if has_function_privilege(role_name, 'private.guard_design_image_generation_job()', 'EXECUTE')
      is distinct from expected then
      raise exception 'B03A unexpected lifecycle guard EXECUTE privilege for %', role_name;
    end if;
  end loop;
end;
$$;

create temporary table b03a_runtime_checks(
  check_name text primary key,
  check_passed boolean not null
) on commit drop;

do $$
declare
  organization_id_value uuid;
  actor_id_value uuid;
  version_id_value uuid;
  model_id_value uuid;
  first_job_id uuid := gen_random_uuid();
  failed_job_id uuid := gen_random_uuid();
  retry_job_id uuid := gen_random_uuid();
  check_passed_value boolean;
begin
  select version.organization_id, membership.user_id, version.id, model.id
  into organization_id_value, actor_id_value, version_id_value, model_id_value
  from public.design_direction_versions version
  join public.organization_memberships membership
    on membership.organization_id = version.organization_id
   and membership.member_kind = 'team' and membership.status = 'active'
  join public.design_model_registry model
    on model.organization_id = version.organization_id
   and model.supported_output_types @> array['image']::text[]
  limit 1;

  if organization_id_value is null then
    raise exception 'B03A runtime fixture requires a direction version, active team member, and image model in one organization';
  end if;

  insert into public.design_image_generation_jobs(
    id, organization_id, direction_version_id, model_registry_id, requested_by,
    operation_key, request_checksum, prompt
  ) values (
    first_job_id, organization_id_value, version_id_value, model_id_value, actor_id_value,
    'b03a-operation-first', repeat('a', 64), 'B03A exact prompt'
  );

  begin
    insert into public.design_image_generation_jobs(
      organization_id, direction_version_id, model_registry_id, requested_by,
      operation_key, request_checksum, prompt
    ) values (
      organization_id_value, version_id_value, model_id_value, actor_id_value,
      'b03a-operation-first', repeat('a', 64), 'B03A exact prompt'
    );
    check_passed_value := false;
  exception when unique_violation then check_passed_value := true;
  end;
  insert into b03a_runtime_checks values ('duplicate_operation_rejected', check_passed_value);

  update public.design_image_generation_jobs
  set status = 'running', started_at = now()
  where id = first_job_id;
  update public.design_image_generation_jobs
  set status = 'outcome_unknown', failure_phase = 'provider',
      failure_reason = 'transport ended without authoritative provider result', completed_at = now()
  where id = first_job_id;

  begin
    insert into public.design_image_generation_jobs(
      organization_id, direction_version_id, model_registry_id, requested_by,
      operation_key, request_checksum, prompt, retry_of_job_id
    ) values (
      organization_id_value, version_id_value, model_id_value, actor_id_value,
      'b03a-retry-unknown', repeat('a', 64), 'B03A exact prompt', first_job_id
    );
    check_passed_value := false;
  exception when others then check_passed_value := true;
  end;
  insert into b03a_runtime_checks values ('unknown_outcome_retry_rejected', check_passed_value);

  begin
    update public.design_image_generation_jobs set failure_reason = 'changed' where id = first_job_id;
    check_passed_value := false;
  exception when others then check_passed_value := true;
  end;
  insert into b03a_runtime_checks values ('terminal_update_rejected', check_passed_value);

  begin
    delete from public.design_image_generation_jobs where id = first_job_id;
    check_passed_value := false;
  exception when others then check_passed_value := true;
  end;
  insert into b03a_runtime_checks values ('delete_rejected', check_passed_value);

  insert into public.design_image_generation_jobs(
    id, organization_id, direction_version_id, model_registry_id, requested_by,
    operation_key, request_checksum, prompt
  ) values (
    failed_job_id, organization_id_value, version_id_value, model_id_value, actor_id_value,
    'b03a-operation-failed', repeat('b', 64), 'B03A retryable prompt'
  );
  update public.design_image_generation_jobs
  set status = 'running', started_at = now()
  where id = failed_job_id;
  update public.design_image_generation_jobs
  set status = 'failed', failure_phase = 'provider',
      failure_reason = 'provider rejected request', completed_at = now()
  where id = failed_job_id;

  insert into public.design_image_generation_jobs(
    id, organization_id, direction_version_id, model_registry_id, requested_by,
    operation_key, request_checksum, prompt, retry_of_job_id
  ) values (
    retry_job_id, organization_id_value, version_id_value, model_id_value, actor_id_value,
    'b03a-retry-confirmed', repeat('b', 64), 'B03A retryable prompt', failed_job_id
  );
  insert into b03a_runtime_checks values ('confirmed_provider_retry_allowed', true);

  begin
    insert into public.design_image_generation_jobs(
      organization_id, direction_version_id, model_registry_id, requested_by,
      operation_key, request_checksum, prompt, retry_of_job_id
    ) values (
      organization_id_value, version_id_value, model_id_value, actor_id_value,
      'b03a-second-retry', repeat('b', 64), 'B03A retryable prompt', failed_job_id
    );
    check_passed_value := false;
  exception when unique_violation then check_passed_value := true;
  end;
  insert into b03a_runtime_checks values ('second_retry_rejected', check_passed_value);

  begin
    insert into public.design_image_generation_jobs(
      organization_id, direction_version_id, model_registry_id, requested_by,
      operation_key, request_checksum, prompt, retry_of_job_id
    ) values (
      organization_id_value, version_id_value, model_id_value, actor_id_value,
      'b03a-mismatched-retry', repeat('c', 64), 'Changed retry prompt', failed_job_id
    );
    check_passed_value := false;
  exception when others then check_passed_value := true;
  end;
  insert into b03a_runtime_checks values ('retry_payload_change_rejected', check_passed_value);
end;
$$;

do $$
begin
  if not coalesce((select bool_and(check_passed) from b03a_runtime_checks), false) then
    raise exception 'B03A runtime verification failed: %',
      (select jsonb_object_agg(check_name, check_passed) from b03a_runtime_checks);
  end if;
end;
$$;

select jsonb_build_object(
  'design_b03a', 'PASS',
  'checks', (select jsonb_object_agg(check_name, check_passed) from b03a_runtime_checks)
);

rollback;
