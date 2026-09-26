import { buildInternalProjectProjection } from './livingProjectRecord.js'

const scopeError = () => Object.assign(new Error('Document sources do not match the selected project'), { status: 403, membershipMismatch: true })
const agreed = new Set(['active', 'on_hold', 'completed'])
export function composeLivingProjectReference({ organizationId, projectId, records, workspace, services, proposals = [], memory, pipeline, unavailable = [] }, loadedAt = new Date().toISOString()) {
  if (records?.project?.id !== projectId || records.project.organization_id !== organizationId
    || workspace?.project?.id !== projectId || workspace.project.organization_id !== organizationId
    || records.livingRecord?.project_id !== projectId || records.livingRecord.organization_id !== organizationId) throw scopeError()
  if (services && (services.organization_id !== organizationId || services.project_id !== projectId)) throw scopeError()
  if (memory && (memory.organization_id !== organizationId || memory.project_id !== projectId)) throw scopeError()
  if (proposals.some(row => row.organization_id !== organizationId || row.project_id !== projectId)) throw scopeError()
  const serviceRows = (services?.scopes || []).map(row => ({ ...row,
    name: services.catalog.find(service => service.id === row.service_id)?.name || 'Recorded service',
  }))
  if (pipeline && (!workspace.engagement
    || [...pipeline.configurations, ...pipeline.activations].some(row =>
      row.organization_id !== organizationId || row.engagement_id !== workspace.engagement.id))) throw scopeError()
  const latestActivation = pipeline?.activations?.[0]
  const activeConfiguration = pipeline?.configurations?.find(row => row.id === latestActivation?.configuration_id) || null
  if (latestActivation && !activeConfiguration) throw scopeError()
  return {
    project: records.project, loadedAt, sourceVersion: records.livingRecord.source_version,
    coreProjection: buildInternalProjectProjection(records, loadedAt), snapshots: records.snapshots,
    brief: { description: workspace.context.brief, objective: workspace.context.objective,
      audience: null, scope: workspace.context.scope, exclusions: workspace.context.exclusions },
    agreedServices: serviceRows.filter(row => agreed.has(row.status)),
    proposedServices: serviceRows.filter(row => row.status === 'proposed'),
    closedServices: serviceRows.filter(row => row.status === 'cancelled'),
    activeConfiguration,
    decisions: proposals.filter(row => row.status === 'applied'),
    proposedChanges: proposals.filter(row => ['pending', 'approved_failed'].includes(row.status)),
    confirmedPreferences: memory?.confirmed || [],
    milestones: workspace.milestones,
    tasks: workspace.projectTasks,
    workItems: workspace.engagementWorkItems,
    workstreams: workspace.workstreams,
    owner: workspace.context.projectOwner,
    unavailable,
    coverage: 'Current reference includes accessible canonical records. Existing preserved snapshots cover the core project record, not all service, pipeline or decision sections. Recurring-plan details and audience are not yet composed here.',
  }
}

export function selectLivingProjectSnapshot(snapshots, snapshotId, organizationId, projectId, documentId) {
  const snapshot = snapshots.find(row => row.id === snapshotId)
  if (!snapshot || snapshot.organization_id !== organizationId || snapshot.project_id !== projectId
    || snapshot.living_project_document_id !== documentId) throw scopeError()
  return snapshot
}
