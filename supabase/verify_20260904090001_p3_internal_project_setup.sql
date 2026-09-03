-- P3 rollback-only verifier. Run only against a disposable/local database after the migration.
-- Verifies deterministic successor migration 20260904090001.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table p3_internal_setup_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

create or replace function pg_temp.p3_check(p_name text, p_passed boolean)
returns void language plpgsql as $$
begin
  if not p_passed then raise exception 'P3 verification failed: %', p_name; end if;
  insert into p3_internal_setup_checks values (p_name, p_passed);
end;
$$;

do $$
declare
  v_signature regprocedure := 'public.create_internal_project_setup(uuid,uuid,text,text,uuid,date,date,text,text,jsonb)'::regprocedure;
  v_options_signature regprocedure := 'public.get_internal_project_setup_options(uuid)'::regprocedure;
  v_owner_helper_signature regprocedure := 'private.can_select_internal_project_owner(uuid,uuid,text)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  perform pg_temp.p3_check('exact_create_rpc_catalog',
    exists (
      select 1
      from pg_proc procedure
      join pg_language language on language.oid = procedure.prolang
      where procedure.oid = v_signature
        and procedure.prokind = 'f'
        and procedure.pronargs = 10
        and procedure.prorettype = 'jsonb'::regtype
        and pg_get_userbyid(procedure.proowner) = 'postgres'
        and language.lanname = 'plpgsql'
        and procedure.prosecdef = false
        and procedure.provolatile = 'v'
        and procedure.proconfig = array['search_path=""']
    )
  );
  perform pg_temp.p3_check('exact_create_rpc_acl',
    (select count(*) from pg_proc procedure
      cross join lateral aclexplode(procedure.proacl) acl
      where procedure.oid = v_signature
        and acl.grantee = 'authenticated'::regrole
        and acl.privilege_type = 'EXECUTE') = 1
    and not exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(procedure.proacl) acl
      where procedure.oid = v_signature
        and acl.grantee in (0, 'anon'::regrole, 'service_role'::regrole)
        and acl.privilege_type = 'EXECUTE'
    )
  );
  perform pg_temp.p3_check('exact_owner_directory_catalog',
    exists (
      select 1 from pg_proc procedure
      where procedure.oid = v_options_signature
        and procedure.prorettype = 'jsonb'::regtype
        and pg_get_userbyid(procedure.proowner) = 'postgres'
        and procedure.prosecdef = true
        and procedure.provolatile = 's'
        and procedure.proconfig = array['search_path=""']
    )
    and exists (
      select 1 from pg_proc procedure
      where procedure.oid = v_owner_helper_signature
        and procedure.prorettype = 'boolean'::regtype
        and pg_get_userbyid(procedure.proowner) = 'postgres'
        and procedure.prosecdef = true
        and procedure.provolatile = 'v'
        and procedure.proconfig = array['search_path=""']
    )
  );
  perform pg_temp.p3_check('exact_owner_directory_acl',
    (select count(*) from pg_proc procedure cross join lateral aclexplode(procedure.proacl) acl
      where procedure.oid in (v_options_signature, v_owner_helper_signature)
        and acl.grantee = 'authenticated'::regrole and acl.privilege_type = 'EXECUTE') = 2
    and not exists (
      select 1 from pg_proc procedure cross join lateral aclexplode(procedure.proacl) acl
      where procedure.oid in (v_options_signature, v_owner_helper_signature)
        and acl.grantee in (0, 'anon'::regrole, 'service_role'::regrole)
        and acl.privilege_type = 'EXECUTE'
    )
  );
  perform pg_temp.p3_check('exact_ledger_rls_and_policies',
    exists (
      select 1 from pg_class relation
      where relation.oid = 'private.internal_project_setup_requests'::regclass
        and relation.relrowsecurity = true
        and relation.relforcerowsecurity = false
        and pg_get_userbyid(relation.relowner) = 'postgres'
    )
    and (
      select jsonb_agg(jsonb_build_object(
        'name', policyname,
        'command', cmd,
        'roles', roles,
        'using', qual is not null,
        'check', with_check is not null
      ) order by policyname)
      from pg_policies
      where schemaname = 'private' and tablename = 'internal_project_setup_requests'
    ) = jsonb_build_array(
      jsonb_build_object('name', 'Creators read own Internal Work setup requests', 'command', 'SELECT', 'roles', array['authenticated']::name[], 'using', true, 'check', false),
      jsonb_build_object('name', 'Creators record own Internal Work setup requests', 'command', 'INSERT', 'roles', array['authenticated']::name[], 'using', false, 'check', true)
    )
    and (select qual from pg_policies where schemaname = 'private' and tablename = 'internal_project_setup_requests' and policyname = 'Creators read own Internal Work setup requests')
      ~ 'requested_by.*auth\.uid.*member_kind.*team.*status.*active.*organization\.status.*active'
    and (select with_check from pg_policies where schemaname = 'private' and tablename = 'internal_project_setup_requests' and policyname = 'Creators record own Internal Work setup requests')
      ~ 'requested_by.*auth\.uid.*member_kind.*team.*status.*active.*organization\.status.*active'
  );
  perform pg_temp.p3_check('exact_ledger_acl',
    (select count(*) from pg_class relation cross join lateral aclexplode(relation.relacl) acl
      where relation.oid = 'private.internal_project_setup_requests'::regclass
        and acl.grantee = 'authenticated'::regrole
        and acl.privilege_type in ('SELECT', 'INSERT')) = 2
    and not exists (
      select 1 from pg_class relation cross join lateral aclexplode(relation.relacl) acl
      where relation.oid = 'private.internal_project_setup_requests'::regclass
        and acl.grantee = 'authenticated'::regrole
        and acl.privilege_type not in ('SELECT', 'INSERT')
    )
    and not exists (
      select 1 from pg_class relation cross join lateral aclexplode(relation.relacl) acl
      where relation.oid = 'private.internal_project_setup_requests'::regclass
        and acl.grantee in (0, 'anon'::regrole, 'service_role'::regrole)
    )
  );
  perform pg_temp.p3_check('exact_ledger_columns',
    (
      select jsonb_agg(jsonb_build_object(
        'name', column_name,
        'type', data_type,
        'nullable', is_nullable,
        'default', column_default
      ) order by ordinal_position)
      from information_schema.columns
      where table_schema = 'private' and table_name = 'internal_project_setup_requests'
    ) = jsonb_build_array(
      jsonb_build_object('name', 'organization_id', 'type', 'uuid', 'nullable', 'NO', 'default', null),
      jsonb_build_object('name', 'requested_by', 'type', 'uuid', 'nullable', 'NO', 'default', null),
      jsonb_build_object('name', 'request_id', 'type', 'uuid', 'nullable', 'NO', 'default', null),
      jsonb_build_object('name', 'normalized_payload_sha256', 'type', 'text', 'nullable', 'NO', 'default', null),
      jsonb_build_object('name', 'project_id', 'type', 'uuid', 'nullable', 'NO', 'default', null),
      jsonb_build_object('name', 'result', 'type', 'jsonb', 'nullable', 'NO', 'default', null),
      jsonb_build_object('name', 'created_at', 'type', 'timestamp with time zone', 'nullable', 'NO', 'default', 'now()')
    )
  );
  perform pg_temp.p3_check('exact_ledger_constraints',
    (select count(*) from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass and contype = 'f') = 3
    and (select count(*) from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass and contype = 'c') = 2
    and (select count(*) from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass and contype in ('p', 'u')) = 2
    and exists (select 1 from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass
      and conname = 'internal_project_setup_requests_pkey' and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (organization_id, requested_by, request_id)')
    and exists (select 1 from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass
      and conname = 'internal_project_setup_requests_project_unique' and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (project_id, organization_id)')
    and exists (select 1 from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass
      and conname = 'internal_project_setup_requests_organization_id_fkey' and contype = 'f' and confdeltype = 'r'
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT')
    and exists (select 1 from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass
      and conname = 'internal_project_setup_requests_requested_by_fkey' and contype = 'f' and confdeltype = 'r'
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE RESTRICT')
    and exists (select 1 from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass
      and conname = 'internal_project_setup_requests_project_fkey' and contype = 'f' and confdeltype = 'r'
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE RESTRICT')
    and exists (select 1 from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) ~ 'normalized_payload_sha256.*\^\[0-9a-f\]\{64\}\$')
    and exists (select 1 from pg_constraint where conrelid = 'private.internal_project_setup_requests'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) ~ 'jsonb_typeof\(result\).*object')
  );
  perform pg_temp.p3_check('exact_ledger_indexes',
    (select count(*) from pg_index where indrelid = 'private.internal_project_setup_requests'::regclass) = 3
    and exists (
      select 1
      from pg_index index join pg_class index_relation on index_relation.oid = index.indexrelid
      where index.indrelid = 'private.internal_project_setup_requests'::regclass
        and index_relation.relname = 'internal_project_setup_requests_requested_by_idx'
        and index.indisunique = false and index.indisvalid and index.indisready
        and index.indpred is null and index.indexprs is null and index.indnkeyatts = 1
        and (select array_agg(attribute.attname order by key.ordinality)
             from unnest(index.indkey::smallint[]) with ordinality key(attnum, ordinality)
             join pg_attribute attribute on attribute.attrelid = index.indrelid and attribute.attnum = key.attnum
             where key.ordinality <= index.indnkeyatts) = array['requested_by']::name[]
    )
  );
  perform pg_temp.p3_check('exact_replay_contract_static',
    v_definition like '%pg_advisory_xact_lock%'
    and v_definition like '%normalized_payload_sha256%'
    and v_definition like '%Request id was already used with different inputs.%'
  );
  perform pg_temp.p3_check('canonical_internal_only_static',
    v_definition like '%insert into public.projects%'
    and v_definition like '%''internal''%'
    and v_definition like '%insert into public.workstreams%'
    and v_definition not like '%insert into public.engagements%'
    and v_definition not like '%insert into public.engagement_services%'
    and v_definition not like '%insert into public.milestones%'
  );
  perform pg_temp.p3_check('owner_validation_rls_bridge_static',
    v_definition like '%private.can_select_internal_project_owner%'
    and pg_get_functiondef(v_options_signature) like '%public.is_team_organization_member%'
    and pg_get_functiondef(v_options_signature) like '%membership.member_kind = ''team''%'
    and pg_get_functiondef(v_options_signature) like '%membership.status = ''active''%'
  );
end;
$$;

create temporary table p3_internal_setup_fixture (
  organization_id uuid not null,
  actor_id uuid not null,
  department_id text not null,
  other_department_id text,
  project_id uuid,
  request_id uuid not null default gen_random_uuid(),
  rollback_request_id uuid not null default gen_random_uuid()
) on commit drop;

insert into p3_internal_setup_fixture(organization_id, actor_id, department_id, other_department_id)
select organization.id, membership.user_id, department.id,
  (select other_department.id from public.departments other_department
   where other_department.organization_id = organization.id and other_department.id <> department.id
   order by other_department.id limit 1)
from public.organizations organization
join public.departments department on department.organization_id = organization.id
join public.organization_memberships membership
  on membership.organization_id = organization.id
 and membership.department_id = department.id
 and membership.member_kind = 'team'
 and membership.status = 'active'
where organization.status = 'active'
order by organization.id, membership.user_id, department.id
limit 1;

do $$
begin
  if not exists (select 1 from p3_internal_setup_fixture where other_department_id is not null) then
    raise exception 'P3 verifier requires an active organization, two canonical departments, and one department member.';
  end if;
end;
$$;

grant select, update on p3_internal_setup_fixture to authenticated;
grant select, insert on p3_internal_setup_checks to authenticated;

create or replace function pg_temp.p3_force_workstream_failure()
returns trigger language plpgsql as $$
begin
  if new.name = (select name from public.departments where id = new.department_id)
    and exists (select 1 from public.projects where id = new.project_id and name = 'P3 atomic rollback probe') then
    raise exception using
      errcode = 'P3001',
      message = 'P3 forced workstream failure.';
  end if;
  return new;
end;
$$;
create trigger trg_p3_force_workstream_failure
before insert on public.workstreams
for each row execute function pg_temp.p3_force_workstream_failure();

select set_config('request.jwt.claim.sub', (select actor_id::text from p3_internal_setup_fixture), true);
set local role authenticated;

do $$
declare
  fixture p3_internal_setup_fixture;
begin
  select * into fixture from p3_internal_setup_fixture;
  begin
    perform public.create_internal_project_setup(
      fixture.organization_id, fixture.rollback_request_id, 'P3 atomic rollback probe', '', fixture.actor_id,
      null, null, '', '', jsonb_build_array(jsonb_build_object('department_id', fixture.department_id, 'owner_id', fixture.actor_id))
    );
    raise exception 'forced failure was not observed';
  exception
    when sqlstate 'P3001' then
      if sqlerrm <> 'P3 forced workstream failure.' then
        raise;
      end if;
      perform pg_temp.p3_check('forced_failure_exact_sqlstate_and_message', true);
    when others then
      raise;
  end;
  perform pg_temp.p3_check('atomic_rollback_on_workstream_failure',
    not exists (select 1 from public.projects where organization_id = fixture.organization_id and name = 'P3 atomic rollback probe')
    and not exists (select 1 from private.internal_project_setup_requests where organization_id = fixture.organization_id and request_id = fixture.rollback_request_id)
  );
end;
$$;

reset role;
drop trigger trg_p3_force_workstream_failure on public.workstreams;
select set_config('request.jwt.claim.sub', (select actor_id::text from p3_internal_setup_fixture), true);
set local role authenticated;

do $$
declare
  fixture p3_internal_setup_fixture;
  first_result jsonb;
  replay_result jsonb;
  options_result jsonb;
begin
  select * into fixture from p3_internal_setup_fixture;
  options_result := public.get_internal_project_setup_options(fixture.organization_id);
  perform pg_temp.p3_check('authorized_owner_directory_runtime',
    jsonb_typeof(options_result -> 'members') = 'array'
    and jsonb_typeof(options_result -> 'departments') = 'array'
    and exists (
      select 1 from jsonb_array_elements(options_result -> 'members') member
      where (member ->> 'id')::uuid = fixture.actor_id
    )
    and exists (
      select 1 from jsonb_array_elements(options_result -> 'departments') department
      where department ->> 'id' = fixture.department_id
        and (department ->> 'organization_id')::uuid = fixture.organization_id
    )
  );
  first_result := public.create_internal_project_setup(
    fixture.organization_id, fixture.request_id, 'P3 verifier internal project', 'Verifier brief', fixture.actor_id,
    current_date, current_date + 30, 'Verifier scope', 'No external work',
    jsonb_build_array(jsonb_build_object('department_id', fixture.department_id, 'owner_id', fixture.actor_id))
  );
  update p3_internal_setup_fixture set project_id = (first_result ->> 'project_id')::uuid;
  replay_result := public.create_internal_project_setup(
    fixture.organization_id, fixture.request_id, 'P3 verifier internal project', 'Verifier brief', fixture.actor_id,
    current_date, current_date + 30, 'Verifier scope', 'No external work',
    jsonb_build_array(jsonb_build_object('department_id', fixture.department_id, 'owner_id', fixture.actor_id))
  );
  perform pg_temp.p3_check('exact_replay_no_duplicates',
    replay_result ->> 'project_id' = first_result ->> 'project_id'
    and (replay_result ->> 'idempotent_replay')::boolean
    and (select count(*) from public.projects where id = (first_result ->> 'project_id')::uuid) = 1
    and (select count(*) from public.workstreams where project_id = (first_result ->> 'project_id')::uuid) = 1
  );
  perform pg_temp.p3_check('exact_internal_project_row',
    exists (
      select 1
      from public.projects project
      where project.id = (first_result ->> 'project_id')::uuid
        and project.organization_id = fixture.organization_id
        and project.client_id is null
        and project.name = 'P3 verifier internal project'
        and project.description = 'Verifier brief'
        and project.department_id is null
        and project.engagement_type = 'internal'
        and project.status = 'active'
        and project.priority = 'medium'
        and project.owner_id = fixture.actor_id
        and project.start_date = current_date
        and project.due_date = current_date + 30
        and project.scope_statement = 'Verifier scope'
        and project.exclusions = 'No external work'
        and project.client_summary = ''
        and project.portal_visible = false
        and project.health = 'unknown'
        and project.archived_at is null
        and project.created_at is not null
        and project.updated_at is not null
    )
  );
  perform pg_temp.p3_check('exact_selected_workstream_rows',
    (select count(*) from public.workstreams where project_id = (first_result ->> 'project_id')::uuid) = 1
    and exists (
      select 1
      from public.workstreams workstream
      join public.departments department
        on department.id = workstream.department_id
       and department.organization_id = workstream.organization_id
      where workstream.project_id = (first_result ->> 'project_id')::uuid
        and workstream.organization_id = fixture.organization_id
        and workstream.department_id = fixture.department_id
        and workstream.name = department.name
        and workstream.status = 'active'
        and workstream.owner_id = fixture.actor_id
        and workstream.client_visible = false
        and workstream.started_at is not null
        and workstream.completed_at is null
        and workstream.created_at is not null
        and workstream.updated_at is not null
    )
  );
  perform pg_temp.p3_check('no_external_or_default_rows',
    not exists (select 1 from public.engagements where project_id = (first_result ->> 'project_id')::uuid or legacy_project_id = (first_result ->> 'project_id')::uuid)
    and not exists (select 1 from public.milestones where project_id = (first_result ->> 'project_id')::uuid)
    and not exists (select 1 from public.tasks where project_id = (first_result ->> 'project_id')::uuid)
    and not exists (select 1 from public.work_items where project_id = (first_result ->> 'project_id')::uuid)
    and not exists (select 1 from public.project_client_access where project_id = (first_result ->> 'project_id')::uuid)
    and not exists (select 1 from public.project_workflow_templates where project_id = (first_result ->> 'project_id')::uuid)
    and not exists (
      select 1 from public.engagement_services service
      join public.engagements engagement on engagement.id = service.engagement_id
      where engagement.project_id = (first_result ->> 'project_id')::uuid
        or engagement.legacy_project_id = (first_result ->> 'project_id')::uuid
    )
    and not exists (select 1 from public.recurring_work_plans where project_id = (first_result ->> 'project_id')::uuid)
    and not exists (select 1 from public.recurring_work_occurrences where project_id = (first_result ->> 'project_id')::uuid)
    and not exists (
      select 1 from public.recurring_work_generation_attempts attempt
      join public.recurring_work_occurrences occurrence on occurrence.id = attempt.occurrence_id
      where occurrence.project_id = (first_result ->> 'project_id')::uuid
    )
    and not exists (
      select 1 from public.recurring_schedule_admissions admission
      join public.recurring_work_plans plan on plan.id = admission.plan_id
      where plan.project_id = (first_result ->> 'project_id')::uuid
    )
    and not exists (
      select 1 from public.recurring_schedule_executions execution
      join public.recurring_schedule_admissions admission on admission.id = execution.admission_id
      join public.recurring_work_plans plan on plan.id = admission.plan_id
      where plan.project_id = (first_result ->> 'project_id')::uuid
    )
  );
  perform pg_temp.p3_check('only_inherited_living_document_default',
    (select count(*) from public.living_project_documents where project_id = (first_result ->> 'project_id')::uuid) = 1
    and not exists (
      select 1 from public.living_project_document_snapshots snapshot
      join public.living_project_documents document on document.id = snapshot.living_project_document_id
      where document.project_id = (first_result ->> 'project_id')::uuid
    )
  );
  begin
    perform public.create_internal_project_setup(
      fixture.organization_id, fixture.request_id, 'Different payload', '', fixture.actor_id,
      null, null, '', '', jsonb_build_array(jsonb_build_object('department_id', fixture.department_id, 'owner_id', fixture.actor_id))
    );
    raise exception 'conflicting request was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'Request id was already used with different inputs.' then
      raise;
    end if;
    perform pg_temp.p3_check('conflicting_request_rejected', true);
  end;
  begin
    perform public.create_internal_project_setup(
      fixture.organization_id, gen_random_uuid(), 'Empty workstreams', '', fixture.actor_id,
      null, null, '', '', '[]'::jsonb
    );
    raise exception 'empty workstreams were accepted';
  exception when sqlstate '22023' then
    perform pg_temp.p3_check('empty_workstreams_rejected', true);
  end;
  begin
    perform public.create_internal_project_setup(
      fixture.organization_id, gen_random_uuid(), 'Foreign owner', '', gen_random_uuid(),
      null, null, '', '', jsonb_build_array(jsonb_build_object('department_id', fixture.department_id, 'owner_id', fixture.actor_id))
    );
    raise exception 'foreign owner was accepted';
  exception when sqlstate '42501' then
    perform pg_temp.p3_check('foreign_owner_denied', true);
  end;
  begin
    perform public.create_internal_project_setup(
      fixture.organization_id, gen_random_uuid(), 'Mismatched workstream owner', '', fixture.actor_id,
      null, null, '', '', jsonb_build_array(jsonb_build_object('department_id', fixture.other_department_id, 'owner_id', fixture.actor_id))
    );
    raise exception 'department mismatch was accepted';
  exception when sqlstate '42501' then
    perform pg_temp.p3_check('department_owner_mismatch_denied', true);
  end;
end;
$$;

reset role;
update public.organization_memberships
set status = 'revoked'
where organization_id = (select organization_id from p3_internal_setup_fixture)
  and user_id = (select actor_id from p3_internal_setup_fixture);
select set_config('request.jwt.claim.sub', (select actor_id::text from p3_internal_setup_fixture), true);
set local role authenticated;

do $$
declare fixture p3_internal_setup_fixture;
begin
  select * into fixture from p3_internal_setup_fixture;
  begin
    perform public.create_internal_project_setup(
      fixture.organization_id, gen_random_uuid(), 'Revoked caller', '', fixture.actor_id,
      null, null, '', '', jsonb_build_array(jsonb_build_object('department_id', fixture.department_id, 'owner_id', fixture.actor_id))
    );
    raise exception 'inactive caller was accepted';
  exception when sqlstate '42501' then
    perform pg_temp.p3_check('inactive_team_denied', true);
  end;
end;
$$;

reset role;
update public.organization_memberships
set status = 'active'
where organization_id = (select organization_id from p3_internal_setup_fixture)
  and user_id = (select actor_id from p3_internal_setup_fixture);

do $$
declare missing text[];
begin
  select array_agg(required.name order by required.name)
  into missing
  from (values
    ('exact_create_rpc_catalog'), ('exact_create_rpc_acl'), ('exact_owner_directory_catalog'),
    ('exact_owner_directory_acl'), ('exact_ledger_rls_and_policies'), ('exact_ledger_acl'),
    ('exact_ledger_columns'), ('exact_ledger_constraints'), ('exact_ledger_indexes'),
    ('exact_replay_contract_static'), ('canonical_internal_only_static'), ('owner_validation_rls_bridge_static'),
    ('forced_failure_exact_sqlstate_and_message'), ('atomic_rollback_on_workstream_failure'),
    ('authorized_owner_directory_runtime'), ('exact_replay_no_duplicates'), ('exact_internal_project_row'),
    ('exact_selected_workstream_rows'), ('no_external_or_default_rows'),
    ('only_inherited_living_document_default'), ('conflicting_request_rejected'),
    ('empty_workstreams_rejected'), ('foreign_owner_denied'), ('department_owner_mismatch_denied'),
    ('inactive_team_denied')
  ) required(name)
  left join p3_internal_setup_checks actual on actual.check_name = required.name and actual.passed
  where actual.check_name is null;
  if missing is not null then raise exception 'Missing P3 checks: %', missing; end if;
end;
$$;

rollback;
