import assert from 'node:assert/strict'
import test from 'node:test'

import { createReportsAndRecordsRepository } from './reportsAndRecordsRepository.js'

function fakeClient({ corruptTable, failure, emptySnapshotRead = false } = {}) {
  const calls = []
  return { calls, from(table) {
    const call = { table, filters: [], signal: null, operation: 'select', payload: null }
    calls.push(call)
    let single = false
    const query = {
      select() { return query },
      update(payload) { call.operation = 'update'; call.payload = payload; return query },
      insert(payload) { call.operation = 'insert'; call.payload = payload; return query },
      eq(key, value) { call.filters.push([key, value]); return query },
      is() { return query }, order() { return query }, limit() { return query },
      single() { single = true; return query },
      abortSignal(signal) { call.signal = signal; return query },
      then(resolve, reject) {
        if (failure) return Promise.resolve(failure).then(resolve, reject)
        if (emptySnapshotRead && table === 'living_project_document_snapshots' && call.operation === 'select') {
          return Promise.resolve({ data: [], error: null, status: 200 }).then(resolve, reject)
        }
        const organizationId = call.filters.find(([key]) => key === 'organization_id')?.[1] || 'org-a'
        const recordOrganizationId = table === corruptTable ? 'org-b' : organizationId
        const projectId = call.filters.find(([key]) => key === 'project_id')?.[1] || 'project-a'
        const record = {
          id: table === 'projects' ? projectId : `${table}-a`, organization_id: recordOrganizationId,
          project_id: projectId, name: 'Project A',
          deliverable_versions: table === 'deliverables' ? [{ id: 'version-a', organization_id: recordOrganizationId }] : undefined,
        }
        return Promise.resolve({ data: single ? record : [record], error: null, status: 200 }).then(resolve, reject)
      },
    }
    return query
  } }
}

test('Reports and Records scopes every read to the active organization and request signal', async () => {
  const client = fakeClient()
  const repository = createReportsAndRecordsRepository(client)
  const signal = new AbortController().signal
  await repository.listProjects('org-a', { signal })
  await repository.getProjectWorkspace('project-a', 'org-a', { signal })
  for (const call of client.calls) {
    assert.ok(call.filters.some(([key, value]) => key === 'organization_id' && value === 'org-a'), call.table)
    assert.equal(call.signal, signal, call.table)
  }
})

test('Reports and Records makes no query without organization selection or after abort', async () => {
  const client = fakeClient()
  const repository = createReportsAndRecordsRepository(client)
  await assert.rejects(repository.listProjects(null), /organizationId is required/)
  await assert.rejects(repository.getProjectWorkspace('project-a', ''), /organizationId is required/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(repository.listProjects('org-a', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(client.calls.length, 0)
})

test('Reports and Records rejects foreign roots, children, and nested versions', async () => {
  for (const table of ['projects', 'tasks', 'deliverables']) {
    const repository = createReportsAndRecordsRepository(fakeClient({ corruptTable: table }))
    await assert.rejects(
      table === 'projects' ? repository.listProjects('org-a') : repository.getProjectWorkspace('project-a', 'org-a'),
      (error) => error.status === 403 && error.membershipMismatch === true,
    )
  }
})

test('Reports and Records preserves access status for membership recovery', async () => {
  const cause = { message: 'Denied', statusCode: 403 }
  const repository = createReportsAndRecordsRepository(fakeClient({ failure: { data: null, error: cause } }))
  await assert.rejects(repository.listProjects('org-a'), (error) => error.status === 403 && error.cause === cause)
})

test('snapshot preservation scopes its read, update, and insert identity to one organization', async () => {
  const client = fakeClient({ emptySnapshotRead: true })
  const repository = createReportsAndRecordsRepository(client)
  await repository.createLivingRecordSnapshot({
    organizationId: 'org-a', projectId: 'project-a', livingRecordId: 'record-a',
    projectionKind: 'client', sourceVersion: 3, snapshot: { schema_version: 1 },
  }, 'user-a')
  assert.deepEqual(client.calls.map((call) => call.operation), ['select', 'update', 'insert'])
  for (const call of client.calls.filter((item) => item.operation !== 'insert')) {
    assert.ok(call.filters.some(([key, value]) => key === 'organization_id' && value === 'org-a'), call.table)
    assert.ok(call.filters.some(([key, value]) => key === 'project_id' && value === 'project-a'), call.table)
  }
  assert.equal(client.calls[2].payload.organization_id, 'org-a')
  assert.equal(client.calls[2].payload.project_id, 'project-a')
})
