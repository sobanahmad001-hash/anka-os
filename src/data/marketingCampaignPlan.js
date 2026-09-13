const clean = (value, max) => String(value || '').trim().slice(0, max)
const isoDate = /^\d{4}-\d{2}-\d{2}$/
const leadershipRoles = new Set(['system_owner', 'operations_admin', 'executive'])

export function canEditCampaignPlan(membership = {}) {
  if (membership.member_kind !== 'team' || membership.status !== 'active') return false
  return leadershipRoles.has(membership.role) || membership.department_id === 'marketing'
}

function campaignPlanAccessError(message) {
  return Object.assign(new Error(message), { status: 403, membershipMismatch: true })
}

export function validateCampaignPlanSnapshot(snapshot, { organizationId, engagementId, campaignId }) {
  const versions = snapshot.versions || []
  const versionIds = new Set(versions.map(item => item.id))
  if (versions.some(item => item.organization_id !== organizationId || item.engagement_id !== engagementId || item.campaign_id !== campaignId)) {
    throw campaignPlanAccessError('Campaign plan version context mismatch')
  }
  if ((snapshot.requirements || []).some(item => item.organization_id !== organizationId || !versionIds.has(item.plan_version_id))) {
    throw campaignPlanAccessError('Campaign plan requirement context mismatch')
  }
  const artifactIds = new Set((snapshot.artifacts || []).map(item => item.id))
  if ((snapshot.artifacts || []).some(item => item.organization_id !== organizationId || item.engagement_id !== engagementId)) {
    throw campaignPlanAccessError('Campaign plan source context mismatch')
  }
  const sourceVersionIds = new Set((snapshot.sourceVersions || []).map(item => item.id))
  if ((snapshot.sourceVersions || []).some(item => item.organization_id !== organizationId || !artifactIds.has(item.artifact_id))) {
    throw campaignPlanAccessError('Campaign plan source version mismatch')
  }
  if ((snapshot.approvals || []).some(item => !sourceVersionIds.has(item.artifact_version_id))) {
    throw campaignPlanAccessError('Campaign plan source approval mismatch')
  }
  const briefArtifactIds = new Set((snapshot.campaignBriefLinks || []).map(item => item.artifact_id))
  const briefVersionIds = new Set((snapshot.campaignBriefVersions || []).map(item => item.id))
  if ((snapshot.campaignBriefLinks || []).some(item => item.organization_id !== organizationId || item.campaign_id !== campaignId || item.relation_type !== 'campaign_brief')) {
    throw campaignPlanAccessError('Campaign plan review destination mismatch')
  }
  if ((snapshot.campaignBriefVersions || []).some(item => item.organization_id !== organizationId || !briefArtifactIds.has(item.artifact_id))) {
    throw campaignPlanAccessError('Campaign plan review version mismatch')
  }
  const submissionById = new Map((snapshot.reviewSubmissions || []).map(item => [item.id, item]))
  if ((snapshot.reviewSubmissions || []).some(item => item.organization_id !== organizationId
    || item.campaign_id !== campaignId || !versionIds.has(item.plan_version_id)
    || !briefArtifactIds.has(item.artifact_id) || !briefVersionIds.has(item.artifact_version_id))) {
    throw campaignPlanAccessError('Campaign plan review submission context mismatch')
  }
  if ((snapshot.reviewRequests || []).some(item => {
    const submission = submissionById.get(item.campaign_plan_submission_id)
    return !submission || item.organization_id !== organizationId || item.artifact_version_id !== submission.artifact_version_id
  })) {
    throw campaignPlanAccessError('Campaign plan review request mismatch')
  }
  return snapshot
}

export function latestCampaignPlanVersion(rows = [], campaignId = '') {
  return rows.filter(row => row.campaign_id === campaignId)
    .sort((left, right) => right.version_number - left.version_number)[0] || null
}

export function campaignPlanDraft(version = {}, requirements = []) {
  return {
    title: version.title || '',
    objective: version.objective || '',
    channels: Array.isArray(version.channels) ? [...version.channels] : [],
    starts_on: version.starts_on || '',
    ends_on: version.ends_on || '',
    audience: version.audience || '',
    landing_page_url: version.landing_page_url || '',
    planned_budget: version.planned_budget ?? '',
    currency_code: version.currency_code || '',
    approved_message_version_id: version.approved_message_version_id || '',
    measurement_plan_version_id: version.measurement_plan_version_id || '',
    change_summary: '',
    creative_requirements: requirements
      .filter(item => item.plan_version_id === version.id)
      .sort((left, right) => left.position - right.position)
      .map(item => ({
        format: item.format || '', intended_placement: item.intended_placement || '',
        message_version_id: item.message_version_id || '', due_date: item.due_date || '',
      })),
  }
}

