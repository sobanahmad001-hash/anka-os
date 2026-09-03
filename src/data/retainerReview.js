const OPEN = new Set(['not_started', 'in_progress', 'blocked'])
const unique = rows => [...new Map(rows.map(row => [row.id, row])).values()]
const iso = date => date.toISOString().slice(0, 10)
export function reviewMonthDays(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || Number(month.slice(0, 4)) < 1000) throw new Error('Select a valid reporting month.')
  const cursor = new Date(`${month}-01T00:00:00Z`)
  const days = []
  while (iso(cursor).startsWith(month)) { days.push(iso(cursor)); cursor.setUTCDate(cursor.getUTCDate() + 1) }
  return days
}
export function reviewLocalDate(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = type => parts.find(part => part.type === type).value
  return `${value('year')}-${value('month')}-${value('day')}`
}
export function reviewCanonicalStart(version, day) {
  if (version.frequency === 'weekly') return (Date.parse(day) - Date.parse(version.effective_start)) / 86400000 % 7 === 0
  if (version.frequency !== 'monthly') return false
  const last = new Date(`${day.slice(0, 7)}-01T00:00:00Z`)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  return Number(day.slice(8)) === Math.min(Number(version.effective_start.slice(8)), last.getUTCDate())
}
export function reviewContextKey(scope) {
  return JSON.stringify([scope.organizationId, scope.projectId, scope.engagementId, scope.actorId, scope.revision, scope.month])
}
// Epoch prevents A -> B -> A from resurrecting a request from the first A.
export function createReviewLoader(fetchSnapshot, publish) {
  let generation = 0
  return {
    cancel() { generation++ },
    async load(scope) {
      const request = ++generation
      const key = reviewContextKey(scope)
      publish({ key, status: 'loading' })
      try {
        const snapshot = await fetchSnapshot(scope)
        if (request === generation) publish({ key, status: 'ready', snapshot, fetchedAt: new Date().toISOString() })
      } catch (error) {
        if (request === generation) publish({ key, status: 'error', error })
      }
    },
  }
}
export function buildRetainerReview(snapshot, scope, now = new Date()) {
  const days = reviewMonthDays(scope.month)
  const monthStart = days[0]
  const own = row => row.organization_id === scope.organizationId
  const inEngagement = row => own(row) && row.project_id === scope.projectId && row.engagement_id === scope.engagementId
  if (!snapshot.project || !inEngagement({ ...snapshot.project, project_id: snapshot.project.id, engagement_id: scope.engagementId })
      || !snapshot.engagement || !inEngagement(snapshot.engagement)
      || !(snapshot.project.engagement_type === 'retainer' || snapshot.engagement.engagement_type === 'retainer')) throw new Error('This retainer is unavailable in the selected organization.')
  const plans = unique(snapshot.plans.filter(inEngagement))
  const work = unique(snapshot.workItems.filter(row => inEngagement(row) && !row.deleted_at))
  const workById = new Map(work.map(row => [row.id, row]))
  const cards = plans.map(plan => {
    const approvedIds = new Set(snapshot.approvals.filter(row => own(row) && row.plan_id === plan.id).map(row => row.plan_version_id))
    const versions = unique(snapshot.versions.filter(row => own(row) && row.plan_id === plan.id && approvedIds.has(row.id)))
      .sort((a, b) => b.effective_start.localeCompare(a.effective_start) || b.version_number - a.version_number)
    const occurrences = unique(snapshot.occurrences.filter(row => inEngagement(row) && row.plan_id === plan.id))
    const byOccurrence = new Map(occurrences.map(row => [row.id, row]))
    const recurringWork = work.filter(row => row.created_via === 'recurring_plan' && row.recurring_plan_id === plan.id
      && byOccurrence.get(row.recurring_occurrence_id)?.plan_version_id === row.recurring_plan_version_id)
      .map(row => ({ ...row, period_start: byOccurrence.get(row.recurring_occurrence_id).period_start }))
    const selectedWork = recurringWork.filter(row => row.period_start.startsWith(scope.month))
    const completed = selectedWork.filter(row => row.status === 'done')
    const carryover = recurringWork.filter(row => row.period_start < monthStart && OPEN.has(row.status))
    const reviewWork = [...selectedWork, ...carryover]
    const blockers = reviewWork.filter(row => OPEN.has(row.status)).flatMap(row => {
      const dependencies = unique(snapshot.dependencies.filter(dep => own(dep) && dep.work_item_id === row.id)
        .map(dep => workById.get(dep.depends_on_work_item_id)).filter(target => target && OPEN.has(target.status)))
      return row.status === 'blocked' || dependencies.length ? [{ work: row, dependencies }] : []
    })
    const service = snapshot.services.find(row => own(row) && row.engagement_id === scope.engagementId && row.id === plan.engagement_service_id)
    const active = plan.status === 'active' && snapshot.engagement.status === 'active' && service?.status === 'active' && service?.catalog_active === true
    const upcoming = days.flatMap(day => {
      const version = versions.find(row => row.effective_start <= day && (!row.effective_end || row.effective_end >= day))
      if (!version || !reviewCanonicalStart(version, day) || day < reviewLocalDate(now, version.timezone)) return []
      const occurrence = occurrences.find(row => row.period_start === day)
      const recordedVersion = occurrence ? versions.find(row => row.id === occurrence.plan_version_id) : null
      const templates = occurrence ? [] : unique(snapshot.templateItems.filter(row => own(row) && row.plan_id === plan.id && row.plan_version_id === version.id))
      return [{ period_start: day, version, recordedVersion, occurrence: occurrence || null, templates, active }]
    })
    const relevantVersions = versions.filter(version => days.some(day => versions.find(row => row.effective_start <= day && (!row.effective_end || row.effective_end >= day))?.id === version.id))
    return { ...plan, relevantVersions, completed, carryover, blockers, upcoming, selectedWork }
  })
  const records = unique(cards.flatMap(card => [...card.selectedWork, ...card.carryover, ...card.blockers.flatMap(row => row.dependencies)]))
  return { cards, records, asOf: now.toISOString(), summary: {
    completed: cards.reduce((n, card) => n + card.completed.length, 0),
    carryover: cards.reduce((n, card) => n + card.carryover.length, 0),
    blockers: cards.reduce((n, card) => n + card.blockers.length, 0),
    upcoming: cards.reduce((n, card) => n + card.upcoming.length, 0),
  } }
}
