import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

function factory() {
  const compiled = transformSync(readFileSync(new URL('./livingProjectReferenceRepository.js', import.meta.url), 'utf8'), { format: 'cjs' }).code
  const module = { exports: {} }
  const require = name => {
    if (name.includes('retainerReviewRepository')) return { createRetainerReviewRepository: () => ({}) }
    if (name.includes('reportsAndRecordsRepository')) return { createReportsAndRecordsRepository: () => ({}) }
    if (name.endsWith('/livingProjectReference.js')) return { composeLivingProjectReference: input => input }
    return { supabase: {}, projectEngagementWorkspace: {}, projectServiceScopeRepository: {},
      projectTaskProposalRepository: {}, projectMemoryRepository: {}, projectPipelineConfigurations: {} }
  }
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports)
  return module.exports.createLivingProjectReferenceRepository
}
function harness({ abortAfterCore, denied = false } = {}) {
  const controller = new AbortController(), calls = []
  const read = (name, result, projectFirst = false) => async (...args) => {
    calls.push(name)
    assert.deepEqual(args.slice(0, 2), projectFirst ? ['project', 'org'] : ['org', 'project'])
    assert.equal(args[2].signal, controller.signal)
    return result
  }
  const core = { livingRecord: { id: 'document' } }
  const deps = {
    records: { getProjectWorkspace: read('core', core, true), createLivingRecordSnapshot: (...args) => { calls.push('preserve'); return args } },
    workspace: { get: async (...args) => { const result = await read('workspace', { engagement: null }, true)(...args); if (abortAfterCore) controller.abort(); return result } },
    services: { snapshot: read('services', { scopes: [] }) },
    proposals: { list: denied ? async () => { calls.push('proposals'); throw new Error('Denied') } : read('proposals', []) },
    memory: { list: read('memory', { confirmed: [] }) },
    pipeline: { list: () => { throw new Error('No engagement: must not query pipeline') } },
  }
  return { repository: factory()(deps), controller, calls }
}

test('reference loader preserves source scoping and labels denied optional data without inventing agreement', async () => {
  const { repository, controller, calls } = harness({ denied: true })
  const result = await repository.load('org', 'project', { signal: controller.signal })
  assert.deepEqual(result.document.unavailable, ['Task decisions'])
  assert.deepEqual(result.document.proposals, [])
  assert.equal(result.document.pipeline, null)
  assert.deepEqual(calls, ['core', 'workspace', 'services', 'proposals', 'memory'])
})
test('abort after mandatory reads prevents every supplemental read', async () => {
  const { repository, controller, calls } = harness({ abortAfterCore: true })
  await assert.rejects(repository.load('org', 'project', { signal: controller.signal }), { name: 'AbortError' })
  assert.deepEqual(calls, ['core', 'workspace'])
})
test('checkpoint delegates exact caller identity/version to existing snapshot RPC repository', async () => {
  const { repository, controller, calls } = harness()
  const input = { organizationId: 'org', projectId: 'project', sourceVersion: 4, requestId: 'exact-request' }
  const options = { signal: controller.signal }
  assert.deepEqual(await repository.preserve(input, options), [input, options])
  assert.deepEqual(calls, ['preserve'])
})
test('retainer source receives exact project/engagement/user/signal and is composed only for retainers', async () => {
  const controller = new AbortController(), calls = []
  const recurringSnapshot = { plans: [] }
  const repository = factory()({
    records: { getProjectWorkspace: async () => ({}) },
    workspace: { get: async () => ({ project: { engagement_type: 'retainer' }, engagement: { id: 'engagement' } }) },
    services: { snapshot: async () => null }, proposals: { list: async () => [] }, memory: { list: async () => null },
    pipeline: { list: async () => null },
    recurring: { get: async scope => { calls.push(scope); return recurringSnapshot } },
  })
  const result = await repository.load('org', 'project', { signal: controller.signal, actorId: 'user' })
  assert.deepEqual(calls, [{ organizationId: 'org', projectId: 'project', engagementId: 'engagement', actorId: 'user', signal: controller.signal }])
  assert.equal(result.document.recurring, recurringSnapshot)
})
