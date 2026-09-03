import {
  normalizeMonthInput,
  normalizePeriodInput,
  normalizePlanVersionInput,
  normalizeTransitionInput,
} from './index.ts'

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

Deno.test('normalizes one explicit RET2 preview and confirmation period', () => {
  const planId = '11111111-1111-4111-8111-111111111111'
  const requestKey = '22222222-2222-4222-8222-222222222222'
  const preview = normalizePeriodInput({
    planId, periodStart: '2026-09-07', pastPeriodReason: ' Approved recovery ',
  })
  equal(preview.p_plan_id, planId)
  equal(preview.p_period_start, '2026-09-07')
  equal(preview.p_past_period_reason, 'Approved recovery')
  const confirm = normalizePeriodInput({ planId, periodStart: '2026-09-07', requestKey }, true)
  equal(confirm.p_request_key, requestKey)
})

Deno.test('rejects malformed RET2 dates and request identities', () => {
  const planId = '11111111-1111-4111-8111-111111111111'
  throws(() => normalizePeriodInput({ planId, periodStart: '2026-02-30' }), /real ISO date/)
  throws(() => normalizePeriodInput({ planId: 'not-an-id', periodStart: '2026-09-07' }), /must be a UUID/)
  throws(() => normalizePeriodInput({ planId, periodStart: '2026-09-07', requestKey: 'bad' }, true), /must be a UUID/)
})

Deno.test('RET3 normalizes only first-of-month plan-local previews', () => {
  const planId = '11111111-1111-4111-8111-111111111111'
  const normalized = normalizeMonthInput({
    planId, monthStart: '2026-09-01', pastPeriodReason: ' Approved recovery ',
  })
  equal(normalized.p_plan_id, planId)
  equal(normalized.p_month_start, '2026-09-01')
  equal(normalized.p_past_period_reason, 'Approved recovery')
  throws(() => normalizeMonthInput({ planId, monthStart: '2026-09-02' }), /first day/)
  throws(() => normalizeMonthInput({ planId, monthStart: '2026-02-30' }), /real ISO date/)
})
