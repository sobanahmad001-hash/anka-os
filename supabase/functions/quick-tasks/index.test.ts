import { normalizeQuickTaskInput } from './index.ts'

function equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`) }
function throws(run: () => unknown, pattern: RegExp) { try { run() } catch (error) { if (pattern.test(error instanceof Error ? error.message : String(error))) return; throw error } throw new Error(`Expected error matching ${pattern}`) }

Deno.test('normalizes create and append inputs', () => {
  const create = normalizeQuickTaskInput('create', { organizationId: 'org', title: ' Note ', content: { notes: 'x' } })
  equal(create.p_title, 'Note'); equal(create.p_organization_id, 'org')
  const append = normalizeQuickTaskInput('append', { quickTaskId: 'task', expectedRevisionId: 'rev', title: 'Next', content: {} })
  equal(append.p_quick_task_id, 'task'); equal(append.p_expected_revision_id, 'rev')
})
Deno.test('requires object content and explicit revision concurrency', () => {
  throws(() => normalizeQuickTaskInput('create', { organizationId: 'org', title: 'x', content: [] }), /Content/)
  throws(() => normalizeQuickTaskInput('append', { quickTaskId: 'task', title: 'x', content: {} }), /expected revision/)
})
Deno.test('fork requires an exact source revision', () => {
  throws(() => normalizeQuickTaskInput('fork', { quickTaskId: 'task' }), /source revision/)
})
