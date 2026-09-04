import { supabase } from '../lib/supabase.js'

export const INTERNAL_WORK_DEPARTMENTS = Object.freeze(['content', 'design', 'development', 'marketing'])

const PAGE_SIZE = 500
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

async function collectPages(factory, { signal, validate, label, key = (row) => row.id }) {
  const rowsByKey = new Map()
  for (let offset = 0; offset < PAGE_SIZE * 10000; offset += PAGE_SIZE) {
    if (signal?.aborted) throw Object.assign(new Error(`${label} request aborted`), { name: 'AbortError' })
    const { data, error, status } = await factory(offset, offset + PAGE_SIZE - 1)
    if (error) throw requestError({ ...error, status }, `Unable to load ${label}.`)
    const rows = data || []
    for (const row of rows) {
      const id = key(row)
      if (!id || !validate(row)) throw Object.assign(new Error(`${label} returned data outside the active organization.`), { status: 403, membershipMismatch: true })
      const prior = rowsByKey.get(id)
      if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw Object.assign(new Error(`${label} changed while loading.`), { status: 409 })
      rowsByKey.set(id, row)
    }
    if (rows.length < PAGE_SIZE) return [...rowsByKey.values()]
  }
  throw Object.assign(new Error(`${label} exceeded the safe pagination limit.`), { status: 409 })
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
      const memberships = await collectPages((from, to) => withSignal(
        client.from('organization_memberships')
          .select('organization_id, user_id, role, department_id, member_kind, status')
          .eq('organization_id', organizationId).eq('member_kind', 'team').eq('status', 'active')
          .order('user_id').range(from, to), signal
      ), { signal, label: 'Internal Work setup memberships', key: (row) => row.user_id, validate: (row) => row.organization_id === organizationId && row.member_kind === 'team' && row.status === 'active' })
      const memberIds = memberships.map((row) => row.user_id).sort()
      const profiles = memberIds.length ? await collectPages((from, to) => withSignal(
        client.from('profiles').select('id, full_name, email').in('id', memberIds).order('id').range(from, to), signal
      ), { signal, label: 'Internal Work setup profiles', validate: (row) => memberIds.includes(row.id) }) : []
      const departments = await collectPages((from, to) => withSignal(
        client.from('departments').select('id, organization_id, name').eq('organization_id', organizationId).order('id').range(from, to), signal
      ), { signal, label: 'Internal Work setup departments', validate: (row) => row.organization_id === organizationId && INTERNAL_WORK_DEPARTMENTS.includes(row.id) })
      const names = new Map(profiles.map((row) => [row.id, row.full_name || row.email]))
      return {
        members: memberships.map((row) => ({ id: row.user_id, name: names.get(row.user_id) || 'Team member', role: row.role, departmentId: row.department_id })),
        departments,
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
