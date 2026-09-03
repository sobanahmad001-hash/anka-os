import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  TASK_STATUSES,
  TASK_TRANSITIONS,
  createDeliveryRepository,
} from './deliveryRepository.js'

function createFakeClient(tableResults = {}) {
  const calls = []

  function makeBuilder(table) {
    const result = tableResults[table] || { data: [], error: null }
    const builder = {
      select(...args) { calls.push([table, 'select', ...args]); return builder },
      insert(...args) { calls.push([table, 'insert', ...args]); return builder },
      update(...args) { calls.push([table, 'update', ...args]); return builder },
      eq(...args) { calls.push([table, 'eq', ...args]); return builder },
      or(...args) { calls.push([table, 'or', ...args]); return builder },
      is(...args) { calls.push([table, 'is', ...args]); return builder },
      in(...args) { calls.push([table, 'in', ...args]); return builder },
      abortSignal(...args) { calls.push([table, 'abortSignal', ...args]); return builder },
      order(...args) { calls.push([table, 'order', ...args]); return builder },
      limit(...args) { calls.push([table, 'limit', ...args]); return builder },
      single() { calls.push([table, 'single']); return builder },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
    }

    return builder
  }

  return {
    calls,
    from(table) {
      calls.push([table, 'from'])
      return makeBuilder(table)
    },
  }
}

function queryChains(calls) {
  const chains = []
  for (const call of calls) {
    if (call[1] === 'from') chains.push([call])
    else if (chains.length) chains.at(-1).push(call)
  }
  return chains
}

