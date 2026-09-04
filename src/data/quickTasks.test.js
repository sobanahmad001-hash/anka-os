import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { daysUntilExpiry, quickTaskContent, QUICK_TASK_STATES } from './quickTasks.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260903071848_qts1_private_core.sql')
const repository = read('src/data/quickTasksRepository.js')
const screen = read('src/apps/QuickTasks.jsx')
const edge = read('supabase/functions/quick-tasks/index.ts')
const config = read('supabase/config.toml')
const verifier = read('supabase/verify_20260903071848_qts1_private_core.sql')
const ci = read('.github/workflows/ci.yml')
const qts2Migration = read('supabase/migrations/20260903100732_qts2_sandbox_chat.sql')
const qts2Verifier = read('supabase/verify_20260903100732_qts2_sandbox_chat.sql')
const packageJson = read('package.json')

test('QTS1 content normalization is bounded and predictable', () => {
  const content = quickTaskContent({ notes: ' idea ', checklist: [{ text: ' ship ', done: 1 }, { text: '' }] })
  assert.equal(content.notes, ' idea ')
  assert.deepEqual(content.checklist, [{ text: 'ship', done: true }])
  assert.deepEqual(QUICK_TASK_STATES, ['active', 'preserved', 'expired', 'discarded', 'promoted'])
  assert.equal(daysUntilExpiry('2026-09-06T00:00:00Z', new Date('2026-09-03T00:00:00Z')), 3)
})

test('QTS1 schema separates private content from metadata-only lifecycle audit', () => {
  assert.match(migration, /create table public\.quick_tasks/)
  assert.match(migration, /create table public\.quick_task_revisions/)
  assert.match(migration, /create table public\.quick_task_lifecycle_events/)
  const events = migration.slice(migration.indexOf('create table public.quick_task_lifecycle_events'), migration.indexOf('create index idx_quick_tasks_owner_activity'))
  assert.doesNotMatch(events, /\b(content|title)\b/)
  assert.match(migration, /Quick Task history is append-only/)
  assert.match(migration, /interval '30 days'/)
  for (const index of [
    'idx_quick_tasks_current_revision', 'idx_quick_tasks_fork_source',
    'idx_quick_tasks_fork_revision', 'idx_quick_task_revisions_task_owner',
    'idx_quick_task_revisions_owner', 'idx_quick_task_revisions_created_by',
    'idx_quick_task_lifecycle_events_task_owner', 'idx_quick_task_lifecycle_events_related',
  ]) assert.match(migration, new RegExp(index))
})

test('QTS1 owner RLS protects task and revision content while leadership sees only events', () => {
  assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/)
  assert.match(migration, /Owners and leaders can read Quick Task lifecycle metadata/)
  assert.match(migration, /system_owner.*operations_admin.*executive/s)
  assert.doesNotMatch(migration, /create policy[^;]*(insert|update|delete)/i)
  assert.match(migration, /revoke all on table public\.quick_tasks, public\.quick_task_revisions/)
})

