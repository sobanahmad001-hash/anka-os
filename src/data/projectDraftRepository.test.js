import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__projectDraftRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./projectDraftRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createProjectDraftRepository, normalizeProjectDraft } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]

const org = '00000000-0000-4000-8000-000000000001'
const project = '50000000-0000-4000-8000-000000000001'
const request = '60000000-0000-4000-8000-000000000001'
const engagement = '70000000-0000-4000-8000-000000000001'
const clientId = '20000000-0000-4000-8000-000000000001'
const brandId = '40000000-0000-4000-8000-000000000001'

test('draft normalization keeps internal and client identity separate', () => {
  const internal = normalizeProjectDraft({ organizationId: org, requestId: request, name: ' Internal ',
    engagementType: 'internal' })
  assert.equal(internal.name, 'Internal')
  assert.equal(internal.clientId, null)
  assert.equal(internal.managerId, null)
  assert.throws(() => normalizeProjectDraft({ organizationId: org, requestId: request, name: 'Wrong',
    engagementType: 'internal', clientId }), /Internal Work has no client/)
  assert.throws(() => normalizeProjectDraft({ organizationId: org, requestId: request, name: 'Missing brand',
    engagementType: 'project', clientId }), /requires a client and brand/)
  assert.equal(normalizeProjectDraft({ organizationId: org, requestId: request, name: 'Client',
    engagementType: 'project', clientId, brandId }).brandId, brandId)
})

test('draft repository sends one exact governed command and rejects mismatched results', async () => {
  const calls = []
  const fake = { rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: { organization_id: org, project_id: project, engagement_id: engagement,
      status: 'planning', request_id: request }, error: null })
  } }
  const repository = createProjectDraftRepository(fake)
  await repository.create({ organizationId: org, requestId: request, name: 'Client draft',
    engagementType: 'project', clientId, brandId })
  assert.equal(calls[0].name, 'create_draft_project')
  assert.equal(calls[0].args.p_organization_id, org)
  assert.equal(calls[0].args.p_brand_id, brandId)
  assert.equal(calls[0].args.p_manager_id, null)
  const wrong = createProjectDraftRepository({ rpc: () => Promise.resolve({ data: {
    organization_id: 'other', project_id: project, engagement_id: engagement, status: 'planning', request_id: request,
  } }) })
  await assert.rejects(wrong.create({ organizationId: org, requestId: request, name: 'Client draft',
    engagementType: 'project', clientId, brandId }), /did not match/)
})

test('setup choices and exact PM binding reads reject cross-organization responses', async () => {
  const client = {
    rpc: () => Promise.resolve({ data: { organization_id: org, members: [], clients: [{ id: clientId, brands: [] }] } }),
    from: () => ({ select: () => {
      const query = { eq: () => query, limit: () => Promise.resolve({ data: [{
        id: 'binding', organization_id: 'other', project_id: project, user_id: 'user-a',
      }] }) }
      return query
    } }),
  }
  const repository = createProjectDraftRepository(client)
  assert.equal((await repository.options(org)).organization_id, org)
  await assert.rejects(repository.hasOwnManagerBinding(org, project, 'user-a'), /did not match/)
})

test('activation validates exact project, organization, and request IDs', async () => {
  const repository = createProjectDraftRepository({ rpc: () => Promise.resolve({ data: {
    organization_id: org, project_id: project, request_id: request, status: 'active',
  } }) })
  assert.equal((await repository.activate({ organizationId: org, projectId: project, requestId: request })).status, 'active')
  await assert.rejects(repository.activate({ organizationId: org, projectId: engagement, requestId: request }), /did not match/)
})

test('manager assignment validates the exact planning project and binding', async () => {
  const manager = '80000000-0000-4000-8000-000000000001'
  const binding = '90000000-0000-4000-8000-000000000001'
  const calls = []
  const repository = createProjectDraftRepository({ rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: name === 'get_draft_project_manager_state'
      ? { organization_id: org, project_id: project, manager_id: null, members: [{ id: manager, name: 'PM' }] }
      : { organization_id: org, project_id: project, manager_id: manager,
        manager_binding_id: binding, request_id: request } })
  } })
  assert.equal((await repository.managerState(org, project)).manager_id, null)
  assert.equal((await repository.assignManager({ organizationId: org, projectId: project,
    managerId: manager, requestId: request })).manager_binding_id, binding)
  assert.equal(calls[1].name, 'assign_draft_project_manager')
  assert.equal(calls[1].args.p_manager_id, manager)
  await assert.rejects(repository.assignManager({ organizationId: org, projectId: engagement,
    managerId: manager, requestId: request }), /did not match/)
})
