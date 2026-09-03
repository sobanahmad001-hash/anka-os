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
const monthEnd = (month) => {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10)
}

const selectedVersionsInMonth = (versions, approvedVersionIds, month) => {
  const start = `${month}-01`
  const end = monthEnd(month)
  const candidates = versions.filter((version) => approvedVersionIds.has(version.id)
    && version.effective_start < end
    && (!version.effective_end || version.effective_end >= start))
  const selectedIds = new Set()
  for (let cursor = new Date(`${start}T00:00:00Z`); cursor.toISOString().slice(0, 10) < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10)
    const selected = candidates.filter((version) => version.effective_start <= day
      && (!version.effective_end || version.effective_end >= day))
      .sort((left, right) => right.effective_start.localeCompare(left.effective_start)
        || right.version_number - left.version_number)[0]
    if (selected) selectedIds.add(selected.id)
  }
  return candidates.filter((version) => selectedIds.has(version.id))
    .sort((left, right) => left.effective_start.localeCompare(right.effective_start)
      || left.version_number - right.version_number)
}

export function retainerPlanningContextKey(context) {
  const { organizationId, projectId, engagementId, actorId = '', month } = context || {}
  return [organizationId, projectId, engagementId, actorId, month].map((value) => String(value || '')).join('|')
}

export function createRetainerPlanningRequestGuard() {
  const sequences = new Map()
  return Object.freeze({
    begin(channel, contextKey) {
      const sequence = (sequences.get(channel) || 0) + 1
      sequences.set(channel, sequence)
      return Object.freeze({ channel, contextKey, sequence })
    },
    isCurrent(token, contextKey) {
      return Boolean(token && token.contextKey === contextKey
        && sequences.get(token.channel) === token.sequence)
    },
    invalidate(channel) {
      sequences.set(channel, (sequences.get(channel) || 0) + 1)
    },
  })
}

export function canConfirmRetainerPeriod(plan, previewEnvelope, contextKey, month, periodStart) {
  return Boolean(plan?.canManagePeriods
    && previewEnvelope?.contextKey === contextKey
    && previewEnvelope.value?.plan_id === plan.id
    && previewEnvelope.value?.month_start === `${month}-01`
    && previewEnvelope.value?.periods?.some((period) => period.period_start === periodStart))
}

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
    const approvals = rowsFor(snapshot.approvals, 'plan_id', plan.id)
      .filter((approval) => approval.organization_id === organizationId)
      .sort((left, right) => new Date(right.approved_at) - new Date(left.approved_at))
    const approvedVersionIds = new Set(approvals.map((approval) => approval.plan_version_id))
    const monthVersions = selectedVersionsInMonth(versions, approvedVersionIds, month)
    const monthVersionIds = new Set(monthVersions.map((version) => version.id))
    const templates = snapshot.templateItems.filter((item) => item.organization_id === organizationId
      && monthVersionIds.has(item.plan_version_id))
      .sort((left, right) => left.plan_version_id.localeCompare(right.plan_version_id)
        || left.position - right.position)
    const templateGroups = monthVersions.map((version) => ({
      version,
      templates: templates.filter((item) => item.plan_version_id === version.id),
    }))
    const currentApprovedVersion = versions.find((version) => version.id === plan.approved_version_id) || null
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
    if (!monthVersions.length) exceptions.push('no_approved_effective_version')
    if (templates.some((item) => !item.default_assignee_id)) exceptions.push('unassigned_template_items')
    if (inactiveAssigned.length) exceptions.push('template_assignee_not_active')

    return {
      ...plan,
      versions,
      currentApprovedVersion,
      monthVersions,
      approvals,
      templates,
      templateGroups,
      occurrences,
      generatedWork,
      attempts,
      serviceOwnerId,
      canManagePeriods: Boolean(actorId && actorId === serviceOwnerId),
      hasUnapprovedNewerVersion: currentApprovedVersion
        ? versions.some((version) => version.version_number > currentApprovedVersion.version_number)
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
      applicableTemplateItems: planCards.reduce((total, plan) => total + plan.coverage.total, 0),
      unassignedItems: planCards.reduce((total, plan) => total + plan.coverage.unassigned, 0),
      exceptions: planCards.reduce((total, plan) => total + plan.exceptions.length, 0),
    },
  }
}

export function applyRetainerMonthPreview(plan, preview, context) {
  const expectedMonthStart = `${context?.month || ''}-01`
  if (preview?.plan_id !== plan.id || preview?.month_start !== expectedMonthStart
      || (context?.planId && context.planId !== plan.id)) return plan
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
