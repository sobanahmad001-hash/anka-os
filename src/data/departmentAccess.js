export function createDepartmentAccessRepository(client) {
  return Object.freeze({
    async hasActiveMembership(organizationId, userId, departmentId, { signal } = {}) {
      if (!organizationId || !userId || !departmentId) return false
      signal?.throwIfAborted()
      let query = client.from('organization_department_memberships')
        .select('id').eq('organization_id', organizationId).eq('user_id', userId)
        .eq('department_id', departmentId).eq('status', 'active')
      if (signal) query = query.abortSignal(signal)
      const { data, error } = await query.maybeSingle()
      signal?.throwIfAborted()
      if (error) throw error
      return Boolean(data)
    },
  })
}

