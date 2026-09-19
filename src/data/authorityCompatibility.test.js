import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createOrganizationScopeRepository, normalizeOrganizationMemberships } from './organizationScope.js'
import { readAuthorityCompatibility, validateAuthorityCompatibility } from '../../supabase/functions/_shared/authorityCompatibility.js'

const envelope = (overrides = {}) => ({ schema_version: 1, compatibility_only: true,
  organization_id: 'org-a', user_id: 'user-a', membership_id: 'member-a',
  legacy_role: 'executive', legacy_department_id: 'design',
  department_memberships: [], contributor_designations: [], project_manager_bindings: [], ...overrides })
const record = (overrides = {}) => ({ id: 'record-a', organization_id: 'org-a', user_id: 'user-a', status: 'active', ...overrides })

test('compatibility projection preserves legacy role and explicit revoked history without derived permissions', () => {
  const result = validateAuthorityCompatibility(envelope({
    can_approve: true, contributor_designations: [record({ designation: 'executive' })],
    department_memberships: [record({ department_id: 'design' }), record({ department_id: 'content', status: 'revoked' })],
    project_manager_bindings: [record({ project_id: 'project-a' }), record({ project_id: 'project-b' })],
  }), 'org-a', 'user-a')
  assert.equal(result.legacy_role, 'executive')
  assert.equal(result.compatibility_only, true)
  assert.equal('can_approve' in result, false)
  assert.equal(result.department_memberships[1].status, 'revoked')
  assert.equal(result.project_manager_bindings.length, 2)
})

test('malformed or foreign compatibility envelopes/rows fail closed', () => {
  for (const overrides of [{ schema_version: 2 }, { compatibility_only: false }, { organization_id: 'other' },
    { user_id: 'other' }, { membership_id: '' }, { department_memberships: null },
    { contributor_designations: [record({ user_id: 'other' })] },
    { project_manager_bindings: [record({ organization_id: 'other' })] },
    { department_memberships: [record({ status: 'unknown' })] }]) {
    assert.throws(() => validateAuthorityCompatibility(envelope(overrides), 'org-a', 'user-a'), { status: 403 })
  }
})

test('empty explicit records do not fall back to role titles or legacy department', () => {
  const result = validateAuthorityCompatibility(envelope(), 'org-a')
  assert.deepEqual(result.department_memberships, [])
  assert.deepEqual(result.project_manager_bindings, [])
  assert.deepEqual(result.contributor_designations, [])
})

test('repository reader is opt-in and sends only selected organization to self RPC', async () => {
  const calls = []
  const client = { from() { throw new Error('No legacy query expected') }, rpc(name, args) {
    calls.push({ name, args }); return Promise.resolve({ data: envelope(), error: null })
  } }
  const repo = createOrganizationScopeRepository(client)
  assert.equal(calls.length, 0)
  assert.equal((await repo.readAuthorityCompatibility('org-a', { expectedUserId: 'user-a' })).legacy_role, 'executive')
  assert.deepEqual(calls, [{ name: 'get_my_authority_compatibility', args: { p_organization_id: 'org-a' } }])
})

test('reader propagates missing-schema and access errors rather than inventing authority', async () => {
  for (const code of ['PGRST202', '42501']) {
    const error = { code, message: 'unavailable' }
    await assert.rejects(readAuthorityCompatibility({ rpc: async () => ({ error }) }, 'org-a'), e => e === error)
  }
})

test('abort before dispatch or after delayed response never returns old scope', async () => {
  const early = new AbortController(); early.abort()
  await assert.rejects(readAuthorityCompatibility({ rpc() { throw new Error('must not dispatch') } }, 'org-a', { signal: early.signal }), { name: 'AbortError' })
  const late = new AbortController()
  await assert.rejects(readAuthorityCompatibility({ rpc: async () => { late.abort(); return { data: envelope(), error: null } } }, 'org-a', { signal: late.signal }), { name: 'AbortError' })
})

test('legacy normalization remains exactly shaped and elevated executive is untouched', () => {
  const organization = { id: 'org-a', name: 'A', status: 'active' }
  assert.deepEqual(normalizeOrganizationMemberships([{ id: 'member-a', organization_id: 'org-a', role: 'executive',
    department_id: 'design', status: 'active', member_kind: 'team', organization }]),
  [{ id: 'member-a', organizationId: 'org-a', role: 'executive', departmentId: 'design', organization }])
})

test('server compatibility reader uses caller RLS client and never privileged admin', () => {
  const source = readFileSync(new URL('../../supabase/functions/_shared/serverOrganizationContext.ts', import.meta.url), 'utf8')
  const reader = source.slice(source.indexOf('export function readServerAuthorityCompatibility'), source.indexOf('export type ServerOrganizationDependencies'))
  assert.match(reader, /readAuthorityCompatibility\(context\.userClient, context\.organizationId/)
  assert.match(reader, /expectedUserId: context\.user\.id/)
  assert.doesNotMatch(reader, /context\.admin/)
})
