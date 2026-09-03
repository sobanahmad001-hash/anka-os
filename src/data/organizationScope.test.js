import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createLatestRequestGuard, createOrganizationScopeRepository, createOrganizationSelectionStorage, isOrganizationAccessError, normalizeOrganizationMemberships, resolveOrganizationSelection } from './organizationScope.js'

const row = (id, overrides = {}) => ({ id: 'membership-' + id, organization_id: id, member_kind: 'team', status: 'active', role: 'contributor', department_id: 'design', organization: { id, name: id.toUpperCase(), slug: id, status: 'active' }, ...overrides })

test('keeps only active team memberships in active matching organizations', () => {
  const result = normalizeOrganizationMemberships([row('org-b'), row('org-a'), row('org-c', { status: 'revoked' }), row('org-d', { member_kind: 'client' }), row('org-e', { organization: { id: 'org-e', name: 'E', status: 'suspended' } }), row('org-x', { organization: { id: 'org-y', name: 'Y', status: 'active' } }), row('org-a')])
  assert.deepEqual(result.map(item => item.organizationId), ['org-a', 'org-b'])
})

test('single auto-selects while multiple require explicit selection', () => {
  const one = normalizeOrganizationMemberships([row('org-a')])
  const two = normalizeOrganizationMemberships([row('org-a'), row('org-b')])
  assert.equal(resolveOrganizationSelection({ memberships: one }).activeOrganizationId, 'org-a')
  assert.deepEqual(resolveOrganizationSelection({ memberships: two }), { activeOrganizationId: null, selectionRequired: true, staleSelection: false })
  assert.equal(resolveOrganizationSelection({ memberships: two, storedOrganizationId: 'org-b' }).activeOrganizationId, 'org-b')
})

test('stale, revoked, empty, and deep-link-like values never select', () => {
  const two = normalizeOrganizationMemberships([row('org-a'), row('org-b')])
  assert.deepEqual(resolveOrganizationSelection({ memberships: two, storedOrganizationId: 'org-c', requestedOrganizationId: 'org-b' }), { activeOrganizationId: null, selectionRequired: true, staleSelection: true })
  assert.deepEqual(resolveOrganizationSelection({ memberships: [], storedOrganizationId: 'org-a' }), { activeOrganizationId: null, selectionRequired: false, staleSelection: true })
})

test('storage is isolated by user and cleared independently on sign-out', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const selections = createOrganizationSelectionStorage(storage)
  selections.write('user-a', 'org-a'); selections.write('user-b', 'org-b'); selections.clear('user-a')
  assert.equal(selections.read('user-a'), null); assert.equal(selections.read('user-b'), 'org-b')
})

test('late requests are invalidated when scope changes', () => {
  const guard = createLatestRequestGuard(); const a = guard.begin(); const b = guard.begin()
  assert.equal(guard.isCurrent(a), false); assert.equal(guard.isCurrent(b), true); guard.invalidate(); assert.equal(guard.isCurrent(b), false)
})

test('access failures trigger membership revalidation', () => {
  assert.equal(isOrganizationAccessError({ status: 401 }), true); assert.equal(isOrganizationAccessError({ statusCode: 403 }), true); assert.equal(isOrganizationAccessError({ status: 500 }), false)
})

test('repository applies user, team, membership, and organization filters', async () => {
  const calls = []; const signal = new AbortController().signal
  const query = { select(value) { calls.push(['select', value]); return this }, eq(column, value) { calls.push(['eq', column, value]); return this }, abortSignal(value) { calls.push(['abortSignal', value]); return this }, then(resolve) { return Promise.resolve({ data: [row('org-a')], error: null }).then(resolve) } }
  const memberships = await createOrganizationScopeRepository({ from(table) { calls.push(['from', table]); return query } }).listActiveTeamMemberships('user-a', { signal })
  assert.deepEqual(memberships.map(item => item.organizationId), ['org-a'])
  assert.deepEqual(calls.filter(call => call[0] === 'eq'), [['eq', 'user_id', 'user-a'], ['eq', 'member_kind', 'team'], ['eq', 'status', 'active'], ['eq', 'organization.status', 'active']])
  assert.deepEqual(calls.at(-1), ['abortSignal', signal])
})

test('provider clears prior-user persistence and remains route-independent', () => {
  const source = readFileSync(new URL('../context/OrganizationContext.jsx', import.meta.url), 'utf8')
  assert.match(source, /prior && prior !== userId\) selections\.clear\(prior\)/)
  assert.match(source, /state\.userId === userId/)
  assert.match(source, /scopeAbort\.current\.abort\(\)/)
  assert.doesNotMatch(source, /react-router|useLocation|useSearchParams/)
})

test('shared provider and header selector are wired without changing AuthContext', () => {
  const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
  const header = readFileSync(new URL('../components/Header.jsx', import.meta.url), 'utf8')
  const auth = readFileSync(new URL('../context/AuthContext.jsx', import.meta.url), 'utf8')
  assert.match(main, /<AuthProvider>[\s\S]*<OrganizationProvider>/)
  assert.match(header, /aria-label="Active organization"/)
  assert.doesNotMatch(auth, /activeOrganization|OrganizationProvider/)
})