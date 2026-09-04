const CLOSED_PROJECT_TASK = new Set(['done', 'cancelled'])
const CLOSED_WORK_ITEM = new Set(['done'])
const CLOSED_MILESTONE = new Set(['completed', 'cancelled'])
const REVIEW_QUEUE = new Set(['ready_for_internal_review', 'ready_for_client_review', 'client_reviewing', 'revision_requested'])

const sameOrg = (record, root) => record?.organization_id === root.organization_id
const sameProject = (record, root) => sameOrg(record, root) && record.project_id === root.id
const onTime = (value, today) => !value || new Date(`${value.slice(0, 10)}T00:00:00Z`) >= today
const ownerLabel = (profile) => profile?.full_name || profile?.email || 'Unassigned'

function groupBy(records, key) {
  return records.reduce((map, record) => {
    const values = map.get(record[key]) || []
    values.push(record)
    map.set(record[key], values)
    return map
  }, new Map())
}

export function buildProjectEngagementWorkspace(snapshot, options = {}) {
  const project = snapshot.project
  if (!project?.id || !project.organization_id) throw new TypeError('A canonical project root is required')
  const today = new Date(`${(options.today || new Date().toISOString()).slice(0, 10)}T00:00:00Z`)
  const membershipKeys = new Set(snapshot.memberships.filter((item) => sameOrg(item, project)).map((item) => item.user_id))
  const profiles = new Map(snapshot.profiles.filter((item) => membershipKeys.has(item.id)).map((item) => [item.id, item]))
  const owner = (id) => ({ id: id || null, name: ownerLabel(profiles.get(id)) })
  const engagement = sameProject(snapshot.engagement, project) ? snapshot.engagement : null
  const client = sameOrg(snapshot.client, project) && snapshot.client.id === project.client_id ? snapshot.client : null
  const brand = engagement && sameOrg(snapshot.brand, project) && snapshot.brand.id === engagement.brand_id ? snapshot.brand : null
  const workstreams = snapshot.workstreams.filter((item) => sameProject(item, project)).map((item) => ({ ...item, owner: owner(item.owner_id) }))
  const workstreamIds = new Set(workstreams.map((item) => item.id))
  const tasks = snapshot.tasks.filter((item) => sameProject(item, project) && !item.archived_at).map((item) => ({ ...item, owner: owner(item.assigned_to), workstreamName: workstreams.find((row) => row.id === item.workstream_id)?.name || 'Shared project work', overdue: !CLOSED_PROJECT_TASK.has(item.status) && !onTime(item.due_date, today) }))
  const milestones = snapshot.milestones.filter((item) => sameProject(item, project) && !item.archived_at).map((item) => ({ ...item, owner: owner(item.owner_id), overdue: !CLOSED_MILESTONE.has(item.status) && !onTime(item.target_date, today) }))
  const deliverables = snapshot.deliverables.filter((item) => sameProject(item, project) && !item.archived_at && workstreamIds.has(item.workstream_id))
  const deliverableIds = new Set(deliverables.map((item) => item.id))
  const versionsByDeliverable = groupBy(snapshot.deliverableVersions.filter((item) => sameProject(item, project) && deliverableIds.has(item.deliverable_id) && !item.withdrawn_at), 'deliverable_id')
  const delivery = deliverables.map((item) => {
    const versions = versionsByDeliverable.get(item.id) || []
    return { ...item, owner: owner(item.owner_id), workstreamName: workstreams.find((row) => row.id === item.workstream_id)?.name || 'Unknown workstream', versions, latestVersion: versions[0] || null }
  })

  const services = engagement ? snapshot.services.filter((item) => sameOrg(item, project) && item.engagement_id === engagement.id).map((item) => ({ ...item, owner: owner(item.owner_id) })) : []
  const stages = engagement ? snapshot.stages.filter((item) => sameOrg(item, project) && item.engagement_id === engagement.id) : []
  const stageIds = new Set(stages.map((item) => item.id))
  const dependencies = engagement ? snapshot.stageDependencies.filter((item) => sameOrg(item, project) && item.engagement_id === engagement.id && stageIds.has(item.stage_instance_id) && stageIds.has(item.depends_on_stage_instance_id)) : []
  const dependenciesByStage = groupBy(dependencies, 'stage_instance_id')
  const stageById = new Map(stages.map((item) => [item.id, item]))
  const journey = stages.map((stage) => ({ ...stage, blockers: (dependenciesByStage.get(stage.id) || []).map((item) => stageById.get(item.depends_on_stage_instance_id)?.name).filter(Boolean) }))
  const prerequisites = engagement ? snapshot.prerequisites.filter((item) => sameOrg(item, project) && item.engagement_id === engagement.id && stageIds.has(item.target_stage_instance_id)) : []
  const workItems = engagement ? snapshot.workItems.filter((item) => sameProject(item, project) && item.engagement_id === engagement.id && !item.deleted_at).map((item) => ({ ...item, owner: owner(item.assignee_id), overdue: !CLOSED_WORK_ITEM.has(item.status) && !onTime(item.due_date, today) })) : []

  const artifacts = engagement ? snapshot.artifacts.filter((item) => sameProject(item, project) && item.engagement_id === engagement.id) : []
  const artifactIds = new Set(artifacts.map((item) => item.id))
  const artifactVersions = snapshot.artifactVersions.filter((item) => sameOrg(item, project) && artifactIds.has(item.artifact_id))
  const approvals = snapshot.artifactApprovals.filter((item) => sameOrg(item, project) && engagement && item.engagement_id === engagement.id && artifactIds.has(item.artifact_id))
  const versionsByArtifact = groupBy(artifactVersions, 'artifact_id')
  const approvalVersionIds = new Set(approvals.map((item) => item.artifact_version_id))
  const workshopArtifacts = artifacts.map((item) => {
    const versions = versionsByArtifact.get(item.id) || []
    return { ...item, versions, latestVersion: versions[0] || null, approvedVersions: versions.filter((version) => approvalVersionIds.has(version.id)).length }
  })

  const reviewQueue = delivery.flatMap((item) => item.versions.map((version) => ({ ...version, deliverableTitle: item.title }))).filter((item) => REVIEW_QUEUE.has(item.review_status))
  const projectActivity = snapshot.projectActivity.filter((item) => sameProject(item, project)).map((item) => ({ ...item, source: 'Project', label: item.action, actor: owner(item.actor_id) }))
  const engagementActivity = engagement ? snapshot.engagementActivity.filter((item) => sameOrg(item, project) && item.engagement_id === engagement.id).map((item) => ({ ...item, source: 'Engagement', label: item.event_type, actor: owner(item.actor_id) })) : []
  const activity = [...projectActivity, ...engagementActivity].sort((left, right) => new Date(right.occurred_at) - new Date(left.occurred_at))
  const openTasks = tasks.filter((item) => !CLOSED_PROJECT_TASK.has(item.status))
  const openWorkItems = workItems.filter((item) => !CLOSED_WORK_ITEM.has(item.status))
  const openMilestones = milestones.filter((item) => !CLOSED_MILESTONE.has(item.status))
  const attentionSignals = []
  if (!onTime(project.due_date, today)) attentionSignals.push('Project due date has passed')
  if (['at_risk', 'blocked'].includes(project.health)) attentionSignals.push(`Project health is ${project.health.replace('_', ' ')}`)
  if (openTasks.some((item) => item.status === 'blocked')) attentionSignals.push('Project Tasks include blocked work')
  if (openWorkItems.some((item) => item.status === 'blocked')) attentionSignals.push('Engagement Work Items include blocked work')
  if (openMilestones.some((item) => item.status === 'at_risk' || item.overdue)) attentionSignals.push('Milestones need attention')
  if (journey.some((item) => item.status === 'blocked')) attentionSignals.push('The engagement journey includes blocked stages')
  if (reviewQueue.length) attentionSignals.push(`${reviewQueue.length} deliverable version${reviewQueue.length === 1 ? '' : 's'} in review or revision`)

  const workshopPaths = { content: '/sphere/content', design: '/sphere/design', development: '/sphere/delivery', marketing: '/sphere/marketing' }
  const workshopLinks = [...new Set(services.filter((item) => item.status === 'active').map((item) => item.service_catalog?.department_id).filter(Boolean))]
    .filter((department) => workshopPaths[department])
    .map((department) => ({ department, path: `${workshopPaths[department]}?engagement=${engagement.id}` }))

  return {
    project: { ...project, owner: owner(project.owner_id) },
    identity: {
      workType: project.engagement_type === 'internal' ? 'Internal Work' : 'Client Work',
      clientName: client?.company || client?.name || null,
      brandName: brand?.name || null,
      hasEngagement: Boolean(engagement),
    },
    engagement,
    workstreams,
    milestones,
    projectTasks: tasks,
    engagementWorkItems: workItems,
    services,
    journey,
    prerequisites,
    deliverables: delivery,
    reviewQueue,
    workshopArtifacts,
    activity,
    workshopLinks,
    attentionSignals,
    summary: {
      openProjectTasks: openTasks.length,
      openEngagementWorkItems: openWorkItems.length,
      completedJourneyStages: journey.filter((item) => item.status === 'completed').length,
      totalJourneyStages: journey.length,
      openMilestones: openMilestones.length,
      reviewQueue: reviewQueue.length,
    },
  }
}
