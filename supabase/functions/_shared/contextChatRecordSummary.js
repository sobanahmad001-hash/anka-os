// Only caller-visible, bounded structured records enter the opt-in OpenAI snapshot.
// Exact IDs stay in the local audit manifest, never in the provider payload.
const TASK_LIMIT = 50
const PROJECT_SCAN_LIMIT = 20
const PROJECT_SEND_LIMIT = 4
const ITEM_SEND_LIMIT = 6
const OMIT = new Set(['what', 'which', 'when', 'where', 'with', 'from', 'about', 'this',
  'that', 'have', 'does', 'show', 'tell', 'please', 'project', 'projects', 'task',
  'tasks', 'work', 'item', 'items', 'status', 'progress', 'review', 'reviews'])
const TASK_STATES = new Set(['backlog', 'ready', 'in_progress', 'blocked',
  'ready_for_review', 'changes_required', 'done', 'cancelled'])
const WORK_STATES = new Set(['not_started', 'in_progress', 'blocked', 'done'])
const REVIEW_STATES = new Set(['in_production', 'ready_for_internal_review',
  'changes_required', 'ready_for_client_review', 'client_reviewing',
  'revision_requested', 'client_approved', 'delivered_published', 'superseded'])

export function safeText(value, limit) {
  return (typeof value === 'string' ? value : '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted contact]')
    .replace(/https?:\/\/\S+/gi, '[redacted link]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted contact]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[redacted id]')
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '[redacted id]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit)
}
function safeState(value, allowed) {
  return allowed.has(value) ? value : 'unknown'
}
function safeDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}
function termsFrom(question) {
  return [...new Set((typeof question === 'string' ? question.toLowerCase() : '')
    .match(/[\p{L}\p{N}]{3,}/gu)?.filter(term => !OMIT.has(term)) || [])].slice(0, 12)
}
function relevanceScore(row, term, fields, today) {
  if (fields.some(field => String(row[field] || '').toLowerCase().includes(term))) return 1
  if (term === 'overdue' && safeDate(row.due_date) && row.due_date < today
    && !['done', 'cancelled'].includes(row.status)) return 1
  if (['deadline', 'deadlines', 'due'].includes(term) && safeDate(row.due_date)) return 1
  if (['assigned', 'assignee'].includes(term) && (row.assigned_to || row.assignee_id)) return 1
  return 0
}
function relevant(rows, terms, limit, fields) {
  if (!terms.length) return rows.slice(0, limit)
  const today = new Date().toISOString().slice(0, 10)
  return rows.map((row, position) => ({
    row, position, score: terms.reduce((score, term) =>
      score + relevanceScore(row, term, fields, today), 0),
  })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit).map(item => item.row)
}
function counts(rows, states) {
  const result = {}
  for (const row of rows) {
    const state = safeState(row.status, states)
    result[state] = (result[state] || 0) + 1
  }
  return result
}
async function required(query, label) {
  const { data, error } = await query
  if (error) throw new Error('Authorized ' + label + ' are unavailable')
  return data
}
async function projectSnapshot(client, organizationId, project, terms) {
  const [tasks, engagement, versions] = await Promise.all([
    required(client.from('tasks')
      .select('id,title,status,due_date,assigned_to,updated_at')
      .eq('organization_id', organizationId).eq('project_id', project.id)
      .is('archived_at', null).order('updated_at', { ascending: false })
      .limit(TASK_LIMIT + 1), 'project tasks'),
    required(client.from('engagements').select('id')
      .eq('organization_id', organizationId).eq('legacy_project_id', project.id)
      .limit(1).maybeSingle(), 'linked engagement'),
    required(client.from('deliverable_versions')
      .select('id,deliverable_id,version_number,review_status,created_at')
      .eq('organization_id', organizationId).eq('project_id', project.id)
      .order('created_at', { ascending: false }).limit(TASK_LIMIT + 1),
    'project review states'),
  ])
  const items = engagement?.id
    ? await required(client.from('work_items')
      .select('id,title,status,due_date,assignee_id,updated_at')
      .eq('organization_id', organizationId).eq('engagement_id', engagement.id)
      .is('deleted_at', null).order('updated_at', { ascending: false })
      .limit(TASK_LIMIT + 1), 'engagement work items')
    : []
  const taskSample = (tasks || []).slice(0, TASK_LIMIT)
  const itemSample = (items || []).slice(0, TASK_LIMIT)
  const versionSample = (versions || []).slice(0, TASK_LIMIT)
  const latestReviews = []
  const seen = new Set()
  for (const version of versionSample) {
    if (!seen.has(version.deliverable_id)) {
      seen.add(version.deliverable_id)
      latestReviews.push(version)
    }
  }
  const chosenTasks = relevant(taskSample, terms, ITEM_SEND_LIMIT, ['title', 'status', 'due_date'])
  const chosenItems = relevant(itemSample, terms, ITEM_SEND_LIMIT, ['title', 'status', 'due_date'])
  return { project, engagementLinked: Boolean(engagement?.id), taskSample, itemSample,
    latestReviews, chosenTasks, chosenItems,
    partial: tasks?.length > TASK_LIMIT || items?.length > TASK_LIMIT
      || versions?.length > TASK_LIMIT }
}

