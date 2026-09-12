import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(root + path, 'utf8')
const migration = read('supabase/migrations/20260910121343_p9_chat_saved_conversations_corrected.sql')
const verifier = read('supabase/verify_20260910121343_p9_chat_saved_conversations_corrected.sql')
const edge = read('supabase/functions/department-chat/index.ts')
const chat = read('src/components/DepartmentChat.jsx')
const transport = read('src/data/departmentChatTransport.js')
const designRepository = read('src/data/designSystemsRepository.js')

function section(source, start, end) {
  const from = source.indexOf(start)
  assert.notEqual(from, -1, 'missing section: ' + start)
  const to = source.indexOf(end, from + start.length)
  return to === -1 ? source.slice(from) : source.slice(from, to)
}

test('P9 conversations and messages are new owner-private stores with exact work context', () => {
  for (const required of [
    'create table public.department_chat_conversations',
    'create table public.department_chat_messages',
    'foreign key (engagement_id, project_id, organization_id)',
    "check (department_id in ('content', 'design', 'marketing'))",
    'owner_id = (select auth.uid())',
    'alter table public.department_chat_conversations enable row level security',
    'alter table public.department_chat_messages enable row level security',
  ]) assert.ok(migration.includes(required), required)
  assert.ok(!migration.includes('insert into public.quick_task_messages'))
  assert.ok(!migration.includes('references public.quick_tasks'))
  assert.ok(!migration.includes('create table public.ai_conversations'))
})

test('P9 browser access is read-only and leadership cannot read linked private runs or proposals', () => {
  assert.ok(migration.includes('grant select on table public.department_chat_conversations, public.department_chat_messages'))
  assert.ok(!migration.includes('grant insert on table public.department_chat_conversations'))
  assert.ok(!migration.includes('grant update on table public.department_chat_messages'))
  assert.ok(migration.includes('department_chat_conversation_id is null'))
  assert.ok(migration.includes('conversation_id is null'))
  assert.ok(migration.includes('proposer_id = (select auth.uid())'))
})

test('P9 turn allocation and proposal linkage are deterministic, atomic, and append-only', () => {
  const begin = section(migration, 'create function public.begin_department_chat_turn', 'create function public.fail_department_chat_turn')
  const save = section(migration, 'create function public.save_department_chat_conversation_proposal', 'create function private.protect_department_chat_message')
  assert.ok(begin.includes('for update'))
  assert.ok(begin.includes('client_request_id = p_client_request_id'))
  assert.ok(begin.includes("v_message.body <> btrim(p_prompt)"))
  assert.ok(begin.includes("errcode = '23505'"))
  assert.ok(begin.includes('next_sequence = next_sequence + 1'))
  assert.ok(migration.includes('create function public.expire_department_chat_pending_turns'))
  assert.ok(migration.includes("then 'interrupted' else 'outcome_unknown'"))
  assert.ok(edge.includes("rpc('expire_department_chat_pending_turns'"))
  assert.ok(save.includes('public.save_department_chat_proposal('))
  assert.ok(save.includes('set department_chat_conversation_id = p_conversation_id'))
  assert.ok(save.includes('set conversation_id = p_conversation_id'))
  assert.ok(save.includes("'assistant'"))
  assert.ok(migration.includes('Department Chat history is append-only.'))
  for (const forbidden of ['insert into public.artifacts', 'insert into public.work_items', 'insert into public.tasks']) {
    assert.ok(!save.includes(forbidden), forbidden)
  }
})

test('P9 records dispatch and preserves ambiguous provider outcomes without advertising safe retry', () => {
  for (const required of [
    "status in ('pending', 'completed', 'failed', 'unsupported', 'unknown')",
    'provider_dispatched_at timestamptz',
    'create function public.mark_department_chat_turn_dispatched',
    'create function public.mark_department_chat_turn_unknown',
    "error_code = 'outcome_unknown'",
  ]) assert.ok(migration.includes(required), required)
  assert.ok(edge.includes("rpc('mark_department_chat_turn_dispatched'"))
  assert.ok(edge.includes("rpc('mark_department_chat_turn_unknown'"))
  assert.ok(edge.includes("outcome: 'outcome_unknown'"))
  assert.ok(chat.includes('Do not retry this request; a retry could duplicate work or cost.'))
})

