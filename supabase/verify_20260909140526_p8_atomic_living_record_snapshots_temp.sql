-- P8 rollback-only verifier. Run only against a disposable/local database after the P8 migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table p8_checks(name text primary key, passed boolean not null) on commit drop;
create or replace function pg_temp.p8_check(p_name text, p_passed boolean)
returns void language plpgsql as $$
begin
  if not p_passed then raise exception 'P8 verification failed: %', p_name; end if;
  insert into p8_checks values (p_name, p_passed);
end;
$$;

do $$
declare
  public_rpc regprocedure := 'public.preserve_living_project_snapshot(uuid,uuid,uuid,text,bigint,uuid,text)'::regprocedure;
  private_rpc regprocedure := 'private.preserve_living_project_snapshot(uuid,uuid,uuid,text,bigint,uuid,text)'::regprocedure;
  public_definition text;
  private_definition text;
begin
  select pg_get_functiondef(public_rpc), pg_get_functiondef(private_rpc)
  into public_definition, private_definition;
  perform pg_temp.p8_check('rpc_catalog_and_acl',
    exists (select 1 from pg_proc where oid = public_rpc and not prosecdef and provolatile = 'v' and proconfig = array['search_path=""'])
    and exists (select 1 from pg_proc where oid = private_rpc and prosecdef and provolatile = 'v' and proconfig = array['search_path=""'])
    and has_function_privilege('authenticated', public_rpc, 'execute')
    and has_function_privilege('authenticated', private_rpc, 'execute')
    and not has_function_privilege('anon', public_rpc, 'execute')
    and not has_function_privilege('service_role', public_rpc, 'execute')
    and not exists (
      select 1 from pg_proc procedure cross join lateral aclexplode(procedure.proacl) acl
      where procedure.oid in (public_rpc, private_rpc) and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  );
  perform pg_temp.p8_check('server_generation_and_linearizable_authorization',
    private_definition like '%auth.uid()%'
    and private_definition like '%membership.member_kind = ''team''%'
    and private_definition like '%membership.status = ''active''%'
    and private_definition like '%membership.role%'
    and private_definition like '%project.owner_id%'
    and private_definition like '%for share%'
    and private_definition like '%for update%'
    and private_definition like '%private.build_living_project_snapshot_projection%'
    and private_definition not like '%p_snapshot%'
  );
  perform pg_temp.p8_check('atomic_idempotency_and_conflict_contract',
    private_definition like '%pg_advisory_xact_lock%'
    and private_definition like '%payload_sha256%'
    and private_definition like '%Request id was already used with different inputs.%'
    and private_definition like '%idempotent_replay%'
  );
  perform pg_temp.p8_check('bypass_grants_removed',
    not has_table_privilege('authenticated', 'public.living_project_documents', 'insert')
    and not has_table_privilege('authenticated', 'public.living_project_documents', 'update')
    and not has_table_privilege('authenticated', 'public.living_project_document_snapshots', 'insert')
    and has_table_privilege('authenticated', 'public.living_project_documents', 'select')
    and has_table_privilege('authenticated', 'public.living_project_document_snapshots', 'select')
  );
  perform pg_temp.p8_check('ledger_private_rls_and_acl',
    (select relrowsecurity from pg_class where oid = 'private.living_project_snapshot_requests'::regclass)
    and not has_table_privilege('authenticated', 'private.living_project_snapshot_requests', 'select')
    and not has_table_privilege('authenticated', 'private.living_project_snapshot_requests', 'insert')
    and not has_table_privilege('anon', 'private.living_project_snapshot_requests', 'select')
  );
  perform pg_temp.p8_check('tenant_chain_constraints',
    exists (select 1 from pg_constraint where conrelid = 'public.living_project_documents'::regclass
      and conname = 'living_project_documents_project_organization_fkey' and contype = 'f')
    and exists (select 1 from pg_constraint where conrelid = 'public.living_project_document_snapshots'::regclass
      and conname = 'living_project_snapshots_document_project_organization_fkey' and contype = 'f')
    and exists (select 1 from pg_constraint where conrelid = 'public.living_project_document_snapshots'::regclass
      and conname = 'living_project_snapshots_project_organization_fkey' and contype = 'f')
  );
end;
$$;

create temporary table p8_fixture as
select organization.id organization_id, membership.user_id actor_id, membership.role original_role,
  project.id project_id, project.owner_id original_owner_id, document.id document_id,
  document.internal_projection original_internal_projection,
  document.client_projection original_client_projection,
  greatest(document.source_version, coalesce((
    select max(snapshot.source_version) + 1
    from public.living_project_document_snapshots snapshot
    where snapshot.living_project_document_id = document.id
  ), document.source_version)) test_source_version,
  gen_random_uuid() success_request_id, gen_random_uuid() rollback_request_id
from public.organizations organization
join public.organization_memberships membership
  on membership.organization_id = organization.id and membership.member_kind = 'team' and membership.status = 'active'
join public.projects project on project.organization_id = organization.id
join public.living_project_documents document
  on document.organization_id = organization.id and document.project_id = project.id
where organization.status = 'active'
order by organization.id, membership.user_id, project.id
limit 1;

do $$
begin
  if not exists (select 1 from p8_fixture) then
    raise exception 'P8 verifier requires one active organization, team member, project, and living document.';
  end if;
end;
$$;
grant select, update on p8_fixture to authenticated;
grant select, insert on p8_checks to authenticated;

update public.organization_memberships membership
set role = 'system_owner'
from p8_fixture fixture
where membership.organization_id = fixture.organization_id and membership.user_id = fixture.actor_id;
update public.projects project set owner_id = fixture.actor_id from p8_fixture fixture where project.id = fixture.project_id;
update public.living_project_documents document set source_version = fixture.test_source_version
from p8_fixture fixture where document.id = fixture.document_id;

select set_config('request.jwt.claim.sub', (select actor_id::text from p8_fixture), true);
set local role authenticated;
create temporary table p8_results as
select public.preserve_living_project_snapshot(
  fixture.organization_id, fixture.project_id, fixture.document_id, 'internal',
  fixture.test_source_version, fixture.success_request_id, 'P8 verifier checkpoint'
) first_result
from p8_fixture fixture;
grant select, update on p8_results to authenticated;
update p8_results set first_result = first_result || jsonb_build_object(
  'replay', (select public.preserve_living_project_snapshot(
    fixture.organization_id, fixture.project_id, fixture.document_id, 'internal',
    fixture.test_source_version, fixture.success_request_id, 'P8 verifier checkpoint'
  ) from p8_fixture fixture)
);
do $$
declare fixture p8_fixture; denied boolean := false;
begin
  select * into fixture from p8_fixture;
  begin
    perform public.preserve_living_project_snapshot(
      fixture.organization_id, fixture.project_id, fixture.document_id, 'internal',
      fixture.test_source_version, fixture.success_request_id, 'conflicting retry');
  exception when invalid_parameter_value then denied := true;
  end;
  if not denied then raise exception 'Conflicting retry was accepted'; end if;
end;
$$;
reset role;

do $$
declare fixture p8_fixture; first_id uuid; replay_id uuid;
begin
  select * into fixture from p8_fixture;
  select (first_result #>> '{snapshot,id}')::uuid, (first_result #>> '{replay,snapshot,id}')::uuid
  into first_id, replay_id from p8_results;
  perform pg_temp.p8_check('runtime_exact_replay_single_snapshot',
    first_id = replay_id
    and (select (first_result #>> '{replay,idempotent_replay}')::boolean from p8_results)
    and (select count(*) from public.living_project_document_snapshots
      where id = first_id and organization_id = fixture.organization_id
        and project_id = fixture.project_id and living_project_document_id = fixture.document_id) = 1
    and (select count(*) from private.living_project_snapshot_requests
      where organization_id = fixture.organization_id and requested_by = fixture.actor_id
        and request_id = fixture.success_request_id) = 1
  );
end;
$$;

update public.organization_memberships membership set role = 'contributor'
from p8_fixture fixture
where membership.organization_id = fixture.organization_id and membership.user_id = fixture.actor_id;
select set_config('request.jwt.claim.sub', (select actor_id::text from p8_fixture), true);
set local role authenticated;
do $$
declare fixture p8_fixture; denied boolean := false;
begin
  select * into fixture from p8_fixture;
  begin
    perform public.preserve_living_project_snapshot(
      fixture.organization_id, fixture.project_id, fixture.document_id, 'client',
      fixture.test_source_version, gen_random_uuid(), 'unauthorized');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Unauthorized contributor preserved a snapshot'; end if;
end;
$$;
reset role;
select pg_temp.p8_check('unauthorized_role_zero_writes',
  not exists (select 1 from public.living_project_document_snapshots snapshot, p8_fixture fixture
    where snapshot.living_project_document_id = fixture.document_id
      and snapshot.projection_kind = 'client' and snapshot.source_version = fixture.test_source_version));

update public.organization_memberships membership set role = 'system_owner'
from p8_fixture fixture
where membership.organization_id = fixture.organization_id and membership.user_id = fixture.actor_id;
create or replace function pg_temp.p8_force_snapshot_failure()
returns trigger language plpgsql as $$
begin
  if new.reason = 'P8 forced rollback' then
    raise exception using errcode = 'P8001', message = 'P8 forced snapshot failure';
  end if;
  return new;
end;
$$;
create trigger trg_p8_force_snapshot_failure
before insert on public.living_project_document_snapshots
for each row execute function pg_temp.p8_force_snapshot_failure();

select set_config('request.jwt.claim.sub', (select actor_id::text from p8_fixture), true);
set local role authenticated;
do $$
declare fixture p8_fixture; failed boolean := false;
begin
  select * into fixture from p8_fixture;
  begin
    perform public.preserve_living_project_snapshot(
      fixture.organization_id, fixture.project_id, fixture.document_id, 'client',
      fixture.test_source_version, fixture.rollback_request_id, 'P8 forced rollback');
  exception when sqlstate 'P8001' then failed := true;
  end;
  if not failed then raise exception 'Forced snapshot failure was not observed'; end if;
end;
$$;
reset role;
drop trigger trg_p8_force_snapshot_failure on public.living_project_document_snapshots;

do $$
declare fixture p8_fixture;
begin
  select * into fixture from p8_fixture;
  perform pg_temp.p8_check('forced_failure_rolls_back_projection_snapshot_and_ledger',
    (select client_projection from public.living_project_documents where id = fixture.document_id)
      is not distinct from fixture.original_client_projection
    and not exists (select 1 from public.living_project_document_snapshots snapshot
      where snapshot.living_project_document_id = fixture.document_id
        and snapshot.projection_kind = 'client' and snapshot.source_version = fixture.test_source_version)
    and not exists (select 1 from private.living_project_snapshot_requests request
      where request.organization_id = fixture.organization_id and request.requested_by = fixture.actor_id
        and request.request_id = fixture.rollback_request_id)
  );
end;
$$;

select set_config('request.jwt.claim.sub', (select actor_id::text from p8_fixture), true);
set local role authenticated;
do $$
declare fixture p8_fixture; denied boolean := false;
begin
  select * into fixture from p8_fixture;
  begin
    perform public.preserve_living_project_snapshot(
      fixture.organization_id, fixture.project_id, gen_random_uuid(), 'client',
      fixture.test_source_version, gen_random_uuid(), 'mismatched root');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Mismatched document root was accepted'; end if;
end;
$$;
reset role;
select pg_temp.p8_check('mismatched_root_zero_writes', true);

do $$
declare failed text;
begin
  select string_agg(name, ', ' order by name) into failed from p8_checks where not passed;
  if failed is not null then raise exception 'P8 failed checks: %', failed; end if;
end;
$$;
select jsonb_object_agg(name, passed order by name) as p8_living_record_snapshot_verification from p8_checks;
rollback;
