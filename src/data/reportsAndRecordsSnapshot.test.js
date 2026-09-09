import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260904140000_p8_atomic_living_record_snapshots.sql', import.meta.url), 'utf8')
const canonicalDelivery = readFileSync(new URL('../../supabase/migrations/20260825040000_canonical_delivery_core.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260904140000_p8_atomic_living_record_snapshots.sql', import.meta.url), 'utf8')
const concurrency = readFileSync(new URL('../../scripts/p8-living-record-snapshot-concurrency.ts', import.meta.url), 'utf8')

test('P8 migration fails closed and enforces the exact tenant project document chain', () => {
  assert.match(migration, /P8 preflight: living project document tenant mismatch/)
  assert.match(migration, /P8 preflight: living project snapshot tenant\/project\/document mismatch/)
  for (const constraint of [
    'living_project_documents_project_organization_fkey',
    'living_project_snapshots_document_project_organization_fkey',
    'living_project_snapshots_project_organization_fkey',
  ]) assert.match(migration, new RegExp(constraint))
})

test('P8 snapshot boundary is private, atomic, server-generated, and exactly authorized', () => {
  assert.match(migration, /create function private\.preserve_living_project_snapshot[\s\S]*security definer[\s\S]*set search_path = ''/)
  assert.match(migration, /create function public\.preserve_living_project_snapshot[\s\S]*security invoker[\s\S]*set search_path = ''/)
  assert.match(migration, /auth\.uid\(\)/)
  assert.match(migration, /membership\.member_kind = 'team'[\s\S]*membership\.status = 'active'/)
  assert.match(migration, /v_role not in \('system_owner', 'operations_admin', 'executive'\)/)
  assert.match(migration, /v_role = 'project_owner' and v_owner = v_actor/)
  assert.match(migration, /for share[\s\S]*for update/)
  assert.match(migration, /private\.build_living_project_snapshot_projection/)
  assert.doesNotMatch(migration, /p_snapshot jsonb/)
})

test('P8 snapshot requests are permanently idempotent and conflicting retries fail', () => {
  assert.match(migration, /create table private\.living_project_snapshot_requests/)
  assert.match(migration, /primary key \(organization_id, requested_by, request_id\)/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /payload_sha256/)
  assert.match(migration, /Request id was already used with different inputs/)
  assert.match(migration, /idempotent_replay/)
  assert.doesNotMatch(migration, /delete from private\.living_project_snapshot_requests/)
})

test('P8 removes browser mutation bypass and grants only the narrow RPC', () => {
  assert.match(migration, /revoke insert, update on public\.living_project_documents from authenticated/)
  assert.match(migration, /revoke insert on public\.living_project_document_snapshots from authenticated/)
  assert.match(migration, /revoke all on function public\.preserve_living_project_snapshot[\s\S]*from public, anon, authenticated, service_role/)
  assert.match(migration, /grant execute on function public\.preserve_living_project_snapshot[\s\S]*to authenticated/)
  assert.match(migration, /alter table private\.living_project_snapshot_requests enable row level security/)
})

