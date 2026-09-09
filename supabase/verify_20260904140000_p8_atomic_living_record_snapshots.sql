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

create temporary table p8_fixture (
  organization_id uuid not null,
  actor_id uuid not null,
  contributor_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  request_id uuid not null,
  source_version bigint not null,
  success_request_id uuid not null,
  rollback_request_id uuid not null,
  mismatch_request_id uuid not null,
  original_internal_projection jsonb not null,
  original_client_projection jsonb not null
) on commit drop;
create temporary table p8_results(first_result jsonb not null, replay_result jsonb) on commit drop;

select set_config('request.jwt.claims', '{}', true);

do $$
declare
  v_organization_id uuid := gen_random_uuid();
  v_actor_id uuid := gen_random_uuid();
  v_contributor_id uuid := gen_random_uuid();
  v_project_id uuid := gen_random_uuid();
  v_request_id uuid := gen_random_uuid();
  v_document public.living_project_documents%rowtype;
begin
  insert into auth.users(id) values (v_actor_id), (v_contributor_id);
  insert into public.organizations(id, name, slug, status)
  values (
    v_organization_id,
    'P8 synthetic verification organization',
    'p8-verify-' || replace(v_organization_id::text, '-', ''),
    'active'
  );
  insert into public.organization_memberships(
    organization_id, user_id, member_kind, role, status
  ) values
    (v_organization_id, v_actor_id, 'team', 'system_owner', 'active'),
    (v_organization_id, v_contributor_id, 'team', 'contributor', 'active');

  insert into public.projects(
    id, organization_id, client_id, name, description, department_id,
    engagement_type, status, priority, owner_id, scope_statement, exclusions, portal_visible
  ) values (
    v_project_id, v_organization_id, null, 'P8 synthetic verification project',
    'Synthetic rollback-only project', null, 'internal', 'active', 'medium',
    v_actor_id, 'Synthetic scope', '', false
  );

  select document.* into strict v_document
  from public.living_project_documents document
  where document.organization_id = v_organization_id and document.project_id = v_project_id;

  insert into public.requests(
    id, organization_id, project_id, request_type, request_origin, title,
    requested_output, priority, status, visibility, requested_by, resolution
  ) values (
    v_request_id, v_organization_id, v_project_id, 'change', 'team',
    'P8 canonical request', 'Verify persisted projection', 'medium',
    'in_progress', 'client_visible', v_actor_id, 'Canonical resolution detail'
  );

  insert into p8_fixture values (
    v_organization_id, v_actor_id, v_contributor_id, v_project_id,
    v_document.id, v_request_id, v_document.source_version,
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    v_document.internal_projection, v_document.client_projection
  );
end;
$$;

grant select on p8_fixture to authenticated;
grant select, insert, update on p8_results to authenticated;
grant select, insert on p8_checks to authenticated;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select actor_id from p8_fixture), 'role', 'authenticated'
)::text, true);
set local role authenticated;
insert into p8_results(first_result)
select public.preserve_living_project_snapshot(
  organization_id, project_id, document_id, 'client', source_version,
  success_request_id, 'P8 synthetic verifier checkpoint'
)
from p8_fixture;
update p8_results set replay_result = (
  select public.preserve_living_project_snapshot(
    organization_id, project_id, document_id, 'client', source_version,
    success_request_id, 'P8 synthetic verifier checkpoint'
  )
  from p8_fixture
);
do $$
declare fixture p8_fixture; denied boolean := false;
begin
  select * into strict fixture from p8_fixture;
  begin
    perform public.preserve_living_project_snapshot(
      fixture.organization_id, fixture.project_id, fixture.document_id, 'client',
      fixture.source_version, fixture.success_request_id, 'conflicting retry');
  exception when invalid_parameter_value then denied := true;
  end;
  if not denied then raise exception 'Conflicting retry was accepted'; end if;
end;
$$;
reset role;

do $$
declare
  fixture p8_fixture;
  first_result jsonb;
  replay_result jsonb;
  projection jsonb;
  expected_projection jsonb;
  project public.projects%rowtype;
