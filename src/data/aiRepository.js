import { supabase } from '../lib/supabase.js'

function failure(error, fallback) {
  return new Error(error?.message || fallback)
}

export const aiRepository = Object.freeze({
  async run({ capability, projectId = null, departmentId, input = '' }) {
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { capability, projectId, departmentId, input },
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

  async listRuns(limit = 40) {
    const { data, error } = await supabase.from('ai_runs').select('*')
      .is('redacted_at', null).order('created_at', { ascending: false }).limit(limit)
    if (error) throw failure(error, 'AI audit history failed')
    return data || []
  },
})
