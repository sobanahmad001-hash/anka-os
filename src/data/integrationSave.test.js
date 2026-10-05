import test from 'node:test'
import assert from 'node:assert/strict'
import { saveConnectionMetadata } from './integrationSave.js'
const body = { provider: 'openai', display_name: 'OpenAI Sol Private', organization_id: '11111111-1111-4111-8111-111111111111', organization_only: true, department_ids: [], public_config: { model_id: 'gpt-6.1-sol' } }
const response = () => ({ data: { connection: { id: '22222222-2222-4222-8222-222222222222', organization_id: body.organization_id, provider: body.provider, display_name: body.display_name, status: 'configured', department_ids: [], public_config: body.public_config } } })
test('save accepts matching persisted metadata only, with no retry', async () => {
  let calls = 0
  const result = await saveConnectionMetadata(async () => { calls++; return response() }, body)
  assert.equal(result.connection.id, '22222222-2222-4222-8222-222222222222')
  assert.equal(calls, 1)
})
for (const field of ['id', 'organization_id', 'provider', 'display_name', 'status', 'public_config', 'department_ids']) {
  test(`save refuses missing or contradictory ${field} without claiming failure to persist`, async () => {
    const data = response(); delete data.data.connection[field]
    await assert.rejects(saveConnectionMetadata(async () => data, body), { code: 'save_unconfirmed' })
  })
}
test('non-JSON errors and malicious server bodies cannot leak into save feedback', async () => {
  for (const status of [400, 401, 403, 409, 500]) {
    await assert.rejects(saveConnectionMetadata(async () => ({ error: { message: 'SECRET SQL', context: new Response('SECRET SQL', { status }) } }), body), error => {
      assert.doesNotMatch(error.message, /SECRET|SQL/); return true
    })
  }
})
