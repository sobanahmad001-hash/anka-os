export const workshopConversationKey = (scope, kind, id) => JSON.stringify([
  scope.organizationId, scope.departmentId, kind,
  kind === 'engagement' ? scope.engagement?.project_id : '',
  kind === 'engagement' ? scope.engagement?.id : '', id,
])

export async function readWorkshopConversationPage(repository, scope, kind, cursor = null) {
  if (!scope.organizationId || !scope.actorId || !scope.departmentId || scope.signal?.aborted) throw new Error('Conversation scope is unavailable')
  if (scope.historyKind && scope.historyKind !== kind) throw new Error('Conversation scope mismatch')
  const request = { organizationId: scope.organizationId, signal: scope.signal }
  if (kind === 'private') {
    const offset = cursor || 0
    const rows = await repository.listContextConversations({ context_kind: 'department_private', department_id: scope.departmentId, offset }, request)
    if (scope.signal?.aborted) throw new Error('Conversation scope is unavailable')
    const page = (rows || []).slice(0, 50)
    if (page.some(row => row.context_kind !== 'department_private' || row.department_id !== scope.departmentId || row.owner_id !== scope.actorId || (row.project_id != null || row.engagement_id != null) || (row.organization_id && row.organization_id !== scope.organizationId))) throw new Error('Private conversation scope mismatch')
    return { items: page.map(row => ({ key: workshopConversationKey(scope, kind, row.id), kind, row })), next: rows.length > 50 ? offset + 50 : null }
  }
  const engagement = scope.engagement
  if (kind !== 'engagement' || !engagement?.id || !engagement.project_id || engagement.organization_id !== scope.organizationId) throw new Error('Select an eligible engagement')
  const page = await repository.searchConversations(scope.departmentId, {
    project_id: engagement.project_id, engagement_id: engagement.id,
    include_archived: true, query: scope.query || '', limit: 25, ...(cursor ? { before_last_activity_at: cursor.last_activity_at, before_id: cursor.id } : {}),
  }, request)
  if (scope.signal?.aborted) throw new Error('Conversation scope is unavailable')
  const rows = page.items || []
  if (rows.some(row => row.engagement_id !== engagement.id || row.project_id !== engagement.project_id || row.department_id !== scope.departmentId || (row.organization_id && row.organization_id !== scope.organizationId))) throw new Error('Engagement conversation scope mismatch')
  return { items: rows.map(row => ({ key: workshopConversationKey(scope, kind, row.id), kind, row, engagementId: engagement.id, projectId: engagement.project_id })), next: page.next_cursor || null }
}

export function eligibleWorkshopEngagements(workspace, organizationId, departmentId) {
  return (workspace?.engagements || []).filter(engagement => engagement.organization_id === organizationId
    && workspace.projects.some(project => project.id === engagement.project_id && project.organization_id === organizationId && !project.archived_at)
    && workspace.services.some(service => service.organization_id === organizationId && service.engagement_id === engagement.id
      && (service.service_catalog?.department_id || service.department_id) === departmentId
      && ['active', 'planned'].includes(service.status)))
}

export function matchesWorkshopConversation(item, scope) {
  if (!item?.row || !scope.actorId || !scope.organizationId || scope.signal?.aborted) return false
  if (scope.historyKind && scope.historyKind !== item.kind) return false
  const row = item.row
  if (row.organization_id && row.organization_id !== scope.organizationId) return false
  if (row.department_id !== scope.departmentId) return false
  if (item.kind === 'private') return row.context_kind === 'department_private' && row.owner_id === scope.actorId && row.project_id == null && row.engagement_id == null
  return item.kind === 'engagement' && scope.engagement?.organization_id === scope.organizationId
    && item.engagementId === scope.engagement.id && row.engagement_id === scope.engagement.id
    && item.projectId === scope.engagement.project_id && row.project_id === scope.engagement.project_id
}

// Selection is checked against the caller's already-authorized workspace inventory.
// Never fall back to another project or private history when selection is unavailable.
export function resolveWorkshopHistoryContext({ selectedContext, organizationId, projects = [], engagements = [] }) {
  if (!organizationId || !selectedContext) return null
  if (selectedContext.kind === 'private') return { kind: 'private', engagement: null }
  if (selectedContext.kind !== 'engagement') return null
  const project = projects.find(row => row.id === selectedContext.projectId && row.organization_id === organizationId && !row.archived_at)
  const engagement = engagements.find(row => row.id === selectedContext.engagementId && row.project_id === project?.id && row.organization_id === organizationId)
  return project && engagement ? { kind: 'engagement', engagement } : null
}
