import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260923180000_context_chat_dispatch_claim.sql', import.meta.url), 'utf8')

test('one immutable claim serializes each reserved private reply', () => {
  assert.match(migration, /unique \(reservation_id\)/)
  assert.match(migration, /unique \(organization_id, message_id\)/)
  assert.match(migration, /unique \(organization_id, dispatch_request_id\)/)
  assert.match(migration, /context_chat_message_id = p_message_id[\s\S]*?for update/)
  assert.match(migration, /'already_claimed', 'must_not_submit', true/)
  assert.match(migration, /protect_context_chat_dispatch_claims before update or delete/)
})

test('a provider claim cannot free unresolved budget and cannot be called by browser roles', () => {
  assert.match(migration, /new.status = 'released'[\s\S]*?context_chat_dispatch_claims/)
  assert.match(migration, /grant execute on function public\.claim_context_chat_dispatch[\s\S]*?to service_role/)
  assert.doesNotMatch(migration, /to authenticated|to anon|fetch\(|https?:\/\//)
})
