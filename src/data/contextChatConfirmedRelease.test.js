import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260923200000_context_chat_confirmed_release.sql', import.meta.url), 'utf8')

test('claimed private budget remains held without independent no-charge evidence', () => {
  assert.match(migration, /review\.reservation_id = old\.id/)
  assert.match(migration, /review\.confirmed_no_charge/)
  assert.match(migration, /reservation\.actor_id = reviewer/)
  assert.match(migration, /membership\.role in \('system_owner', 'operations_admin'\)/)
  assert.match(migration, /p_provider_checked_at < claim\.claimed_at/)
  assert.match(migration, /p_confirmed_no_charge is distinct from true/)
})

test('review is immutable, scoped, and stored before atomic release', () => {
  assert.match(migration, /protect_context_chat_confirmed_release_reviews before update or delete/)
  assert.match(migration, /unique \(organization_id, request_id\)/)
  assert.match(migration, /insert into private\.context_chat_confirmed_release_reviews[\s\S]*?result := public\.reconcile_context_chat_budget/)
  assert.match(migration, /grant execute on function public\.release_context_chat_confirmed_no_charge[\s\S]*?to authenticated/)
  assert.doesNotMatch(migration, /fetch\(|https?:\/\//)
})
