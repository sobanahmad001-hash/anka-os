import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260923190000_context_chat_audited_reply.sql', import.meta.url), 'utf8')

test('private reply is copied only from a settled audit for the exact source turn', () => {
  assert.match(migration, /unique index department_chat_messages_one_reply_per_source/)
  assert.match(migration, /status = 'settled'/)
  assert.match(migration, /context_chat_message_id = source\.id/)
  assert.match(migration, /context_chat_model_configuration_id = claim\.model_configuration_id/)
  assert.match(migration, /output_body := btrim\(coalesce\(run\.output_text, ''\)\)/)
  assert.match(migration, /in_reply_to_message_id = source\.id/)
  assert.match(migration, /for update/)
})

test('audited append remains service-only and does not dispatch', () => {
  assert.match(migration, /grant execute on function public\.append_context_chat_audited_reply[\s\S]*?to service_role/)
  assert.doesNotMatch(migration, /to authenticated|to anon|fetch\(|https?:\/\//)
})
