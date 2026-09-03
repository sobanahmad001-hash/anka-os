import { supabase } from '../lib/supabase.js'
import { WORK_RECORD_TYPES } from './workItemExperience.js'

const requireValue = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`)
  return value.trim()
}

const withSignal = (query, signal) => signal && typeof query?.abortSignal === 'function' ? query.abortSignal(signal) : query

async function dataOrThrow(query, fallback) {
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || fallback), { status: error.status || 500, code: error.code })
  return data
}

const unique = values => [...new Set(values.filter(Boolean))]
const assertOrganizationRecords = (organizationId, ...values) => {
  const records = values.flatMap(value => Array.isArray(value) ? value : value ? [value] : [])
  if (records.some(record => record.organization_id && record.organization_id !== organizationId)) {
    throw Object.assign(new Error('The requested record is unavailable in the active organization.'), { status: 403, membershipMismatch: true })
  }
}

export function createWorkItemExperienceRepository(client) {
  async function ownerFor(record, organizationId, signal) {
    const ownerId = record.assigned_to || record.assignee_id
    if (!ownerId) return null
    const membership = await dataOrThrow(withSignal(
      client.from('organization_memberships')
        .select('user_id, role, department_id, status')
        .eq('organization_id', organizationId)
        .eq('user_id', ownerId)
        .eq('member_kind', 'team')
        .eq('status', 'active')
        .maybeSingle(), signal
    ), 'Owner membership could not be loaded')
    if (!membership) return null
    const profile = await dataOrThrow(withSignal(
      client.from('profiles').select('id, full_name, email, department, role').eq('id', ownerId).maybeSingle(), signal
    ), 'Owner profile could not be loaded')
    return profile ? { ...membership, profile } : { ...membership, profile: null }
  }

  async function projectTaskDetail(record, organizationId, signal) {
    const [project, workstream, owner, dependencies, discussion, history] = await Promise.all([
      dataOrThrow(withSignal(client.from('projects').select('id, organization_id, client_id, name, engagement_type, status').eq('organization_id', organizationId).eq('id', record.project_id).maybeSingle(), signal), 'Project could not be loaded'),
      record.workstream_id ? dataOrThrow(withSignal(client.from('workstreams').select('id, organization_id, project_id, department_id, name, status').eq('organization_id', organizationId).eq('id', record.workstream_id).maybeSingle(), signal), 'Workstream could not be loaded') : null,
      ownerFor(record, organizationId, signal),
      dataOrThrow(withSignal(client.from('task_dependencies').select('*').eq('organization_id', organizationId).or(`task_id.eq.${record.id},depends_on_task_id.eq.${record.id}`).order('created_at'), signal), 'Task dependencies could not be loaded'),
      dataOrThrow(withSignal(client.from('comments').select('id, organization_id, project_id, user_id, content, parent_comment_id, visibility, created_at, updated_at').eq('organization_id', organizationId).eq('entity_type', 'task').eq('entity_id', record.id).order('created_at'), signal), 'Task discussion could not be loaded'),
      dataOrThrow(withSignal(client.from('activity_events').select('id, organization_id, project_id, actor_id, action, target_type, target_id, metadata, occurred_at').eq('organization_id', organizationId).eq('target_type', 'task').eq('target_id', record.id).order('occurred_at', { ascending: false }), signal), 'Task history could not be loaded'),
    ])
    const relationIds = unique((dependencies || []).flatMap(item => [item.task_id, item.depends_on_task_id]).filter(id => id !== record.id))
    const related = relationIds.length ? await dataOrThrow(withSignal(client.from('tasks').select('id, organization_id, project_id, title, status, due_date').eq('organization_id', organizationId).in('id', relationIds), signal), 'Related tasks could not be loaded') : []
    assertOrganizationRecords(organizationId, record, project, workstream, dependencies, discussion, history, related)
    if (!project || project.id !== record.project_id || (workstream && workstream.project_id !== record.project_id)) {
      throw Object.assign(new Error('The Project Task context is stale or unavailable.'), { status: 403, membershipMismatch: true })
    }
    return {
      kind: WORK_RECORD_TYPES.PROJECT_TASK,
      record, project, workstream, engagement: null, owner,
      dependencies: dependencies || [], relatedRecords: related || [],
      discussion: discussion || [], discussionAvailability: 'available',
      outputs: record.completion_evidence ? [{ id: `completion-${record.id}`, title: 'Completion evidence', artifact_type: 'task evidence', description: record.completion_evidence, versions: [] }] : [],
      outputAvailability: record.completion_evidence ? 'Stored completion evidence on this Project Task.' : 'No direct output relation is stored on Project Tasks. Open the project workspace for deliverables.',
      history: history || [],
    }
  }

  async function engagementWorkItemDetail(record, organizationId, signal) {
    const [project, engagement, owner, dependencies, history, artifact, stage, subtasks] = await Promise.all([
      dataOrThrow(withSignal(client.from('projects').select('id, organization_id, client_id, name, engagement_type, status').eq('organization_id', organizationId).eq('id', record.project_id).maybeSingle(), signal), 'Project could not be loaded'),
      dataOrThrow(withSignal(client.from('engagements').select('id, organization_id, project_id, brand_id, name, status').eq('organization_id', organizationId).eq('id', record.engagement_id).maybeSingle(), signal), 'Engagement could not be loaded'),
      ownerFor(record, organizationId, signal),
      dataOrThrow(withSignal(client.from('work_item_dependencies').select('*').eq('organization_id', organizationId).or(`work_item_id.eq.${record.id},depends_on_work_item_id.eq.${record.id}`).order('created_at'), signal), 'Work Item dependencies could not be loaded'),
      dataOrThrow(withSignal(client.from('engagement_events').select('id, organization_id, engagement_id, event_type, actor_id, payload, occurred_at').eq('organization_id', organizationId).eq('engagement_id', record.engagement_id).contains('payload', { record_id: record.id }).order('occurred_at', { ascending: false }), signal), 'Work Item history could not be loaded'),
      record.linked_artifact_id ? dataOrThrow(withSignal(client.from('artifacts').select('id, organization_id, engagement_id, artifact_type, title, created_at').eq('organization_id', organizationId).eq('id', record.linked_artifact_id).maybeSingle(), signal), 'Linked output could not be loaded') : null,
      record.linked_engagement_stage_instance_id ? dataOrThrow(withSignal(client.from('engagement_stage_instances').select('id, organization_id, engagement_id, name, status, accountable_department_id').eq('organization_id', organizationId).eq('id', record.linked_engagement_stage_instance_id).maybeSingle(), signal), 'Linked stage could not be loaded') : null,
      dataOrThrow(withSignal(client.from('work_items').select('id, organization_id, project_id, engagement_id, parent_work_item_id, title, status, due_date').eq('organization_id', organizationId).eq('parent_work_item_id', record.id).is('deleted_at', null).order('position'), signal), 'Subtasks could not be loaded'),
    ])
    const relationIds = unique([
      ...(dependencies || []).flatMap(item => [item.work_item_id, item.depends_on_work_item_id]),
      record.parent_work_item_id,
    ].filter(id => id && id !== record.id))
    const related = relationIds.length ? await dataOrThrow(withSignal(client.from('work_items').select('id, organization_id, project_id, engagement_id, title, status, due_date').eq('organization_id', organizationId).in('id', relationIds), signal), 'Related Work Items could not be loaded') : []
    const versions = artifact ? await dataOrThrow(withSignal(client.from('artifact_versions').select('id, organization_id, artifact_id, version_number, change_summary, data_classification, created_at').eq('organization_id', organizationId).eq('artifact_id', artifact.id).order('version_number', { ascending: false }), signal), 'Output versions could not be loaded') : []
    assertOrganizationRecords(organizationId, record, project, engagement, dependencies, history, artifact, stage, subtasks, related, versions)
    if (!project || !engagement || project.id !== record.project_id || engagement.id !== record.engagement_id || engagement.project_id !== record.project_id) {
      throw Object.assign(new Error('The Engagement Work Item context is stale or unavailable.'), { status: 403, membershipMismatch: true })
    }
    return {
      kind: WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM,
      record, project, engagement, workstream: null, owner, stage,
      dependencies: dependencies || [], relatedRecords: related || [], subtasks: subtasks || [],
      discussion: [], discussionAvailability: 'No work-item-specific discussion record exists. Use the owning project or engagement conversation.',
      outputs: artifact ? [{ ...artifact, versions: versions || [] }] : [],
      outputAvailability: artifact ? 'Linked output and its existing versions.' : 'No output is linked to this Engagement Work Item.',
      history: history || [],
    }
  }

  return Object.freeze({
    async getDetail(kind, recordId, activeOrganizationId, { signal } = {}) {
      requireValue(recordId, 'recordId')
      const organizationId = requireValue(activeOrganizationId, 'organizationId')
      if (!Object.values(WORK_RECORD_TYPES).includes(kind)) throw Object.assign(new Error('Unsupported work-record type.'), { status: 400 })
      const table = kind === WORK_RECORD_TYPES.PROJECT_TASK ? 'tasks' : 'work_items'
      const record = await dataOrThrow(withSignal(
        client.from(table).select('*').eq('organization_id', organizationId).eq('id', recordId).maybeSingle(), signal
      ), 'Work record could not be loaded')
      if (!record) return null
      if (record.organization_id !== organizationId) throw Object.assign(new Error('The requested record is unavailable in the active organization.'), { status: 403, membershipMismatch: true })
      return kind === WORK_RECORD_TYPES.PROJECT_TASK
        ? projectTaskDetail(record, organizationId, signal)
        : engagementWorkItemDetail(record, organizationId, signal)
    },
  })
}

export const workItemExperience = createWorkItemExperienceRepository(supabase)
