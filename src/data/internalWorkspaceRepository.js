import { supabase } from '../lib/supabase'

const EMPTY = { data: [], error: null }

function rows(result, name) {
  if (result.error) throw new Error(`Unable to load ${name}: ${result.error.message}`)
  return result.data || []
}

export async function fetchInternalWorkspaceSnapshot() {
  const projectsResult = await supabase.from('projects').select('id, organization_id, client_id, name, description, engagement_type, status, priority, health, owner_id, start_date, due_date, progress, scope_statement, exclusions, archived_at').eq('engagement_type', 'internal').is('archived_at', null).order('updated_at', { ascending: false })
  const projects = rows(projectsResult, 'internal projects')
  const projectIds = projects.map((project) => project.id)
  if (!projectIds.length) return { projects, engagements: [], workstreams: [], tasks: [], workItems: [], milestones: [], requests: [], deliverables: [], activity: [], livingRecords: [], memberships: [], profiles: [] }

  const [engagementsResult, workstreamsResult, tasksResult, milestonesResult, requestsResult, deliverablesResult, activityResult, livingRecordsResult, membershipsResult, profilesResult] = await Promise.all([
    supabase.from('engagements').select('id, organization_id, project_id, status').in('project_id', projectIds),
    supabase.from('workstreams').select('id, organization_id, project_id, department_id, name, status, owner_id, client_visible').in('project_id', projectIds).order('created_at'),
    supabase.from('tasks').select('id, organization_id, project_id, workstream_id, department_id, title, description, status, priority, assigned_to, due_date, archived_at').in('project_id', projectIds).is('archived_at', null).order('due_date', { nullsFirst: false }),
    supabase.from('milestones').select('id, organization_id, project_id, name, description, status, owner_id, target_date, archived_at').in('project_id', projectIds).is('archived_at', null).order('target_date', { nullsFirst: false }),
    supabase.from('requests').select('id, organization_id, project_id, title, request_type, request_origin, status, priority, owner_id, required_by, archived_at').in('project_id', projectIds).is('archived_at', null).order('required_by', { nullsFirst: false }),
    supabase.from('deliverables').select('id, organization_id, project_id, workstream_id, title, description, deliverable_type, status, owner_id, due_date, archived_at').in('project_id', projectIds).is('archived_at', null).order('due_date', { nullsFirst: false }),
    supabase.from('activity_events').select('id, organization_id, project_id, actor_id, action, target_type, target_id, metadata, occurred_at').in('project_id', projectIds).order('occurred_at', { ascending: false }).limit(150),
    supabase.from('living_project_documents').select('id, organization_id, project_id, source_version, generated_at, updated_at').in('project_id', projectIds),
    supabase.from('organization_memberships').select('organization_id, user_id').eq('member_kind', 'team').eq('status', 'active'),
    supabase.from('profiles').select('id, full_name, email'),
  ])
  const engagements = rows(engagementsResult, 'engagement extensions')
  const engagementIds = engagements.map((engagement) => engagement.id)
  const workItemsResult = engagementIds.length
    ? await supabase.from('work_items').select('id, organization_id, project_id, engagement_id, department_id, title, description, status, priority, assignee_id, due_date, deleted_at').in('project_id', projectIds).in('engagement_id', engagementIds).is('deleted_at', null).order('due_date', { nullsFirst: false })
    : EMPTY
  return {
    projects, engagements,
    workstreams: rows(workstreamsResult, 'workstreams'), tasks: rows(tasksResult, 'Project Tasks'), workItems: rows(workItemsResult, 'Engagement Work Items'),
    milestones: rows(milestonesResult, 'milestones'), requests: rows(requestsResult, 'requests'), deliverables: rows(deliverablesResult, 'deliverables'),
    activity: rows(activityResult, 'activity'), livingRecords: rows(livingRecordsResult, 'Living Records'), memberships: rows(membershipsResult, 'memberships'), profiles: rows(profilesResult, 'profiles'),
  }
}
