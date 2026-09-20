import { supabase } from '../lib/supabase.js'

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const actions = new Set(['add', 'activate', 'pause', 'resume', 'complete', 'cancel'])
const failure = (error, status) => Object.assign(new Error(error?.message || 'Unable to change service scope'),
  { cause: error, status: error?.code === '42501' ? 403 : error?.code === '40001' ? 409 : status || undefined })

export function createProjectServiceScopeRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async snapshot(organizationId, projectId, { signal } = {}) {
      if (!uuid(organizationId) || !uuid(projectId)) throw new TypeError('Valid project scope IDs required')
      let query = client.rpc('get_project_service_scope', { p_organization_id: organizationId, p_project_id: projectId })
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error, status } = await query
      if (error) throw failure(error, status)
      if (data?.organization_id !== organizationId || data.project_id !== projectId
        || !Array.isArray(data.catalog) || !Array.isArray(data.members) || !Array.isArray(data.scopes)
        || !data.impact || data.impact.exact_service_linkage_known !== false
        || data.scopes.some(row => !uuid(row.id) || !uuid(row.service_id) || !Number.isInteger(row.revision)
          || typeof row.impact_token !== 'string')) {
        throw Object.assign(new Error('Service scope did not match the active project'), { status: 409 })
      }
      return data
    },
    async change(input) {
      const { organizationId, projectId, requestId, action } = input || {}
      if (![organizationId, projectId, requestId].every(uuid) || !actions.has(action)) {
        throw new TypeError('Valid service-scope command required')
      }
      if (action === 'add' ? !uuid(input.serviceId) || !Number.isInteger(input.quantity) || input.quantity < 1
        : !uuid(input.scopeId) || !Number.isInteger(input.expectedRevision)) {
        throw new TypeError('Valid service selection or revision required')
      }
      if (['pause', 'complete', 'cancel'].includes(action) && (!input.impactAcknowledged || !input.impactToken)) {
        throw new TypeError('Review and acknowledge the current project-wide impact first')
      }
      const { data, error, status } = await client.rpc('change_project_service_scope', {
        p_organization_id: organizationId, p_project_id: projectId, p_request_id: requestId,
        p_action: action, p_scope_id: input.scopeId || null, p_service_id: input.serviceId || null,
        p_scope_statement: input.scopeStatement || '', p_exclusions: input.exclusions || '',
        p_quantity: input.quantity || 1, p_owner_id: input.ownerId || null,
        p_start_date: input.startDate || null, p_target_date: input.targetDate || null,
        p_expected_revision: input.expectedRevision ?? null,
        p_impact_token: input.impactToken || null, p_impact_acknowledged: Boolean(input.impactAcknowledged),
      })
      if (error) throw failure(error, status)
      if (data?.organization_id !== organizationId || data.project_id !== projectId
        || data.request_id !== requestId || !uuid(data.scope_id) || !Number.isInteger(data.revision)) {
        throw Object.assign(new Error('Service-scope result did not match the selected project'), { status: 409 })
      }
      return data
    },
  }
}

export const projectServiceScopeRepository = createProjectServiceScopeRepository(supabase)
