function requiredId(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(`${label} must be a UUID`)
  }
  return value
}

async function dataOrThrow(query, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Pipeline run request failed')
  return data
}

export function createPipelineRunIntentsRepository(supabase) {
  if (!supabase?.from || !supabase?.rpc) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    async list(organizationId, engagementId, { signal } = {}) {
      const organization = requiredId(organizationId, 'Organization')
      const rows = await dataOrThrow(supabase.from('pipeline_run_intents')
        .select('id, request_id, status, input_sha256, input_manifest, requested_at, requested_by')
        .eq('organization_id', organization)
        .eq('engagement_id', requiredId(engagementId, 'Engagement'))
        .order('requested_at', { ascending: false }).limit(20), signal)
      if (!rows?.length) return []
      const ids = rows.map(row => row.id)
      const [reviews, plans, jobs] = await Promise.all([
        dataOrThrow(supabase.from('pipeline_run_intent_reviews')
          .select('id, run_intent_id, decision, reason, reviewed_by, reviewed_at')
          .eq('organization_id', organization).in('run_intent_id', ids), signal),
        dataOrThrow(supabase.from('pipeline_run_plans')
          .select('id, run_intent_id, work_manifest, work_sha256, planned_at, planned_by')
          .eq('organization_id', organization).in('run_intent_id', ids), signal),
        dataOrThrow(supabase.from('ai_execution_jobs')
          .select('id, run_intent_id, run_plan_id, status, blocked_reason, input_sha256, created_at, steps:ai_execution_job_steps(id, ordinal, work_item_id, department_id, status, input_sha256)')
          .eq('organization_id', organization).in('run_intent_id', ids), signal),
      ])
      const reviewByIntent = new Map((reviews || []).map(review => [review.run_intent_id, review]))
      const planByIntent = new Map((plans || []).map(plan => [plan.run_intent_id, plan]))
      const jobByIntent = new Map((jobs || []).map(job => [job.run_intent_id, job]))
      return rows.map(row => ({
        ...row, review: reviewByIntent.get(row.id) || null,
        plan: planByIntent.get(row.id) || null,
        job: jobByIntent.get(row.id) || null,
      }))
    },
    start({ organizationId, engagementId, requestId, assetIds = [] }, { signal } = {}) {
      if (!Array.isArray(assetIds) || assetIds.length > 20 || new Set(assetIds).size !== assetIds.length) {
        throw new TypeError('Choose at most 20 unique assets')
      }
      return dataOrThrow(supabase.rpc('start_pipeline_run_intent', {
        p_organization_id: requiredId(organizationId, 'Organization'),
        p_engagement_id: requiredId(engagementId, 'Engagement'),
        p_request_id: requiredId(requestId, 'Request'),
        p_asset_ids: assetIds.map(id => requiredId(id, 'Asset')),
      }), signal)
    },
    review({ organizationId, runIntentId, requestId, decision, reason = '' }, { signal } = {}) {
      if (!['accepted_for_planning', 'rejected'].includes(decision)) {
        throw new TypeError('A valid review decision is required')
      }
      const normalizedReason = String(reason).trim()
      if (normalizedReason.length > 1000 || (decision === 'rejected' && !normalizedReason)) {
        throw new TypeError('A rejection reason of at most 1000 characters is required')
      }
      return dataOrThrow(supabase.rpc('review_pipeline_run_intent', {
        p_organization_id: requiredId(organizationId, 'Organization'),
        p_run_intent_id: requiredId(runIntentId, 'Run request'),
        p_request_id: requiredId(requestId, 'Request'),
        p_decision: decision,
        p_reason: normalizedReason,
      }), signal)
    },
    plan({ organizationId, runIntentId, requestId, workItemIds }, { signal } = {}) {
      if (!Array.isArray(workItemIds) || workItemIds.length < 1 || workItemIds.length > 50
        || new Set(workItemIds).size !== workItemIds.length) {
        throw new TypeError('Choose 1 to 50 unique work items')
      }
      return dataOrThrow(supabase.rpc('plan_manual_pipeline_run', {
        p_organization_id: requiredId(organizationId, 'Organization'),
        p_run_intent_id: requiredId(runIntentId, 'Run request'),
        p_request_id: requiredId(requestId, 'Request'),
        p_work_item_ids: workItemIds.map(id => requiredId(id, 'Work item')),
      }), signal)
    },
  })
}