test('P8 server projection labels recent activity as bounded and orders complete roots deterministically', () => {
  assert.match(migration, /recent_activity_is_complete', false/)
  assert.match(migration, /order by row\.occurred_at desc, row\.id desc limit 50/)
  assert.match(migration, /order by row\.occurred_at desc, row\.id desc limit 25/)
  for (const table of ['workstreams', 'tasks', 'task_dependencies', 'milestones', 'research_records', 'deliverables', 'deliverable_versions', 'requests']) {
    assert.match(migration, new RegExp(`from public\\.${table}[\\s\\S]*order by`))
  }
})

test('P8 browser preview and persisted snapshot share the exact progress contract', () => {
  const internal = migration.match(/if p_projection_kind = 'internal' then([\s\S]*?)elsif p_projection_kind = 'client' then/)?.[1] || ''
  const client = migration.match(/elsif p_projection_kind = 'client' then([\s\S]*?)else\s+raise exception 'Projection kind/)?.[1] || ''

  assert.match(internal, /'progress', jsonb_build_object\(/)
  for (const key of ['workstreams', 'tasks', 'milestones', 'deliverables', 'requests']) {
    assert.match(internal, new RegExp("'" + key + "', coalesce\\(\\(select jsonb_object_agg"))
  }
  assert.match(internal, /coalesce\(nullif\(row\.status::text, ''\), 'unknown'\)/)

  assert.match(client, /'progress', jsonb_build_object\(/)
  for (const key of ['visible_workstreams', 'completed_milestones', 'released_deliverables', 'open_client_requests']) {
    assert.match(client, new RegExp("'" + key + "', \\(select count\\(\\*\\)"))
  }
  assert.match(client, /portal\.withdrawn_at is null/)

  const requestsSchema = canonicalDelivery.match(/create table if not exists public\.requests \(([\s\S]*?)\n\);/)?.[1] || ''
  assert.match(requestsSchema, /\n  resolution text not null default ''/)
  assert.doesNotMatch(requestsSchema, /resolution_summary/)
  assert.match(client, /'resolution_summary', row\.resolution/)
  assert.doesNotMatch(client, /row\.resolution_summary/)
  assert.match(client, /row\.status not in \('completed', 'declined', 'withdrawn'\)/)
  assert.match(internal, /jsonb_strip_nulls\(jsonb_build_object\([\s\S]*?'owner_id', row\.owner_id/)
  assert.match(internal, /jsonb_strip_nulls\(to_jsonb\(row\)\)/)
  assert.match(internal, /'summary', initcap\(replace\(replace\(row\.action, '_', ' '\), '\.', ' '\)\)/)
  assert.doesNotMatch(client, /'action', row\.action, 'target_type'/)
  assert.match(client, /'action', row\.action,[\s\S]*?'summary', initcap\(replace\(replace\(row\.action, '_', ' '\), '\.', ' '\)\)/)
  for (const order of [
    /order by row\.created_at, row\.id/,
    /order by row\.position::text, row\.id/,
    /order by row\.updated_at desc nulls last, row\.id/,
    /order by deliverable\.updated_at desc nulls last, deliverable\.id/,
    /order by version\.version_number::text, version\.id/,
  ]) assert.match(migration, order)
})

test('P8 rollback verifier covers ACL, authorization, replay, conflict, root mismatch, and forced failure', () => {
  assert.match(verifier, /^begin;/m)
  assert.match(verifier, /insert into auth\.users/)
  assert.match(verifier, /insert into public\.organizations/)
  assert.match(verifier, /insert into public\.projects/)
  assert.match(verifier, /insert into public\.requests/)
  assert.doesNotMatch(verifier, /create temporary table p8_fixture as\s+select/)
  assert.match(verifier, /rpc_catalog_and_acl/)
  assert.match(verifier, /unauthorized_contributor_zero_writes/)
  assert.match(verifier, /runtime_exact_replay_and_projection_contract/)
  assert.match(verifier, /projection = expected_projection/)
  assert.match(verifier, /Conflicting retry was accepted/)
  assert.match(verifier, /mismatched_root_zero_writes/)
  assert.match(verifier, /P8 forced snapshot failure/)
  assert.match(verifier, /forced_failure_rolls_back_projection_snapshot_and_ledger/)
  assert.match(verifier, /rollback;\s*$/)
})


test('P8 concurrency harness is loopback-only and proves same-key serialization', () => {
  assert.match(concurrency, /Only an explicitly configured loopback PostgreSQL template is allowed/)
  assert.match(concurrency, /host\(inet_server_addr\(\)\) server_address/)
  assert.doesNotMatch(concurrency, /inet_server_addr\(\)::text server_address/)
  assert.match(concurrency, /Promise\.all\(/)
  assert.match(concurrency, /Promise\.allSettled\(/)
  assert.match(concurrency, /idempotent_replay/)
  assert.match(concurrency, /Request id was already used with different inputs/)
  assert.match(concurrency, /snapshot_count/)
  assert.match(concurrency, /request_count/)
  assert.match(concurrency, /insert into public\.projects\(id,organization_id,name,owner_id,engagement_type\)/)
  assert.doesNotMatch(concurrency, /public\.projects\([^)]*created_by/)
})
