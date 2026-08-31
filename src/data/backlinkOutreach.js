export const BACKLINK_STATUSES = Object.freeze([
  'not_started', 'contacted', 'in_discussion', 'secured', 'declined',
])

export const BACKLINK_LINK_TYPES = Object.freeze([
  'membership', 'partnership', 'editorial', 'guest_post',
])

export const BACKLINK_COST_TYPES = Object.freeze(['free', 'paid', 'both'])

export function blankBacklinkTarget() {
  return {
    site_name: '', site_url: '', industry_category: '', domain_authority: '',
    estimated_traffic: '', relevance_score: '', link_type: '', cost_type: '',
    outreach_status: 'not_started', notes: '',
  }
}

export function backlinkTargetEditor(target) {
  if (!target) return blankBacklinkTarget()
  return {
    site_name: target.site_name || '',
    site_url: target.site_url || '',
    industry_category: target.industry_category || '',
    domain_authority: target.domain_authority ?? '',
    estimated_traffic: target.estimated_traffic ?? '',
    relevance_score: target.relevance_score ?? '',
    link_type: target.link_type || '',
    cost_type: target.cost_type || '',
    outreach_status: target.outreach_status || 'not_started',
    notes: target.notes || '',
  }
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function scoreOrUnknown(value) {
  const number = numberOrNull(value)
  return number === null ? -1 : number
}

export function filterBacklinkTargets(targets = [], filters = {}) {
  const minimumRelevance = numberOrNull(filters.minimum_relevance)
  const minimumAuthority = numberOrNull(filters.minimum_authority)
  return [...targets].filter(target => {
    if (filters.outreach_status && target.outreach_status !== filters.outreach_status) return false
    if (filters.link_type && target.link_type !== filters.link_type) return false
    if (filters.cost_type && target.cost_type !== filters.cost_type) return false
    if (minimumRelevance !== null && (target.relevance_score === null || Number(target.relevance_score) < minimumRelevance)) return false
    if (minimumAuthority !== null && (target.domain_authority === null || Number(target.domain_authority) < minimumAuthority)) return false
    return true
  }).sort((left, right) => {
    const leftActionable = ['not_started', 'contacted', 'in_discussion'].includes(left.outreach_status) ? 1 : 0
    const rightActionable = ['not_started', 'contacted', 'in_discussion'].includes(right.outreach_status) ? 1 : 0
    if (leftActionable !== rightActionable) return rightActionable - leftActionable
    const relevance = scoreOrUnknown(right.relevance_score) - scoreOrUnknown(left.relevance_score)
    if (relevance) return relevance
    const authority = scoreOrUnknown(right.domain_authority) - scoreOrUnknown(left.domain_authority)
    if (authority) return authority
    return String(left.site_name).localeCompare(String(right.site_name))
  })
}
