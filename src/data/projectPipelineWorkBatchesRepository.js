const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id = value => { if (!UUID.test(value || '')) throw new TypeError('Exact scope and request UUIDs required'); return value }
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
const scopeArgs = scope => ({ p_organization_id: id(scope.organizationId), p_project_id: id(scope.projectId), p_engagement_id: id(scope.engagementId) })
export function createProjectPipelineWorkBatchesRepository(client) {
  if (!client?.rpc || !client?.auth?.getUser) throw new TypeError('Authenticated Supabase client required')
  async function actor(scope) {
    const { data, error } = await client.auth.getUser()
    if (error || !scope.actorId || data?.user?.id !== scope.actorId) throw new Error('Return to the original account and project before continuing this batch')
  }
  async function rpc(name, args, signal) {
    let query = client.rpc(name, args)
    if (signal && query.abortSignal) query = query.abortSignal(signal)
    const { data, error } = await query
    if (error) throw Object.assign(new Error(error.message || 'Work batch request failed'), { code: error.code, knownRollback: ['22023', '42501', '40001', '55000'].includes(error.code) })
    return data
  }
  return Object.freeze({
    async context(scope, configurationId, partition, { workItemIds = [], signal } = {}) {
      const args = { ...scopeArgs(scope), p_configuration_id: id(configurationId), p_partition: structuredClone(partition), p_work_item_ids: workItemIds.map(id) }
      if (workItemIds.length > 100) throw new TypeError('Choose at most 100 exact existing Work cards')
      await actor(scope)
      return rpc('get_project_pipeline_work_batch_context', args, signal)
    },
    async review(scope, configurationId, partition, proposal, { signal } = {}) {
      const draft = freeze({ ...scopeArgs(scope), p_configuration_id: id(configurationId), p_partition: structuredClone(partition), p_proposal: structuredClone(proposal) })
      const originalScope = freeze(structuredClone(scope))
      await actor(originalScope)
      const review = await rpc('review_project_pipeline_work_batch', structuredClone(draft), signal)
      return freeze({ scope: originalScope, draft, review: structuredClone(review) })
    },
    async apply(reviewed, requestId) {
      const request = id(requestId)
      if (!reviewed?.review?.can_apply || !/^[a-f0-9]{64}$/.test(reviewed.review.review_sha256 || '')) throw new TypeError('Resolve blockers and review the exact Work batch first')
      await actor(reviewed.scope)
      // No fallback, retry or source adoption. Keep this request for read-only recovery.
      return rpc('apply_project_pipeline_work_batch', { ...structuredClone(reviewed.draft), p_review_sha256: reviewed.review.review_sha256, p_request_id: request })
    },
    async recover(scope, requestId) {
      const args = { ...scopeArgs(scope), p_request_id: id(requestId) }
      await actor(scope)
      return rpc('recover_project_pipeline_work_batch', args)
    },
  })
}
