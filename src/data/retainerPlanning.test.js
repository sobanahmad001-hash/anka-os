import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyRetainerMonthPreview,
  buildRetainerPlanning,
  canConfirmRetainerPeriod,
  createRetainerPlanningRequestGuard,
  retainerPlanningContextKey,
  retainerPlanningReason,
} from './retainerPlanning.js'

const base = {
  plans: [{
    id: 'plan-a', organization_id: 'org-a', engagement_id: 'engagement-a',
    engagement_service_id: 'service-a', approved_version_id: 'version-a', status: 'active',
  }],
  versions: [
    { id: 'version-b', plan_id: 'plan-a', organization_id: 'org-a', version_number: 2 },
    { id: 'version-a', plan_id: 'plan-a', organization_id: 'org-a', version_number: 1, frequency: 'monthly', timezone: 'Asia/Karachi', effective_start: '2026-01-01', effective_end: null },
  ],
  templateItems: [
    { id: 'template-a', plan_id: 'plan-a', plan_version_id: 'version-a', organization_id: 'org-a', position: 0, default_assignee_id: 'member-a' },
    { id: 'template-b', plan_id: 'plan-a', plan_version_id: 'version-a', organization_id: 'org-a', position: 1, default_assignee_id: null },
    { id: 'template-c', plan_id: 'plan-a', plan_version_id: 'version-a', organization_id: 'org-a', position: 2, default_assignee_id: 'inactive-a' },
  ],
  approvals: [{ id: 'approval-a', plan_id: 'plan-a', plan_version_id: 'version-a', organization_id: 'org-a', approved_at: '2026-08-01T00:00:00Z' }],
  occurrences: [
    { id: 'occurrence-a', plan_id: 'plan-a', organization_id: 'org-a', period_start: '2026-09-30' },
    { id: 'occurrence-old', plan_id: 'plan-a', organization_id: 'org-a', period_start: '2026-08-31' },
  ],
  attempts: [{ id: 'attempt-a', plan_id: 'plan-a', occurrence_id: 'occurrence-a', organization_id: 'org-a', outcome: 'generated' }],
  workItems: [
    { id: 'work-a', recurring_plan_id: 'plan-a', recurring_occurrence_id: 'occurrence-a', organization_id: 'org-a', created_via: 'recurring_plan' },
    { id: 'quick-a', recurring_plan_id: null, recurring_occurrence_id: null, organization_id: 'org-a', created_via: 'quick_task_promotion' },
  ],
  memberships: [
    { organization_id: 'org-a', user_id: 'member-a', member_kind: 'team', status: 'active' },
    { organization_id: 'org-a', user_id: 'inactive-a', member_kind: 'team', status: 'inactive' },
  ],
  services: [{ id: 'service-a', organization_id: 'org-a', engagement_id: 'engagement-a', owner_id: 'member-a' }],
}

test('RET3 composes factual monthly commitments without mixing QTS work', () => {
  const model = buildRetainerPlanning(base, {
    organizationId: 'org-a', engagementId: 'engagement-a', month: '2026-09', actorId: 'member-a',
  })
  const plan = model.plans[0]
  assert.equal(plan.canManagePeriods, true)
  assert.equal(plan.hasUnapprovedNewerVersion, true)
  assert.deepEqual(plan.occurrences.map((item) => item.id), ['occurrence-a'])
  assert.deepEqual(plan.generatedWork.map((item) => item.id), ['work-a'])
  assert.deepEqual(plan.coverage, {
    total: 3, assigned: 2, unassigned: 1, activeAssigned: 1, inactiveAssigned: 1, generated: 1,
  })
  assert.deepEqual(plan.exceptions, ['unassigned_template_items', 'template_assignee_not_active'])
})