/** Reads only records visible through the caller's current RLS session. */
export async function loadVisibleWorkSummary(client, organizationId, selectedProject,
  question, asOf = new Date().toISOString()) {
  const terms = termsFrom(question)
  const projects = selectedProject ? [selectedProject] : await required(client.from('projects')
    .select('id,name,status,health,updated_at')
    .eq('organization_id', organizationId).is('archived_at', null)
    .order('updated_at', { ascending: false }).limit(PROJECT_SCAN_LIMIT + 1),
  'organization projects')
  const projectScan = (projects || []).slice(0, PROJECT_SCAN_LIMIT)
  const selected = selectedProject ? projectScan : relevant(projectScan, terms,
    PROJECT_SEND_LIMIT, ['name', 'status', 'health'])
  const chosenProjects = selectedProject || selected.length ? selected
    : projectScan.slice(0, PROJECT_SEND_LIMIT)
  const snapshots = await Promise.all(chosenProjects.map(project =>
    projectSnapshot(client, organizationId, project, terms)))
  const assigneeIds = [...new Set(snapshots.flatMap(snapshot =>
    [...snapshot.chosenTasks.map(row => row.assigned_to),
      ...snapshot.chosenItems.map(row => row.assignee_id)].filter(Boolean)))]
  let profiles = []
  let labelsAvailable = true
  if (assigneeIds.length) {
    const result = await client.from('profiles').select('id,full_name').in('id', assigneeIds)
    if (result.error) labelsAvailable = false
    else profiles = result.data || []
  }
  const nameById = new Map(profiles.map(row => [row.id, safeText(row.full_name, 80)]))
  const assignee = id => !id ? 'Unassigned' : nameById.get(id) || 'Assigned teammate'
  const summary = {
    scope: selectedProject ? 'selected_project' : 'current_organization_visible_project_sample',
    as_of: asOf,
    coverage: {
      visible_projects_scanned: projectScan.length,
      projects_included: snapshots.length,
      more_visible_projects_possible: !selectedProject && projects.length > PROJECT_SCAN_LIMIT,
      projects_omitted_from_bounded_summary: !selectedProject
        && (projectScan.length > snapshots.length || projects.length > PROJECT_SCAN_LIMIT),
      assignee_labels_available: labelsAvailable,
      counts_describe_recent_visible_samples_only: true,
    },
    projects: snapshots.map(snapshot => ({
      name: safeText(snapshot.project.name, 160),
      status: safeText(snapshot.project.status, 40),
      health: safeText(snapshot.project.health, 40),
      sample: {
        project_tasks: snapshot.taskSample.length,
        engagement_work_items: snapshot.itemSample.length,
        linked_engagement: snapshot.engagementLinked,
        more_records_possible: snapshot.partial,
        project_task_statuses: counts(snapshot.taskSample, TASK_STATES),
        engagement_work_item_statuses: counts(snapshot.itemSample, WORK_STATES),
      },
      project_tasks: snapshot.chosenTasks.map(row => ({
        title: safeText(row.title, 160), status: safeState(row.status, TASK_STATES),
        due: safeDate(row.due_date), assignee: assignee(row.assigned_to),
      })),
      engagement_work_items: snapshot.chosenItems.map(row => ({
        title: safeText(row.title, 160), status: safeState(row.status, WORK_STATES),
        due: safeDate(row.due_date), assignee: assignee(row.assignee_id),
      })),
      latest_visible_review_states_in_sample: snapshot.latestReviews.reduce((acc, row) => {
        const status = safeState(row.review_status, REVIEW_STATES)
        acc[status] = (acc[status] || 0) + 1
        return acc
      }, {}),
    })),
  }
  const manifest = {
    as_of: asOf, scope: summary.scope,
    project_ids: snapshots.map(snapshot => snapshot.project.id),
    project_task_ids: snapshots.flatMap(snapshot => snapshot.chosenTasks.map(row => row.id)),
    engagement_work_item_ids: snapshots.flatMap(snapshot => snapshot.chosenItems.map(row => row.id)),
    review_version_ids: snapshots.flatMap(snapshot => snapshot.latestReviews.slice(0, 20).map(row => row.id)),
    partial: summary.coverage.projects_omitted_from_bounded_summary
      || snapshots.some(row => row.partial),
  }
  return { summary, manifest }
}
