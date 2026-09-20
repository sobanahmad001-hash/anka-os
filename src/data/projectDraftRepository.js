import { supabase } from '../lib/supabase.js'

const TYPES = new Set(['internal', 'project', 'retainer'])
const required = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' is required')
  return value.trim()
}
const errorFrom = (error, status, fallback) => Object.assign(
  new Error(error?.message || fallback),
  { cause: error, status: error?.code === '42501' ? 403 : error?.code === '40001' ? 409 : status || undefined },
)
const validId = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export function normalizeProjectDraft(input) {
  const organizationId = required(input?.organizationId, 'Organization')
  const requestId = required(input?.requestId, 'Request ID')
  const name = required(input?.name, 'Project name')
  const engagementType = required(input?.engagementType, 'Work type')
  if (!validId(requestId) || name.length > 240 || !TYPES.has(engagementType)) throw new TypeError('Valid draft-project inputs required')
  const clientId = input.clientId || null
  const brandId = input.brandId || null
  if (engagementType === 'internal' ? clientId || brandId : !clientId || !brandId) {
    throw new TypeError('Internal Work has no client; client work requires a client and brand')
  }
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw new TypeError('Due date must follow start date')
  return {
    organizationId, requestId, name, engagementType, clientId, brandId,
    managerId: input.managerId || null,
    description: String(input.description || '').trim(),
    startDate: input.startDate || null, dueDate: input.dueDate || null,
    scope: String(input.scope || '').trim(),
    exclusions: String(input.exclusions || '').trim(),
  }
}

export function createProjectDraftRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async options(organizationId, { signal } = {}) {
      required(organizationId, 'Organization')
      let query = client.rpc('get_project_draft_options', { p_organization_id: organizationId })
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error, status } = await query
      if (error) throw errorFrom(error, status, 'Unable to load draft-project options')
      if (data?.organization_id !== organizationId || !Array.isArray(data.members) || !Array.isArray(data.clients)
        || data.clients.some(row => !row?.id || !Array.isArray(row.brands))) {
        throw Object.assign(new Error('Draft-project options did not match the active organization'), { status: 409 })
      }
      return data
    },
    async create(input) {
      const value = normalizeProjectDraft(input)
      const { data, error, status } = await client.rpc('create_draft_project', {
        p_organization_id: value.organizationId, p_request_id: value.requestId,
        p_name: value.name, p_description: value.description,
        p_engagement_type: value.engagementType, p_client_id: value.clientId,
        p_brand_id: value.brandId, p_manager_id: value.managerId,
        p_start_date: value.startDate, p_due_date: value.dueDate,
        p_scope_statement: value.scope, p_exclusions: value.exclusions,
      })
      if (error) throw errorFrom(error, status, 'Unable to save draft project')
      if (data?.organization_id !== value.organizationId || data.request_id !== value.requestId
        || data.status !== 'planning' || !validId(data.project_id)
        || (value.engagementType === 'internal' ? data.engagement_id !== null : !validId(data.engagement_id))) {
        throw Object.assign(new Error('Draft-project result did not match the submitted request'), { status: 409 })
      }
      return data
    },
    async hasOwnManagerBinding(organizationId, projectId, userId, { signal } = {}) {
      required(organizationId, 'Organization')
      required(projectId, 'Project')
      required(userId, 'User')
      let query = client.from('project_manager_bindings').select('id, organization_id, project_id, user_id')
        .eq('organization_id', organizationId).eq('project_id', projectId).eq('user_id', userId)
        .eq('status', 'active').limit(1)
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error, status } = await query
      if (error) throw errorFrom(error, status, 'Unable to verify project-manager binding')
      if (data?.some(row => row.organization_id !== organizationId || row.project_id !== projectId || row.user_id !== userId)) {
        throw Object.assign(new Error('Manager binding did not match the selected project'), { status: 403 })
      }
      return Boolean(data?.length)
    },
    async activate({ organizationId, projectId, requestId }) {
      required(organizationId, 'Organization')
      required(projectId, 'Project')
      if (!validId(requestId)) throw new TypeError('Valid activation request ID required')
      const { data, error, status } = await client.rpc('activate_draft_project', {
        p_organization_id: organizationId, p_project_id: projectId, p_request_id: requestId,
      })
      if (error) throw errorFrom(error, status, 'Unable to activate project')
      if (data?.organization_id !== organizationId || data.project_id !== projectId
        || data.request_id !== requestId || data.status !== 'active') {
        throw Object.assign(new Error('Activation result did not match the selected project'), { status: 409 })
      }
      return data
    },
  }
}

export const projectDraftRepository = createProjectDraftRepository(supabase)
