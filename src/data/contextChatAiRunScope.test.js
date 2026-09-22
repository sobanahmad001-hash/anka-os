import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260923160000_context_chat_ai_run_scope.sql', import.meta.url), 'utf8')

test('private AI audit binds a run to its conversation owner and selected verified model', () => {
  assert.match(migration, /foreign key \(context_chat_conversation_id, organization_id, user_id\)/)
  assert.match(migration, /foreign key \(context_chat_model_configuration_id, organization_id\)/)
  assert.match(migration, /conversation\.context_kind = 'organization'/)
  assert.match(migration, /configuration\.model_id = new\.model/)
  assert.match(migration, /connection\.provider = new\.provider/)
  assert.match(migration, /department_chat_conversation_id is null and engagement_id is null/)
})

test('private conversation run payload stays out of leadership-wide audit and migration cannot dispatch', () => {
  assert.match(migration, /alter policy "Leaders can audit organization AI runs"/)
  assert.match(migration, /context_chat_conversation_id is null/)
  assert.doesNotMatch(migration, /https?:\/\/|fetch\(|insert into public\.ai_runs|reserve_.*budget/)
})
