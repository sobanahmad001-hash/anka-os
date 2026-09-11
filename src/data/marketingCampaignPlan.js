const clean = (value, max) => String(value || '').trim().slice(0, max)
const isoDate = /^\d{4}-\d{2}-\d{2}$/

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
    approved_message_version_id: clean(value.approved_message_version_id, 80) || null,
    measurement_plan_version_id: clean(value.measurement_plan_version_id, 80) || null,
    creative_requirements: creativeRequirements, change_summary: clean(value.change_summary, 1000),
  }
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
