import { supabase } from '../lib/supabase.js'
import { normalizeProjectDraft } from './projectDraftRepository.js'

const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const failure = (error, status, fallback) => Object.assign(new Error(error?.message || fallback),
  { cause: error, status: error?.code === '42501' ? 403 : status || undefined })

export function createProjectRequestRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async snapshot(organizationId, { signal } = {}) {
      if (!uuid(organizationId)) throw new TypeError('Valid organization ID required')
      let query = client.rpc('get_project_requests', { p_organization_id: organizationId })
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error, status } = await query
      if (error) throw failure(error, status, 'Unable to load project requests')
      if (data?.organization_id !== organizationId || !Array.isArray(data.requests) || !Array.isArray(data.clients)
        || data.requests.some(row => !uuid(row?.request_id) || !uuid(row?.requester_id)
          || !['pending', 'converted'].includes(row.status) || !row.payload)
        || data.clients.some(row => !uuid(row?.id) || !Array.isArray(row.brands))) {
        throw Object.assign(new Error('Project request response did not match the active organization'), { status: 409 })
      }
      return data
    },
    async submit(input) {
      const value = normalizeProjectDraft(input)
      const { data, error, status } = await client.rpc('submit_project_request', {
        p_organization_id: value.organizationId, p_request_id: value.requestId,
        p_name: value.name, p_description: value.description, p_engagement_type: value.engagementType,
        p_client_id: value.clientId, p_brand_id: value.brandId,
        p_start_date: value.startDate, p_due_date: value.dueDate,
      })
      if (error) throw failure(error, status, 'Unable to submit project request')
      if (data?.organization_id !== value.organizationId || data.request_id !== value.requestId
        || !['pending', 'converted'].includes(data.status)) {
        throw Object.assign(new Error('Project request result did not match the submitted request'), { status: 409 })
      }
      return data
    },
    async convert({ organizationId, sourceRequestId, requestId }) {
      if (![organizationId, sourceRequestId, requestId].every(uuid)) throw new TypeError('Valid conversion IDs required')
      const { data, error, status } = await client.rpc('convert_project_request', {
        p_organization_id: organizationId, p_source_request_id: sourceRequestId,
        p_request_id: requestId, p_manager_id: null,
      })
      if (error) throw failure(error, status, 'Unable to create draft from project request')
      if (data?.organization_id !== organizationId || data.source_request_id !== sourceRequestId
        || data.status !== 'converted' || !uuid(data.project_id)) {
        throw Object.assign(new Error('Converted project did not match the selected request'), { status: 409 })
      }
      return data
    },
  }
}

export const projectRequestRepository = createProjectRequestRepository(supabase)
