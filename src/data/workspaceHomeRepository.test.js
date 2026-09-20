import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceHomeRepository } from './workspaceHomeRepositoryFactory.js'
import { buildWorkspaceHome } from './workspaceHomeModel.js'

function clientFor(seed, { foreignTable, failureTable } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const call = { table, filters: [], orders: [], range: null, signal: null, limit: null }
      calls.push(call)
      const query = {
        select() { return query },
        eq(column, value) { call.filters.push(['eq', column, value]); return query },
        is(column, value) { call.filters.push(['is', column, value]); return query },
        in(column, values) { call.filters.push(['in', column, values]); return query },
        order(column, options) { call.orders.push([column, options]); return query },
        range(from, to) { call.range = [from, to]; return query },
        limit(value) { call.limit = value; return query },
        abortSignal(signal) { call.signal = signal; return query },
        then(resolve, reject) {
          if (table === failureTable) return Promise.resolve({ data: null, error: { message: 'Denied' }, status: 403 }).then(resolve, reject)
          let rows = (seed[table] || []).filter(row => call.filters.every(([operation, column, value]) =>
            operation === 'in' ? value.includes(row[column]) : (row[column] ?? null) === value))
          for (const [column, options] of [...call.orders].reverse()) {
            rows = [...rows].sort((left, right) => {
              const comparison = String(left[column] ?? '').localeCompare(String(right[column] ?? ''))
              return options?.ascending === false ? -comparison : comparison
            })
          }
          if (table === foreignTable && call.range?.[0] === 0) rows = [{ id: 'foreign', organization_id: 'org-b' }]
          if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1)
          if (call.limit !== null) rows = rows.slice(0, call.limit)
          return Promise.resolve({ data: rows, error: null, status: 200 }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

const rows = (count, make) => Array.from({ length: count }, (_, index) => make(String(index).padStart(4, '0')))
const base = {
  projects: [{ id: 'project-a', organization_id: 'org-a', name: 'Launch', status: 'active', archived_at: null }],
  engagements: [{ id: 'engagement-a', organization_id: 'org-a', project_id: 'project-a' }],
  activity_events: [],
}

test('Workspace Home counts every scoped work and review row beyond the response cap', async () => {
  const client = clientFor({
    ...base,
    tasks: rows(1201, id => ({ id: 'task-' + id, organization_id: 'org-a', project_id: 'project-a', title: 'Task ' + id, status: 'ready', priority: 'medium', archived_at: null })),
    work_items: rows(1001, id => ({ id: 'item-' + id, organization_id: 'org-a', project_id: 'project-a', engagement_id: 'engagement-a', title: 'Item ' + id, status: 'not_started', priority: 'medium', deleted_at: null })),
    deliverable_versions: rows(501, id => ({ id: 'version-' + id, organization_id: 'org-a', project_id: 'project-a', title: 'Version ' + id, version_number: 1, review_status: 'ready_for_internal_review', withdrawn_at: null, created_at: '2026-09-20T00:00:00Z' })),
  })
  const signal = new AbortController().signal
  const snapshot = await createWorkspaceHomeRepository(client).forOrganization('org-a', { signal }).getSnapshot()
  const home = buildWorkspaceHome(snapshot, { organizationId: 'org-a', today: '2026-09-20' })
  assert.deepEqual([home.summary.projectTasks, home.summary.engagementWorkItems, home.summary.reviews], [1201, 1001, 501])
  assert.deepEqual(client.calls.filter(call => call.table === 'tasks').map(call => call.range), [[0, 499], [500, 999], [1000, 1499]])
  for (const call of client.calls.filter(call => call.table !== 'activity_events')) {
    assert.ok(call.filters.some(([operation, column, value]) => operation === 'eq' && column === 'organization_id' && value === 'org-a'))
    assert.deepEqual(call.orders, [['id', undefined]])
    assert.equal(call.signal, signal)
  }
  assert.equal(client.calls.find(call => call.table === 'activity_events').limit, 40)
})

test('Workspace Home refuses foreign rows and propagates access failure instead of partial totals', async () => {
  const foreign = clientFor({ ...base, tasks: [{ id: 'task-a', organization_id: 'org-a' }] }, { foreignTable: 'tasks' })
  await assert.rejects(createWorkspaceHomeRepository(foreign).forOrganization('org-a').getSnapshot(), error => error.status === 403 && error.membershipMismatch)
  const denied = clientFor(base, { failureTable: 'work_items' })
  await assert.rejects(createWorkspaceHomeRepository(denied).forOrganization('org-a').getSnapshot(), error => error.status === 403)
})

test('Workspace Home stops before querying when the organization signal is aborted', async () => {
  const client = clientFor(base)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(createWorkspaceHomeRepository(client).forOrganization('org-a', { signal: controller.signal }).getSnapshot(), { name: 'AbortError' })
  assert.equal(client.calls.length, 0)
})
