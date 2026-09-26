export const workshopConversationKey = (scope, kind, id) => JSON.stringify([
  scope.organizationId, scope.departmentId, kind,
  kind === 'engagement' ? scope.engagement?.project_id : '',
  kind === 'engagement' ? scope.engagement?.id : '', id,
])

export async function readWorkshopConversationPage(repository, scope, kind, cursor = null) {
  if (!scope.organizationId || !scope.actorId || !scope.departmentId || scope.signal?.aborted) throw new Error('Conversation scope is unavailable')
  const request = { organizationId: scope.organizationId, signal: scope.signal }
  if (kind === 'private') {
    const offset = cursor || 0
    const rows = await repository.listContextConversations({ context_kind: 'department_private', department_id: scope.departmentId, offset }, request)
    const page = (rows || []).slice(0, 50)
    if (page.some(row => row.context_kind !== 'department_private' || row.department_id !== scope.departmentId || row.owner_id !== scope.actorId || row.project_id)) throw new Error('Private conversation scope mismatch')
    return { items: page.map(row => ({ key: workshopConversationKey(scope, kind, row.id), kind, row })), next: rows.length > 50 ? offset + 50 : null }
  }
  const engagement = scope.engagement
  if (kind !== 'engagement' || !engagement?.id || !engagement.project_id || engagement.organization_id !== scope.organizationId) throw new Error('Select an eligible engagement')
  const page = await repository.searchConversations(scope.departmentId, {
    project_id: engagement.project_id, engagement_id: engagement.id,
    include_archived: true, query: '', limit: 25, ...(cursor ? { before_last_activity_at: cursor.last_activity_at, before_id: cursor.id } : {}),
  }, request)
  const rows = page.items || []
  if (rows.some(row => row.engagement_id !== engagement.id || row.project_id !== engagement.project_id || row.department_id !== scope.departmentId || (row.organization_id && row.organization_id !== scope.organizationId))) throw new Error('Engagement conversation scope mismatch')
  return { items: rows.map(row => ({ key: workshopConversationKey(scope, kind, row.id), kind, row, engagementId: engagement.id, projectId: engagement.project_id })), next: page.next_cursor || null }
}
