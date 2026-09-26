import { CONTENT_ARTIFACT_FORMS, bestContentStage } from './contentStudio.js'
import { contentArtifactForMode } from './contentWriter.js'
import { departmentChatProfile } from './departmentChatProfiles.js'
export function contentArtifactChatTargets(workspace, { organizationId, projectId, engagementId, brandId } = {}) {
  const engagement = workspace?.engagement
  if (!organizationId || !projectId || !engagementId || engagement?.id !== engagementId
    || engagement.organization_id !== organizationId || engagement.project_id !== projectId || !engagement.brand_id || engagement.brand_id !== brandId) return null
  const scoped = row => row.organization_id === organizationId && row.engagement_id === engagementId && (!row.project_id || row.project_id === projectId)
  if (!Array.isArray(workspace.contentServices) || !workspace.contentServices.some(row => scoped(row) && row.status === 'active'
    && (Array.isArray(row.service_catalog) ? row.service_catalog[0] : row.service_catalog)?.department_id === 'content'
    && (Array.isArray(row.service_catalog) ? row.service_catalog[0] : row.service_catalog)?.is_active !== false)) return null
  if (![workspace.artifacts, workspace.stages, workspace.versions].every(Array.isArray)
    || workspace.artifacts.some(row => !scoped(row)) || workspace.stages.some(row => !scoped(row))) return null
  const artifacts = new Map(workspace.artifacts.map(row => [row.id, row]))
  if (workspace.versions.some(row => row.organization_id !== organizationId || !artifacts.has(row.artifact_id))) return null
  const types = departmentChatProfile('content').artifactTypes
  if (types.some(type => !Object.hasOwn(CONTENT_ARTIFACT_FORMS, type))) return null
  return {
    engagement, definitions: CONTENT_ARTIFACT_FORMS,
    artifactForType: type => !Object.hasOwn(CONTENT_ARTIFACT_FORMS, type) ? null : type === 'content'
      ? contentArtifactForMode(workspace, 'legacy') : workspace.artifacts.find(row => row.artifact_type === type) || null,
    stageForType: type => Object.hasOwn(CONTENT_ARTIFACT_FORMS, type) ? bestContentStage(workspace.stages, type) : null,
  }
}
