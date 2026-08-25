import test from 'node:test'
import assert from 'node:assert/strict'

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
      is(...args) { calls.push([table, 'is', ...args]); return builder },
      in(...args) { calls.push([table, 'in', ...args]); return builder },
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
      data: [{ id: 'content-stream', project_id: 'project-1', department_id: 'content' }],
      error: null,
    },
    tasks: { data: [{ id: 'task-1', workstream_id: 'content-stream' }], error: null },
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

  const workspace = await repository.getDepartmentWorkspace('content')
  const tables = client.calls
    .filter(([, operation]) => operation === 'from')
    .map(([table]) => table)

  assert.deepEqual(tables, [
    'workstreams',
    'workstreams',
    'tasks',
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
  assert.equal(tables.some((table) => table.startsWith('as_')), false)
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
