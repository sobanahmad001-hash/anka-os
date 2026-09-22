import { supabase } from '../lib/supabase.js'

function failure(error, fallback) {
  return new Error(error?.message || fallback)
}

export const aiRepository = Object.freeze({
  async run({ organizationId, capability, projectId = null, engagementId = null, departmentId, input = '' }) {
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { organizationId, capability, projectId, engagementId, departmentId, input },
    })
    if (error) throw failure(error, 'AI request failed')
    if (data?.error) throw new Error(data.error)
    return data
  },

  async recordDecision(runId, decision, outcome = '') {
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { operation: 'record_decision', runId, decision, outcome },
    })
    if (error) throw failure(error, 'AI decision audit failed')
    if (data?.error) throw new Error(data.error)
    return data
  },

  async listRuns(organizationId, { limit = 40, signal } = {}) {
    if (!organizationId) throw new TypeError('organizationId is required')
    let query = supabase.from('ai_runs').select('*')
      .eq('organization_id', organizationId).is('redacted_at', null)
      .order('created_at', { ascending: false }).limit(limit)
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await query
    if (error) throw failure(error, 'AI audit history failed')
    return data || []
  },
})
