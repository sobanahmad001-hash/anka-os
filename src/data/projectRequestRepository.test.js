import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const moduleKey = '__projectRequestRepositoryTest'
globalThis[moduleKey] = { rpc: () => Promise.resolve({ data: null }) }
const draftSource = readFileSync(new URL('./projectDraftRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(moduleKey) + ']')
const draftUrl = 'data:text/javascript;base64,' + Buffer.from(draftSource).toString('base64')
const requestSource = readFileSync(new URL('./projectRequestRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(moduleKey) + ']')
  .replace("from './projectDraftRepository.js'", 'from ' + JSON.stringify(draftUrl))
const { createProjectRequestRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(requestSource).toString('base64'))
delete globalThis[moduleKey]

const organizationId = '00000000-0000-4000-8000-000000000001'
const requestId = '60000000-0000-4000-8000-000000000001'
const sourceRequestId = '60000000-0000-4000-8000-000000000002'
const projectId = '70000000-0000-4000-8000-000000000001'

test('contributors submit a request without any PM assignment or official project command', async () => {
  const calls = []
  const repository = createProjectRequestRepository({ rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: { organization_id: organizationId, request_id: requestId, status: 'pending' } })
  } })
  await repository.submit({ organizationId, requestId, name: 'New internal work', engagementType: 'internal' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'submit_project_request')
  assert.equal(calls[0].args.p_client_id, null)
  assert.equal('p_manager_id' in calls[0].args, false)
})

test('only exact organization and source request conversion results are accepted', async () => {
  const repository = createProjectRequestRepository({ rpc: () => Promise.resolve({ data: {
    organization_id: organizationId, source_request_id: sourceRequestId,
    project_id: projectId, status: 'converted',
  } }) })
  assert.equal((await repository.convert({ organizationId, sourceRequestId, requestId })).project_id, projectId)
  await assert.rejects(repository.convert({ organizationId, sourceRequestId: requestId, requestId }), /did not match/)
})

test('request lists reject malformed organization and request identities', async () => {
  const repository = createProjectRequestRepository({ rpc: () => Promise.resolve({ data: {
    organization_id: organizationId, requests: [{ request_id: requestId, requester_id: projectId,
      payload: { name: 'Internal' }, status: 'pending' }], clients: [],
  } }) })
  assert.equal((await repository.snapshot(organizationId)).requests.length, 1)
  await assert.rejects(repository.snapshot(projectId), /did not match/)
})
