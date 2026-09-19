import test from 'node:test'
import assert from 'node:assert/strict'
import { canShowAuthorityAdministration, createAuthorityAdministrationRepository, validateAdministration } from './authorityAdministration.js'

const row = overrides => ({ id: 'row', organization_id: 'org', user_id: 'user', status: 'active', ...overrides })
const envelope = (userId = null, overrides = {}) => ({ schema_version: 1, compatibility_only: true, organization_id: 'org',
  actor_id: 'admin', members: [{ user_id: 'user', organization_id: 'org' }], departments: [], projects: [],
  token: userId ? 'snapshot-token' : null, snapshot: userId ? { user_id: userId, organization_id: 'org', legacy_role: 'contributor',
    department_memberships: [row({ department_id: 'design' })], contributor_designations: [], project_manager_bindings: [] } : null, ...overrides })
const command = () => ({ organizationId: 'org', userId: 'user', action: 'set_designation', value: 'intern', token: 'snapshot-token', requestId: 'nonce' })

test('only existing owner/admin memberships advertise new controls', () => {
  for (const role of ['system_owner', 'operations_admin']) assert.equal(canShowAuthorityAdministration({ organizationId: 'org', role }), true)
  for (const role of ['admin', 'executive', 'project_owner', 'department_manager', 'contributor', 'intern']) assert.equal(canShowAuthorityAdministration({ organizationId: 'org', role }), false)
  assert.equal(canShowAuthorityAdministration(null), false)
  assert.equal(canShowAuthorityAdministration({ role: 'system_owner' }), false)
})

test('admin reader rejects wrong tenant, target, history or non-compatibility envelopes', () => {
  for (const overrides of [{ organization_id: 'foreign' }, { compatibility_only: false }, { actor_id: null },
    { schema_version: 2 }, { members: [{ user_id: 'foreign', organization_id: 'foreign' }] }, { projects: null },
    { token: null }, { snapshot: { ...envelope('user').snapshot, user_id: 'foreign' } },
    { snapshot: { ...envelope('user').snapshot, department_memberships: [row({ organization_id: 'foreign' })] } }]) {
    assert.throws(() => validateAdministration(envelope('user', overrides), 'org', 'user'))
  }
  assert.throws(() => validateAdministration(envelope('user'), 'org', null))
})

test('projection keeps history, no derived permission booleans or title mapping', () => {
  const data = envelope('user', { can_manage: true })
  data.snapshot.department_memberships.push(row({ id: 'old', status: 'revoked' }))
  const result = validateAdministration(data, 'org', 'user')
  assert.equal(result.snapshot.department_memberships.length, 2)
  assert.equal(result.snapshot.legacy_role, 'contributor')
  assert.equal('can_manage' in result, false)
})

test('RPC-only repository scopes reads and strips untrusted actor/role command fields', async () => {
  const calls = []
  const repo = createAuthorityAdministrationRepository({ from() { throw new Error('No legacy writes') }, rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: name === 'get_authority_administration' ? envelope('user')
      : { schema_version: 1, compatibility_only: true, organization_id: 'org', user_id: 'user', request_id: 'nonce' }, error: null })
  } })
  await repo.read('org', 'user')
  await repo.change({ ...command(), actorId: 'spoof', role: 'system_owner' })
  assert.deepEqual(calls, [
    { name: 'get_authority_administration', args: { p_organization_id: 'org', p_user_id: 'user' } },
    { name: 'change_authority_compatibility', args: { p_organization_id: 'org', p_user_id: 'user', p_action: 'set_designation',
      p_value: 'intern', p_expected_token: 'snapshot-token', p_request_id: 'nonce' } },
  ])
})

test('missing schema, authorization and stale edit errors propagate without retry or legacy fallback', async () => {
  for (const code of ['PGRST202', '42501', '40001']) {
    let calls = 0
    const repo = createAuthorityAdministrationRepository({ rpc() { calls++; return Promise.resolve({ error: { code } }) } })
    await assert.rejects(repo.change(command()), { code })
    assert.equal(calls, 1)
  }
})

test('aborted scope never starts request; late read and write responses are discarded', async () => {
  const aborted = new AbortController(); aborted.abort()
  const unavailable = createAuthorityAdministrationRepository({ rpc() { throw new Error('Must not start') } })
  await assert.rejects(unavailable.read('org', null, { signal: aborted.signal }), { name: 'AbortError' })
  for (const write of [false, true]) {
    const controller = new AbortController()
    let finish
    const repo = createAuthorityAdministrationRepository({ rpc() { return new Promise(resolve => { finish = resolve }) } })
    const pending = write ? repo.change(command(), { signal: controller.signal }) : repo.read('org', 'user', { signal: controller.signal })
    controller.abort()
    finish({ data: envelope('user'), error: null })
    await assert.rejects(pending, { name: 'AbortError' })
  }
})

test('incomplete/unknown commands and foreign write receipts fail closed', async () => {
  const repo = createAuthorityAdministrationRepository({ rpc() { return Promise.resolve({ data: { schema_version: 1, compatibility_only: true, organization_id: 'foreign' } }) } })
  for (const overrides of [{ action: 'update_role' }, { token: null }, { requestId: null }, { value: 'operations_admin' }]) {
    await assert.rejects(repo.change({ ...command(), ...overrides }), TypeError)
  }
  await assert.rejects(repo.change(command()), /mismatched/)
})

test('explicit retries reuse the caller request ID, with no implicit automatic retry', async () => {
  const ids = []
  const repo = createAuthorityAdministrationRepository({ rpc(_name, args) {
    ids.push(args.p_request_id)
    return Promise.resolve({ data: { schema_version: 1, compatibility_only: true, organization_id: 'org', user_id: 'user', request_id: args.p_request_id } })
  } })
  const input = command()
  await repo.change(input)
  await repo.change(input)
  assert.deepEqual(ids, ['nonce', 'nonce'])
})
