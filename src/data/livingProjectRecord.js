const CLIENT_VERSION_STATUSES = new Set([
  'client_reviewing',
  'revision_requested',
  'client_approved',
  'delivered_published',
])

const CLIENT_VISIBILITIES = new Set(['client_visible', 'client_restricted'])

function compact(value) {
  if (Array.isArray(value)) return value.map(compact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined && item !== '')
        .map(([key, item]) => [key, compact(item)])
    )
  }
  return value
}

function countBy(items, key) {
  return (items || []).reduce((counts, item) => {
    const value = item[key] || 'unknown'
    counts[value] = (counts[value] || 0) + 1
    return counts
  }, {})
}

function projectSummary(project) {
  return compact({
    id: project.id,
    name: project.name,
    engagement_type: project.engagement_type,
    status: project.status,
    health: project.health,
    priority: project.priority,
    start_date: project.start_date,
    due_date: project.due_date,
  })
}

export function buildInternalProjectProjection(workspace, generatedAt = new Date().toISOString()) {
  const { project, livingRecord } = workspace
  return compact({
    schema_version: 1,
    projection_kind: 'internal',
    generated_at: generatedAt,
    source_version: livingRecord?.source_version || 1,
    project: {
      ...projectSummary(project),
      description: project.description,
      scope_statement: project.scope_statement,
      exclusions: project.exclusions,
      client_id: project.client_id,
      owner_id: project.owner_id,
    },
    progress: {
      workstreams: countBy(workspace.workstreams, 'status'),
      tasks: countBy(workspace.tasks, 'status'),
      milestones: countBy(workspace.milestones, 'status'),
      deliverables: countBy(workspace.deliverables, 'status'),
      requests: countBy(workspace.requests, 'status'),
    },
    workstreams: workspace.workstreams.map((item) => compact({
      id: item.id,
      department_id: item.department_id,
      name: item.name,
      status: item.status,
      owner_id: item.owner_id,
    })),
    tasks: workspace.tasks.map((item) => compact({
      id: item.id,
      workstream_id: item.workstream_id,
      title: item.title,
      description: item.description,
      status: item.status,
      priority: item.priority,
      due_date: item.due_date,
      assigned_to: item.assigned_to,
      acceptance_criteria: item.acceptance_criteria,
      completion_evidence: item.completion_evidence,
    })),
    dependencies: workspace.dependencies,
    milestones: workspace.milestones.map((item) => compact({
      id: item.id,
      name: item.name,
      description: item.description,
      status: item.status,
      target_date: item.target_date,
      completed_at: item.completed_at,
    })),
    research: workspace.research.map((item) => compact({
      id: item.id,
      workstream_id: item.workstream_id,
      research_type: item.research_type,
      title: item.title,
      question: item.question,
      findings: item.findings,
      recommendation: item.recommendation,
      sources: item.sources,
      confidence: item.confidence,
      status: item.status,
    })),
    deliverables: workspace.deliverables.map((item) => compact({
      id: item.id,
      workstream_id: item.workstream_id,
      title: item.title,
      deliverable_type: item.deliverable_type,
      status: item.status,
      due_date: item.due_date,
      versions: (item.deliverable_versions || []).map((version) => compact({
        id: version.id,
        version_number: version.version_number,
        title: version.title,
        change_summary: version.change_summary,
        review_status: version.review_status,
        created_at: version.created_at,
      })),
    })),
    requests: workspace.requests.map((item) => compact({
      id: item.id,
      request_type: item.request_type,
      request_origin: item.request_origin,
      title: item.title,
      requested_output: item.requested_output,
      status: item.status,
      priority: item.priority,
      required_by: item.required_by,
      owner_id: item.owner_id,
    })),
    recent_activity: workspace.activities.slice(0, 50).map((item) => compact({
      id: item.id,
      event_type: item.event_type,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      summary: item.summary,
      actor_id: item.actor_id,
      occurred_at: item.occurred_at,
    })),
  })
}

