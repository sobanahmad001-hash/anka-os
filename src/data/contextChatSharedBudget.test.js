import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260923170000_context_chat_shared_budget.sql', import.meta.url), 'utf8')
const n6 = readFileSync(new URL('../../supabase/migrations/20260922150000_n6_step_budget_reservations.sql', import.meta.url), 'utf8')

test('private conversation reservations share the atomic N6 organization ledger', () => {
  assert.match(migration, /alter table private\.ai_execution_step_budget_reservations/)
  assert.match(migration, /where organization_id = p_organization_id for update/)
  assert.match(migration, /from private\.ai_execution_step_budget_reservations reservation/)
  assert.match(n6, /from private\.ai_execution_step_budget_reservations reservation/)
  assert.match(migration, /unique index ai_execution_step_budget_context_message_unique/)
  assert.match(migration, /context_chat_message_id is not null/)
})

test('completed run and reservation identify the same owner-controlled human turn', () => {
  assert.match(migration, /ai_runs_context_chat_message_scope_check/)
  assert.match(migration, /message\.role = 'user' and message\.status = 'completed'/)
  assert.match(migration, /message\.author_id = p_actor_id/)
  assert.match(migration, /run\.context_chat_message_id = reservation\.context_chat_message_id/)
  assert.match(migration, /run\.estimated_cost_microusd = p_actual_cost_microusd/)
  assert.match(migration, /run\.status = 'completed'/)
})

test('budget mutation remains service-only and this migration cannot dispatch', () => {
  assert.match(migration, /grant execute on function public\.reserve_context_chat_budget[\s\S]*?to service_role/)
  assert.match(migration, /grant execute on function public\.reconcile_context_chat_budget[\s\S]*?to service_role/)
  assert.doesNotMatch(migration, /https?:\/\/|fetch\(|insert into public\.ai_runs|monthly_limit_microusd\s*=|insert into private\.ai_execution_budget_limits/)
})
