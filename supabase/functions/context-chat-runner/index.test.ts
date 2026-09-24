import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { handleRequest, requirePrivateChatPaidExecution, requirePrivateConversationAccess } from './index.ts'

Deno.test('paid switch denies new submissions while the handler never calls a provider without auth', async () => {
  let calls = 0
  const result = await handleRequest(new Request('https://example.test/run', { method: 'POST' }),
    () => { calls += 1; throw new Error('provider must not run') },
    { get: () => undefined })
  assertEquals(result.status, 401)
  assertEquals(calls, 0)
  assertEquals((await result.json()).error, 'Authentication required')
  assertThrows(() => requirePrivateChatPaidExecution({ get: () => undefined }))
})

const organizationId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

function accessAdmin(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      const query = {
        select(_columns: string) { return query },
        eq(column: string, value: unknown) {
          filters.push(row => row[column] === value)
          return query
        },
        is(column: string, value: unknown) {
          filters.push(row => row[column] === value)
          return query
        },
        async maybeSingle() {
          return { data: (tables[table] || []).find(row => filters.every(match => match(row))) || null,
            error: null }
        },
      }
      return query
    },
  }
}

Deno.test('private reply scope rechecks active project and current department authority', async () => {
  const organization = { context_kind: 'organization', project_id: null, department_id: null }
  const project = { context_kind: 'project_team', project_id: projectId, department_id: null }
  const department = { context_kind: 'department_private', project_id: null, department_id: 'design' }
  const membership = { role: 'contributor', department_id: 'content' }
  const admin = accessAdmin({
    projects: [{ id: projectId, organization_id: organizationId, archived_at: null }],
    organization_department_memberships: [
      { id: projectId, organization_id: organizationId, user_id: userId,
        department_id: 'design', status: 'active' },
    ],
  })
  await requirePrivateConversationAccess(admin as never, organization, membership, organizationId, userId)
  await requirePrivateConversationAccess(admin as never, project, membership, organizationId, userId)
  await requirePrivateConversationAccess(admin as never, department, membership, organizationId, userId)
  await assertRejects(() => requirePrivateConversationAccess(
    accessAdmin({ projects: [{ id: projectId, organization_id: organizationId,
      archived_at: '2026-09-23T00:00:00Z' }] }) as never,
    project, membership, organizationId, userId))
  await assertRejects(() => requirePrivateConversationAccess(
    accessAdmin({ organization_department_memberships: [
      { id: projectId, organization_id: organizationId, user_id: userId,
        department_id: 'design', status: 'revoked' },
    ] }) as never, department, membership, organizationId, userId))
  await requirePrivateConversationAccess(
    accessAdmin({}) as never, department,
    { role: 'operations_admin', department_id: null }, organizationId, userId)
  await requirePrivateConversationAccess(
    accessAdmin({}) as never, department,
    { role: 'contributor', department_id: 'design' }, organizationId, userId)
})
