export function getDepartmentWorkshopContext(workspace, selectedWorkstreamId) {
  if (!workspace || !Array.isArray(workspace.workstreams) || !Array.isArray(workspace.engagements)) {
    return {
      selectedWorkstream: null,
      selectedProjectId: null,
      engagementIds: [],
      hasContext: false,
    }
  }

  const selectedWorkstream = workspace.workstreams.find((workstream) => workstream?.id === selectedWorkstreamId) || null
  if (!selectedWorkstream?.project_id) {
    return {
      selectedWorkstream: null,
      selectedProjectId: null,
      engagementIds: [],
      hasContext: false,
    }
  }

  const engagementIds = workspace.engagements
    .filter((engagement) => engagement?.project_id === selectedWorkstream.project_id && engagement?.id)
    .map((engagement) => engagement.id)

  return {
    selectedWorkstream,
    selectedProjectId: selectedWorkstream.project_id,
    engagementIds,
    hasContext: engagementIds.length > 0,
  }
}

export function getDepartmentWorkshopVisibleData(workspace, selectedWorkstreamId, context) {
  const { hasContext, projectId = context?.selectedProjectId, engagementIds } = context

  if (!workspace) {
    return {
      tasks: [],
      workItems: [],
      services: [],
      stages: [],
      research: [],
      deliverables: [],
      requests: [],
      milestones: [],
    }
  }

  if (!selectedWorkstreamId) return workspace

  const safeEngagementIds = hasContext ? engagementIds : []

  return {
    ...workspace,
    tasks: workspace.tasks.filter((item) => item.workstream_id === selectedWorkstreamId),
    workItems: hasContext
      ? workspace.workItems.filter((item) => item.project_id === projectId && safeEngagementIds.includes(item.engagement_id))
      : [],
    services: hasContext
      ? workspace.services.filter((item) => item.engagement_id && safeEngagementIds.includes(item.engagement_id))
      : [],
    stages: hasContext
      ? workspace.stages.filter((item) => item.engagement_id && safeEngagementIds.includes(item.engagement_id))
      : [],
    research: workspace.research.filter((item) => item.workstream_id === null || item.workstream_id === selectedWorkstreamId),
    deliverables: workspace.deliverables.filter((item) => item.workstream_id === selectedWorkstreamId),
    requests: workspace.requests.filter((item) => item.requesting_workstream_id === selectedWorkstreamId || item.receiving_workstream_id === selectedWorkstreamId),
    milestones: hasContext ? workspace.milestones.filter((item) => item.project_id === projectId) : [],
  }
}

export function getReceivingWorkstreams(workspace, selectedWorkstreamId, projectId) {
  if (!workspace?.relatedWorkstreams || !selectedWorkstreamId || !projectId) return []

  return (workspace.relatedWorkstreams || []).filter((workstream) => (
    workstream?.project_id === projectId && workstream.id !== selectedWorkstreamId
  ))
}



