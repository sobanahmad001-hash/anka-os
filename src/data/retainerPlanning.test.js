import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyRetainerMonthPreview,
  buildRetainerPlanning,
  retainerPlanningReason,
} from './retainerPlanning.js'

const base = {
  plans: [{
    id: 'plan-a', organization_id: 'org-a', engagement_id: 'engagement-a',
    engagement_service_id: 'service-a', approved_version_id: 'version-a', status: 'active',
  }],
  versions: [
    { id: 'version-b', plan_id: 'plan-a', organization_id: 'org-a', version_number: 2 },
    { id: 'version-a', plan_id: 'plan-a', organization_id: 'org-a', version_number: 1, frequency: 'monthly', timezone: 'Asia/Karachi' },
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
    reasons: ['no_period_start_in_month'],
    periods: [{ reasons: ['past_period_reason_required', 'future_reason'] }],
  })
  assert.deepEqual(plan.previewExceptions, [
    'no_period_start_in_month', 'past_period_reason_required', 'future_reason',
  ])
  assert.match(retainerPlanningReason('past_period_reason_required'), /reason is required/i)
  assert.equal(retainerPlanningReason('future_reason'), 'Future reason')
})

test('RET3 requires one explicit YYYY-MM planning context', () => {
  assert.throws(() => buildRetainerPlanning(base, {
    organizationId: 'org-a', engagementId: 'engagement-a', month: 'September',
  }), /YYYY-MM/)
})
