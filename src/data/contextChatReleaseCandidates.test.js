import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260923220000_context_chat_release_candidate_eligibility.sql', import.meta.url), 'utf8')

test('reviewer list is role-gated, bounded, and excludes private message content', () => {
  assert.match(migration, /membership\.role in \('system_owner', 'operations_admin'\)/)
  assert.match(migration, /limit 51 offset p_offset/)
  assert.match(migration, /reservation\.status in \('reserved', 'uncertain'\)/)
  assert.match(migration, /reservation\.ai_run_id is null/)
  assert.match(migration, /grant execute on function public\.list_context_chat_release_candidates[\s\S]*?to authenticated/)
  assert.doesNotMatch(migration, /message\.body|run\.input_text|run\.output_text|secret_name/)
})
