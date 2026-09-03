import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(root + path, 'utf8')
const migration = read('supabase/migrations/20260903235243_department_chat_proposals.sql')
const verifier = read('supabase/verify_20260903235243_department_chat_proposals.sql')
const edge = read('supabase/functions/department-chat/index.ts')
const chat = read('src/components/DepartmentChat.jsx')
const development = read('src/components/DevelopmentTrackingPanel.jsx')
const workshop = read('src/apps/DepartmentWorkshop.jsx')
const repository = read('src/data/departmentChatTransport.js')

function section(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, 'missing section: ' + start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  return endIndex === -1 ? source.slice(startIndex) : source.slice(startIndex, endIndex)
}

test('WCH3 proposal persistence is dedicated, tenant-scoped, expiring, and read-only to browsers', () => {
  assert.ok(migration.includes('create table public.department_chat_proposals'))
  assert.ok(migration.includes("interval '24 hours'"))
  assert.ok(migration.includes('context_artifact_version_ids uuid[]'))
  assert.ok(migration.includes('context_checksum text not null'))
  assert.ok(migration.includes('connector_connection_id uuid not null'))
  assert.ok(migration.includes('model_id text not null'))
  assert.ok(migration.includes('alter table public.department_chat_proposals enable row level security'))
  assert.ok(migration.includes('grant select on public.department_chat_proposals to authenticated'))
  assert.ok(!migration.includes('grant insert on public.department_chat_proposals to authenticated'))
  assert.ok(!migration.includes('grant update on public.department_chat_proposals to authenticated'))
  assert.ok(!migration.includes('grant delete on public.department_chat_proposals to authenticated'))
})

test('WCH3 preview atomically persists an AI run and pending proposal without an official write', () => {
  const save = section(
    migration,
    'create or replace function public.save_department_chat_proposal',
    'create or replace function public.confirm_department_chat_proposal',
  )
  assert.ok(save.includes('insert into public.ai_runs'))
  assert.ok(save.includes('insert into public.department_chat_proposals'))
  for (const forbidden of [
    'insert into public.artifacts',
    'insert into public.artifact_versions',
    'insert into public.work_items',
    'insert into public.tasks',
    'insert into public.artifact_approvals',
  ]) assert.ok(!save.includes(forbidden), forbidden)
  assert.ok(edge.includes('save_department_chat_proposal'))
  assert.ok(!edge.includes("rpc('save_work_item'"))
  assert.ok(!edge.includes('.from("tasks").insert'))
  assert.ok(!edge.includes(".from('tasks').insert"))
})

test('WCH3 confirmation is proposer-only, locked, stale-safe, atomic, and idempotent', () => {
  const confirm = section(
    migration,
    'create or replace function public.confirm_department_chat_proposal',
    'create or replace function public.reject_department_chat_proposal',
  )
  for (const required of [
    'for update',
    'Only the proposer can confirm',
    'context_changed_regenerate',
    "v_proposal.status = 'accepted'",
    "'replayed', true",
    'insert into public.artifact_versions',
    'public.save_work_item',
    "p_status => 'not_started'",
    "p_created_via => 'ai_chat_proposal'",
  ]) assert.ok(confirm.includes(required), required)
  for (const forbidden of [
    'insert into public.tasks',
    'insert into public.artifact_approvals',
    'insert into public.artifact_approval_requests',
    'insert into public.artifact_approval_signoffs',
    'update public.engagement_stage_instances',
    'update public.tasks',
    'update public.projects',
    'update public.engagements',
  ]) assert.ok(!confirm.includes(forbidden), forbidden)
})

test('WCH3 reject and expiry create no official record and decisions are service-role only', () => {
  const reject = section(
    migration,
    'create or replace function public.reject_department_chat_proposal',
    'revoke all on function public.save_department_chat_proposal',
  )
  assert.ok(reject.includes('Only the proposer can reject'))
  assert.ok(reject.includes('proposal_expired'))
  assert.ok(reject.includes("'replayed', true"))
  for (const forbidden of [
    'insert into public.artifacts',
    'insert into public.artifact_versions',
    'insert into public.work_items',
    'insert into public.tasks',
  ]) assert.ok(!reject.includes(forbidden), forbidden)
  for (const name of ['save_department_chat_proposal', 'confirm_department_chat_proposal', 'reject_department_chat_proposal']) {
    const revoke = 'revoke all on function public.' + name
    const grant = 'grant execute on function public.' + name
    assert.ok(migration.includes(revoke), revoke)
    assert.ok(migration.includes(grant), grant)
  }
  assert.ok(migration.includes('from public, anon, authenticated'))
  assert.ok(migration.includes('to service_role'))
})

test('WCH3 UI distinguishes preview from official state and mounts Development only in tracking', () => {
  assert.ok(chat.includes('Preview only'))
  assert.ok(chat.includes('Confirm official draft'))
  assert.ok(chat.includes('Reject'))
  assert.ok(chat.includes('Confirmation is not approval, release, publication, deployment, launch, or stage completion'))
  assert.ok(repository.includes('proposal_id: proposalId'))
  assert.ok(development.includes('departmentId="development"'))
  assert.ok(development.includes("departmentChat.proposeArtifact('development'"))
  assert.ok(!workshop.includes('departmentId="development"'))
})

test('WCH3 preserves narrow Workshop confirmation and does not adopt QTS candidate semantics', () => {
  assert.ok(!edge.includes('quick_tasks'))
  assert.ok(!edge.includes('quick_task_revisions'))
  assert.ok(!edge.includes('promote_quick_task'))
  assert.ok(!migration.includes('insert into public.quick_tasks'))
  assert.ok(!migration.includes('insert into public.tasks'))
  assert.ok(migration.includes('technical_brief'))
  assert.ok(migration.includes('launch_checklist'))
  assert.ok(!migration.includes('design_direction'))
  assert.ok(!migration.includes('marketing_report'))
})

test('WCH4 release matrix includes a rollback-only fail-closed verifier', () => {
  assert.ok(verifier.includes('begin;'))
  assert.ok(verifier.includes('rollback;'))
  assert.ok(verifier.includes('raise exception'))
  for (const check of [
    'proposal_table_rls_enabled',
    'browser_acl_is_read_only',
    'rpc_acl_is_service_role_only',
    'preview_has_no_official_write',
    'confirmation_is_proposer_only',
    'accepted_replay_is_idempotent',
    'stale_confirmation_creates_no_record',
    'expired_confirmation_creates_no_record',
    'rejection_creates_no_record',
    'artifact_is_unapproved',
    'work_item_is_not_started',
    'tasks_are_untouched',
    'transaction_failure_rolls_back',
  ]) assert.ok(verifier.includes(check), check)
})
