import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { textAiConsentKey, hasTextAiConsent, textAiConsentNeedsReview, readTextAiConsent, rememberTextAiConsent } from './textAiConsent.js'
const scope = { userId: 'actor', organizationId: 'org', departmentId: 'design', projectId: 'project', engagementId: 'engagement', contextKind: 'engagement', conversationId: 'conversation', connectionId: 'connection', provider: 'openai', canonical: false, recipients: ['a', 'b'], sources: ['version'], selectedAttachmentIds: ['file'] }
test('text consent excludes message content, normalizes selections, and has no time expiry', () => {
  const key = textAiConsentKey(scope)
  assert.equal(textAiConsentKey({ ...scope, message: 'new human text', recipients: ['b', 'a'] }), key)
  const grant = { key, expiresAt: 0 }
  assert.equal(hasTextAiConsent(grant, key, 101), true)
  assert.equal(hasTextAiConsent(grant, key, Number.MAX_SAFE_INTEGER), true)
  assert.equal(hasTextAiConsent(null, key), false)
})
test('every material text sharing scope change requires a fresh grant', () => {
  const grant = { key: textAiConsentKey(scope), expiresAt: Infinity }
  for (const [field, value] of Object.entries(scope)) {
    const changed = Array.isArray(value) ? [...value, 'new'] : typeof value === 'boolean' ? !value : value + '-changed'
    assert.equal(hasTextAiConsent(grant, textAiConsentKey({ ...scope, [field]: changed })), false, field)
  }
})

test('same-provider model and readiness changes reuse the approved scope', () => {
  const key = textAiConsentKey(scope)
  assert.equal(textAiConsentKey({ ...scope, modelId: 'another-model', ready: false }), key)
  assert.equal(hasTextAiConsent({ key }, key), true)
  assert.equal(textAiConsentKey({ ...scope, sources: ['b', 'a'], selectedAttachmentIds: ['y', 'x'] }), textAiConsentKey({ ...scope, sources: ['a', 'b'], selectedAttachmentIds: ['x', 'y'] }))
})

test('both chat surfaces key only material scope and preserve engagement selections in the request', () => {
  for (const file of ['DepartmentChat', 'ContextConversationPanel']) {
    const source = readFileSync(new URL(`../components/${file}.jsx`, import.meta.url), 'utf8')
    const keyLine = source.split('\n').find(line => line.includes('const consent = useTextAiConsent'))
    assert.doesNotMatch(keyLine, /modelId|ChecksPass|ready/i)
    if (file === 'DepartmentChat') {
      assert.match(keyLine, /sources: selectedSourceVersionIds, selectedAttachmentIds/)
      assert.match(source, /attachment_ids: supportsSavedConversations \? selectedAttachmentIds/)
      assert.match(source, /selected_artifact_version_ids: supportsSavedConversations \? selectedSourceVersionIds/)
      assert.match(source, /selectedAttachmentIds=\{selectedAttachmentIds\}/)
      assert.doesNotMatch(source, /Private files are excluded from ordinary text replies/)
    } else {
      assert.doesNotMatch(keyLine, /sources:|selectedAttachmentIds/)
    }
  }
})

test('ordinary text Send needs no extra approval; added data still requires review', () => {
  const plain = { ...scope, canonical: false, sources: [], selectedAttachmentIds: [] }
  assert.equal(textAiConsentNeedsReview(textAiConsentKey(plain)), false)
  for (const extra of [{ canonical: true }, { sources: ['version'] }, { selectedAttachmentIds: ['file'] }]) {
    assert.equal(textAiConsentNeedsReview(textAiConsentKey({ ...plain, ...extra })), true)
  }
  assert.equal(textAiConsentNeedsReview('malformed'), true)
})
test('exact additional-source approval survives remount but never grants a changed scope', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const key = textAiConsentKey(scope)
  rememberTextAiConsent(key, storage)
  assert.equal(hasTextAiConsent(readTextAiConsent(key, storage), key), true)
  for (const extra of [{ userId: 'other' }, { organizationId: 'other' }, { conversationId: 'other' }, { provider: 'other' }, { connectionId: 'other' }, { recipients: ['other'] }, { sources: ['new-version'] }, { selectedAttachmentIds: ['new-file'] }]) {
    assert.equal(readTextAiConsent(textAiConsentKey({ ...scope, ...extra }), storage), null)
  }
  assert.equal(readTextAiConsent(key, { getItem() { throw Error('unavailable') } }), null)
  rememberTextAiConsent(key, { setItem() { throw Error('unavailable') } })
})
