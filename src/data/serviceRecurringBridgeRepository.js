const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id = value => { if (!UUID.test(value || '')) throw new TypeError('Exact saved scope and request UUIDs required'); return value }
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
const scopeArgs = scope => ({ p_organization_id: id(scope.organizationId), p_project_id: id(scope.projectId), p_engagement_id: id(scope.engagementId) })

export function createServiceRecurringBridgeRepository(client) {
  if (!client?.rpc || !client?.auth?.getUser) throw new TypeError('Authenticated Supabase client required')
  async function actor(scope) {
    const { data, error } = await client.auth.getUser()
    if (error || !scope.actorId || data?.user?.id !== scope.actorId) throw new Error('Return to the original account and project before continuing this recurring plan')
  }
  async function rpc(name, args, signal) {
    let query = client.rpc(name, args)
    if (signal && query.abortSignal) query = query.abortSignal(signal)
    const { data, error } = await query
    if (error) throw Object.assign(new Error(error.message || 'Recurring plan request failed'), { code: error.code, knownRollback: ['22023', '42501', '40001', '55000', '23505'].includes(error.code) })
    return data
  }
  return Object.freeze({
    async context(scope, scopeId, { planId = null, signal } = {}) {
      const originalScope = freeze(structuredClone(scope))
      const args = { ...scopeArgs(originalScope), p_scope_id: id(scopeId), p_plan_id: planId === null ? null : id(planId) }
      await actor(originalScope)
      return rpc('get_service_recurring_plan_context', args, signal)
    },
    async review(scope, scopeId, proposal, { planId = null, signal } = {}) {
      if (!proposal || !Object.hasOwn(proposal, 'scheduler')) throw new TypeError('Review the explicit scheduler choice before saving')
      const originalScope = freeze(structuredClone(scope))
      const draft = freeze({ ...scopeArgs(originalScope), p_scope_id: id(scopeId), p_plan_id: planId === null ? null : id(planId), p_proposal: structuredClone(proposal) })
      await actor(originalScope)
      const review = await rpc('review_service_recurring_plan', structuredClone(draft), signal)
      return freeze({ scope: originalScope, draft, review: structuredClone(review) })
    },
    async apply(reviewed, requestId) {
      const request = id(requestId)
      if (!reviewed?.review?.can_apply || !/^[a-f0-9]{64}$/.test(reviewed.review.review_sha256 || '')) throw new TypeError('Resolve blockers and review the exact recurring plan first')
      await actor(reviewed.scope)
      return rpc('apply_service_recurring_plan', { ...structuredClone(reviewed.draft), p_review_sha256: reviewed.review.review_sha256, p_request_id: request })
    },
    async recover(scope, requestId) {
      const originalScope = freeze(structuredClone(scope))
      const args = { ...scopeArgs(originalScope), p_request_id: id(requestId) }
      await actor(originalScope)
      return rpc('recover_service_recurring_plan', args)
    },
  })
}
