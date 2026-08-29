export const PORTFOLIO_ENGAGEMENT_STATUSES = Object.freeze(['planning', 'active', 'on_hold', 'completed', 'cancelled'])
export const PORTFOLIO_TARGET_FILTERS = Object.freeze([
  Object.freeze({ value: 'overdue', label: 'Overdue' }),
  Object.freeze({ value: 'next_7_days', label: 'Next 7 days' }),
  Object.freeze({ value: 'next_30_days', label: 'Next 30 days' }),
  Object.freeze({ value: 'no_target_date', label: 'No target date' }),
])

const COMPLETE_STAGE_STATUSES = new Set(['completed', 'complete'])
const DAY_MS = 24 * 60 * 60 * 1000

function isoDay(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  return new Date(date.getTime() + (days * DAY_MS))
}

export function buildPortfolioDashboard(snapshot = {}, today = new Date()) {
  const engagements = snapshot.engagements || []
  const engagementById = new Map(engagements.map(engagement => [engagement.id, engagement]))
  const workByEngagement = new Map()
  const stagesByEngagement = new Map()

  for (const item of snapshot.workItems || []) {
    const engagement = engagementById.get(item.engagement_id)
    if (!engagement || item.organization_id !== engagement.organization_id || item.deleted_at) continue
    workByEngagement.set(item.engagement_id, [...(workByEngagement.get(item.engagement_id) || []), item])
  }
  for (const stage of snapshot.stages || []) {
    const engagement = engagementById.get(stage.engagement_id)
    if (!engagement || stage.organization_id !== engagement.organization_id) continue
    stagesByEngagement.set(stage.engagement_id, [...(stagesByEngagement.get(stage.engagement_id) || []), stage])
  }

  const start = isoDay(today)
  const sevenDays = isoDay(addDays(new Date(`${start}T00:00:00Z`), 7))
  const rows = engagements.map(engagement => {
    const workItems = workByEngagement.get(engagement.id) || []
    const stages = stagesByEngagement.get(engagement.id) || []
    const flaggedAutomationItems = workItems.filter(item => Boolean(item.automation_flagged_at)).length
    const blockedStages = stages.filter(stage => stage.status === 'blocked').length
    const targetDateRisk = Boolean(
      engagement.target_date
      && engagement.target_date >= start
      && engagement.target_date <= sevenDays
      && engagement.status !== 'completed'
    )
    return {
      ...engagement,
      openWorkItems: workItems.filter(item => item.status !== 'done').length,
      blockedWorkItems: workItems.filter(item => item.status === 'blocked').length,
      incompleteStages: stages.filter(stage => !COMPLETE_STAGE_STATUSES.has(stage.status)).length,
      blockedStages,
      flaggedAutomationItems,
      risks: {
        targetDate: targetDateRisk,
        automation: flaggedAutomationItems > 0,
        blockedStage: blockedStages > 0,
      },
    }
  })

  return {
    rows,
    summary: {
      activeEngagements: rows.filter(row => row.status === 'active').length,
      blockedStages: rows.reduce((total, row) => total + row.blockedStages, 0),
      flaggedAutomationItems: rows.reduce((total, row) => total + row.flaggedAutomationItems, 0),
    },
  }
}

export function filterAndSortPortfolioRows(rows, filters = {}, sort = {}, today = new Date()) {
  const start = isoDay(today)
  const sevenDays = isoDay(addDays(new Date(`${start}T00:00:00Z`), 7))
  const thirtyDays = isoDay(addDays(new Date(`${start}T00:00:00Z`), 30))
  const filtered = (rows || []).filter(row => {
    if (filters.status && row.status !== filters.status) return false
    if (filters.leadOwner && row.lead_owner_id !== filters.leadOwner) return false
    if (filters.target === 'overdue' && (!row.target_date || row.target_date >= start || ['completed', 'cancelled'].includes(row.status))) return false
    if (filters.target === 'next_7_days' && (!row.target_date || row.target_date < start || row.target_date > sevenDays)) return false
    if (filters.target === 'next_30_days' && (!row.target_date || row.target_date < start || row.target_date > thirtyDays)) return false
    if (filters.target === 'no_target_date' && row.target_date) return false
    return true
  })
  const key = sort.key || 'target_date'
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...filtered].sort((left, right) => {
    const leftValue = key === 'lead_owner_id' ? left.lead_owner_id || '' : left[key]
    const rightValue = key === 'lead_owner_id' ? right.lead_owner_id || '' : right[key]
    if ((leftValue == null || leftValue === '') && (rightValue == null || rightValue === '')) return 0
    if (leftValue == null || leftValue === '') return 1
    if (rightValue == null || rightValue === '') return -1
    return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true }) * direction
  })
}
