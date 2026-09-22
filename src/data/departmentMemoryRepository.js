import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
const validDepartment = value => ['content', 'design', 'development', 'marketing'].includes(value)
const failure = (error, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : undefined,
})

export function createDepartmentMemoryRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async list(organizationId, departmentId) {
      if (!validId(organizationId) || !validDepartment(departmentId)) throw new TypeError('Valid department required')
      const { data, error } = await client.rpc('get_department_ai_memory', {
        p_organization_id: organizationId, p_department_id: departmentId,
      })
      if (error) throw failure(error, 'Unable to load department memory')
      if (data?.organization_id !== organizationId || data?.department_id !== departmentId
        || !Array.isArray(data.confirmed) || !Array.isArray(data.candidates)
        || [...data.confirmed, ...data.candidates].some(row =>
          !validId(row?.id) || !validId(row?.source_project_memory_id)
          || !validId(row?.source_comment_id) || !validId(row?.project_id)
          || typeof row?.generalized_statement !== 'string')) {
        throw Object.assign(new Error('Memory did not match the active department'), { status: 409 })
      }
      return data
    },
    async propose({ organizationId, projectId, departmentId, requestId, sourceMemoryId, statement, sanitizationNote }) {
      if (![organizationId, projectId, requestId, sourceMemoryId].every(validId)
        || !validDepartment(departmentId) || typeof statement !== 'string'
        || !statement.trim() || statement.trim().length > 1000
        || typeof sanitizationNote !== 'string'
        || sanitizationNote.trim().length < 20 || sanitizationNote.trim().length > 1000) {
        throw new TypeError('Valid sanitized department lesson required')
      }
      const { data, error } = await client.rpc('propose_department_ai_memory', {
        p_organization_id: organizationId, p_project_id: projectId,
        p_department_id: departmentId, p_request_id: requestId,
        p_source_project_memory_id: sourceMemoryId,
        p_statement: statement.trim(), p_sanitization_note: sanitizationNote.trim(),
      })
      if (error) throw failure(error, 'Unable to propose department method')
      if (data?.memory_id !== requestId
        || !['candidate', 'confirmed', 'rejected', 'retired'].includes(data.status)) {
        throw Object.assign(new Error('Department proposal receipt did not match'), { status: 409 })
      }
      return data
    },
    async review({ organizationId, departmentId, memoryId, requestId, decision, evidence }) {
      if (![organizationId, memoryId, requestId].every(validId)
        || !validDepartment(departmentId)
        || !['confirm', 'reject', 'retire'].includes(decision)
        || typeof evidence !== 'string' || !evidence.trim()
        || evidence.trim().length > 1000) throw new TypeError('Valid department decision required')
      const { data, error } = await client.rpc('review_department_ai_memory', {
        p_organization_id: organizationId, p_department_id: departmentId,
        p_memory_id: memoryId, p_request_id: requestId,
        p_decision: decision, p_evidence: evidence.trim(),
      })
      if (error) throw failure(error, 'Unable to review department method')
      if (data?.memory_id !== memoryId
        || data.status !== ({ confirm: 'confirmed', reject: 'rejected', retire: 'retired' })[decision]) {
        throw Object.assign(new Error('Department decision receipt did not match'), { status: 409 })
      }
      return data
    },
  }
}

export const departmentMemoryRepository = createDepartmentMemoryRepository(supabase)