test('QTS1 mutations are atomic service-role operations with exact revision checks', () => {
  for (const name of ['create_quick_task', 'append_quick_task_revision', 'fork_quick_task']) assert.match(migration, new RegExp(`function public\\.${name}`))
  assert.match(migration, /current_revision_id <> p_expected_revision_id/)
  assert.match(migration, /to service_role/)
  assert.match(edge, /admin\.rpc\(functionName/)
  assert.match(edge, /user\.id/)
  assert.match(config, /\[functions\.quick-tasks\][\s\S]*verify_jwt = true/)
})

test('QTS1 Edge Function is covered by frozen CI tests and checks', () => {
  assert.match(ci, /deno test --frozen[^\n]*quick-tasks\/index\.test\.ts/)
  assert.match(ci, /deno check --frozen[^\n]*quick-tasks\/index\.ts[^\n]*quick-tasks\/index\.test\.ts/)
})

test('QTS1 ships standalone UI and does not register or mutate canonical records', () => {
  assert.match(screen, /export default function QuickTasks/)
  assert.match(screen, /promotion is intentionally unavailable/i)
  assert.match(repository, /\.from\('quick_tasks'\)/)
  assert.match(repository, /functions\.invoke\('quick-tasks'/)
  for (const source of [migration, repository, edge, screen]) {
    assert.doesNotMatch(source, /from\(['"](artifacts|work_items|tasks|engagements)['"]\).*\.(insert|update|upsert|delete)/is)
  }
  for (const owned of ['src/App.jsx', 'src/config/environmentNav.js', 'src/components/Sidebar.jsx', 'src/components/Header.jsx']) {
    assert.ok(fs.existsSync(path.join(root, owned)))
  }
})

test('QTS1 verifier is rollback-safe, exhaustive, and fails closed', () => {
  for (const check of [
    'owner_can_read_content', 'leadership_metadata_only_access',
    'wrong_owner_operations_rejected', 'cross_organization_create_rejected',
    'optimistic_concurrency_rejected', 'revision_update_rejected',
    'revision_delete_rejected', 'lifecycle_update_rejected',
    'lifecycle_delete_rejected', 'create_append_fork_are_atomic_and_audited',
    'table_acls_are_exact', 'rpc_execute_acls_are_exact',
    'owner_content_policies_are_exact', 'leadership_event_policy_is_exact',
    'no_write_policies_exist', 'composite_foreign_keys_are_exact',
    'composite_fk_supporting_indexes_are_exact',
  ]) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /jsonb_object_agg\(check_name, passed order by check_name\)/)
  assert.match(verifier, /raise exception 'QTS1 verification failed/)
  assert.doesNotMatch(verifier, /\bconstraint\./i)
  assert.doesNotMatch(verifier, /from\s+pg_constraint\s+constraint\b/i)
  assert.match(verifier, /insert into auth\.users \(id\) values \(v_owner\), \(v_leader\)/)
  assert.match(verifier, /\(v_org, v_owner, 'team', 'contributor'/)
  assert.match(verifier, /\(v_org, v_leader, 'team', 'system_owner'/)
  assert.doesNotMatch(verifier, /update public\.organization_memberships|delete from public\.organization_memberships/i)
  assert.match(verifier.trim(), /rollback;$/)
  assert.doesNotMatch(verifier, /(^|\n)\s*commit\s*;/i)
})

test('QTS2 sandbox chat has no canonical context or action surface', () => {
  assert.match(edge, /store:\s*false/)
  assert.match(edge, /record_quick_task_chat_failure/)
  assert.match(edge, /capability:\s*'quick_task_chat'|record_quick_task_chat_success/)
  assert.doesNotMatch(edge, /\.from\(['"](?:artifacts|work_items|tasks|engagements|content_requests)['"]\)/)
  assert.doesNotMatch(edge, /save_work_item|createContentArtifactVersion|propose_artifact|propose_work_item/)
  assert.doesNotMatch(qts2Migration, /insert into public\.(?:artifacts|work_items|tasks|engagements|projects|content_requests)/)
})

test('QTS2 persists only owner-private append-only messages and validated sandbox revisions', () => {
  assert.match(qts2Migration, /create table public\.quick_task_messages/)
  assert.match(qts2Migration, /Owners can read their Quick Task messages/)
  assert.match(qts2Migration, /trg_quick_task_messages_append_only/)
  assert.match(qts2Migration, /idx_quick_task_messages_owner/)
  assert.match(qts2Migration, /source_kind in \('manual', 'quick_chat', 'copied_general_request', 'copied_department_chat'\)/)
  assert.match(qts2Migration, /private\.is_valid_quick_task_sandbox_content/)
  assert.match(qts2Migration, /record_quick_task_chat_success/)
  assert.match(qts2Migration, /record_quick_task_chat_failure/)
  const failure = qts2Migration.slice(qts2Migration.indexOf('create function public.record_quick_task_chat_failure'))
  assert.doesNotMatch(failure, /update public\.quick_tasks/)
})

test('QTS2 uses organization and department model mapping with retained-disabled audited AI', () => {
  assert.match(edge, /integration_connection_departments!inner\(department_id\)/)
  assert.doesNotMatch(edge, /integration_connection_engagements/)
  assert.match(edge, /Hourly AI run limit reached/)
  assert.match(edge, /Organization AI budget has been reached/)
  assert.match(edge, /store:\s*false/)
  assert.match(qts2Migration, /'quick_task_chat'/)
  assert.match(qts2Migration, /input_text, output_text, context_manifest/)
  assert.match(qts2Migration, /input_tokens, output_tokens, estimated_cost_microusd/)
  assert.match(qts2Migration, /capability <> 'quick_task_chat'/)
})

test('QTS2 UI and manifests expose sandbox chat without promotion', () => {
  assert.match(repository, /messages: quickTaskId/)
  assert.match(repository, /chat: input => invoke\('chat'/)
  assert.match(screen, /Sandbox chat/)
  assert.match(screen, /Create sandbox revision/)
  assert.match(screen, /promotion is (?:intentionally )?unavailable/i)
  assert.match(config, /\[functions\.quick-tasks\][\s\S]*verify_jwt = true/)
  assert.match(packageJson, /supabase functions deploy quick-tasks/)
})

test('QTS2 verifier is rollback-only, exhaustive, and fails closed', () => {
  for (const check of [
    'success_is_atomic_and_audited', 'failure_is_audited_without_activity',
    'owner_only_transcript_and_ai_content', 'wrong_department_rejected',
    'message_update_rejected', 'message_delete_rejected', 'no_canonical_side_effects',
    'message_rls_enabled', 'message_policy_is_owner_only', 'leader_ai_policy_excludes_qts',
    'message_table_acls_are_exact', 'rpc_execute_acls_are_exact',
    'qts_foreign_keys_are_tenant_exact', 'qts_fk_indexes_exist', 'messages_are_append_only',
    'ai_capability_and_context_are_explicit', 'no_message_write_policies',
  ]) assert.match(qts2Verifier, new RegExp(check))
  assert.match(qts2Verifier, /jsonb_object_agg\(check_name, passed order by check_name\)/)
  assert.match(qts2Verifier, /raise exception 'QTS2 verification failed/)
  assert.match(qts2Verifier.trim(), /rollback;$/)
  assert.doesNotMatch(qts2Verifier, /(^|\n)\s*commit\s*;/i)
  assert.doesNotMatch(qts2Verifier, /\bconstraint\./i)
  assert.doesNotMatch(qts2Verifier, /from\s+pg_constraint\s+constraint\b/i)
})
