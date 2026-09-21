import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectPipelineConfigurationsRepository, normalizeSelectedSteps, parseMicrousd } from './projectPipelineConfigurationsRepository.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const steps = [
  { key: 'brief', label: 'Brief', depends_on: [] },
  { key: 'draft', label: 'Draft', depends_on: ['brief'] },
]

test('keeps selected step order and requires dependencies and bounded total quantity', () => {
  assert.deepEqual(normalizeSelectedSteps(steps, { brief: '2', draft: '3' }), [
    { key: 'brief', quantity: 2 }, { key: 'draft', quantity: 3 },
  ])
  assert.throws(() => normalizeSelectedSteps(steps, { draft: '1' }), /requires its earlier steps/)
  assert.throws(() => normalizeSelectedSteps(steps, { brief: '50', draft: '1' }), /total quantity/)
  assert.throws(() => normalizeSelectedSteps(steps, { brief: '1.5' }), /quantity must be/)
})

test('parses exact microdollars without float rounding', () => {
  assert.equal(parseMicrousd('0.000001'), 1)
  assert.equal(parseMicrousd('12.345678'), 12345678)
  assert.throws(() => parseMicrousd('0.0000001'), /six decimal/)
  assert.throws(() => parseMicrousd('9007199255'), /too large/)
})

test('activation requires explicit impact acknowledgement and sends the reviewed token', async () => {
  const calls = []
  const repo = createProjectPipelineConfigurationsRepository({
    from() { throw new Error('not expected') },
    rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: { activation_number: 1 }, error: null }) },
  })
  assert.throws(() => repo.activate({ organizationId: A, configurationId: B, requestId: C,
    impactToken: 'a'.repeat(64), acknowledged: false }), /acknowledge/)
  assert.equal(calls.length, 0)
  const result = await repo.activate({ organizationId: A, configurationId: B, requestId: C,
    impactToken: 'a'.repeat(64), acknowledged: true })
  assert.equal(result.activation_number, 1)
  assert.equal(calls[0].name, 'activate_project_pipeline_configuration')
  assert.equal(calls[0].args.p_impact_token_sha256, 'a'.repeat(64))
  assert.equal(calls[0].args.p_impact_acknowledged, true)
})
