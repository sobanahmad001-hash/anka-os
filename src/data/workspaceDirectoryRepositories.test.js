import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isOrganizationAccessError } from './organizationScope.js'

let moduleSequence = 0
async function injectedRepository(name, client) {
  const key = '__directoryRepositoryTest' + moduleSequence++
  globalThis[key] = client
  let source = readFileSync(new URL('./' + name + 'Repository.js', import.meta.url), 'utf8')
    .replace(/import \{ supabase \} from '\.\.\/lib\/supabase(?:\.js)?'/, 'const supabase = globalThis[' + JSON.stringify(key) + ']')
  if (name === 'clientWorkDirectory') {
    const pagination = readFileSync(new URL('./workspaceDirectoryPagination.js', import.meta.url), 'utf8').replaceAll('export ', '')
    source = source.replace(/import \{ collectDirectoryPages, directoryAbortError \} from '\.\/workspaceDirectoryPagination\.js'/, pagination)
  }
  try { return await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')) }
  finally { delete globalThis[key] }
}
async function clientRepository(client) { return (await injectedRepository('clientWorkDirectory', client)).createClientWorkDirectoryRepository(client) }
async function internalRepository(client) { return (await injectedRepository('internalWorkspace', client)).createInternalWorkspaceRepository(client) }

function fakeClient(seed = {}, options = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const call = { table, filters: [], orders: [], range: null, signal: null }
      calls.push(call)
      const query = {
        select() { return query },
        eq(column, value) { call.filters.push(['eq', column, value]); return query },
        in(column, value) { call.filters.push(['in', column, value]); return query },
        is(column, value) { call.filters.push(['is', column, value]); return query },
        order(column, settings) { call.orders.push([column, settings]); return query },
        range(from, to) { call.range = [from, to]; return query },
        abortSignal(signal) { call.signal = signal; return query },
        then(resolve, reject) {
          if (options.failureTable === table) return Promise.resolve(options.failure).then(resolve, reject)
          let rows = [...(seed[table] || [])].filter((row) => call.filters.every(([operator, column, value]) => operator === 'in' ? value.includes(row[column]) : (row[column] ?? null) === value))
          for (const [column, settings] of [...call.orders].reverse()) {
            rows.sort((left, right) => {
              const compared = String(left[column] ?? '').localeCompare(String(right[column] ?? ''))
              return settings?.ascending === false ? -compared : compared
            })
          }
          if (options.foreignTable === table && call.range?.[0] === 0) rows = [{ ...(rows[0] || { id: 'foreign' }), id: 'foreign', organization_id: 'org-b' }]
          const pageRows = call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows
          options.onPage?.(call, pageRows)
          return Promise.resolve({ data: pageRows, error: null, status: 200 }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

const membership = { organization_id: 'org-a', user_id: 'member-a', member_kind: 'team', status: 'active' }
const profile = { id: 'member-a', full_name: 'Member A' }
const rows = (count, make) => Array.from({ length: count }, (_, index) => make(index))

test('Client Work makes zero queries without an active organization or with an aborted signal', async () => {
  const client = fakeClient()
  const repository = await clientRepository(client)
  for (const organizationId of [null, undefined, '', ' ']) await assert.rejects(repository.getSnapshot(organizationId), /organizationId is required/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(repository.getSnapshot('org-a', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(client.calls.length, 0)
})

test('Client Work paginates beyond 1000 with stable ID ordering, no duplicates, and membership-only profiles', async () => {
  const clients = rows(1201, (index) => ({ id: 'client-' + String(index).padStart(4, '0'), organization_id: 'org-a', company: 'Company ' + index, name: 'Client ' + index, status: 'active' }))
  clients.push({ ...clients[0] })
  const client = fakeClient({
    organization_memberships: [membership],
    profiles: [profile, { id: 'outsider', full_name: 'Outsider' }],
    clients,
  })
  const signal = new AbortController().signal
  const snapshot = await (await clientRepository(client)).getSnapshot('org-a', { signal })
  assert.equal(snapshot.clients.length, 1201)
  assert.equal(new Set(snapshot.clients.map((row) => row.id)).size, 1201)
  assert.deepEqual(snapshot.profiles.map((row) => row.id), ['member-a'])
  assert.deepEqual(client.calls.find((call) => call.table === 'profiles').filters, [['in', 'id', ['member-a']]])
  const clientCalls = client.calls.filter((call) => call.table === 'clients')
  assert.ok(clientCalls.length >= 3)
  assert.deepEqual(clientCalls[0].range, [0, 499])
  assert.deepEqual(clientCalls[1].range, [500, 999])
  assert.equal(clientCalls.every((call) => call.orders.at(-1)[0] === 'id' && call.signal === signal), true)
  for (const call of client.calls.filter((item) => item.table !== 'profiles')) {
    assert.ok(call.filters.some(([operator, column, value]) => operator === 'eq' && column === 'organization_id' && value === 'org-a'), call.table)
  }
})

test('Client Work fails closed on foreign rows and preserves envelope-only access status', async () => {
  const foreign = fakeClient({ organization_memberships: [membership], profiles: [profile], tasks: [{ id: 'task-a', organization_id: 'org-a' }] }, { foreignTable: 'tasks' })
  await assert.rejects((await clientRepository(foreign)).getSnapshot('org-a'), (error) => error.status === 403 && error.membershipMismatch)
  for (const status of [401, 403]) {
    const envelope = { data: null, error: { message: 'Denied' }, status }
    const client = fakeClient({}, { failureTable: 'organization_memberships', failure: envelope })
    await assert.rejects((await clientRepository(client)).getSnapshot('org-a'), (error) => isOrganizationAccessError(error) && error.status === status && error.cause === envelope.error)
  }
})

test('Client Work cancellation stops later pages', async () => {
  const controller = new AbortController()
  const client = fakeClient({
    organization_memberships: [membership],
    profiles: [profile],
    clients: rows(1200, (index) => ({ id: 'client-' + index, organization_id: 'org-a', company: 'Company', status: 'active' })),
  }, { onPage(call) { if (call.table === 'clients' && call.range[0] === 0) controller.abort() } })
  await assert.rejects((await clientRepository(client)).getSnapshot('org-a', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(client.calls.filter((call) => call.table === 'clients').length, 1)
})

test('Internal Work paginates complete project and child directories and reads only member profiles', async () => {
  const projects = rows(1201, (index) => ({ id: 'project-' + String(index).padStart(4, '0'), organization_id: 'org-a', engagement_type: 'internal', status: 'active', updated_at: '2026-09-04T00:00:00Z' }))
  const tasks = rows(1201, (index) => ({ id: 'task-' + String(index).padStart(4, '0'), organization_id: 'org-a', project_id: projects[index].id, status: 'ready' }))
  const client = fakeClient({ projects, tasks, organization_memberships: [membership], profiles: [profile, { id: 'outsider', full_name: 'Outsider' }] })
  const signal = new AbortController().signal
  const snapshot = await (await internalRepository(client)).getSnapshot('org-a', { signal })
  assert.equal(snapshot.projects.length, 1201)
  assert.equal(snapshot.tasks.length, 1201)
  assert.equal(new Set(snapshot.tasks.map((row) => row.id)).size, 1201)
  assert.deepEqual(snapshot.profiles.map((row) => row.id), ['member-a'])
  for (const table of ['projects', 'tasks']) {
    const calls = client.calls.filter((call) => call.table === table)
    assert.ok(calls.length >= 3)
    assert.equal(calls.every((call) => call.orders.at(-1)[0] === 'id' && call.signal === signal), true)
  }
})

test('Internal Work makes zero queries without organization and fails closed on foreign pages', async () => {
  const empty = fakeClient()
  const repository = await internalRepository(empty)
  await assert.rejects(repository.getSnapshot(''), /organizationId is required/)
  assert.equal(empty.calls.length, 0)
  const foreign = fakeClient({ projects: [{ id: 'project-a', organization_id: 'org-a', engagement_type: 'internal', status: 'active' }] }, { foreignTable: 'projects' })
  await assert.rejects((await internalRepository(foreign)).getSnapshot('org-a'), (error) => error.status === 403 && error.membershipMismatch)
})
