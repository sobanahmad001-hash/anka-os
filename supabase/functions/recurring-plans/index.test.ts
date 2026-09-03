import { normalizePlanVersionInput, normalizeTransitionInput } from './index.ts'

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

const valid = {
  title: ' Weekly reporting ', frequency: 'weekly', timezone: 'Asia/Karachi',
  effectiveStart: '2026-09-07', scheduleDefinition: { weekday: 1 },
  templateItems: [{ templateKey: 'prepare_report', title: ' Prepare report ', position: 0, dueOffsetDays: 2 }],
}

Deno.test('normalizes weekly/monthly version data without calculating occurrences', () => {
  const input = normalizePlanVersionInput(valid)
  equal(input.p_title, 'Weekly reporting')
  equal(input.p_frequency, 'weekly')
  equal(input.p_timezone, 'Asia/Karachi')
  equal(input.p_template_items[0].title, 'Prepare report')
  equal(input.p_template_items[0].due_offset_days, 2)
})

Deno.test('rejects unsupported cadence, invalid ranges, and duplicate immutable items', () => {
  throws(() => normalizePlanVersionInput({ ...valid, frequency: 'daily' }), /weekly or monthly/)
  throws(() => normalizePlanVersionInput({ ...valid, effectiveEnd: '2026-09-01' }), /cannot precede/)
  throws(() => normalizePlanVersionInput({ ...valid, templateItems: [
    { templateKey: 'same', title: 'One', position: 0 },
    { templateKey: 'same', title: 'Two', position: 1 },
  ] }), /must be unique/)
})

Deno.test('accepts only lifecycle targets exposed by RET1 and requires reasons', () => {
  equal(normalizeTransitionInput({ status: 'active' }).p_status, 'active')
  equal(normalizeTransitionInput({ status: 'paused', reason: 'Capacity review' }).p_reason, 'Capacity review')
  throws(() => normalizeTransitionInput({ status: 'approved' }), /Unsupported/)
  throws(() => normalizeTransitionInput({ status: 'ended' }), /reason is required/)
})
