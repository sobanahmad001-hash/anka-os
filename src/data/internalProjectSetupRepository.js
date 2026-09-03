import { supabase } from '../lib/supabase.js'

export const INTERNAL_WORK_DEPARTMENTS = Object.freeze(['content', 'design', 'development', 'marketing'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`)
  return value.trim()
}

function requestError(error, fallback) {
  const code = error?.code || error?.cause?.code
  const status = code === '42501' ? 403 : code === '40001' ? 409 : Number(error?.status || error?.statusCode) || undefined
  return Object.assign(new Error(error?.message || fallback), { cause: error, code, status, membershipMismatch: status === 403 })
}

function withSignal(query, signal) {
  return signal && typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query
}

export function normalizeInternalProjectSetup(input) {
  const organizationId = required(input?.organizationId, 'organizationId')
  const requestId = required(input?.requestId, 'requestId')
  const ownerId = required(input?.ownerId, 'ownerId')
  const name = required(input?.name, 'Project name')
  if (!UUID.test(requestId)) throw new TypeError('A valid setup request ID is required')
  if (!Array.isArray(input?.workstreams) || input.workstreams.length === 0) throw new TypeError('Select at least one initial workstream')
  const seen = new Set()
  const workstreams = input.workstreams.map((item) => {
    const departmentId = required(item?.departmentId, 'Workstream department')
    const workstreamOwnerId = required(item?.ownerId, 'Workstream owner')
    if (!INTERNAL_WORK_DEPARTMENTS.includes(departmentId)) throw new TypeError(`Unsupported workstream department: ${departmentId}`)
    if (seen.has(departmentId)) throw new TypeError(`Duplicate workstream department: ${departmentId}`)
    seen.add(departmentId)
    return { department_id: departmentId, owner_id: workstreamOwnerId }
  }).sort((left, right) => left.department_id.localeCompare(right.department_id))
  return Object.freeze({
    organizationId,
    requestId,
    name,
    description: String(input.description || '').trim(),
    ownerId,
    startDate: input.startDate || null,
    dueDate: input.dueDate || null,
    scope: String(input.scope || '').trim(),
    exclusions: String(input.exclusions || '').trim(),
    workstreams,
  })
}

export function createInternalProjectSetupRepository(client) {
  if (!client?.from || !client?.rpc) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    async getOptions(organizationId, { signal } = {}) {
      required(organizationId, 'organizationId')
      const query = withSignal(client.rpc('get_internal_project_setup_options', {
        p_organization_id: organizationId,
      }), signal)
      const { data, error, status } = await query
      if (error) throw requestError({ ...error, status }, 'Unable to load Internal Work setup options.')
      if (!Array.isArray(data?.members) || !Array.isArray(data?.departments)) {
        throw Object.assign(new Error('Internal Work setup options returned an invalid result.'), { status: 409 })
      }
      const memberIds = new Set()
      for (const member of data.members) {
        if (!member?.id || memberIds.has(member.id)) throw Object.assign(new Error('Internal Work setup options returned duplicate or invalid members.'), { status: 409 })
        memberIds.add(member.id)
      }
      const departmentIds = new Set()
      for (const department of data.departments) {
        if (!department?.id || department.organization_id !== organizationId
          || !INTERNAL_WORK_DEPARTMENTS.includes(department.id) || departmentIds.has(department.id)) {
          throw Object.assign(new Error('Internal Work setup options returned data outside the active organization.'), { status: 403, membershipMismatch: true })
        }
        departmentIds.add(department.id)
      }
      return {
        members: data.members.map((row) => ({
          id: row.id,
          name: row.name || 'Team member',
          role: row.role,
          departmentId: row.department_id,
        })),
        departments: data.departments,
      }
    },

    async create(input, { signal } = {}) {
      const value = normalizeInternalProjectSetup(input)
      let query = client.rpc('create_internal_project_setup', {
        p_organization_id: value.organizationId,
        p_request_id: value.requestId,
        p_name: value.name,
        p_description: value.description,
        p_owner_id: value.ownerId,
        p_start_date: value.startDate,
        p_due_date: value.dueDate,
        p_scope_statement: value.scope,
        p_exclusions: value.exclusions,
        p_workstreams: value.workstreams,
      })
      query = withSignal(query, signal)
      const { data, error, status } = await query
      if (error) throw requestError({ ...error, status }, 'Unable to create Internal Work.')
      if (!data?.project_id || !Array.isArray(data.workstreams)) throw Object.assign(new Error('Internal Work setup returned an invalid result.'), { status: 409 })
      return data
    },
  })
}

export const internalProjectSetup = createInternalProjectSetupRepository(supabase)
