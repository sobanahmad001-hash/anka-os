// Presentation guard only; the existing scoped repository/server remains authoritative.
export function eligibleDesignVersions(workspace, scope) {
  const engagement = workspace?.engagement
  if (!scope.organizationId || !scope.projectId || !scope.engagementId
    || engagement?.id !== scope.engagementId || engagement.organization_id !== scope.organizationId
    || engagement.project_id !== scope.projectId) return []
  const services = new Set((workspace.designServices || []).filter(service => {
    const catalog = Array.isArray(service.service_catalog) ? service.service_catalog[0] : service.service_catalog
    return service.engagement_id === scope.engagementId && service.status === 'active'
      && catalog?.department_id === 'design' && catalog.is_active === true
  }).map(service => service.id))
  const sessions = new Set((workspace.sessions || []).filter(session => session.organization_id === scope.organizationId
    && session.engagement_id === scope.engagementId && services.has(session.engagement_service_id)).map(session => session.id))
  const directions = new Set((workspace.directions || []).filter(direction => direction.organization_id === scope.organizationId
    && sessions.has(direction.session_id)).map(direction => direction.id))
  return (workspace.directionVersions || []).filter(version => version.organization_id === scope.organizationId
    && version.is_experimental === false && directions.has(version.direction_id))
}

export function requireDesignVersion(workspace, scope, versionId) {
  const version = eligibleDesignVersions(workspace, scope).find(version => version.id === versionId)
  if (!version) throw new Error('This exact direction version is no longer available in the selected active Design context.')
  return version
}
