export const RET3_REASON_LABELS = Object.freeze({
  no_approved_effective_version: 'No approved plan version applies to this month.',
  no_period_start_in_month: 'No canonical period starts in this month.',
  period_start_is_not_canonical: 'The selected date is not a canonical plan period.',
  plan_not_active: 'The recurring plan is not active.',
  engagement_not_retainer: 'The engagement is not an active retainer.',
  engagement_not_active: 'The engagement is not active.',
  engagement_service_not_active: 'The activated service is not active.',
  service_catalog_not_active: 'The catalogue service is not active.',
  template_assignee_not_active: 'A planned assignee is not an active team member.',
  past_period_reason_required: 'A reason is required before generating past work.',
  past_period_reason_too_long: 'The past-period reason is too long.',
  period_already_generated: 'This period has already been generated.',
})

const rowsFor = (rows, key, value) => rows.filter((row) => row?.[key] === value)
const monthOf = (value) => typeof value === 'string' ? value.slice(0, 7) : ''

export function retainerPlanningReason(code) {
  return RET3_REASON_LABELS[code]
    || String(code || 'unknown_exception').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}

export function buildRetainerPlanning(snapshot, options) {
  const { organizationId, engagementId, month, actorId = null } = options || {}
  if (!organizationId || !engagementId) throw new TypeError('Organization and engagement are required')
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new TypeError('A YYYY-MM planning month is required')

  const plans = snapshot.plans.filter((plan) =>
    plan.organization_id === organizationId && plan.engagement_id === engagementId)
  const activeMembers = new Set(snapshot.memberships.filter((membership) =>
    membership.organization_id === organizationId
    && membership.member_kind === 'team'
    && membership.status === 'active').map((membership) => membership.user_id))
  const serviceOwners = new Map(snapshot.services.filter((service) =>
    service.organization_id === organizationId && service.engagement_id === engagementId)
    .map((service) => [service.id, service.owner_id]))

  const planCards = plans.map((plan) => {
    const versions = rowsFor(snapshot.versions, 'plan_id', plan.id)
      .filter((version) => version.organization_id === organizationId)
      .sort((left, right) => right.version_number - left.version_number)
    const approvedVersion = versions.find((version) => version.id === plan.approved_version_id) || null
    const approvals = rowsFor(snapshot.approvals, 'plan_id', plan.id)
      .filter((approval) => approval.organization_id === organizationId)
      .sort((left, right) => new Date(right.approved_at) - new Date(left.approved_at))
    const templates = approvedVersion
      ? rowsFor(snapshot.templateItems, 'plan_version_id', approvedVersion.id)
        .filter((item) => item.organization_id === organizationId)
        .sort((left, right) => left.position - right.position)
      : []
    const occurrences = rowsFor(snapshot.occurrences, 'plan_id', plan.id)
      .filter((occurrence) => occurrence.organization_id === organizationId && monthOf(occurrence.period_start) === month)
      .sort((left, right) => left.period_start.localeCompare(right.period_start))
    const occurrenceIds = new Set(occurrences.map((occurrence) => occurrence.id))
    const generatedWork = rowsFor(snapshot.workItems, 'recurring_plan_id', plan.id)
      .filter((item) => item.organization_id === organizationId
        && item.created_via === 'recurring_plan'
        && occurrenceIds.has(item.recurring_occurrence_id)
        && !item.deleted_at)
    const attempts = rowsFor(snapshot.attempts, 'plan_id', plan.id)
      .filter((attempt) => attempt.organization_id === organizationId
        && occurrenceIds.has(attempt.occurrence_id))
    const assigned = templates.filter((item) => item.default_assignee_id)
    const inactiveAssigned = assigned.filter((item) => !activeMembers.has(item.default_assignee_id))
    const serviceOwnerId = serviceOwners.get(plan.engagement_service_id) || null
    const exceptions = []
    if (plan.status !== 'active') exceptions.push(`plan_${plan.status}`)
    if (!approvedVersion) exceptions.push('no_approved_version')
    if (templates.some((item) => !item.default_assignee_id)) exceptions.push('unassigned_template_items')
    if (inactiveAssigned.length) exceptions.push('template_assignee_not_active')

    return {
      ...plan,
      versions,
      approvedVersion,
      approvals,
      templates,
      occurrences,
      generatedWork,
      attempts,
      serviceOwnerId,
      canManagePeriods: Boolean(actorId && actorId === serviceOwnerId),
      hasUnapprovedNewerVersion: approvedVersion
        ? versions.some((version) => version.version_number > approvedVersion.version_number)
        : versions.length > 0,
      coverage: {
        total: templates.length,
        assigned: assigned.length,
        unassigned: templates.length - assigned.length,
        activeAssigned: assigned.length - inactiveAssigned.length,
        inactiveAssigned: inactiveAssigned.length,
        generated: generatedWork.length,
      },
      exceptions,
    }
  })

  return {
    month,
    plans: planCards,
    summary: {
      plans: planCards.length,
      activePlans: planCards.filter((plan) => plan.status === 'active').length,
      generatedPeriods: planCards.reduce((total, plan) => total + plan.occurrences.length, 0),
      plannedItems: planCards.reduce((total, plan) => total + plan.coverage.total, 0),
      unassignedItems: planCards.reduce((total, plan) => total + plan.coverage.unassigned, 0),
      exceptions: planCards.reduce((total, plan) => total + plan.exceptions.length, 0),
    },
  }
}

export function applyRetainerMonthPreview(plan, preview) {
  const periods = Array.isArray(preview?.periods) ? preview.periods : []
  const reasonCodes = [
    ...(Array.isArray(preview?.reasons) ? preview.reasons : []),
    ...periods.flatMap((period) => Array.isArray(period.reasons) ? period.reasons : []),
  ]
  return {
    ...plan,
    monthPreview: preview,
    periods,
    previewExceptions: [...new Set(reasonCodes)],
  }
}
