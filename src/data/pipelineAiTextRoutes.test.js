import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../../supabase/migrations/20260922030000_n6_text_route_configuration.sql', import.meta.url), 'utf8')

test('N6 text routes require approved current scope and remain provider-free', () => {
  assert.match(migration, /unique \(organization_id, department_id, revision\)/)
  assert.match(migration, /unique \(organization_id, request_id\)/)
  assert.match(migration, /priority smallint not null check \(priority between 1 and 3\)/)
  assert.match(migration, /membership\.role in \('system_owner', 'operations_admin'\)/)
  assert.match(migration, /configuration\.revoked_at is null/g)
  assert.match(migration, /connection\.status = 'verified'/g)
  assert.match(migration, /engagement\.engagement_id = intent\.engagement_id/)
  assert.match(migration, /job\.requested_by <> p_actor_id/)
  assert.match(migration, /grant execute on function public\.get_pipeline_ai_text_routes\(uuid, uuid, text, uuid\)\s+to service_role/)
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all) on private\.pipeline_ai_text_route_(?:sets|entries) to authenticated/)
  assert.doesNotMatch(migration, /insert into public\.ai_runs|reserve_pipeline_ai_budget|https?:\/\//)
})