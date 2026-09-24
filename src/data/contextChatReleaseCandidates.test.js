import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260923220000_context_chat_release_candidate_eligibility.sql', import.meta.url), 'utf8')

test('reviewer list is role-gated, bounded, and excludes private message content', () => {
  assert.match(migration, /membership\.role in \('system_owner', 'operations_admin'\)/)
  assert.match(migration, /limit 51 offset p_offset/)
  assert.match(migration, /reservation\.status in \('reserved', 'uncertain'\)/)
  assert.match(migration, /reservation\.ai_run_id is null/)
  assert.match(migration, /not exists \([\s\S]*?public\.ai_runs run[\s\S]*?context_chat_message_id = claim\.message_id/)
  assert.match(migration, /grant execute on function public\.list_context_chat_release_candidates[\s\S]*?to authenticated/)
  assert.doesNotMatch(migration, /message\.body|run\.input_text|run\.output_text|secret_name/)
})

const recoveryMigration = readFileSync(new URL('../../supabase/migrations/20260923230000_context_chat_persisted_run_recovery.sql', import.meta.url), 'utf8')
const chargeMigration = readFileSync(new URL('../../supabase/migrations/20260923240000_context_chat_confirmed_charge.sql', import.meta.url), 'utf8')

test('audited-run recovery serializes with billing review and stays service-only', () => {
  assert.match(recoveryMigration, /create unique index ai_runs_context_chat_one_run_per_message/)
  assert.match(recoveryMigration, /ai_execution_budget_limits[\s\S]*?for update/)
  assert.match(recoveryMigration, /context_manifest ->> 'dispatch_claim_id'/)
  assert.match(recoveryMigration, /context_manifest ->> 'prompt_sha256'/)
  assert.match(recoveryMigration, /grant execute on function public\.recover_context_chat_completed_run[\s\S]*?to service_role/)
  assert.match(recoveryMigration, /An audited private AI run cannot be released as no charge/)
})

test('confirmed charge review requires a second person and exact cost without an audited run', () => {
  assert.match(chargeMigration, /reservation\.actor_id = reviewer/)
  assert.match(chargeMigration, /p_provider_checked_at < claim\.claimed_at/)
  assert.match(chargeMigration, /p_actual_cost_microusd > reservation\.max_cost_microusd/)
  assert.match(chargeMigration, /exists \(select 1 from public\.ai_runs run/)
  assert.match(chargeMigration, /unique \(organization_id, request_id\)/)
  assert.match(chargeMigration, /grant execute on function public\.settle_context_chat_confirmed_charge[\s\S]*?to authenticated/)
  assert.doesNotMatch(chargeMigration, /grant execute on function public\.settle_context_chat_confirmed_charge[\s\S]*?to anon/)
})