test('delivery runtime composes approval support without mutating the frozen repository', () => {
  const repository = createDeliveryRepository(createFakeClient())
  const runtimeSource = readFileSync(new URL('./delivery.js', import.meta.url), 'utf8')

  assert.equal(Object.isExtensible(repository), false)
  assert.doesNotMatch(runtimeSource, /Object\.assign\(repository/)
  assert.match(runtimeSource, /Object\.freeze\(\{\s*\.\.\.repository,/)
})

test('project workspace reads only canonical delivery tables', async () => {
  const client = createFakeClient({
    projects: { data: { id: 'project-1' }, error: null },
    living_project_documents: { data: { project_id: 'project-1' }, error: null },
  })
  const repository = createDeliveryRepository(client)

  await repository.getProjectWorkspace('project-1')

  const tables = client.calls
    .filter(([, operation]) => operation === 'from')
    .map(([table]) => table)

  assert.deepEqual(tables, [
    'projects',
    'workstreams',
    'milestones',
    'tasks',
    'task_dependencies',
    'research_records',
    'deliverables',
    'requests',
    'living_project_documents',
    'living_project_document_snapshots',
    'activity_events',
    'client_portal_items',
  ])
  assert.equal(tables.some((table) => table.startsWith('as_')), false)
})

test('new tasks are internal and use the canonical lifecycle', async () => {
  const client = createFakeClient({
    tasks: { data: { id: 'task-1' }, error: null },
  })
  const repository = createDeliveryRepository(client)

  await repository.createTask({
    projectId: 'project-1',
    title: 'Prepare research brief',
    status: 'ready',
  }, 'user-1')

  const insertCall = client.calls.find(([table, operation]) => (
    table === 'tasks' && operation === 'insert'
  ))
  const payload = insertCall[2]

  assert.equal(payload.status, 'ready')
  assert.equal(payload.visibility, 'internal_only')
  assert.equal(payload.user_id, 'user-1')
  assert.equal(payload.created_by, 'user-1')
})

test('workstream creation deduplicates departments and stays client-hidden', async () => {
  const client = createFakeClient({
    workstreams: { data: [{ id: 'workstream-1' }], error: null },
  })
  const repository = createDeliveryRepository(client)

  await repository.createWorkstreams(
    'project-1',
    ['content', 'design', 'content'],
    'user-1'
  )

  const insertCall = client.calls.find(([table, operation]) => (
    table === 'workstreams' && operation === 'insert'
  ))
  const payload = insertCall[2]

  assert.equal(payload.length, 2)
  assert.deepEqual(payload.map((row) => row.department_id), ['content', 'design'])
  assert.equal(payload.every((row) => row.client_visible === false), true)
  assert.equal(payload.every((row) => row.owner_id === 'user-1'), true)
})

test('department workspace composes shared records without legacy tables', async () => {
  const client = createFakeClient({
    workstreams: {
      data: [{ id: 'content-stream', organization_id: 'org-a', project_id: 'project-1', department_id: 'content' }],
      error: null,
    },
    engagements: { data: [{ id: 'engagement-1', organization_id: 'org-a', project_id: 'project-1' }], error: null },
    tasks: { data: [{ id: 'task-1', organization_id: 'org-a', workstream_id: 'content-stream' }], error: null },
    work_items: { data: [{ id: 'item-1', organization_id: 'org-a', engagement_id: 'engagement-1', department_id: 'content' }], error: null },
    engagement_services: { data: [{ id: 'service-1', organization_id: 'org-a', engagement_id: 'engagement-1' }], error: null },
    engagement_stage_instances: { data: [{ id: 'stage-1', organization_id: 'org-a', engagement_id: 'engagement-1' }], error: null },
    research_records: {
      data: [
        { id: 'shared-research', workstream_id: null },
        { id: 'content-research', workstream_id: 'content-stream' },
        { id: 'design-research', workstream_id: 'design-stream' },
      ],
      error: null,
    },
    requests: {
      data: [
        { id: 'incoming', receiving_workstream_id: 'content-stream', requesting_workstream_id: 'design-stream' },
        { id: 'unrelated', receiving_workstream_id: 'marketing-stream', requesting_workstream_id: 'design-stream' },
      ],
      error: null,
    },
  })
  const repository = createDeliveryRepository(client)

  const signal = new AbortController().signal
  const workspace = await repository.getDepartmentWorkspace('content', 'org-a', { signal })
  const tables = client.calls
    .filter(([, operation]) => operation === 'from')
    .map(([table]) => table)

  assert.deepEqual(tables, [
    'workstreams',
    'engagements',
    'workstreams',
    'tasks',
    'work_items',
    'engagement_services',
    'engagement_stage_instances',
    'research_records',
    'milestones',
    'deliverables',
    'requests',
  ])
  assert.deepEqual(workspace.research.map((record) => record.id), [
    'shared-research',
    'content-research',
  ])
  assert.deepEqual(workspace.requests.map((request) => request.id), ['incoming'])
  assert.deepEqual(workspace.workItems.map((item) => item.id), ['item-1'])
  assert.deepEqual(workspace.services.map((item) => item.id), ['service-1'])
  assert.deepEqual(workspace.stages.map((item) => item.id), ['stage-1'])
  for (const chain of queryChains(client.calls)) {
    const table = chain[0][0]
    assert.ok(chain.some(([, operation, field, value]) => operation === 'eq' && field === 'organization_id' && value === 'org-a'), `${table} query must use the selected organization`)
    assert.ok(chain.some(([, operation, value]) => operation === 'abortSignal' && value === signal), `${table} query must receive the scope signal`)
  }
  assert.equal(tables.some((table) => table.startsWith('as_')), false)
})

test('My Work scopes every tenant root and keeps organization A and B isolated', async () => {
  const signalA = new AbortController().signal
  const signalB = new AbortController().signal
  const clientA = createFakeClient({ tasks: { data: [{ id: 'task-a', organization_id: 'org-a' }], error: null } })
  const clientB = createFakeClient({ tasks: { data: [{ id: 'task-b', organization_id: 'org-b' }], error: null } })

  const workspaceA = await createDeliveryRepository(clientA).getMyWork('user-1', 'org-a', { signal: signalA })
  const workspaceB = await createDeliveryRepository(clientB).getMyWork('user-1', 'org-b', { signal: signalB })

  assert.deepEqual(workspaceA.tasks.map(item => item.id), ['task-a'])
  assert.deepEqual(workspaceB.tasks.map(item => item.id), ['task-b'])
  for (const [client, organizationId, signal] of [[clientA, 'org-a', signalA], [clientB, 'org-b', signalB]]) {
    for (const chain of queryChains(client.calls)) {
      const table = chain[0][0]
      assert.ok(chain.some(([, operation, field, value]) => operation === 'eq' && field === 'organization_id' && value === organizationId), `${table} query must use ${organizationId}`)
      assert.ok(chain.some(([, operation, value]) => operation === 'abortSignal' && value === signal), `${table} query must receive its scope signal`)
    }
  }
})

test('WKS5 issues zero tenant queries without a selected organization and rejects foreign results', async () => {
  const emptyClient = createFakeClient()
  const repository = createDeliveryRepository(emptyClient)
  await assert.rejects(repository.getDepartmentWorkspace('content', null), /organizationId is required/)
  await assert.rejects(repository.getMyWork('user-1', null), /organizationId is required/)
  assert.equal(emptyClient.calls.length, 0)

  const foreignClient = createFakeClient({
    tasks: { data: [{ id: 'foreign-task', organization_id: 'org-b' }], error: null },
  })
  await assert.rejects(
    createDeliveryRepository(foreignClient).getMyWork('user-1', 'org-a'),
    error => error.status === 403 && error.membershipMismatch === true,
  )
})

test('unknown departments are rejected before querying Supabase', async () => {
  const client = createFakeClient()
  const repository = createDeliveryRepository(client)

  await assert.rejects(
    repository.getDepartmentWorkspace('research'),
    /Unsupported department/
  )
  assert.equal(client.calls.length, 0)
})

test('task transition map matches the database quality flow', () => {
  assert.deepEqual(TASK_TRANSITIONS.backlog, ['ready', 'cancelled'])
  assert.deepEqual(TASK_TRANSITIONS.ready_for_review, [
    'in_progress',
    'changes_required',
    'done',
  ])
  assert.equal(TASK_TRANSITIONS.in_progress.includes('done'), false)
})

test('unsupported task statuses are rejected before a database call', async () => {
  const client = createFakeClient()
  const repository = createDeliveryRepository(client)

  await assert.rejects(
    repository.transitionTask('task-1', 'todo'),
    /Unsupported task status/
  )
  assert.deepEqual(TASK_STATUSES.includes('todo'), false)
  assert.equal(client.calls.length, 0)
})

test('client revision payload is exact-version and client-visible', async () => {
  const client = createFakeClient({
    requests: { data: { id: 'request-1' }, error: null },
  })
  const repository = createDeliveryRepository(client)

  await repository.submitClientRevision({
    projectId: 'project-1',
    deliverableVersionId: 'version-2',
    title: 'Revise the hero heading',
  }, 'client-user-1')

  const insertCall = client.calls.find(([table, operation]) => (
    table === 'requests' && operation === 'insert'
  ))
  const payload = insertCall[2]

  assert.equal(payload.request_type, 'revision')
  assert.equal(payload.request_origin, 'client')
  assert.equal(payload.visibility, 'client_visible')
  assert.equal(payload.target_deliverable_version_id, 'version-2')
  assert.equal(payload.requested_by, 'client-user-1')
})

test('repository converts Supabase errors into thrown failures', async () => {
  const client = createFakeClient({
    projects: { data: null, error: { message: 'RLS denied' } },
  })
  const repository = createDeliveryRepository(client)

  await assert.rejects(repository.listProjects(), /RLS denied/)
})