begin
  select * into strict fixture from p8_fixture;
  select results.first_result, results.replay_result
  into strict first_result, replay_result
  from p8_results results;
  projection := first_result #> '{snapshot,snapshot}';
  select row.* into strict project from public.projects row where row.id = fixture.project_id;
  expected_projection := jsonb_build_object(
    'schema_version', 1,
    'projection_kind', 'client',
    'generated_at', projection->'generated_at',
    'source_version', fixture.source_version,
    'project', jsonb_strip_nulls(jsonb_build_object(
      'id', project.id,
      'name', project.name,
      'engagement_type', project.engagement_type,
      'status', project.status,
      'health', project.health,
      'priority', project.priority,
      'start_date', project.start_date,
      'due_date', project.due_date,
      'summary', project.client_summary
    )),
    'progress', jsonb_build_object(
      'visible_workstreams', 0,
      'completed_milestones', 0,
      'released_deliverables', 0,
      'open_client_requests', 1
    ),
    'workstreams', '[]'::jsonb,
    'milestones', '[]'::jsonb,
    'deliverables', '[]'::jsonb,
    'requests', jsonb_build_array(jsonb_build_object(
      'id', fixture.request_id,
      'request_type', 'change',
      'title', 'P8 canonical request',
      'status', 'in_progress',
      'priority', 'medium',
      'resolution_summary', 'Canonical resolution detail'
    )),
    'recent_activity', '[]'::jsonb,
    'recent_activity_is_complete', false
  );

  perform pg_temp.p8_check('runtime_exact_replay_and_projection_contract',
    first_result #>> '{snapshot,id}' = replay_result #>> '{snapshot,id}'
    and (replay_result->>'idempotent_replay')::boolean
    and projection = expected_projection
    and projection->'progress' = jsonb_build_object(
      'visible_workstreams', 0,
      'completed_milestones', 0,
      'released_deliverables', 0,
      'open_client_requests', 1
    )
    and jsonb_array_length(projection->'requests') = 1
    and projection #>> '{requests,0,id}' = fixture.request_id::text
    and projection #>> '{requests,0,resolution_summary}' = 'Canonical resolution detail'
    and not ((projection #> '{requests,0}') ? 'resolution')
    and (select count(*) from public.living_project_document_snapshots
      where id = (first_result #>> '{snapshot,id}')::uuid
        and organization_id = fixture.organization_id
        and project_id = fixture.project_id
        and living_project_document_id = fixture.document_id) = 1
    and (select count(*) from private.living_project_snapshot_requests
      where organization_id = fixture.organization_id and requested_by = fixture.actor_id
        and request_id = fixture.success_request_id) = 1
  );
end;
$$;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select contributor_id from p8_fixture), 'role', 'authenticated'
)::text, true);
set local role authenticated;
do $$
declare fixture p8_fixture; denied boolean := false;
begin
  select * into strict fixture from p8_fixture;
  begin
    perform public.preserve_living_project_snapshot(
      fixture.organization_id, fixture.project_id, fixture.document_id, 'internal',
      fixture.source_version, gen_random_uuid(), 'unauthorized contributor');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Unauthorized contributor preserved a snapshot'; end if;
end;
$$;
reset role;
select pg_temp.p8_check('unauthorized_contributor_zero_writes',
  not exists (
    select 1 from public.living_project_document_snapshots snapshot, p8_fixture fixture
    where snapshot.living_project_document_id = fixture.document_id
      and snapshot.projection_kind = 'internal'
      and snapshot.source_version = fixture.source_version
  )
);

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

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select actor_id from p8_fixture), 'role', 'authenticated'
)::text, true);
set local role authenticated;
do $$
declare fixture p8_fixture; failed boolean := false;
begin
  select * into strict fixture from p8_fixture;
  begin
    perform public.preserve_living_project_snapshot(
      fixture.organization_id, fixture.project_id, fixture.document_id, 'internal',
      fixture.source_version, fixture.rollback_request_id, 'P8 forced rollback');
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
  select * into strict fixture from p8_fixture;
  perform pg_temp.p8_check('forced_failure_rolls_back_projection_snapshot_and_ledger',
    (select internal_projection from public.living_project_documents where id = fixture.document_id)
      is not distinct from fixture.original_internal_projection
    and not exists (
      select 1 from public.living_project_document_snapshots snapshot
      where snapshot.living_project_document_id = fixture.document_id
        and snapshot.projection_kind = 'internal'
        and snapshot.source_version = fixture.source_version
    )
    and not exists (
      select 1 from private.living_project_snapshot_requests request
      where request.organization_id = fixture.organization_id
        and request.requested_by = fixture.actor_id
        and request.request_id = fixture.rollback_request_id
    )
  );
end;
$$;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select actor_id from p8_fixture), 'role', 'authenticated'
)::text, true);
set local role authenticated;
do $$
declare fixture p8_fixture; denied boolean := false;
begin
  select * into strict fixture from p8_fixture;
  begin
    perform public.preserve_living_project_snapshot(
      fixture.organization_id, fixture.project_id, gen_random_uuid(), 'internal',
      fixture.source_version, fixture.mismatch_request_id, 'mismatched root');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Mismatched document root was accepted'; end if;
end;
$$;
reset role;
select pg_temp.p8_check('mismatched_root_zero_writes',
  not exists (
    select 1 from private.living_project_snapshot_requests request, p8_fixture fixture
    where request.organization_id = fixture.organization_id
      and request.requested_by = fixture.actor_id
      and request.request_id = fixture.mismatch_request_id
  )
);

do $$
declare failed text;
begin
  select string_agg(name, ', ' order by name) into failed from p8_checks where not passed;
  if failed is not null then raise exception 'P8 failed checks: %', failed; end if;
end;
$$;
select jsonb_object_agg(name, passed order by name) as p8_living_record_snapshot_verification
from p8_checks;
rollback;
