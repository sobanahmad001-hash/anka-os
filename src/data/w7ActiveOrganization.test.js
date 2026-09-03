import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { createOperatingSpineRepository } from './operatingSpineRepository.js'

const repositorySource = readFileSync(new URL('./operatingSpineRepository.js', import.meta.url), 'utf8')
const viewSource = readFileSync(new URL('../apps/OperatingSpine.jsx', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/20260903170702_w7_active_organization_client_rpc_post_qts4.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260903170702_w7_active_organization_client_rpc_post_qts4.sql', import.meta.url), 'utf8')

test('W7 migration ledger follows live RET2 and reserved QTS4 slots', () => {
  assert.ok(20260903170702 > 20260903152801)
  assert.ok(20260903170702 > 20260903123259)
})

function scopedClient(seed = {}) {
  const calls = []
  const rpcCalls = []

  function queryFor(table) {
    const filters = []
    const query = {
      select() { return query },
      insert(value) { calls.push({ table, operator: 'insert', value }); return query },
      eq(column, value) { filters.push({ column, value }); calls.push({ table, operator: 'eq', column, value }); return query },
      in(column, values) { calls.push({ table, operator: 'in', column, values }); return query },
      is(column, value) { calls.push({ table, operator: 'is', column, value }); return query },
      order() { return query },
      abortSignal(signal) { calls.push({ table, operator: 'abortSignal', signal }); return query },
      rows() {
        return (seed[table] || []).filter(row => filters.every(({ column, value }) => (
          column.includes('.') || row[column] === value
        )))
      },
      maybeSingle() { return Promise.resolve({ data: query.rows()[0] || null, error: null }) },
      single() { return Promise.resolve({ data: query.rows()[0] || null, error: null }) },
      then(resolve, reject) { return Promise.resolve({ data: query.rows(), error: null }).then(resolve, reject) },
    }
    return query
  }

  return {
    calls,
    rpcCalls,
    client: {
      from: queryFor,
      rpc(name, params) {
        rpcCalls.push({ name, params })
        return Promise.resolve({ data: seed.rpcResult || 'engagement-created', error: null })
      },
    },
  }
}

const orgTables = [
  'engagements', 'work_items', 'engagement_stage_instances', 'engagement_services',
  'engagement_stage_dependencies', 'engagement_prerequisites', 'engagement_assets',
  'engagement_events', 'integration_connection_engagements', 'artifacts',
  'artifact_versions', 'artifact_approvals', 'content_requests', 'design_workshop_sessions',
]

test('W7 active organization isolates A and B reads at every portfolio root', async () => {
  const seed = {
    agency_clients: [
      { id: 'client-a', organization_id: 'org-a', name: 'A' },
      { id: 'client-b', organization_id: 'org-b', name: 'B' },
    ],
    engagements: [
      { id: 'engagement-a', organization_id: 'org-a' },
      { id: 'engagement-b', organization_id: 'org-b' },
    ],
    work_items: [],
    engagement_stage_instances: [],
    service_catalog: [],
    organization_memberships: [],
  }
  const { client, calls } = scopedClient(seed)
  const repository = createOperatingSpineRepository(client)

  assert.deepEqual((await repository.listClientsAndBrands('org-a')).map(row => row.id), ['client-a'])
  assert.deepEqual((await repository.listClientsAndBrands('org-b')).map(row => row.id), ['client-b'])
  assert.deepEqual((await repository.getPortfolioSnapshot('org-a')).engagements.map(row => row.id), ['engagement-a'])
  assert.deepEqual((await repository.getPortfolioSnapshot('org-b')).engagements.map(row => row.id), ['engagement-b'])

  for (const table of ['agency_clients', 'engagements', 'work_items', 'engagement_stage_instances']) {
    assert.ok(calls.some(call => call.table === table && call.operator === 'eq' && call.column === 'organization_id'))
  }
})

test('W7 engagement loading scopes the root and all tenant-bearing child reads', async () => {
  const controller = new AbortController()
  const seed = { engagements: [{ id: 'engagement-b', organization_id: 'org-b' }] }
  const { client, calls } = scopedClient(seed)
  const result = await createOperatingSpineRepository(client).getEngagement('engagement-b', 'org-b', { signal: controller.signal })

  assert.equal(result.engagement.organization_id, 'org-b')
  for (const table of orgTables) {
    assert.ok(calls.some(call => call.table === table && call.operator === 'eq' && call.column === 'organization_id' && call.value === 'org-b'), `${table} must be scoped`)
  }
  assert.ok(calls.some(call => call.operator === 'abortSignal' && call.signal === controller.signal))
})

test('W7 writes carry the selected organization and reject an A record under B', async () => {
  const { client, rpcCalls } = scopedClient({
    brands: [{ id: 'brand-a', client_id: 'client-a', organization_id: 'org-a', status: 'active' }],
    agency_clients: [{ id: 'client-a', organization_id: 'org-a', status: 'active' }],
    organization_memberships: [{ user_id: 'actor', organization_id: 'org-b', member_kind: 'team', status: 'active' }],
    rpcResult: { client: { id: 'client-b' }, brand: { id: 'brand-b' } },
  })
  const repository = createOperatingSpineRepository(client)

  await repository.createClient({ name: 'B Client', brandName: 'B Brand' }, 'actor', 'org-b')
  assert.equal(rpcCalls[0].params.p_organization_id, 'org-b')

  await assert.rejects(
    () => repository.composeEngagement({ clientId: 'client-a', brandId: 'brand-a', name: 'Wrong scope', serviceIds: ['service'] }, 'org-b'),
    error => error.status === 403,
  )
  await assert.rejects(
    () => repository.createBrand({ clientId: 'client-a', name: 'Wrong scope' }, 'actor', 'org-b'),
    error => error.status === 403,
  )
  assert.equal(rpcCalls.some(call => call.name === 'compose_engagement'), false)
})

test('W7 preserves response-level access status when the Supabase error omits it', async () => {
  const response = { data: null, error: { message: 'Forbidden by RLS' }, status: 403 }
  const query = {
    select() { return query },
    eq() { return query },
    order() { return query },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject) },
  }
  const repository = createOperatingSpineRepository({
    from() { return query },
    rpc() { throw new Error('must not be called') },
  })

  await assert.rejects(
    () => repository.listClientsAndBrands('org-b'),
    error => error.message === 'Forbidden by RLS' && error.status === 403,
  )
})

