import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const failure = (error, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : undefined,
})

export function createProjectHandoffRepository(client) {
  if (!client?.from || !client?.rpc) throw new TypeError('Supabase client required')
  return {
    async list(organizationId, projectId, { signal } = {}) {
      if (!validId(organizationId) || !validId(projectId)) throw new TypeError('Valid project required')
      let query = client.from('requests').select('id,organization_id,project_id,requesting_workstream_id,receiving_workstream_id,title,requested_output,acceptance_criteria,priority,status,requested_by,required_by,source_project_comment_id,created_at')
        .eq('organization_id', organizationId).eq('project_id', projectId)
        .eq('request_type', 'internal_handoff').eq('request_origin', 'team').eq('visibility', 'internal_only')
        .is('archived_at', null).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100)
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error } = await query
      if (error) throw failure(error, 'Unable to load project handoffs')
      if (!Array.isArray(data) || data.some(item => item.organization_id !== organizationId
        || item.project_id !== projectId || !validId(item.id)
        || (item.receiving_workstream_id && !validId(item.receiving_workstream_id)))) {
        throw Object.assign(new Error('Handoffs did not match the active project'), { status: 409 })
      }
      return data
    },
    async create(input) {
      const { organizationId, projectId, requestId, sourceCommentId = null,
        requestingWorkstreamId = null, receivingWorkstreamId, title, requestedOutput,
        acceptanceCriteria = '', priority = 'medium', requiredBy = null } = input
      if (![organizationId, projectId, requestId, sourceCommentId, receivingWorkstreamId].every(validId)
        || (requestingWorkstreamId && !validId(requestingWorkstreamId))
        || requestingWorkstreamId === receivingWorkstreamId
        || !title?.trim() || !requestedOutput?.trim()
        || !['low', 'medium', 'high', 'urgent'].includes(priority)) {
        throw new TypeError('Complete project handoff required')
      }
      const { data, error } = await client.rpc('create_project_handoff_request', {
        p_organization_id: organizationId, p_project_id: projectId, p_request_id: requestId,
        p_source_comment_id: sourceCommentId, p_requesting_workstream_id: requestingWorkstreamId,
        p_receiving_workstream_id: receivingWorkstreamId, p_title: title.trim(),
        p_requested_output: requestedOutput.trim(), p_acceptance_criteria: acceptanceCriteria.trim(),
        p_priority: priority, p_required_by: requiredBy || null,
      })
      if (error) throw failure(error, 'Unable to create handoff')
      if (data?.id !== requestId || data.organization_id !== organizationId || data.project_id !== projectId
        || data.receiving_workstream_id !== receivingWorkstreamId || data.request_type !== 'internal_handoff') {
        throw Object.assign(new Error('Handoff did not match the selected project'), { status: 409 })
      }
      return data
    },
  }
}

export const projectHandoffRepository = createProjectHandoffRepository(supabase)
