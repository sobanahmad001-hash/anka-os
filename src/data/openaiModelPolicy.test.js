import assert from 'node:assert/strict'
import test from 'node:test'
import { preferredApprovedModel, openAiTextOptions, requireAutomaticTextModel, openAiModelLabel } from './openaiModelPolicy.js'
import { selectDepartmentChatModelConfiguration } from './departmentChatModelSelection.js'
const models = [
  { id: 'premium', configuration_id: 'premium', model_id: 'gpt-6-astra', is_default: true },
  { id: 'routine', configuration_id: 'routine', model_id: 'gpt-6-luna' },
  { id: 'substantive', configuration_id: 'substantive', model_id: 'gpt-6.1-sol' },
]
test('approved workload defaults prefer Luna/Sol, premium never auto-selects', () => {
  assert.equal(preferredApprovedModel(models).id, 'routine')
  assert.equal(preferredApprovedModel(models, 'substantive').id, 'substantive')
  assert.equal(preferredApprovedModel([models[0]]), undefined)
  assert.equal(preferredApprovedModel([]), undefined)
  assert.throws(() => requireAutomaticTextModel('gpt-6-astra'), /explicit/)
  assert.doesNotThrow(() => requireAutomaticTextModel('gpt-4.1'))
})
test('explicit valid selections survive defaults and unavailable models are never synthesized', () => {
  const caps = { approved_models: models, default_model_configuration_id: 'premium' }
  assert.equal(selectDepartmentChatModelConfiguration(caps, 'premium'), 'premium')
  assert.equal(selectDepartmentChatModelConfiguration(caps), 'substantive')
  assert.equal(selectDepartmentChatModelConfiguration({ approved_models: [models[0]] }), '')
  assert.equal(preferredApprovedModel([{ id: 'legacy', model_id: 'gpt-4.1' }]).id, 'legacy')
})
test('text policy uses supported efforts and labels exact model identity', () => {
  assert.deepEqual(openAiTextOptions('gpt-6.1-sol'), { reasoning: { effort: 'low' }, service_tier: 'default' })
  assert.deepEqual(openAiTextOptions('gpt-6-luna', 'substantive'), { reasoning: { effort: 'medium' }, service_tier: 'default' })
  assert.deepEqual(openAiTextOptions('gpt-4.1'), {})
  assert.match(openAiModelLabel('gpt-6-astra'), /gpt-6-astra.*Premium/)
  assert.equal(openAiModelLabel('explicit-old'), 'explicit-old')
})