export function buildClientProjectProjection(workspace, generatedAt = new Date().toISOString()) {
  const releasedVersionIds = new Set(
    workspace.portalItems
      .filter((item) => item.source_type === 'deliverable_version')
      .map((item) => item.source_id)
  )
  const deliverables = workspace.deliverables.flatMap((deliverable) => {
    const releasedVersions = (deliverable.deliverable_versions || [])
      .filter((version) => releasedVersionIds.has(version.id) && CLIENT_VERSION_STATUSES.has(version.review_status))
      .map((version) => compact({
        id: version.id,
        version_number: version.version_number,
        title: version.title,
        change_summary: version.change_summary,
        review_status: version.review_status,
        released_at: workspace.portalItems.find((item) => item.source_id === version.id)?.released_at,
      }))
    if (!releasedVersions.length) return []
    return [compact({
      id: deliverable.id,
      title: deliverable.title,
      deliverable_type: deliverable.deliverable_type,
      status: deliverable.status,
      due_date: deliverable.due_date,
      versions: releasedVersions,
    })]
  })

  return compact({
    schema_version: 1,
    projection_kind: 'client',
    generated_at: generatedAt,
    source_version: workspace.livingRecord?.source_version || 1,
    project: {
      ...projectSummary(workspace.project),
      summary: workspace.project.client_summary,
    },
    progress: {
      visible_workstreams: workspace.workstreams.filter((item) => item.client_visible).length,
      completed_milestones: workspace.milestones.filter((item) => item.status === 'completed' && CLIENT_VISIBILITIES.has(item.visibility)).length,
      released_deliverables: deliverables.length,
      open_client_requests: workspace.requests.filter((item) => item.visibility === 'client_visible' && !['completed', 'declined', 'withdrawn'].includes(item.status)).length,
    },
    workstreams: workspace.workstreams
      .filter((item) => item.client_visible)
      .map((item) => compact({ name: item.name, status: item.status })),
    milestones: workspace.milestones
      .filter((item) => CLIENT_VISIBILITIES.has(item.visibility))
      .map((item) => compact({
        name: item.name,
        description: item.description,
        status: item.status,
        target_date: item.target_date,
        completed_at: item.completed_at,
      })),
    deliverables,
    requests: workspace.requests
      .filter((item) => item.visibility === 'client_visible')
      .map((item) => compact({
        id: item.id,
        request_type: item.request_type,
        title: item.title,
        status: item.status,
        priority: item.priority,
        required_by: item.required_by,
        resolution_summary: item.resolution_summary,
      })),
    recent_activity: workspace.activities
      .filter((item) => item.visibility === 'client_visible')
      .slice(0, 25)
      .map((item) => compact({
        event_type: item.event_type,
        summary: item.summary,
        occurred_at: item.occurred_at,
      })),
  })
}

function markdownList(items, render) {
  return items.length ? items.map((item) => `- ${render(item)}`).join('\n') : '- None yet'
}

export function projectProjectionToMarkdown(projection) {
  const project = projection.project || {}
  const milestones = projection.milestones || []
  const deliverables = projection.deliverables || []
  const requests = projection.requests || []
  return [
    `# ${project.name || 'Project'} — ${projection.projection_kind === 'client' ? 'Client Progress Report' : 'Internal Living Record'}`,
    '',
    `Generated: ${projection.generated_at}`,
    `Source version: ${projection.source_version}`,
    '',
    '## Overview',
    '',
    project.summary || project.description || 'No summary recorded.',
    '',
    `Status: ${project.status || 'Not set'}`,
    `Health: ${project.health || 'Not set'}`,
    `Due date: ${project.due_date || 'Not set'}`,
    '',
    '## Milestones',
    '',
    markdownList(milestones, (item) => `${item.name} — ${item.status || 'planned'}${item.target_date ? ` (target ${item.target_date})` : ''}`),
    '',
    '## Deliverables',
    '',
    markdownList(deliverables, (item) => `${item.title} — ${item.status || 'in progress'}`),
    '',
    '## Requests',
    '',
    markdownList(requests, (item) => `${item.title} — ${item.status || 'open'}`),
    '',
  ].join('\n')
}
