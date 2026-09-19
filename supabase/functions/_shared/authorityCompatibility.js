/** N1 is observational only. Never turn these records into permission booleans. */
export function validateAuthorityCompatibility(data, organizationId, expectedUserId = null) {
  if (!data || data.schema_version !== 1 || data.compatibility_only !== true ||
      data.organization_id !== organizationId || typeof data.user_id !== 'string' || !data.user_id ||
      typeof data.membership_id !== 'string' || !data.membership_id ||
      typeof data.legacy_role !== 'string' ||
      (expectedUserId && data.user_id !== expectedUserId)) {
    throw Object.assign(new Error('Authority compatibility response is unavailable or mismatched'), { status: 403 })
  }
  const keys = ['department_memberships', 'contributor_designations', 'project_manager_bindings']
  const records = {}
  for (const key of keys) {
    if (!Array.isArray(data[key]) || data[key].some(row => !row ||
        row.organization_id !== organizationId || row.user_id !== data.user_id ||
        !['active', 'revoked'].includes(row.status))) {
      throw Object.assign(new Error('Authority compatibility records are mismatched'), { status: 403 })
    }
    records[key] = data[key].map(row => ({ ...row }))
  }
  // Explicit projection: do not pass through any server-supplied can_* fields.
  return {
    schema_version: 1, compatibility_only: true,
    organization_id: organizationId, user_id: data.user_id, membership_id: data.membership_id,
    legacy_role: data.legacy_role, legacy_department_id: data.legacy_department_id ?? null,
    ...records,
  }
}

/**
 * Opt-in reader. Missing migration, revoked access and network errors propagate;
 * there is intentionally no authority fallback to role titles or department_id.
 * @param {{rpc: Function}} client
 * @param {string} organizationId
 * @param {{signal?: AbortSignal, expectedUserId?: string}} options
 */
export async function readAuthorityCompatibility(client, organizationId, options = {}) {
  if (!organizationId || !client?.rpc) throw new TypeError('Organization and RPC client are required')
  options.signal?.throwIfAborted()
  let query = client.rpc('get_my_authority_compatibility', { p_organization_id: organizationId })
  if (options.signal && typeof query.abortSignal === 'function') query = query.abortSignal(options.signal)
  const { data, error } = await query
  options.signal?.throwIfAborted()
  if (error) throw error
  return validateAuthorityCompatibility(data, organizationId, options.expectedUserId)
}