test('P9 linked runs and proposals enforce full existing owner and work context', () => {
  assert.ok(migration.includes('foreign key (department_chat_conversation_id, organization_id, project_id, engagement_id, user_id)'))
  assert.ok(migration.includes('references public.department_chat_conversations(id, organization_id, project_id, engagement_id, owner_id)'))
  assert.ok(migration.includes('foreign key (conversation_id, organization_id, project_id, engagement_id, department_id, proposer_id)'))
  assert.ok(migration.includes('create trigger trg_ai_runs_department_chat_conversation'))
  assert.ok(migration.includes('AI run Department Chat conversation is immutable.'))
})

test('P9 endpoint and reusable shell expose saved lifecycle and truthful capability boundaries', () => {
  for (const action of [
    'list_conversations', 'search_conversations', 'create_conversation', 'get_conversation',
    'rename_conversation', 'set_conversation_state', 'get_capabilities',
  ]) {
    assert.ok(edge.includes(action), action)
  }
  assert.ok(edge.includes('attachments: {'))
  assert.ok(edge.includes('reference_only: { mime_types:'))
  assert.ok(edge.includes("unavailable: ['PDF'"))
  assert.ok(edge.includes('approved_models: provider.approvedModels'))
  assert.ok(edge.includes("SAVED_CONVERSATION_DEPARTMENTS = new Set(['content', 'design', 'marketing'])"))
  for (const label of ['Conversations', 'Private to you', 'Show archived', 'Explicit source files']) {
    assert.ok(chat.includes(label), label)
  }
  for (const method of [
    'listConversations', 'searchConversations', 'createConversation', 'getConversation',
    'renameConversation', 'setConversationState', 'getCapabilities', 'uploadAttachment', 'listAttachments',
  ]) assert.ok(transport.includes(method), method)
})

test('P9 conversation metadata actions share the same latest-completion controller', () => {
  assert.ok(chat.includes('runCurrentChatOperation'))
  for (const action of ['renameConversation', 'setConversationState', 'toggleArchived']) {
    const body = section(chat, `async function ${action}`, '\n  async function')
    assert.ok(body.includes('runCurrentChatOperation(completion.current'), action)
  }
  assert.ok(chat.includes('loadConversationList(targetConversationId, checked, isCurrent)'))
  assert.ok(chat.includes("loadConversation(selected?.id || '', isCurrent)"))
})

test('P9 preserves proposal-only Development and official confirmation boundaries', () => {
  assert.ok(chat.includes("['content', 'design', 'marketing'].includes(departmentId)"))
  assert.ok(chat.includes('Confirm official draft'))
  assert.ok(chat.includes('Confirmation is not approval, release, publication, deployment, launch, or stage completion'))
  assert.ok(edge.includes('save_department_chat_proposal'))
  assert.ok(edge.includes('confirm_department_chat_proposal'))
  assert.ok(!migration.includes('update public.engagement_stage_instances'))
})

test('all three Workshop consumers provide canonical project-owned engagement context', () => {
  assert.ok(designRepository.includes('engagements!inner(id, organization_id, project_id, client_id, name, brand_id'))
  assert.ok(chat.includes('const projectId = engagement.project_id'))
  assert.ok(chat.includes('props.engagement?.organization_id !== activeOrganizationId'))
})

test('P9 ships a rollback-only verifier for privacy, ACL, concurrency, and storage separation', () => {
  assert.ok(verifier.includes('begin;'))
  assert.ok(verifier.includes('rollback;'))
  for (const check of [
    'conversation_rls_not_enabled',
    'message_rls_not_enabled',
    'browser_acl_not_read_only',
    'private_run_leadership_exclusion_missing',
    'private_proposal_leadership_exclusion_missing',
    'conversation_rpc_browser_execute_not_revoked',
    'turn_concurrency_contract_missing',
    'atomic_proposal_link_contract_missing',
    'quick_task_storage_was_reused',
  ]) assert.ok(verifier.includes(check), check)
})
