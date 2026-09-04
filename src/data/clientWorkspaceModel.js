const CLOSED_PROJECT = new Set(['completed', 'cancelled', 'archived'])
const CLOSED_TASK = new Set(['done', 'cancelled'])
const CLOSED_ITEM = new Set(['done'])
const CLOSED_REQUEST = new Set(['completed', 'declined', 'withdrawn'])
const CLOSED_MILESTONE = new Set(['completed', 'cancelled'])
const CLOSED_DELIVERABLE = new Set(['delivered_published', 'withdrawn', 'archived'])

const sameOrg = (row, root) => row?.organization_id === root.organization_id
const dateOnly = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null
const overdue = (value, today) => Boolean(value && dateOnly(value) < today)
const ownerName = (profile) => profile?.full_name || profile?.email || 'Unassigned'

function group(rows, key) {
  return rows.reduce((map, row) => map.set(row[key], [...(map.get(row[key]) || []), row]), new Map())
}

export function buildClientWorkspace(snapshot, options = {}) {
  const client = snapshot.client
  if (!client?.id || !client.organization_id) throw new TypeError('A canonical client root is required')
  const today = dateOnly(options.today || new Date().toISOString())
  const memberships = new Set(snapshot.memberships.filter((row) => sameOrg(row, client)).map((row) => row.user_id))
  const profiles = new Map(snapshot.profiles.filter((profile) => memberships.has(profile.id)).map((profile) => [profile.id, profile]))
  const owner = (id) => ({ id: id || null, name: ownerName(profiles.get(id)) })
  const agencyClient = sameOrg(snapshot.agencyClient, client) && snapshot.agencyClient.canonical_client_id === client.id ? snapshot.agencyClient : null
  const brands = agencyClient ? snapshot.brands.filter((row) => sameOrg(row, client) && row.client_id === agencyClient.id) : []
  const brandIds = new Set(brands.map((row) => row.id))
  const projects = snapshot.projects.filter((row) => sameOrg(row, client) && row.client_id === client.id && !row.archived_at)
  const projectIds = new Set(projects.map((row) => row.id))
  const engagements = agencyClient ? snapshot.engagements.filter((row) => sameOrg(row, client) && row.client_id === agencyClient.id && projectIds.has(row.project_id) && brandIds.has(row.brand_id)) : []
  const engagementByProject = new Map(engagements.map((row) => [row.project_id, row]))
  const tasksByProject = group(snapshot.tasks.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.archived_at), 'project_id')
  const workItemsByProject = group(snapshot.workItems.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.deleted_at && engagementByProject.get(row.project_id)?.id === row.engagement_id), 'project_id')
  const milestonesByProject = group(snapshot.milestones.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.archived_at), 'project_id')
  const requestsByProject = group(snapshot.requests.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.archived_at), 'project_id')
  const deliverables = snapshot.deliverables.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.archived_at)
  const deliverableIds = new Set(deliverables.map((row) => row.id))
  const versionsByDeliverable = group(snapshot.versions.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && deliverableIds.has(row.deliverable_id) && !row.withdrawn_at), 'deliverable_id')
  const releases = snapshot.releases.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.withdrawn_at)
  const releasesByProject = group(releases, 'project_id')
  const brandById = new Map(brands.map((row) => [row.id, row]))
  const projectRows = projects.map((project) => {
    const extension = engagementByProject.get(project.id) || null
    const projectTasks = tasksByProject.get(project.id) || []
    const engagementWorkItems = workItemsByProject.get(project.id) || []
    const milestones = milestonesByProject.get(project.id) || []
    const requests = requestsByProject.get(project.id) || []
    return {
      ...project,
      owner: owner(project.owner_id),
      extension,
      brandName: extension ? brandById.get(extension.brand_id)?.name || null : null,
      projectTasks,
      engagementWorkItems,
      milestones,
      requests,
      releases: releasesByProject.get(project.id) || [],
      counts: {
        openProjectTasks: projectTasks.filter((row) => !CLOSED_TASK.has(row.status)).length,
        openEngagementWorkItems: engagementWorkItems.filter((row) => !CLOSED_ITEM.has(row.status)).length,
        openRequests: requests.filter((row) => !CLOSED_REQUEST.has(row.status)).length,
      },
    }
  })
  const projectById = new Map(projectRows.map((row) => [row.id, row]))
  const delivery = deliverables.map((row) => ({ ...row, owner: owner(row.owner_id), projectName: projectById.get(row.project_id)?.name || 'Unknown project', versions: (versionsByDeliverable.get(row.id) || []).sort((a, b) => b.version_number - a.version_number) }))
  const releaseRows = releases.map((row) => ({ ...row, projectName: projectById.get(row.project_id)?.name || 'Unknown project' }))
  const dueWork = [
    ...snapshot.tasks.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.archived_at && !CLOSED_TASK.has(row.status)).map((row) => ({ ...row, source: 'Project Task', date: row.due_date, owner: owner(row.assigned_to) })),
    ...snapshot.workItems.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.deleted_at && !CLOSED_ITEM.has(row.status) && engagementByProject.get(row.project_id)?.id === row.engagement_id).map((row) => ({ ...row, source: 'Engagement Work Item', date: row.due_date, owner: owner(row.assignee_id) })),
    ...snapshot.milestones.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.archived_at && !CLOSED_MILESTONE.has(row.status)).map((row) => ({ ...row, title: row.name, source: 'Milestone', date: row.target_date, owner: owner(row.owner_id) })),
    ...snapshot.requests.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && !row.archived_at && !CLOSED_REQUEST.has(row.status)).map((row) => ({ ...row, source: 'Request', date: row.required_by, owner: owner(row.owner_id) })),
    ...deliverables.filter((row) => !CLOSED_DELIVERABLE.has(row.status)).map((row) => ({ ...row, source: 'Deliverable', date: row.due_date, owner: owner(row.owner_id) })),
  ].map((row) => ({ ...row, projectName: projectById.get(row.project_id)?.name || 'Unknown project', overdue: overdue(row.date, today) })).sort((a, b) => (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31'))
  const contacts = snapshot.contacts.filter((row) => sameOrg(row, client) && row.client_id === client.id)
  const contactIds = new Set(contacts.map((row) => row.id))
  const access = snapshot.access.filter((row) => sameOrg(row, client) && projectIds.has(row.project_id) && contactIds.has(row.client_contact_id))
  const accessByContact = group(access, 'client_contact_id')
  const people = contacts.map((contact) => ({ ...contact, access: (accessByContact.get(contact.id) || []).map((grant) => ({ ...grant, projectName: projectById.get(grant.project_id)?.name || 'Unknown project' })) }))
  const allTasks = projectRows.flatMap((row) => row.projectTasks)
  const allItems = projectRows.flatMap((row) => row.engagementWorkItems)
  const allRequests = projectRows.flatMap((row) => row.requests)
  return {
    client: { ...client, owner: owner(client.owner_id) }, agencyClient, brands, projects: projectRows, people, dueWork, deliverables: delivery, releases: releaseRows,
    summary: {
      activeProjects: projectRows.filter((row) => !CLOSED_PROJECT.has(row.status)).length,
      oneTimeProjects: projectRows.filter((row) => row.engagement_type === 'project').length,
      retainers: projectRows.filter((row) => row.engagement_type === 'retainer').length,
      openProjectTasks: allTasks.filter((row) => !CLOSED_TASK.has(row.status)).length,
      openEngagementWorkItems: allItems.filter((row) => !CLOSED_ITEM.has(row.status)).length,
      openRequests: allRequests.filter((row) => !CLOSED_REQUEST.has(row.status)).length,
      releases: releases.length,
    },
  }
}
