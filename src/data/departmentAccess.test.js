import assert from 'node:assert/strict'
import test from 'node:test'
import { createDepartmentAccessRepository } from './departmentAccess.js'

test('secondary department lookup is scoped to selected organization and signed-in user', async () => {
  const calls = []
  const signal = new AbortController().signal
  const query = {
    select(value) { calls.push(['select', value]); return this },
    eq(column, value) { calls.push(['eq', column, value]); return this },
    abortSignal(value) { calls.push(['abortSignal', value]); return this },
    async maybeSingle() { return { data: { id: 'department-membership' }, error: null } },
  }
  const client = { from(table) { calls.push(['from', table]); return query } }
  assert.equal(await createDepartmentAccessRepository(client).hasActiveMembership('org-B', 'user-B', 'design', { signal }), true)
  assert.deepEqual(calls, [
    ['from', 'organization_department_memberships'], ['select', 'id'],
    ['eq', 'organization_id', 'org-B'], ['eq', 'user_id', 'user-B'],
    ['eq', 'department_id', 'design'], ['eq', 'status', 'active'], ['abortSignal', signal],
  ])
})

test('missing or revoked secondary membership never grants Workshop access', async () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) }
  const access = createDepartmentAccessRepository({ from: () => query })
  assert.equal(await access.hasActiveMembership('org-B', 'user-B', 'marketing'), false)
  assert.equal(await access.hasActiveMembership('', 'user-B', 'marketing'), false)
})
