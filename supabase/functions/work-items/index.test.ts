import { normalizeWorkItemInput } from './index.ts'

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
  throws(invalidInput, /Unsupported created_via/)
})
