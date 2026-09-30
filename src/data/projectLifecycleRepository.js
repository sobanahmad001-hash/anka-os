import { supabase } from '../lib/supabase.js'

const rollbackCodes = new Set([
  '25001', '40001', '40P01', // Isolation refusal, serialization failure, deadlock.
  '22000', '22001', '22003', '22004', '22007', '22008', '22012', '22023', '22P02', // Data errors.
  '23000', '23001', '23502', '23503', '23505', '23514', '23P01', // Constraint errors.
  '28000', '28P01', '42501', // Authorization errors.
  '55P03', '57014', // Lock unavailable (including lock timeout), explicit query cancellation.
])

export function isProjectLifecycleRollbackError(error) {
  // Unknown outcomes (including 40003 and transport failures) must retain the receipt identity.
  return rollbackCodes.has(error?.cause?.code ?? error?.code)
}

const validId = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
// Catalog names may be quoted identifiers, including spaces, punctuation and Unicode.
const validIdentifier = value => typeof value === 'string' && value.length > 0
  && !value.includes('\0') && new TextEncoder().encode(value).length <= 63
const mismatch = () => { throw Object.assign(new Error('Lifecycle response did not match the selected scope'), { status: 409 }) }

export function createProjectLifecycleRepository(client) {
  async function rpc(name, organizationId, projectId, args = {}, signal) {
    if (!validId(organizationId) || (projectId !== null && !validId(projectId))) throw new TypeError('Valid project scope required')
    signal?.throwIfAborted()
    let query = client.rpc(name, { p_organization_id: organizationId, ...(projectId ? { p_project_id: projectId } : {}), ...args })
    if (signal && query.abortSignal) query = query.abortSignal(signal)
    const { data, error } = await query
    if (error) throw Object.assign(new Error(error.message || 'Project lifecycle request failed'), {
      cause: error, status: error.code === '42501' ? 403 : error.code === '40001' ? 409 : undefined,
    })
    if (data?.organization_id !== organizationId || (projectId && data.project_id !== projectId)) mismatch()
    return data
  }
  return {
    async list(organizationId, archived, { signal } = {}) {
      if (typeof archived !== 'boolean') throw new TypeError('Archived filter required')
      const data = await rpc('list_project_lifecycle', organizationId, null, { p_archived: archived }, signal)
      if (!Array.isArray(data.projects) || data.projects.some(p => !validId(p?.id) || typeof p.name !== 'string'
        || (archived ? !validDate(p.archived_at) : p.archived_at !== null || p.status !== 'planning'))) mismatch()
      return data.projects
    },
    async setArchived({ organizationId, projectId, archived, requestId }) {
      if (typeof archived !== 'boolean' || !validId(requestId)) throw new TypeError('Valid lifecycle command required')
      const data = await rpc('set_project_archived', organizationId, projectId, { p_archived: archived, p_request_id: requestId })
      if (data.request_id !== requestId || typeof data.status !== 'string'
        || (archived ? !validDate(data.archived_at) : data.archived_at !== null)) mismatch()
      return data
    },
    async preview(organizationId, projectId, { signal } = {}) {
      const data = await rpc('preview_project_deletion', organizationId, projectId, {}, signal)
      if (typeof data.project_name !== 'string' || typeof data.eligible !== 'boolean'
        || !Array.isArray(data.dependencies) || data.dependencies.some(row => !validIdentifier(row?.schema)
          || !validIdentifier(row.table) || !Number.isSafeInteger(row.count) || row.count < 0)
        || (data.eligible && (!validId(data.preview_id) || !validDate(data.expires_at)
          || data.dependencies.some(row => row.count !== 0)))) mismatch()
      return data
    },
    async deleteEmpty({ organizationId, projectId, preview, confirmation, requestId }) {
      if (!validId(requestId) || !preview?.eligible || !validId(preview.preview_id)
        || preview.organization_id !== organizationId || preview.project_id !== projectId
        || typeof confirmation !== 'string' || confirmation !== preview.project_name) {
        throw new TypeError('Reviewed preview and exact project name required')
      }
      // The server checks expiry on first execution. Expired successful requests may still replay.
      const data = await rpc('delete_empty_project', organizationId, projectId, {
        p_preview_id: preview.preview_id, p_confirmation: confirmation, p_request_id: requestId,
      })
      if (data.request_id !== requestId || data.deleted !== true) mismatch()
      return data
    },
  }
}
export const projectLifecycleRepository = createProjectLifecycleRepository(supabase)
