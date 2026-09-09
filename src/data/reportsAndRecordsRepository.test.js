import assert from 'node:assert/strict'
import test from 'node:test'

import { createReportsAndRecordsRepository } from './reportsAndRecordsRepository.js'

const rows = (count, make) => Array.from({ length: count }, (_, index) => make(index))
const id = (prefix, index) => `${prefix}-${String(index).padStart(5, '0')}`

function fakeClient(seed = {}, options = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const call = { table, filters: [], orders: [], limit: null, signal: null, single: false }
      calls.push(call)
      const query = {
        select() { return query },
        eq(key, value) { call.filters.push(['eq', key, value]); return query },
        is(key, value) { call.filters.push(['is', key, value]); return query },
        gt(key, value) { call.filters.push(['gt', key, value]); return query },
        order(key, settings) { call.orders.push([key, settings]); return query },
        limit(value) { call.limit = value; return query },
        single() { call.single = true; return query },
        abortSignal(signal) { call.signal = signal; return query },
        then(resolve, reject) {
          let result = [...(seed[table] || [])].filter((row) => call.filters.every(([operator, key, value]) => {
            if (operator === 'eq') return row[key] === value
            if (operator === 'is') return (row[key] ?? null) === value
            return row[key] > value
          }))
          for (const [key, settings] of [...call.orders].reverse()) {
            result.sort((a, b) => {
              const compared = String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
              return settings?.ascending === false ? -compared : compared
            })
          }
          if (options.foreignTable === table && call.filters.some(([op]) => op === 'gt')) {
            result[0] = { ...result[0], organization_id: 'org-b' }
          }
          if (call.limit) result = result.slice(0, call.limit)
          options.onPage?.(call, result)
          return Promise.resolve({ data: call.single ? result[0] || null : result, error: null, status: 200 }).then(resolve, reject)
        },
      }
      return query
    },
    rpc(name, args) {
      const call = { table: 'rpc', name, args, signal: null }
      calls.push(call)
      const query = {
        abortSignal(signal) { call.signal = signal; return query },
        then(resolve, reject) {
          const data = options.rpcResult || { snapshot: {
            id: 'snapshot-a', organization_id: args.p_organization_id, project_id: args.p_project_id,
            living_project_document_id: args.p_living_project_document_id,
            projection_kind: args.p_projection_kind, source_version: args.p_expected_source_version,
          } }
          return Promise.resolve({ data, error: null, status: 200 }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

function workspaceSeed(extra = {}) {
  return {
    projects: [{ id: 'project-a', organization_id: 'org-a', archived_at: null }],
    living_project_documents: [{ id: 'document-a', organization_id: 'org-a', project_id: 'project-a', source_version: 1 }],
    ...extra,
  }
}

test('Reports and Records keyset-paginates more than 1000 projects with stable IDs and deduplication', async () => {
  const projects = rows(1201, (index) => ({
    id: id('project', index), organization_id: 'org-a', archived_at: null, updated_at: '2026-09-09',
  }))
  projects.splice(500, 0, { ...projects[499] })
  const signal = new AbortController().signal
  const client = fakeClient({ projects })
  const result = await createReportsAndRecordsRepository(client).listProjects('org-a', { signal })
  assert.equal(result.length, 1201)
  assert.equal(new Set(result.map((row) => row.id)).size, 1201)
  const calls = client.calls.filter((call) => call.table === 'projects')
  assert.ok(calls.length >= 3)
  assert.equal(calls.every((call) => call.orders.at(-1)[0] === 'id' && call.signal === signal), true)
  assert.deepEqual(calls[1].filters.find(([operator]) => operator === 'gt'), ['gt', 'id', projects[499].id])
})

test('complete workspace roots and deliverable versions exceed 1000 without truncation', async () => {
  const versions = rows(1201, (index) => ({
    id: id('version', index), organization_id: 'org-a', project_id: 'project-a',
    deliverable_id: 'deliverable-a', version_number: index + 1,
  }))
  const snapshots = rows(1201, (index) => ({
    id: id('snapshot', index), organization_id: 'org-a', project_id: 'project-a',
    living_project_document_id: 'document-a', generated_at: String(index),
  }))
  const client = fakeClient(workspaceSeed({
    tasks: rows(1201, (index) => ({ id: id('task', index), organization_id: 'org-a', project_id: 'project-a', archived_at: null })),
    deliverables: [{ id: 'deliverable-a', organization_id: 'org-a', project_id: 'project-a', archived_at: null }],
    deliverable_versions: versions,
    living_project_document_snapshots: snapshots,
  }))
  const workspace = await createReportsAndRecordsRepository(client).getProjectWorkspace('project-a', 'org-a')
  assert.equal(workspace.tasks.length, 1201)
  assert.equal(workspace.deliverables[0].deliverable_versions.length, 1201)
  assert.equal(workspace.snapshots.length, 1201)
  for (const table of ['tasks', 'deliverable_versions', 'living_project_document_snapshots']) {
    assert.ok(client.calls.filter((call) => call.table === table).length >= 3, table)
  }
})

test('pagination cancellation stops all later pages', async () => {
  const controller = new AbortController()
  const client = fakeClient({
    projects: rows(1200, (index) => ({ id: id('project', index), organization_id: 'org-a', archived_at: null })),
  }, { onPage(call) { if (call.table === 'projects' && !call.filters.some(([op]) => op === 'gt')) controller.abort() } })
  await assert.rejects(createReportsAndRecordsRepository(client).listProjects('org-a', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(client.calls.filter((call) => call.table === 'projects').length, 1)
})

test('foreign later pages and mismatched nested roots fail closed', async () => {
  const foreign = fakeClient({
    projects: rows(1001, (index) => ({ id: id('project', index), organization_id: 'org-a', archived_at: null })),
  }, { foreignTable: 'projects' })
  await assert.rejects(createReportsAndRecordsRepository(foreign).listProjects('org-a'), (error) => error.status === 403 && error.membershipMismatch)

  const version = fakeClient(workspaceSeed({
    deliverable_versions: [{ id: 'version-a', organization_id: 'org-a', project_id: 'project-a', deliverable_id: 'missing' }],
  }))
  await assert.rejects(createReportsAndRecordsRepository(version).getProjectWorkspace('project-a', 'org-a'), (error) => error.status === 403)

  const snapshot = fakeClient(workspaceSeed({
    living_project_document_snapshots: [{ id: 'snapshot-a', organization_id: 'org-a', project_id: 'project-a', living_project_document_id: 'foreign' }],
  }))
  await assert.rejects(createReportsAndRecordsRepository(snapshot).getProjectWorkspace('project-a', 'org-a'), (error) => error.status === 403)
})

test('activity is explicitly bounded and deterministically ordered', async () => {
  const client = fakeClient(workspaceSeed())
  await createReportsAndRecordsRepository(client).getProjectWorkspace('project-a', 'org-a')
  const call = client.calls.find((item) => item.table === 'activity_events')
  assert.equal(call.limit, 100)
  assert.deepEqual(call.orders, [['occurred_at', { ascending: false }], ['id', { ascending: false }]])
})

test('snapshot preservation is one signal-bound server RPC with no actor or client projection', async () => {
  const client = fakeClient()
  const signal = new AbortController().signal
  const snapshot = await createReportsAndRecordsRepository(client).createLivingRecordSnapshot({
    organizationId: 'org-a', projectId: 'project-a', livingRecordId: 'document-a',
    projectionKind: 'client', sourceVersion: 3, requestId: 'request-a', reason: 'Checkpoint',
  }, { signal })
  assert.equal(snapshot.id, 'snapshot-a')
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].name, 'preserve_living_project_snapshot')
  assert.equal(client.calls[0].signal, signal)
  assert.deepEqual(Object.keys(client.calls[0].args).sort(), [
    'p_expected_source_version', 'p_living_project_document_id', 'p_organization_id',
    'p_project_id', 'p_projection_kind', 'p_reason', 'p_request_id',
  ])
})

test('snapshot preservation makes no call after cancellation and rejects mismatched RPC roots', async () => {
  const controller = new AbortController()
  controller.abort()
  const empty = fakeClient()
  await assert.rejects(createReportsAndRecordsRepository(empty).createLivingRecordSnapshot({
    organizationId: 'org-a', projectId: 'project-a', livingRecordId: 'document-a',
    projectionKind: 'internal', sourceVersion: 1, requestId: 'request-a',
  }, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(empty.calls.length, 0)

  const mismatch = fakeClient({}, { rpcResult: { snapshot: {
    id: 'snapshot-a', organization_id: 'org-b', project_id: 'project-a',
    living_project_document_id: 'document-a', projection_kind: 'internal', source_version: 1,
  } } })
  await assert.rejects(createReportsAndRecordsRepository(mismatch).createLivingRecordSnapshot({
    organizationId: 'org-a', projectId: 'project-a', livingRecordId: 'document-a',
    projectionKind: 'internal', sourceVersion: 1, requestId: 'request-a',
  }), (error) => error.status === 403 && error.membershipMismatch)
})
