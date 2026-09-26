import assert from 'node:assert/strict'
import test from 'node:test'
import { readWorkshopConversationPage, workshopConversationKey } from './workshopConversationList.js'

const scope = { organizationId: 'org', actorId: 'actor', departmentId: 'design', engagement: { id: 'eng', project_id: 'project', organization_id: 'org' } }
const privateRow = id => ({ id, title: id, context_kind: 'department_private', department_id: 'design', owner_id: 'actor', project_id: null })
const engagementRow = id => ({ id, title: id, organization_id: 'org', department_id: 'design', project_id: 'project', engagement_id: 'eng', access_role: 'recipient' })

test('combined list keeps typed IDs and exact independent pagination scopes', async () => {
  const calls = []
  const cursor = { id: 'last', last_activity_at: '2026-09-26T00:00:00Z' }
  const repo = {
    listContextConversations: async (input, request) => { calls.push({ input, request }); return Array.from({ length: 51 }, (_, i) => privateRow(String(i))) },
    searchConversations: async (department, input, request) => { calls.push({ department, input, request }); return { items: [engagementRow('0')], next_cursor: cursor } },
  }
  const privatePage = await readWorkshopConversationPage(repo, scope, 'private', 50)
  const engagementPage = await readWorkshopConversationPage(repo, scope, 'engagement', cursor)
  assert.equal(privatePage.items.length, 50)
  assert.equal(privatePage.next, 100)
  assert.notEqual(privatePage.items[0].key, engagementPage.items[0].key)
  assert.deepEqual(calls[0].input, { context_kind: 'department_private', department_id: 'design', offset: 50 })
  assert.deepEqual(calls[1].input, { project_id: 'project', engagement_id: 'eng', include_archived: true, query: '', limit: 25, before_last_activity_at: cursor.last_activity_at, before_id: cursor.id })
  assert.equal(calls[1].request.organizationId, 'org')
  assert.notEqual(workshopConversationKey(scope, 'engagement', '0'), workshopConversationKey({ ...scope, organizationId: 'other' }, 'engagement', '0'))
})

test('adapter rejects foreign scopes and propagates denied reads without fallback', async () => {
  let calls = 0
  const repo = { searchConversations: async () => { calls++; throw new Error('Denied') }, listContextConversations: async () => [privateRow('a')] }
  await assert.rejects(readWorkshopConversationPage(repo, { ...scope, engagement: { ...scope.engagement, organization_id: 'other' } }, 'engagement'), /eligible/)
  assert.equal(calls, 0)
  await assert.rejects(readWorkshopConversationPage(repo, scope, 'engagement'), /Denied/)
  assert.equal(calls, 1)
  await assert.rejects(readWorkshopConversationPage({ ...repo, listContextConversations: async () => [{ ...privateRow('a'), owner_id: 'other' }] }, scope, 'private'), /scope mismatch/)
  await assert.rejects(readWorkshopConversationPage({ ...repo, searchConversations: async () => ({ items: [{ ...engagementRow('a'), project_id: 'other' }] }) }, scope, 'engagement'), /scope mismatch/)
})
