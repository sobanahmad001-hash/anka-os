import test from 'node:test'
import assert from 'node:assert/strict'
import { engagementFirstSendKey, readEngagementFirstSend, saveEngagementFirstSend, clearEngagementFirstSend } from './engagementChatFirstSend.js'
test('first Send recovery identity is isolated by author org project engagement department and contains no prompt', () => {
 const scope = { userId: 'author', organizationId: 'org', projectId: 'project', engagementId: 'engagement', departmentId: 'content' }
 const key = engagementFirstSendKey(scope)
 for (const field of Object.keys(scope)) assert.notEqual(engagementFirstSendKey({ ...scope, [field]: 'other' }), key)
 const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) }
 const attempt = { conversationId: '10000000-0000-4000-8000-000000000001', requestId: '10000000-0000-4000-8000-000000000002', prompt: 'Private text' }
 saveEngagementFirstSend(key,attempt,storage)
 assert.equal(values.get(key).includes('Private text'),false)
 assert.equal(readEngagementFirstSend(key,storage).requestId, attempt.requestId)
 clearEngagementFirstSend(key,storage); assert.equal(readEngagementFirstSend(key,storage),null)
})
test('first Send cannot dispatch without verified recovery storage', () => {
 const attempt = { conversationId: '10000000-0000-4000-8000-000000000001', requestId: '10000000-0000-4000-8000-000000000002' }
 for (const storage of [null, { setItem() { throw new Error('denied') } }, { setItem(){},getItem(){return null} }]) assert.throws(() => saveEngagementFirstSend('key',attempt,storage), /No request was sent/)
 assert.throws(() => saveEngagementFirstSend('key',{ ...attempt, requestId: 'invalid' },{}))
})