export function validateCampaignPlanDraft(value = {}) {
  const channels = [...new Set((Array.isArray(value.channels) ? value.channels : String(value.channels || '').split('\n'))
    .map(item => clean(item, 120)).filter(Boolean))].slice(0, 20)
  const startsOn = clean(value.starts_on, 10)
  const endsOn = clean(value.ends_on, 10)
  const landingPageUrl = clean(value.landing_page_url, 2000)
  const rawBudget = value.planned_budget
  const hasBudget = rawBudget !== null && rawBudget !== undefined
    && !(typeof rawBudget === 'string' && rawBudget.trim() === '')
  if (hasBudget && !['number', 'string'].includes(typeof rawBudget)) throw new Error('Planning budget must be a non-negative finite number')
  if (hasBudget && typeof rawBudget === 'string' && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawBudget.trim())) {
    throw new Error('Planning budget must be a non-negative finite number')
  }
  const plannedBudget = hasBudget ? Number(rawBudget) : null
  const rawCurrency = value.currency_code
  if (rawCurrency !== null && rawCurrency !== undefined && typeof rawCurrency !== 'string') {
    throw new Error('Currency must use a three-letter code')
  }
  const currencyCode = typeof rawCurrency === 'string' ? rawCurrency.trim().toUpperCase() : ''
  if (!clean(value.title, 180)) throw new Error('Plan title is required')
  if (!clean(value.objective, 4000)) throw new Error('Plan objective is required')
  if (!channels.length) throw new Error('At least one channel is required')
  if (startsOn && !isoDate.test(startsOn)) throw new Error('Start date must use YYYY-MM-DD')
  if (endsOn && !isoDate.test(endsOn)) throw new Error('End date must use YYYY-MM-DD')
  if (startsOn && endsOn && endsOn < startsOn) throw new Error('End date cannot precede start date')
  if (landingPageUrl) {
    let parsed
    try { parsed = new URL(landingPageUrl) } catch { throw new Error('Landing page must use an HTTP or HTTPS URL') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Landing page must use an HTTP or HTTPS URL')
  }
  if (plannedBudget !== null && (!Number.isFinite(plannedBudget) || plannedBudget < 0)) throw new Error('Planning budget must be a non-negative finite number')
  if (plannedBudget !== null && !/^[A-Z]{3}$/.test(currencyCode)) throw new Error('Currency is required with a planning budget and must use a three-letter code')
  if (plannedBudget === null && currencyCode) throw new Error('Enter a planning budget with its currency or leave both blank')
  const creativeRequirements = (Array.isArray(value.creative_requirements) ? value.creative_requirements : []).map((item, index) => {
    const format = clean(item.format, 240)
    const intendedPlacement = clean(item.intended_placement, 500)
    const dueDate = clean(item.due_date, 10)
    if (!format || !intendedPlacement) throw new Error(`Creative requirement ${index + 1} needs format and intended placement`)
    if (dueDate && !isoDate.test(dueDate)) throw new Error(`Creative requirement ${index + 1} due date must use YYYY-MM-DD`)
    return {
      format, intended_placement: intendedPlacement,
      message_version_id: clean(item.message_version_id, 80) || null,
      due_date: dueDate || null,
    }
  })
  if (creativeRequirements.length > 100) throw new Error('At most 100 creative requirements are supported')
  return {
    title: clean(value.title, 180), objective: clean(value.objective, 4000), channels,
    starts_on: startsOn || null, ends_on: endsOn || null, audience: clean(value.audience, 4000),
    landing_page_url: landingPageUrl || null,
    planned_budget: plannedBudget, currency_code: plannedBudget === null ? null : currencyCode,
    approved_message_version_id: clean(value.approved_message_version_id, 80) || null,
    measurement_plan_version_id: clean(value.measurement_plan_version_id, 80) || null,
    creative_requirements: creativeRequirements, change_summary: clean(value.change_summary, 1000),
  }
}

export function campaignPlanDuplicatePreview(version, campaign = {}, latestVersion = version) {
  if (!version?.id) throw new Error('Choose an exact saved plan version to duplicate')
  return Object.freeze({
    sourcePlanVersionId: version.id,
    sourceVersionNumber: version.version_number,
    destination: `${campaign.name || 'Current campaign'} · new plan version ${Number(latestVersion?.version_number || 0) + 1}`,
    effect: 'Creates one new unapproved plan draft with an exact source-version link.',
  })
}

export function campaignPlanReviewPreview(version, approver, campaign = {}, latestBriefVersion = null) {
  if (!version?.id) throw new Error('Choose an exact saved plan version to submit')
  if (!approver?.user_id) throw new Error('Choose a permitted campaign brief reviewer')
  return Object.freeze({
    sourcePlanVersionId: version.id,
    sourceVersionNumber: version.version_number,
    destination: `${campaign.name || 'Current campaign'} · canonical campaign brief · new version ${Number(latestBriefVersion?.version_number || 0) + 1}`,
    approverId: approver.user_id,
    approverLabel: approver.full_name || approver.email || 'Permitted reviewer',
    effect: 'Creates one immutable campaign brief version and one pending review request; it does not approve or release anything.',
  })
}

export function campaignPlanSourceOptions({ artifacts = [], versions = [], approvals = [] } = {}) {
  const approved = new Set(approvals.map(item => item.artifact_version_id))
  const artifactById = new Map(artifacts.map(item => [item.id, item]))
  return versions.reduce((result, version) => {
    const artifact = artifactById.get(version.artifact_id)
    if (!artifact) return result
    const option = { id: version.id, versionNumber: version.version_number, title: artifact.title, type: artifact.artifact_type }
    if (['campaign_messaging', 'scripts'].includes(artifact.artifact_type) && approved.has(version.id)) result.approvedMessages.push(option)
    if (artifact.artifact_type === 'measurement_plan') result.measurementPlans.push(option)
    return result
  }, { approvedMessages: [], measurementPlans: [] })
}

export function campaignPlanContextKey(organizationId, engagementId, campaignId) {
  return [organizationId, engagementId, campaignId].join(':')
}

export function acceptCampaignPlanSave(saved, requestedContextKey, activeContextKey) {
  return requestedContextKey === activeContextKey ? saved : null
}
