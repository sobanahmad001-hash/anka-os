import { supabase } from '../lib/supabase.js'
import { buildMarketingCalendar } from './marketingCalendar.js'

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const response = await query
  if (response.error) throw Object.assign(new Error(response.error.message || 'Marketing Calendar query failed'), { status: response.status ?? response.error.status ?? response.error.statusCode, cause: response.error, response })
  return response.data
}

export function createMarketingCalendarRepository(organizationId, { signal, client = supabase } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  const options = { signal }
  return Object.freeze({ async load(engagement) {
    if (!engagement?.id || engagement.organization_id !== organizationId || !engagement.project_id) throw Object.assign(new Error('Marketing Calendar context mismatch'), { status: 403, membershipMismatch: true })
    const project = await dataOrThrow(client.from('projects').select('id, organization_id, client_id, engagement_type, planning_timezone').eq('organization_id', organizationId).eq('id', engagement.project_id).maybeSingle(), options)
    if (!project) throw Object.assign(new Error('Marketing Calendar project is unavailable'), { status: 403, membershipMismatch: true })
    const [clientRecord, tasks, workItems, taskDependencies, campaigns, planVersions, campaignLinks, memberships] = await Promise.all([
      project.client_id ? dataOrThrow(client.from('clients').select('id, organization_id, default_timezone').eq('organization_id', organizationId).eq('id', project.client_id).maybeSingle(), options) : null,
      dataOrThrow(client.from('tasks').select('id, organization_id, project_id, department_id, title, status, assigned_to, due_date, row_version, archived_at').eq('organization_id', organizationId).eq('project_id', project.id).eq('department_id', 'marketing').is('archived_at', null).order('due_date'), options),
      dataOrThrow(client.from('work_items').select('id, organization_id, project_id, engagement_id, department_id, title, status, assignee_id, start_date, due_date, row_version, linked_artifact_id, recurring_occurrence_id, deleted_at').eq('organization_id', organizationId).eq('project_id', project.id).eq('engagement_id', engagement.id).eq('department_id', 'marketing').is('deleted_at', null).order('due_date'), options),
      dataOrThrow(client.from('task_dependencies').select('id, organization_id, project_id, task_id, depends_on_task_id').eq('organization_id', organizationId).eq('project_id', project.id), options),
      dataOrThrow(client.from('marketing_campaigns').select('id, organization_id, engagement_id, name, planned_channels').eq('organization_id', organizationId).eq('engagement_id', engagement.id), options),
      dataOrThrow(client.from('marketing_campaign_plan_versions').select('id, organization_id, engagement_id, campaign_id, version_number, title, channels, starts_on, ends_on, created_by').eq('organization_id', organizationId).eq('engagement_id', engagement.id).order('version_number', { ascending: false }), options),
      dataOrThrow(client.from('marketing_campaign_artifacts').select('id, organization_id, campaign_id, artifact_id, marketing_campaigns!inner(engagement_id)').eq('organization_id', organizationId).eq('marketing_campaigns.engagement_id', engagement.id), options),
      dataOrThrow(client.from('organization_memberships').select('organization_id, user_id, member_kind, status').eq('organization_id', organizationId).eq('member_kind', 'team').eq('status', 'active'), options),
    ])
    const workItemIds = workItems.map(item => item.id)
    const [workItemDependencies, profiles] = await Promise.all([
      workItemIds.length ? dataOrThrow(client.from('work_item_dependencies').select('id, organization_id, work_item_id, depends_on_work_item_id').eq('organization_id', organizationId).in('work_item_id', workItemIds), options) : [],
      memberships.length ? dataOrThrow(client.from('profiles').select('id, full_name, email').in('id', memberships.map(item => item.user_id)), options) : [],
    ])
    return buildMarketingCalendar({ organizationId, engagement, project, client: clientRecord, tasks, workItems, taskDependencies, workItemDependencies, campaigns, planVersions, campaignLinks, memberships, profiles })
  } })
}
