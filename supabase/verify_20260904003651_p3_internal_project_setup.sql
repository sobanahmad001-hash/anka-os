-- P3 rollback-only verifier. Run only against a disposable/local database after the migration.
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
  v_definition text;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  perform pg_temp.p3_check('security_invoker_empty_search_path',
    exists (select 1 from pg_proc where oid = v_signature and prosecdef = false and proconfig = array['search_path=""'])
  );
  perform pg_temp.p3_check('authenticated_only_execute',
    has_function_privilege('authenticated', v_signature, 'execute')
    and not has_function_privilege('anon', v_signature, 'execute')
    and not has_function_privilege('service_role', v_signature, 'execute')
    and not exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where procedure.oid = v_signature and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  );
  perform pg_temp.p3_check('private_idempotency_rls',
    (select relrowsecurity from pg_class where oid = 'private.internal_project_setup_requests'::regclass)
    and has_table_privilege('authenticated', 'private.internal_project_setup_requests', 'select')
    and has_table_privilege('authenticated', 'private.internal_project_setup_requests', 'insert')
    and not has_table_privilege('anon', 'private.internal_project_setup_requests', 'select')
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
    raise exception 'forced workstream failure';
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
  exception when others then
    if sqlerrm = 'forced failure was not observed' then raise; end if;
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
begin
  select * into fixture from p3_internal_setup_fixture;
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
  perform pg_temp.p3_check('no_external_or_default_rows',
    not exists (select 1 from public.engagements where project_id = (first_result ->> 'project_id')::uuid)
    and not exists (select 1 from public.milestones where project_id = (first_result ->> 'project_id')::uuid)
    and not exists (select 1 from public.engagement_services service join public.engagements engagement on engagement.id = service.engagement_id where engagement.project_id = (first_result ->> 'project_id')::uuid)
  );
  begin
    perform public.create_internal_project_setup(
      fixture.organization_id, fixture.request_id, 'Different payload', '', fixture.actor_id,
      null, null, '', '', jsonb_build_array(jsonb_build_object('department_id', fixture.department_id, 'owner_id', fixture.actor_id))
    );
    raise exception 'conflicting request was accepted';
  exception when sqlstate '22023' then
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
    ('security_invoker_empty_search_path'), ('authenticated_only_execute'), ('private_idempotency_rls'),
    ('exact_replay_contract_static'), ('canonical_internal_only_static'), ('atomic_rollback_on_workstream_failure'),
    ('exact_replay_no_duplicates'), ('no_external_or_default_rows'), ('conflicting_request_rejected'),
    ('empty_workstreams_rejected'), ('foreign_owner_denied'), ('department_owner_mismatch_denied'),
    ('inactive_team_denied')
  ) required(name)
  left join p3_internal_setup_checks actual on actual.check_name = required.name and actual.passed
  where actual.check_name is null;
  if missing is not null then raise exception 'Missing P3 checks: %', missing; end if;
end;
$$;

rollback;
