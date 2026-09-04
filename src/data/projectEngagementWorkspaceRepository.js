import { supabase } from '../lib/supabase'

const PROJECT_FIELDS = 'id, organization_id, client_id, name, description, engagement_type, status, priority, health, owner_id, start_date, due_date, progress, portal_visible, scope_statement, exclusions, archived_at'
const EMPTY = { data: [], error: null }

function assertProjectId(projectId) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new TypeError('A project id is required')
}

function rows(result, name) {
  if (result.error) throw new Error(`Unable to load ${name}: ${result.error.message}`)
  return result.data || []
}

function row(result, name) {
  if (result.error) throw new Error(`Unable to load ${name}: ${result.error.message}`)
  return result.data && !Array.isArray(result.data) ? result.data : null
}

export async function fetchProjectEngagementSnapshot(projectId) {
  assertProjectId(projectId)
  const project = row(await supabase.from('projects').select(PROJECT_FIELDS).eq('id', projectId).single(), 'project')
  const org = project.organization_id

  const [client, engagement, workstreams, tasks, milestones, deliverables, deliverableVersions, projectActivity, memberships, profiles] = await Promise.all([
    project.client_id ? supabase.from('clients').select('id, organization_id, name, company, industry, status').eq('id', project.client_id).eq('organization_id', org).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('engagements').select('id, organization_id, project_id, brand_id, name, engagement_type, objective, status, lead_owner_id, start_date, target_date').eq('project_id', projectId).eq('organization_id', org).maybeSingle(),
    supabase.from('workstreams').select('id, organization_id, project_id, department_id, name, status, owner_id').eq('project_id', projectId).eq('organization_id', org).order('created_at'),
    supabase.from('tasks').select('id, organization_id, project_id, workstream_id, department_id, title, description, status, priority, assigned_to, acceptance_criteria, completion_evidence, due_date, created_at, archived_at').eq('project_id', projectId).eq('organization_id', org).is('archived_at', null).order('due_date', { nullsFirst: false }),
    supabase.from('milestones').select('id, organization_id, project_id, name, description, status, owner_id, target_date, position, archived_at').eq('project_id', projectId).eq('organization_id', org).is('archived_at', null).order('position'),
    supabase.from('deliverables').select('id, organization_id, project_id, workstream_id, milestone_id, title, description, deliverable_type, status, owner_id, due_date, archived_at').eq('project_id', projectId).eq('organization_id', org).is('archived_at', null).order('updated_at', { ascending: false }),
    supabase.from('deliverable_versions').select('id, organization_id, project_id, deliverable_id, version_number, title, change_summary, review_status, internal_reviewer_id, internal_reviewed_at, client_released_at, withdrawn_at, created_at').eq('project_id', projectId).eq('organization_id', org).is('withdrawn_at', null).order('version_number', { ascending: false }),
    supabase.from('activity_events').select('id, organization_id, project_id, actor_id, action, target_type, target_id, metadata, occurred_at').eq('project_id', projectId).eq('organization_id', org).order('occurred_at', { ascending: false }).limit(100),
    supabase.from('organization_memberships').select('organization_id, user_id').eq('organization_id', org).eq('member_kind', 'team').eq('status', 'active'),
    supabase.from('profiles').select('id, full_name, email'),
  ])

  const extension = row(engagement, 'engagement extension')
  const engagementId = extension?.id
  const extensionQueries = engagementId ? [
    supabase.from('brands').select('id, organization_id, name, description, status').eq('id', extension.brand_id).eq('organization_id', org).maybeSingle(),
    supabase.from('engagement_services').select('id, organization_id, engagement_id, owner_id, target_date, status, service_catalog(id, name, department_id)').eq('engagement_id', engagementId).eq('organization_id', org).order('activated_at'),
    supabase.from('engagement_stage_instances').select('id, organization_id, engagement_id, name, accountable_department_id, stage_kind, position, status').eq('engagement_id', engagementId).eq('organization_id', org).order('position'),
    supabase.from('engagement_stage_dependencies').select('organization_id, engagement_id, stage_instance_id, depends_on_stage_instance_id, dependency_kind, reason').eq('engagement_id', engagementId).eq('organization_id', org),
    supabase.from('engagement_prerequisites').select('id, organization_id, engagement_id, prerequisite_key, description, status, satisfaction_method, target_stage_instance_id, prerequisite_stage_instance_id').eq('engagement_id', engagementId).eq('organization_id', org).order('recorded_at'),
    supabase.from('work_items').select('id, organization_id, project_id, engagement_id, department_id, title, description, status, priority, assignee_id, due_date, automation_flagged_at, linked_artifact_id, linked_engagement_stage_instance_id, deleted_at').eq('engagement_id', engagementId).eq('project_id', projectId).eq('organization_id', org).is('deleted_at', null).order('position'),
    supabase.from('artifacts').select('id, organization_id, project_id, engagement_id, engagement_stage_instance_id, artifact_type, title, created_at').eq('engagement_id', engagementId).eq('project_id', projectId).eq('organization_id', org).order('created_at', { ascending: false }),
    supabase.from('artifact_approvals').select('id, organization_id, artifact_id, artifact_version_id, engagement_id, decision, notes, approved_by, approved_at').eq('engagement_id', engagementId).eq('organization_id', org).order('approved_at', { ascending: false }),
    supabase.from('engagement_events').select('id, organization_id, engagement_id, event_type, actor_id, payload, occurred_at').eq('engagement_id', engagementId).eq('organization_id', org).order('occurred_at', { ascending: false }).limit(100),
  ] : Array.from({ length: 9 }, () => Promise.resolve(EMPTY))

  const [brand, services, stages, stageDependencies, prerequisites, workItems, artifacts, artifactApprovals, engagementActivity] = await Promise.all(extensionQueries)
  const artifactRows = rows(artifacts, 'artifacts')
  const artifactVersions = artifactRows.length
    ? await supabase.from('artifact_versions').select('id, organization_id, artifact_id, version_number, change_summary, data_classification, created_at').eq('organization_id', org).in('artifact_id', artifactRows.map((item) => item.id)).order('created_at', { ascending: false })
    : EMPTY
  return {
    project,
    client: row(client, 'client'),
    engagement: extension,
    brand: row(brand, 'brand'),
    workstreams: rows(workstreams, 'workstreams'), tasks: rows(tasks, 'Project Tasks'), milestones: rows(milestones, 'milestones'),
    deliverables: rows(deliverables, 'deliverables'), deliverableVersions: rows(deliverableVersions, 'deliverable versions'), projectActivity: rows(projectActivity, 'project activity'),
    memberships: rows(memberships, 'memberships'), profiles: rows(profiles, 'profiles'), services: rows(services, 'services'), stages: rows(stages, 'journey stages'),
    stageDependencies: rows(stageDependencies, 'stage dependencies'), prerequisites: rows(prerequisites, 'prerequisites'), workItems: rows(workItems, 'Engagement Work Items'),
    artifacts: artifactRows, artifactVersions: rows(artifactVersions, 'artifact versions'), artifactApprovals: rows(artifactApprovals, 'artifact approvals'), engagementActivity: rows(engagementActivity, 'engagement activity'),
  }
}