test('RET3 keeps tenant and service-owner boundaries in the presentation model', () => {
  const model = buildRetainerPlanning({
    ...base,
    plans: [...base.plans, { ...base.plans[0], id: 'forged', organization_id: 'org-b' }],
  }, {
    organizationId: 'org-a', engagementId: 'engagement-a', month: '2026-09', actorId: 'other',
  })
  assert.equal(model.plans.length, 1)
  assert.equal(model.plans[0].canManagePeriods, false)
})

test('RET3 preserves known and unknown computed exception codes', () => {
  const plan = applyRetainerMonthPreview(base.plans[0], {
    plan_id: 'plan-a',
    month_start: '2026-09-01',
    reasons: ['no_period_start_in_month'],
    periods: [{ reasons: ['past_period_reason_required', 'future_reason'] }],
  }, { planId: 'plan-a', month: '2026-09' })
  assert.deepEqual(plan.previewExceptions, [
    'no_period_start_in_month', 'past_period_reason_required', 'future_reason',
  ])
  assert.match(retainerPlanningReason('past_period_reason_required'), /reason is required/i)
  assert.equal(retainerPlanningReason('future_reason'), 'Future reason')
})

test('RET3 selects historical and multiple approved versions that actually govern the chosen month', () => {
  const snapshot = {
    ...base,
    plans: [{ ...base.plans[0], approved_version_id: 'version-new' }],
    versions: [
      { id: 'version-old', plan_id: 'plan-a', organization_id: 'org-a', version_number: 1, title: 'Old commitment', frequency: 'monthly', timezone: 'Asia/Karachi', effective_start: '2026-01-01', effective_end: '2026-09-14' },
      { id: 'version-new', plan_id: 'plan-a', organization_id: 'org-a', version_number: 2, title: 'New commitment', frequency: 'weekly', timezone: 'Asia/Karachi', effective_start: '2026-09-15', effective_end: '2026-10-31' },
    ],
    approvals: [
      { id: 'approval-old', plan_id: 'plan-a', plan_version_id: 'version-old', organization_id: 'org-a', approved_at: '2026-01-01T00:00:00Z' },
      { id: 'approval-new', plan_id: 'plan-a', plan_version_id: 'version-new', organization_id: 'org-a', approved_at: '2026-09-10T00:00:00Z' },
    ],
    templateItems: [
      { id: 'template-old', plan_id: 'plan-a', plan_version_id: 'version-old', organization_id: 'org-a', position: 0, title: 'Old item', default_assignee_id: 'member-a' },
      { id: 'template-new', plan_id: 'plan-a', plan_version_id: 'version-new', organization_id: 'org-a', position: 0, title: 'New item', default_assignee_id: null },
    ],
  }
  const august = buildRetainerPlanning(snapshot, {
    organizationId: 'org-a', engagementId: 'engagement-a', month: '2026-08',
  }).plans[0]
  assert.deepEqual(august.monthVersions.map((version) => version.id), ['version-old'])
  assert.deepEqual(august.templates.map((item) => item.title), ['Old item'])

  const september = buildRetainerPlanning(snapshot, {
    organizationId: 'org-a', engagementId: 'engagement-a', month: '2026-09',
  }).plans[0]
  assert.deepEqual(september.monthVersions.map((version) => version.id), ['version-old', 'version-new'])
  assert.deepEqual(september.templateGroups.map((group) => group.templates[0].title), ['Old item', 'New item'])
  assert.equal(september.coverage.total, 2)

  const november = buildRetainerPlanning(snapshot, {
    organizationId: 'org-a', engagementId: 'engagement-a', month: '2026-11',
  }).plans[0]
  assert.deepEqual(november.monthVersions, [])
  assert.deepEqual(november.templates, [])
  assert.equal(november.coverage.total, 0)
  assert.ok(november.exceptions.includes('no_approved_effective_version'))
})

