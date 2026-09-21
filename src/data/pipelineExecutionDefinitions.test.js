import assert from 'node:assert/strict'
import test from 'node:test'

import { createPipelineExecutionDefinitionsRepository, normalizeExecutionSteps } from './pipelineExecutionDefinitionsRepository.js'

const ORG = '11111111-1111-4111-8111-111111111111'
const PRESET = '22222222-2222-4222-8222-222222222222'
const REQUEST = '33333333-3333-4333-8333-333333333333'
const SERVICE = '44444444-4444-4444-8444-444444444444'
const STEPS = [
  { key: 'draft', label: 'Draft', kind: 'human', department_id: 'content', service_id: SERVICE, depends_on: [] },
  { key: 'review', label: 'Review', kind: 'approval_gate', department_id: 'content', service_id: SERVICE, depends_on: ['draft'] },
]

test('execution steps require unique keys and earlier-only dependencies', () => {
  assert.deepEqual(normalizeExecutionSteps(STEPS), STEPS)
  assert.throws(() => normalizeExecutionSteps([STEPS[1], STEPS[0]]), /dependency/)
  assert.throws(() => normalizeExecutionSteps([STEPS[0], { ...STEPS[1], key: 'draft' }]), /key/)
  assert.throws(() => normalizeExecutionSteps([{ ...STEPS[0], kind: 'script' }]), /kind/)
  assert.throws(() => normalizeExecutionSteps([{ ...STEPS[0], service_id: PRESET, depends_on: ['draft'] }]), /dependency/)
})

test('definition authoring sends one exact published preset and request ID', async () => {
  let sent
  const repository = createPipelineExecutionDefinitionsRepository({
    from() { throw new Error('Unexpected read') },
    rpc(name, payload) { sent = [name, payload]; return Promise.resolve({ data: { definition_id: REQUEST }, error: null }) },
  })
  await repository.create({ organizationId: ORG, presetPublicationId: PRESET, requestId: REQUEST, name: 'Editorial flow', steps: STEPS })
  assert.deepEqual(sent, ['create_pipeline_execution_definition', {
    p_organization_id: ORG, p_preset_publication_id: PRESET, p_request_id: REQUEST,
    p_name: 'Editorial flow', p_steps: STEPS,
  }])
})

test('department signoff and owner publication call separate commands', async () => {
  const calls = []
  const repository = createPipelineExecutionDefinitionsRepository({
    from() { throw new Error('Unexpected read') },
    rpc(name, payload) { calls.push([name, payload]); return Promise.resolve({ data: {}, error: null }) },
  })
  await repository.approve({ definitionId: REQUEST, departmentId: 'content' })
  await repository.publish(REQUEST)
  assert.deepEqual(calls, [
    ['approve_pipeline_execution_definition', { p_definition_id: REQUEST, p_department_id: 'content' }],
    ['publish_pipeline_execution_definition', { p_definition_id: REQUEST }],
  ])
})