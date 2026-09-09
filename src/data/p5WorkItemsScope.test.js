import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isCurrentWorkItemsRequest, readOrganizationRows } from './workItemsScope.js'

function clientWithRows(rowsByTable) {
  const calls = []
  return { calls, functions: { invoke: async () => ({ data: { data: null }, error: null }) }, from(table) {
    calls.push({ table, filters: [], signal: null })
    const call = calls.at(-1)
    const query = {
      select() { return query }, eq(column, value) { call.filters.push([column, value]); return query },
      is() { return query }, in(column, value) { call.filters.push([column, value]); return query }, order() { return query },
      abortSignal(signal) { call.signal = signal; return query },
      then(resolve) { return Promise.resolve({ data: rowsByTable[table] || [], error: null }).then(resolve) },
    }
    return query
  } }
}

test('Work Items reads make zero queries without an active organization', async () => {
  const client = clientWithRows({})
  assert.deepEqual(await readOrganizationRows('', () => client.from('work_items')), [])
  assert.equal(client.calls.length, 0)
})

test('Work Items roots scope by organization and attach the abort signal', async () => {
  const controller = new AbortController()
  const client = clientWithRows({ work_items: [{ id: 'work-a', organization_id: 'org-a' }], work_item_dependencies: [{ organization_id: 'org-a', work_item_id: 'work-a' }] })
  await readOrganizationRows('org-a', organizationId => client.from('work_items').select('*').eq('organization_id', organizationId), { signal: controller.signal })
  assert.deepEqual(client.calls[0].filters[0], ['organization_id', 'org-a'])
  assert.equal(client.calls[0].signal, controller.signal)
})

test('Work Items reads reject foreign rows even if a backend response is malformed', async () => {
  const client = clientWithRows({ work_items: [{ id: 'foreign', organization_id: 'org-b' }] })
  await assert.rejects(readOrganizationRows('org-a', organizationId => client.from('work_items').select('*').eq('organization_id', organizationId)), error => error.status === 403 && error.membershipMismatch)
})

test('a delayed organization A response cannot become current after switching to B', () => {
  const requestA = { organizationId: 'org-a', generation: 1, signal: new AbortController().signal }
  assert.equal(isCurrentWorkItemsRequest(requestA, { organizationId: 'org-b', generation: 2 }), false)
  assert.equal(isCurrentWorkItemsRequest({ ...requestA, organizationId: 'org-b', generation: 2 }, { organizationId: 'org-b', generation: 2 }), true)
})

test('all P5 mutation consumers reload typed stale writes while retaining intended actions', () => {
  const panel = readFileSync(new URL('../components/WorkItemsPanel.jsx', import.meta.url), 'utf8')
  const canonical = readFileSync(new URL('../apps/CanonicalProjects.jsx', import.meta.url), 'utf8')
  const department = readFileSync(new URL('../apps/DepartmentWorkshop.jsx', import.meta.url), 'utf8')
  const myWork = readFileSync(new URL('../apps/MyWork.jsx', import.meta.url), 'utf8')
  for (const intent of ['automation acknowledgement', 'work-item edits', 'deletion', 'dependency addition', 'dependency removal']) assert.match(panel, new RegExp(intent))
  assert.match(panel, /recoverStaleWrite[\s\S]*await loadItems\(\{ preserveEditor: true \}\)/)
  assert.match(panel, /row_version: refreshed\.row_version/)
  const canonicalTransition = canonical.slice(canonical.indexOf('async function transitionTask'), canonical.indexOf('async function createResearch'))
  for (const source of [canonicalTransition, department, myWork]) {
    assert.match(source, /status === 409/)
    assert.match(source, /Intended[\s\S]*Project Task status/)
    assert.match(source, /await (refreshWorkspace|loadWorkspace)\(\)/)
  }
})

test('the concrete repository scopes both roots and skips absent selection', () => {
  const source = readFileSync(new URL('./workItemsRepository.js', import.meta.url), 'utf8')
  assert.match(source, /if \(!organizationId \|\| !engagementId\) return Promise\.resolve\(\[\]\)/)
  assert.match(source, /listDependencies:[\s\S]*organizationId && workItemIds\.length/)
  assert.ok((source.match(/\.eq\('organization_id', organizationId\)/g) || []).length >= 2)
})

test('Content Studio legacy organization input is accepted only behind the engagement scope preflight', () => {
  const contentRepository = readFileSync(new URL('./contentStudioRepository.js', import.meta.url), 'utf8')
  const edge = readFileSync(new URL('../../supabase/functions/work-items/index.ts', import.meta.url), 'utf8')
  assert.match(contentRepository, /organization_id: organizationId/)
  assert.match(edge, /selectedOrganizationId\(body\)/)
  assert.match(edge, /requireGenerateContentScope\([\s\S]*organizationId, engagementId\)/)
  assert.match(edge, /\.eq\('organization_id', organizationId\)/)
})
