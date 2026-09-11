import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(root + path, 'utf8')
const migration = read('supabase/migrations/20260910153055_p9_chat_internal_sharing.sql')
const verifier = read('supabase/verify_20260910153055_p9_chat_internal_sharing.sql')
const edge = read('supabase/functions/department-chat/index.ts')
const chat = read('src/components/DepartmentChat.jsx')
const transport = read('src/data/departmentChatTransport.js')

function section(source, start, end) {
  const from = source.indexOf(start)
  assert.notEqual(from, -1, 'missing section: ' + start)
  const to = source.indexOf(end, from + start.length)
  return to === -1 ? source.slice(from) : source.slice(from, to)
}

test('CHAT-2 sharing is creator-selected, internal, exact-scope, and revocable', () => {
  const shares = section(migration, 'create table public.department_chat_conversation_shares', 'create index idx_department_chat_conversation_shares_recipient')
  const setter = section(migration, 'create function public.set_department_chat_conversation_shares', 'create or replace function private.protect_department_chat_proposal_conversation')
  for (const required of [
    'foreign key (conversation_id, organization_id, project_id, engagement_id, department_id, owner_id)',
    'recipient_id <> owner_id and shared_by = owner_id',
    'conversation.owner_id = p_actor_id',
    'private.is_current_department_chat_contributor',
    'set revoked_at = now()',
    'on conflict (conversation_id, recipient_id) do update',
  ]) assert.ok((shares + setter).includes(required), required)
  assert.ok(migration.includes('project.archived_at is null'))
  assert.ok((migration.match(/join public\.engagement_services service/g) || []).length >= 6)
})

test('CHAT-2 keeps collaborator authorship separate from conversation ownership', () => {
  for (const required of [
    'department_chat_conversation_owner_id uuid',
    'conversation_owner_id uuid',
    'department_chat_conversation_owner_id = v_conversation.owner_id',
    'conversation_owner_id = v_conversation.owner_id',
    'message.author_id = p_actor_id',
    "v_message.author_id <> p_actor_id",
    "v_message.body <> btrim(p_prompt)",
  ]) assert.ok(migration.includes(required), required)
  assert.ok(migration.includes('foreign key (department_chat_conversation_id, organization_id, project_id, engagement_id, department_chat_conversation_owner_id)'))
  assert.ok(migration.includes('foreign key (conversation_id, organization_id, project_id, engagement_id, department_id, conversation_owner_id)'))
  assert.ok(migration.includes('Users can read own standalone AI runs'))
  assert.ok(migration.includes('department_chat_conversation_id is null'))
  assert.ok(migration.includes('(conversation_id is null and proposer_id = (select auth.uid()))'))
})

test('CHAT-2 preserves dispatch ambiguity and deterministic concurrent ordering', () => {
  const begin = section(migration, 'create or replace function public.begin_department_chat_turn', 'create or replace function public.fail_department_chat_turn')
  assert.ok(begin.includes('for update'))
  assert.ok(begin.includes('next_sequence = next_sequence + 1'))
  assert.ok(migration.includes('create or replace function public.mark_department_chat_turn_dispatched'))
  assert.ok(migration.includes('create or replace function public.mark_department_chat_turn_unknown'))
  assert.ok(migration.includes("then 'interrupted' else 'outcome_unknown'"))
  assert.ok(migration.includes("error_code = 'outcome_unknown'"))
})

test('CHAT-2 browser access is read-only and service RPCs stay closed', () => {
  assert.ok(migration.includes('alter table public.department_chat_conversation_shares enable row level security'))
  assert.ok(migration.includes('grant select on table public.department_chat_conversation_shares to authenticated, service_role'))
  assert.ok(!migration.includes('grant insert on table public.department_chat_conversation_shares to authenticated'))
  for (const signature of [
    'public.can_access_department_chat_conversation(uuid, uuid, uuid, uuid, text, uuid)',
    'public.set_department_chat_conversation_shares(uuid, uuid, uuid, uuid, text, uuid, uuid[])',
  ]) assert.ok(migration.includes('revoke all on function ' + signature), signature)
})

test('CHAT-2 endpoint and UI expose sharing without added approval or execution power', () => {
  for (const action of ['list_conversation_share_candidates', 'set_conversation_shares']) {
    assert.ok(edge.includes(action), action)
  }
  for (const method of ['listConversationShareCandidates', 'setConversationShares']) {
    assert.ok(transport.includes(method), method)
  }
  for (const text of [
    'Share conversation and linked previews',
    'Removing a person revokes later reads and replies immediately',
    'Only its author can use the existing confirmation or rejection action',
    'no approval, tool, release, publishing, or paid-action authority',
  ]) assert.ok(chat.includes(text), text)
  assert.ok(edge.includes('share_with_recipients'))
  assert.ok(edge.includes('approved_models: provider.approvedModels'))
})

test('CHAT-2 ships named rollback-safe catalog gates', () => {
  assert.ok(verifier.includes('begin;'))
  assert.ok(verifier.includes('rollback;'))
  for (const check of [
    'share_rls_not_enabled',
    'share_browser_acl_not_read_only',
    'ai_run_actor_owner_separation_missing',
    'legacy_own_run_revocation_bypass_present',
    'conversation_revocable_read_policy_missing',
    'creator_selected_revocation_contract_missing',
    'collaborative_turn_concurrency_contract_missing',
    'collaborative_unknown_outcome_contract_missing',
    'collaborative_attribution_link_contract_missing',
  ]) assert.ok(verifier.includes(check), check)
})
