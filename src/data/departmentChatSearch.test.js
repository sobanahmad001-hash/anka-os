import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(root + path, 'utf8')
const migration = read('supabase/migrations/20260912102531_p9_department_chat_conversation_search.sql')
const verifier = read('supabase/verify_20260912102531_p9_department_chat_conversation_search.sql')
const edge = read('supabase/functions/department-chat/index.ts')
const transport = read('src/data/departmentChatTransport.js')
const chat = read('src/components/DepartmentChat.jsx')

test('P9 search is indexed, scope-bound, permission-filtered, and service-only', () => {
  for (const required of [
    "to_tsvector('simple'", 'using gin (search_vector)',
    'private.is_current_department_chat_contributor(',
    'conversation.organization_id = p_organization_id',
    'conversation.project_id = p_project_id',
    'conversation.engagement_id = p_engagement_id',
    'conversation.department_id = p_department_id',
    'share.recipient_id = p_actor_id and share.revoked_at is null',
    ') from public, anon, authenticated;', ') to service_role;',
  ]) assert.ok(migration.includes(required), required)
})

test('P9 search returns no message snippets or counts and uses bounded keyset ordering', () => {
  assert.ok(migration.includes('p_limit not between 1 and 50'))
  assert.ok(migration.includes('order by conversation.last_activity_at desc, conversation.id'))
  assert.ok(migration.includes('conversation.id > p_before_id'))
  assert.ok(!migration.includes('ts_headline'))
  assert.ok(!migration.includes('select count('))
  const returns = migration.slice(migration.indexOf('returns table ('), migration.indexOf('language plpgsql'))
  assert.ok(!returns.includes('body'))
  assert.ok(!returns.includes('snippet'))
  assert.ok(!returns.includes('match_count'))
})

test('P9 edge, repository, and UI use server search with bounded pagination and no client transcript scan', () => {
  assert.ok(edge.includes("action === 'search_conversations'"))
  assert.ok(edge.includes("admin.rpc('search_department_chat_conversations'"))
  assert.ok(edge.includes('pageSize > 25'))
  assert.ok(transport.includes("invoke('search_conversations'"))
  assert.ok(chat.includes('Search permitted conversations'))
  assert.ok(chat.includes('Titles and messages'))
  assert.ok(chat.includes('nextConversationCursor'))
  assert.ok(chat.includes('Load more'))
  assert.ok(!chat.includes('.filter(message => message.body'))
})

test('P9 transcript presents stored timestamps and stored run metadata without invented provider values', () => {
  assert.ok(edge.includes(".select('id, provider, model, capability, status, department_chat_model_configuration_id, created_at')"))
  assert.ok(edge.includes('run: message.ai_run_id ? aiRunById.get(message.ai_run_id) || null : null'))
  for (const required of ['dateTime={message.created_at}', 'message.run.provider', 'message.run.model', 'message.run.capability', 'message.run.status']) {
    assert.ok(chat.includes(required), required)
  }
  assert.ok(!chat.includes("provider: 'openai'"))
  assert.ok(!chat.includes("model: 'gpt-"))
})

test('P9 search verifier covers generated vectors, indexes, access clauses, leakage, pagination, and ACL', () => {
  for (const required of [
    'conversation_search_vector_missing', 'message_search_vector_missing',
    'conversation_search_index_missing', 'message_search_index_missing',
    'search_current_access_filter_missing', 'search_result_leak_contract_failed',
    'search_keyset_pagination_contract_missing', 'search_function_acl_invalid',
    'rollback;',
  ]) assert.ok(verifier.includes(required), required)
})