test('RET3 rejects a preview payload for another plan or month', () => {
  const plan = { ...base.plans[0], sentinel: true }
  const wrongMonth = applyRetainerMonthPreview(plan, {
    plan_id: 'plan-a', month_start: '2026-08-01', periods: [{ period_start: '2026-08-01' }],
  }, { planId: 'plan-a', month: '2026-09' })
  const wrongPlan = applyRetainerMonthPreview(plan, {
    plan_id: 'plan-b', month_start: '2026-09-01', periods: [{ period_start: '2026-09-01' }],
  }, { planId: 'plan-a', month: '2026-09' })
  assert.equal(wrongMonth, plan)
  assert.equal(wrongPlan, plan)
})

test('RET3 confirms only a visible current-context period for the current Service Owner', () => {
  const contextKey = retainerPlanningContextKey({ organizationId: 'org-a', projectId: 'project-a', engagementId: 'engagement-a', actorId: 'owner-a', month: '2026-09' })
  const preview = {
    contextKey,
    value: { plan_id: 'plan-a', month_start: '2026-09-01', periods: [{ period_start: '2026-09-08' }] },
  }
  assert.equal(canConfirmRetainerPeriod({ id: 'plan-a', canManagePeriods: true }, preview, contextKey, '2026-09', '2026-09-08'), true)
  assert.equal(canConfirmRetainerPeriod({ id: 'plan-a', canManagePeriods: false }, preview, contextKey, '2026-09', '2026-09-08'), false)
  assert.equal(canConfirmRetainerPeriod({ id: 'plan-a', canManagePeriods: true }, preview, contextKey, '2026-10', '2026-09-08'), false)
  assert.equal(canConfirmRetainerPeriod({ id: 'plan-a', canManagePeriods: true }, preview, 'different-context', '2026-09', '2026-09-08'), false)
  assert.equal(canConfirmRetainerPeriod({ id: 'plan-a', canManagePeriods: true }, preview, contextKey, '2026-09', '2026-09-15'), false)
})

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('RET3 drops a delayed load after A-to-B workspace navigation', async () => {
  const guard = createRetainerPlanningRequestGuard()
  const contextA = retainerPlanningContextKey({ organizationId: 'org-a', projectId: 'project-a', engagementId: 'engagement-a', actorId: 'owner-a', month: '2026-09' })
  const contextB = retainerPlanningContextKey({ organizationId: 'org-b', projectId: 'project-b', engagementId: 'engagement-b', actorId: 'owner-b', month: '2026-09' })
  let currentContext = contextA
  const request = deferred()
  const token = guard.begin('load', contextA)
  const accepted = request.promise.then((value) => guard.isCurrent(token, currentContext) ? value : null)
  currentContext = contextB
  request.resolve({ plans: ['stale-a'] })
  assert.equal(await accepted, null)
})

test('RET3 drops delayed month previews and superseded post-confirm refreshes', async () => {
  const guard = createRetainerPlanningRequestGuard()
  const september = retainerPlanningContextKey({ organizationId: 'org-a', projectId: 'project-a', engagementId: 'engagement-a', actorId: 'owner-a', month: '2026-09' })
  const october = retainerPlanningContextKey({ organizationId: 'org-a', projectId: 'project-a', engagementId: 'engagement-a', actorId: 'owner-a', month: '2026-10' })
  let currentContext = september
  const request = deferred()
  const septemberToken = guard.begin('preview', september)
  const accepted = request.promise.then((value) => guard.isCurrent(septemberToken, currentContext) ? value : null)
  currentContext = october
  request.resolve({ month_start: '2026-09-01' })
  assert.equal(await accepted, null)

  const staleRefresh = guard.begin('preview', october)
  const currentRefresh = guard.begin('preview', october)
  assert.equal(guard.isCurrent(staleRefresh, october), false)
  assert.equal(guard.isCurrent(currentRefresh, october), true)
})

test('RET3 requires one explicit YYYY-MM planning context', () => {
  assert.throws(() => buildRetainerPlanning(base, {
    organizationId: 'org-a', engagementId: 'engagement-a', month: 'September',
  }), /YYYY-MM/)
})
