const CLOSED_PROJECT = new Set(['completed', 'cancelled', 'archived'])
const CLOSED_TASK = new Set(['done', 'cancelled'])
const CLOSED_ITEM = new Set(['done'])
const sameOrganization = (row, organizationId) => row?.organization_id === organizationId
const ownerLabel = (profile) => profile?.full_name || profile?.email || 'Unassigned'

function group(rows, key) {
  return rows.reduce((map, row) => map.set(row[key], [...(map.get(row[key]) || []), row]), new Map())
}

export function buildClientWorkDirectory(snapshot, { today = new Date().toISOString() } = {}) {
  const organizationId = snapshot.organizationId
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('An active organization is required')

  const clients = snapshot.clients.filter((row) => sameOrganization(row, organizationId))
  const clientIds = new Set(clients.map((row) => row.id))
  const agencyClients = snapshot.agencyClients.filter((row) => sameOrganization(row, organizationId) && clientIds.has(row.canonical_client_id))
  const extensionByClient = new Map(agencyClients.map((row) => [row.canonical_client_id, row]))
  const extensionIds = new Set(agencyClients.map((row) => row.id))
  const brands = snapshot.brands.filter((row) => sameOrganization(row, organizationId) && extensionIds.has(row.client_id))
  const brandsByExtension = group(brands, 'client_id')
  const brandIds = new Set(brands.map((row) => row.id))
  const projects = snapshot.projects.filter((row) => sameOrganization(row, organizationId) && clientIds.has(row.client_id) && row.engagement_type !== 'internal' && !row.archived_at)
  const projectIds = new Set(projects.map((row) => row.id))
  const projectById = new Map(projects.map((row) => [row.id, row]))
  const engagements = snapshot.engagements.filter((row) => {
    const extension = extensionByClient.get(projectById.get(row.project_id)?.client_id)
    return sameOrganization(row, organizationId) && projectIds.has(row.project_id) && extension?.id === row.client_id && brandIds.has(row.brand_id)
  })
  const engagementByProject = new Map(engagements.map((row) => [row.project_id, row]))
  const tasksByProject = group(snapshot.tasks.filter((row) => sameOrganization(row, organizationId) && projectIds.has(row.project_id) && !row.archived_at), 'project_id')
  const workItemsByProject = group(snapshot.workItems.filter((row) => sameOrganization(row, organizationId) && projectIds.has(row.project_id) && !row.deleted_at && engagementByProject.get(row.project_id)?.id === row.engagement_id), 'project_id')
  const memberIds = new Set(snapshot.memberships.filter((row) => sameOrganization(row, organizationId)).map((row) => row.user_id))
  const profiles = new Map(snapshot.profiles.filter((row) => memberIds.has(row.id)).map((row) => [row.id, row]))
  const owner = (id) => ({ id: memberIds.has(id) ? id : null, name: memberIds.has(id) ? ownerLabel(profiles.get(id)) : 'Unassigned' })
  const todayDate = new Date(today.slice(0, 10) + 'T00:00:00Z')

  const projectRows = projects.map((project) => {
    const extension = engagementByProject.get(project.id) || null
    const projectTasks = tasksByProject.get(project.id) || []
    const engagementWorkItems = workItemsByProject.get(project.id) || []
    return {
      ...project,
      owner: owner(project.owner_id),
      brandName: extension ? brands.find((brand) => brand.id === extension.brand_id)?.name || null : null,
      hasEngagement: Boolean(extension),
      overdue: Boolean(project.due_date && !CLOSED_PROJECT.has(project.status) && new Date(project.due_date.slice(0, 10) + 'T00:00:00Z') < todayDate),
      counts: {
        openProjectTasks: projectTasks.filter((row) => !CLOSED_TASK.has(row.status)).length,
        openEngagementWorkItems: engagementWorkItems.filter((row) => !CLOSED_ITEM.has(row.status)).length,
      },
    }
  })
  const projectsByClient = group(projectRows, 'client_id')
  const clientRows = clients.map((client) => {
    const extension = extensionByClient.get(client.id) || null
    const clientProjects = projectsByClient.get(client.id) || []
    return {
      ...client,
      owner: owner(client.owner_id),
      agencyClient: extension,
      brands: extension ? brandsByExtension.get(extension.id) || [] : [],
      projects: clientProjects,
      counts: {
        activeProjects: clientProjects.filter((row) => !CLOSED_PROJECT.has(row.status)).length,
        oneTimeProjects: clientProjects.filter((row) => row.engagement_type === 'project').length,
        retainers: clientProjects.filter((row) => row.engagement_type === 'retainer').length,
        openProjectTasks: clientProjects.reduce((sum, row) => sum + row.counts.openProjectTasks, 0),
        openEngagementWorkItems: clientProjects.reduce((sum, row) => sum + row.counts.openEngagementWorkItems, 0),
      },
    }
  }).sort((left, right) => (left.company || left.name).localeCompare(right.company || right.name))

  return {
    organizationId,
    clients: clientRows,
    summary: {
      clients: clientRows.length,
      activeProjects: projectRows.filter((row) => !CLOSED_PROJECT.has(row.status)).length,
      openProjectTasks: projectRows.reduce((sum, row) => sum + row.counts.openProjectTasks, 0),
      openEngagementWorkItems: projectRows.reduce((sum, row) => sum + row.counts.openEngagementWorkItems, 0),
    },
  }
}
