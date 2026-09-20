import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__projectServiceScopeRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./projectServiceScopeRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createProjectServiceScopeRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]

const org = '00000000-0000-4000-8000-000000000001'
const project = '10000000-0000-4000-8000-000000000001'
const service = '20000000-0000-4000-8000-000000000001'
const scope = '30000000-0000-4000-8000-000000000001'
const request = '40000000-0000-4000-8000-000000000001'

test('service snapshot rejects a different project or an unreviewable impact', async () => {
  const valid = { organization_id: org, project_id: project, catalog: [], members: [],
    scopes: [{ id: scope, service_id: service, revision: 2, impact_token: 'current' }],
    impact: { exact_service_linkage_known: false } }
  const repository = createProjectServiceScopeRepository({ rpc: () => Promise.resolve({ data: valid }) })
  assert.equal((await repository.snapshot(org, project)).scopes[0].revision, 2)
  await assert.rejects(repository.snapshot(org, service), /did not match/)
  const missing = createProjectServiceScopeRepository({ rpc: () => Promise.resolve({ data: {
    ...valid, impact: null,
  } }) })
  await assert.rejects(missing.snapshot(org, project), /did not match/)
})

test('service transition forwards the exact revision and reviewed impact token', async () => {
  const calls = []
  const repository = createProjectServiceScopeRepository({ rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: { organization_id: org, project_id: project, request_id: request,
      scope_id: scope, revision: 3 } })
  } })
  await assert.rejects(repository.change({ organizationId: org, projectId: project,
    requestId: request, action: 'pause', scopeId: scope, expectedRevision: 2 }), /Review and acknowledge/)
  await repository.change({ organizationId: org, projectId: project, requestId: request,
    action: 'pause', scopeId: scope, expectedRevision: 2, impactToken: 'current', impactAcknowledged: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'change_project_service_scope')
  assert.equal(calls[0].args.p_expected_revision, 2)
  assert.equal(calls[0].args.p_impact_token, 'current')
  assert.equal(calls[0].args.p_impact_acknowledged, true)
})

test('service proposal rejects a mismatched result', async () => {
  const repository = createProjectServiceScopeRepository({ rpc: () => Promise.resolve({ data: {
    organization_id: org, project_id: service, request_id: request, scope_id: scope, revision: 1,
  } }) })
  await assert.rejects(repository.change({ organizationId: org, projectId: project, requestId: request,
    action: 'add', serviceId: service, quantity: 1 }), /did not match/)
})
