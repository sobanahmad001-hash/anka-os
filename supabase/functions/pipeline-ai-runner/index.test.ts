import { buildPrompt, outputText } from './index.ts'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}
function rejects(action: () => unknown, expected: RegExp) {
  try { action() } catch (error) {
    if (expected.test(String(error))) return
    throw error
  }
  throw new Error('Expected rejection')
}
const intent = {
  input_manifest: {
    engagement: { id: 'engagement-1', name: 'Allowed engagement', objective: 'Create a draft' },
    services: [{ id: 'scope-1', service_id: 'service-1', status: 'active' }],
    assets: [],
  },
}
const plan = { work_manifest: [
  { id: 'work-1', department_id: 'content', title: 'Allowed item' },
  { id: 'work-2', department_id: 'marketing', title: 'Unrelated item' },
] }
const step = {
  step_key: 'draft',
  definition_step: { kind: 'ai_assisted', department_id: 'content',
    service_id: 'service-1', label: 'Draft content' },
}
const job = { input_sha256: 'a'.repeat(64) }

Deno.test('N6 prompt includes only current step department and pinned service', () => {
  const prompt = buildPrompt(intent, plan, step, job)
  assert(prompt.includes('Allowed item'), 'Scoped work is missing')
  assert(!prompt.includes('Unrelated item'), 'Another department leaked into prompt')
  assert(prompt.includes('service-1'), 'Pinned service is missing')
  assert(prompt.includes(job.input_sha256), 'Job digest is missing')
})

Deno.test('N6 prompt refuses assets and unrelated service scope', () => {
  rejects(() => buildPrompt({
    input_manifest: { ...intent.input_manifest, assets: [{ id: 'asset-1' }] },
  }, plan, step, job), /scope is unavailable/)
  rejects(() => buildPrompt(intent, plan, {
    ...step, definition_step: { ...step.definition_step, service_id: 'another-service' },
  }, job), /service scope is unavailable/)
})

Deno.test('N6 output parser uses provider output text', () => {
  assert(outputText({ output: [{ content: [{ type: 'output_text', text: '  Draft  ' }] }] })
    === 'Draft', 'Provider output extraction failed')
  assert(outputText({ output: [{ content: [{ type: 'refusal', text: 'No' }] }] }) === '',
    'Refusal must not become draft text')
})
