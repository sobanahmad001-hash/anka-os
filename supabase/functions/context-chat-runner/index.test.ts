import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { handleRequest, requireOpenAiCanonicalContextChoice, requirePrivateChatPaidExecution, requirePrivateConversationAccess } from './index.ts'
import { buildPrivateConversationPrompt, canonicalOpenAiContext } from '../_shared/contextChatPrompt.js'

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

Deno.test('canonical records enter only an explicit OpenAI prompt with allowlisted fields and no IDs', () => {
  assertEquals(requireOpenAiCanonicalContextChoice(undefined, 'openai'), false)
  assertEquals(requireOpenAiCanonicalContextChoice(true, 'openai'), true)
  assertThrows(() => requireOpenAiCanonicalContextChoice(true, 'anthropic'))
  assertThrows(() => requireOpenAiCanonicalContextChoice(true, 'google_gemini'))
  const snapshot = canonicalOpenAiContext(
    { id: organizationId, name: 'Anka', settings: { secret: 'never-send' } },
    { id: projectId, name: 'Website', description: 'Current brief',
      status: 'active', health: 'at_risk', scope_statement: 'Launch scope',
      exclusions: 'No paid media', private_notes: 'never-send' })
  const prompt = JSON.parse(buildPrivateConversationPrompt([
    { id: userId, role: 'user', status: 'completed', body: 'What next?' },
  ], userId, { context_kind: 'project_team', project_id: projectId,
    department_id: null }, snapshot))
  assertEquals(prompt.canonical_context, { organization_name: 'Anka', project: {
    name: 'Website', description: 'Current brief', status: 'active',
    health: 'at_risk', scope: 'Launch scope', exclusions: 'No paid media',
  } })
  assertEquals(JSON.stringify(prompt).includes(projectId), false)
  assertEquals(JSON.stringify(prompt).includes(organizationId), false)
  assertEquals(JSON.stringify(prompt).includes('never-send'), false)
})

Deno.test('bounded work summary stays opt-in and respects organization versus selected-project scope', () => {
  const summary = { scope: 'selected_project', as_of: '2026-09-25T00:00:00Z',
    coverage: { visible_projects_scanned: 1, projects_included: 1,
      counts_describe_recent_visible_samples_only: true },
    projects: [{ id: projectId, name: 'Website', status: 'active', health: 'at_risk',
      sample: { project_tasks: 1, engagement_work_items: 0,
        project_task_statuses: { blocked: 1 } },
      project_tasks: [{ id: userId, title: 'Fix launch', status: 'blocked',
        due: '2026-09-28', assignee: 'Jamie Example' }],
      engagement_work_items: [],
      review_states_in_recent_visible_version_sample: {} }],
  }
  const rows = [{ id: userId, role: 'user', status: 'completed', body: 'What is blocked?' }]
  const projectScope = { context_kind: 'project_team', project_id: projectId,
    department_id: null }
  const withoutOptIn = JSON.parse(buildPrivateConversationPrompt(rows, userId, projectScope))
  assertEquals(withoutOptIn.canonical_context, undefined)
  const projectContext = canonicalOpenAiContext({ name: 'Anka' },
    { name: 'Website', status: 'active' }, summary)
  const withOptIn = JSON.parse(buildPrivateConversationPrompt(rows, userId,
    projectScope, projectContext))
  assertEquals(withOptIn.canonical_context.work_summary.scope, 'selected_project')
  assertEquals(withOptIn.canonical_context.work_summary.projects[0].project_tasks[0].title,
    'Fix launch')
  assertEquals(JSON.stringify(withOptIn).includes(projectId), false)
  assertEquals(JSON.stringify(withOptIn).includes(userId), false)
  const orgContext = canonicalOpenAiContext({ name: 'Anka' }, null,
    { ...summary, scope: 'current_organization_visible_project_sample' })
  const orgPrompt = JSON.parse(buildPrivateConversationPrompt(rows, userId,
    { context_kind: 'organization', project_id: null, department_id: null }, orgContext))
  assertEquals(orgPrompt.canonical_context.project, undefined)
  assertEquals(orgPrompt.canonical_context.work_summary.scope,
    'current_organization_visible_project_sample')
  assertThrows(() => requireOpenAiCanonicalContextChoice(true, 'anthropic'))
  assertThrows(() => requireOpenAiCanonicalContextChoice(true, 'google_gemini'))
})

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
