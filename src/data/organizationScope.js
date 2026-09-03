export const ACTIVE_ORGANIZATION_STORAGE_PREFIX = 'anka:active-organization'

function required(value, label) {
  if (!value) throw new TypeError(label + ' is required')
  return value
}

function related(value) {
  return Array.isArray(value) ? value[0] || null : value || null
}

export function organizationStorageKey(userId) {
  return ACTIVE_ORGANIZATION_STORAGE_PREFIX + ':' + required(userId, 'userId')
}

export function normalizeOrganizationMemberships(rows = []) {
  const seen = new Set()
  return rows.flatMap((row) => {
    const organization = related(row.organization)
    if (row.member_kind !== 'team' || row.status !== 'active' || organization?.status !== 'active' ||
        organization?.id !== row.organization_id || seen.has(row.organization_id)) return []
    seen.add(row.organization_id)
    return [{ id: row.id, organizationId: row.organization_id, role: row.role, departmentId: row.department_id, organization }]
  }).sort((a, b) => a.organization.name.localeCompare(b.organization.name) || a.organizationId.localeCompare(b.organizationId))
}

export function resolveOrganizationSelection({ memberships = [], storedOrganizationId = null } = {}) {
  if (!memberships.length) return { activeOrganizationId: null, selectionRequired: false, staleSelection: Boolean(storedOrganizationId) }
  if (memberships.some(item => item.organizationId === storedOrganizationId)) {
    return { activeOrganizationId: storedOrganizationId, selectionRequired: false, staleSelection: false }
  }
  if (memberships.length === 1) {
    return { activeOrganizationId: memberships[0].organizationId, selectionRequired: false, staleSelection: Boolean(storedOrganizationId) }
  }
  return { activeOrganizationId: null, selectionRequired: true, staleSelection: Boolean(storedOrganizationId) }
}

export function createOrganizationSelectionStorage(storage) {
  return Object.freeze({
    read(userId) { try { return storage?.getItem(organizationStorageKey(userId)) || null } catch { return null } },
    write(userId, organizationId) { try { storage?.setItem(organizationStorageKey(userId), required(organizationId, 'organizationId')) } catch { /* optional persistence */ } },
    clear(userId) { if (userId) try { storage?.removeItem(organizationStorageKey(userId)) } catch { /* optional persistence */ } },
  })
}

export function createLatestRequestGuard() {
  let generation = 0
  return Object.freeze({
    begin() { generation += 1; return generation },
    isCurrent(value) { return value === generation },
    invalidate() { generation += 1 },
  })
}

export function isOrganizationAccessError(error) {
  const status = Number(error?.status || error?.statusCode)
  return status === 401 || status === 403
}

export function createOrganizationScopeRepository(client) {
  if (!client?.from) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    async listActiveTeamMemberships(userId, { signal } = {}) {
      required(userId, 'userId')
      let query = client.from('organization_memberships')
        .select('id, organization_id, role, department_id, member_kind, status, organization:organizations!inner(id, name, slug, status)')
        .eq('user_id', userId)
        .eq('member_kind', 'team')
        .eq('status', 'active')
        .eq('organization.status', 'active')
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error } = await query
      if (error) throw error
      return normalizeOrganizationMemberships(data || [])
    },
  })
}
