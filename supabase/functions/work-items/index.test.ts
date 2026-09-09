import { normalizeWorkItemInput, staleWrite } from './index.ts'

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`)
}

function throws(run: () => unknown, pattern: RegExp) {
  try { run() } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return
    throw error
  }
  throw new Error(`Expected error matching ${pattern}`)
}

Deno.test('normalizes the fixed W1 work item fields', () => {
  const input = normalizeWorkItemInput({
    engagementId: 'engagement-1',
    title: '  Prepare launch QA  ',
    workItemType: 'task',
    priority: 'high',
    status: 'in_progress',
    parentWorkItemId: 'parent-1',
    assigneeId: '',
    startDate: '2026-08-29',
    dueDate: '2026-08-30',
    position: -4,
  })
  equal(input.p_title, 'Prepare launch QA')
  equal(input.p_assignee_id, null)
  equal(input.p_position, 0)
  equal(input.p_parent_work_item_id, 'parent-1')
  equal(input.p_expected_row_version, null)
})

Deno.test('requires a positive expected row version for existing work items', () => {
  equal(normalizeWorkItemInput({ organizationId: 'org', engagementId: 'e', workItemId: 'w', title: 'Task', expectedRowVersion: 7 }).p_expected_row_version, 7)
  throws(() => normalizeWorkItemInput({ organizationId: 'org', engagementId: 'e', workItemId: 'w', title: 'Task' }), /Expected row version/)
})

Deno.test('rejects unsupported vocabulary and impossible date ranges', () => {
  throws(() => normalizeWorkItemInput({ engagementId: 'e', title: 'Task', status: 'review' }), /Unsupported work item status/)
  throws(() => normalizeWorkItemInput({ engagementId: 'e', title: 'Task', startDate: '2026-09-02', dueDate: '2026-09-01' }), /Due date/)
})

Deno.test('supports work item created_via provenance normalization and validation', () => {
  const inputWithDefault = normalizeWorkItemInput({
    engagementId: 'e',
    title: 'Task default',
  })
  const inputWithAi = normalizeWorkItemInput({
    engagementId: 'e',
    title: 'Task from AI',
    created_via: 'ai_chat_proposal',
  })
  const invalidInput = () => normalizeWorkItemInput({
    engagementId: 'e',
    title: 'Bad',
    created_via: 'not_real',
  })
  equal(inputWithDefault.p_created_via, 'manual')
  equal(inputWithAi.p_created_via, 'ai_chat_proposal')
  equal(normalizeWorkItemInput({ engagementId: 'e', title: 'Recurring', created_via: 'recurring_plan' }).p_created_via, 'recurring_plan')
  equal(normalizeWorkItemInput({ engagementId: 'e', title: 'Promoted', created_via: 'quick_task_promotion' }).p_created_via, 'quick_task_promotion')
  throws(invalidInput, /Unsupported created_via/)
})

Deno.test('maps only exact database stale-write payloads', () => {
  const payload = staleWrite({ message: 'ERROR: {\"code\":\"stale_write\",\"recordKind\":\"project_task\",\"recordId\":\"task-1\",\"expectedRowVersion\":2,\"currentRowVersion\":3}' })
  equal(payload?.code, 'stale_write')
  equal(payload?.recordKind, 'project_task')
  equal(payload?.expectedRowVersion, 2)
  equal(staleWrite({ message: 'ordinary failure' }), null)
})
