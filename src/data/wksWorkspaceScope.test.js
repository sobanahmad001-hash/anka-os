import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isOrganizationAccessError } from './organizationScope.js'

const cases = [
  ['portfolioWorkspace', 'fetchPortfolioWorkspaceSnapshot', null, 'projects'],
  ['internalWorkspace', 'fetchInternalWorkspaceSnapshot', null, 'projects'],
  ['clientWorkspace', 'fetchClientWorkspaceSnapshot', 'client', 'client'],
  ['projectEngagementWorkspace', 'fetchProjectEngagementSnapshot', 'project', 'project'],
]
let sequence = 0

function fakeClient({ failure, corruptTable } = {}) {
  const calls = []
  const tables = ['clients', 'projects', 'agency_clients', 'brands', 'engagements', 'tasks', 'work_items', 'workstreams',
    'engagement_services', 'engagement_stage_instances', 'engagement_stage_dependencies', 'engagement_prerequisites',
    'milestones', 'requests', 'deliverables', 'deliverable_versions', 'client_contacts', 'project_client_access',
    'client_portal_items', 'activity_events', 'living_project_documents', 'organization_memberships', 'artifacts',
    'artifact_versions', 'artifact_approvals', 'engagement_events']
  const seed = Object.fromEntries(tables.map(table => [table, ['a', 'b'].map(org => ({
    id: (table === 'projects' ? 'project' : table === 'clients' ? 'client' : table === 'agency_clients' ? 'agency' : table === 'engagements' ? 'engagement' : table) + '-' + org,
    organization_id: 'org-' + org, project_id: 'project-' + org, canonical_client_id: 'client-' + org,
    client_id: (['brands', 'engagements'].includes(table) ? 'agency' : 'client') + '-' + org,
    engagement_id: 'engagement-' + org, brand_id: 'brands-' + org, artifact_id: 'artifacts-' + org,
    user_id: 'user-' + org, member_kind: 'team', status: 'active', engagement_type: 'internal',
    archived_at: null, deleted_at: null, withdrawn_at: null, review_status: 'ready_for_internal_review',
  }))]))
  return { calls, from(table) {
    const call = { table, filters: [], signal: null }
    calls.push(call)
    let single = false
    const query = {
      select() { return query },
      eq(key, value) { call.filters.push(['eq', key, value]); return query },
      is(key, value) { call.filters.push(['is', key, value]); return query },
      in(key, value) { call.filters.push(['in', key, value]); return query },
      order() { return query }, limit() { return query },
      single() { single = true; return query }, maybeSingle() { single = true; return query },
      abortSignal(signal) { call.signal = signal; return query },
      then(resolve, reject) {
        if (failure) return Promise.resolve(failure).then(resolve, reject)
        let rows = (seed[table] || []).filter(row => call.filters.every(([op, key, value]) => op === 'in' ? value.includes(row[key]) : (row[key] ?? null) === value))
        if (table === corruptTable) rows = [{ ...seed[table][1] }]
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null, status: 200 }).then(resolve, reject)
      },
    }
    return query
  } }
}

async function loadRepository(name, client) {
  const key = '__wksScopeTest' + sequence++
  globalThis[key] = client
  const source = readFileSync(new URL('./' + name + 'Repository.js', import.meta.url), 'utf8')
    .replace("import { supabase } from '../lib/supabase'", 'const supabase = globalThis[' + JSON.stringify(key) + ']')
  try { return await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')) }
  finally { delete globalThis[key] }
}

for (const [name, fn, root, resultKey] of cases) {
  const invoke = (repository, org, options, idOrg = org?.slice(-1)) => repository[fn](...(root ? [root + '-' + idOrg] : []), org, options)

  test(name + ' executes isolated A/B roots and scopes every tenant query with its signal', async () => {
    for (const org of ['org-a', 'org-b']) {
      const client = fakeClient()
      const repository = await loadRepository(name, client)
      const signal = new AbortController().signal
      const result = await invoke(repository, org, { signal })
      const roots = Array.isArray(result[resultKey]) ? result[resultKey] : [result[resultKey]]
      assert.ok(roots.length)
      assert.ok(roots.every(row => row.organization_id === org))
      for (const call of client.calls) {
        assert.equal(call.signal, signal, call.table)
        if (call.table !== 'profiles') assert.ok(call.filters.some(([op, key, value]) => op === 'eq' && key === 'organization_id' && value === org), call.table)
      }
    }
  })

  test(name + ' makes zero queries without selection or with an aborted scope', async () => {
    const client = fakeClient()
    const repository = await loadRepository(name, client)
    for (const org of [null, undefined, '', ' ']) await assert.rejects(invoke(repository, org), /organizationId is required/)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(invoke(repository, 'org-a', { signal: controller.signal }), { name: 'AbortError' })
    assert.equal(client.calls.length, 0)
  })

  test(name + ' rejects mismatched returned roots', async () => {
    const client = fakeClient({ corruptTable: root === 'client' ? 'clients' : 'projects' })
    const repository = await loadRepository(name, client)
    await assert.rejects(invoke(repository, 'org-a'), error => error.status === 403 && error.membershipMismatch)
  })

  test(name + ' rejects mismatched child rows', async () => {
    const client = fakeClient({ corruptTable: 'tasks' })
    const repository = await loadRepository(name, client)
    await assert.rejects(invoke(repository, 'org-a'), error => error.status === 403 && error.membershipMismatch)
  })

  test(name + ' preserves envelope 401/403 for provider recovery and compatible fallback', async () => {
    for (const response of [
      { status: 401, error: { message: 'Denied' } },
      { status: 403, error: { message: 'Denied' } },
      { error: { message: 'Denied', statusCode: 403 } },
    ]) {
      const repository = await loadRepository(name, fakeClient({ failure: response }))
      await assert.rejects(invoke(repository, 'org-a'), error => isOrganizationAccessError(error) && error.cause === response.error)
    }
  })

  if (root) test(name + ' does not accept a B deep link under selection A', async () => {
    const client = fakeClient()
    const repository = await loadRepository(name, client)
    await assert.rejects(invoke(repository, 'org-a', {}, 'b'), { status: 404 })
    assert.equal(client.calls.length, 1)
    assert.ok(client.calls[0].filters.some(([, key, value]) => key === 'organization_id' && value === 'org-a'))
  })
}