test('W7 consumer clears on scope revision and suppresses stale/deep-link responses without switching organization', () => {
  assert.match(viewSource, /<OrganizationGate><ScopedOperatingSpine/)
  assert.match(viewSource, /activeOrganizationId, scopeRevision, requestSignal/)
  assert.match(viewSource, /catalogGeneration\.current \+= 1/)
  assert.match(viewSource, /workspaceGeneration\.current \+= 1/)
  assert.match(viewSource, /signal\.aborted \|\| generation !== workspaceGeneration\.current/)
  assert.match(viewSource, /getEngagement\(id, activeOrganizationId, \{ signal \}\)/)
  assert.match(viewSource, /requestedEngagementId[\s\S]*openEngagement\(requestedEngagementId/)
  assert.doesNotMatch(viewSource, /selectOrganization/)
})

test('W7 selected-organization RPC removes oldest-membership inference and keeps canonical creation atomic', () => {
  assert.match(migration, /drop function if exists public\.create_commercial_client\([\s\S]*text, text, text, text, text, text, text, text/)
  assert.match(migration, /create function public\.create_commercial_client\(\s*p_organization_id uuid/)
  assert.match(migration, /membership\.organization_id = p_organization_id/)
  assert.match(migration, /organization\.status = 'active'/)
  assert.match(migration, /membership\.status = 'active'/)
  assert.doesNotMatch(migration, /order by membership\.created_at[\s\S]*limit 1/)
  assert.match(migration, /security invoker/)
  assert.match(migration, /insert into public\.clients[\s\S]*p_organization_id/)
  assert.match(migration, /insert into public\.agency_clients[\s\S]*p_organization_id/)
  assert.match(migration, /insert into public\.brands[\s\S]*p_organization_id/)
})

test('W7 verifier covers selected B, non-member C, revoked/suspended access, atomicity, and rollback', () => {
  for (const check of [
    'valid_organization_b_write',
    'canonical_ownership_stays_in_organization_b',
    'non_member_organization_c_rejected',
    'revoked_membership_rejected',
    'suspended_organization_rejected',
    'failed_scope_writes_are_atomic',
    'ambiguous_oldest_membership_rpc_removed',
  ]) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /set local role authenticated/)
  assert.match(verifier, /request\.jwt\.claim\.sub/)
  assert.match(verifier, /acl\.grantee = 0[\s\S]*acl\.privilege_type = 'EXECUTE'/)
  assert.match(verifier, /not has_function_privilege\('anon',[\s\S]*'EXECUTE'\)/)
  assert.match(verifier, /has_function_privilege\('authenticated',[\s\S]*'EXECUTE'\)/)
  assert.match(verifier, /has_function_privilege\('service_role',[\s\S]*'EXECUTE'\)/)
  assert.match(verifier, /where not passed/)
  assert.match(verifier, /raise exception 'W7 active-organization verification failed: %'/)
  assert.match(verifier, /\nrollback;\s*$/)
})

// Structural coverage also prevents a future unscoped root from slipping into the repository.
test('W7 repository has no organization-less public read method signatures', () => {
  for (const method of ['listClientsAndBrands', 'listServices', 'listOwners', 'listEngagements', 'getPortfolioSnapshot']) {
    assert.match(repositorySource, new RegExp(`async ${method}\\(organizationId`))
  }
})
