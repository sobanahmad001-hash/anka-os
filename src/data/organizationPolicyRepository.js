import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const failure = (error, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : undefined,
})

export function createOrganizationPolicyRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async list(organizationId) {
      if (!validId(organizationId)) throw new TypeError('Exact organization required')
      const { data, error } = await client.rpc('get_organization_ai_policy', {
        p_organization_id: organizationId,
      })
      if (error) throw failure(error, 'Unable to load organization policy')
      if (data?.organization_id !== organizationId
        || !Array.isArray(data.confirmed) || !Array.isArray(data.candidates)
        || !Array.isArray(data.history)
        || [...data.confirmed, ...data.candidates, ...data.history].some(row =>
          !validId(row?.id) || typeof row?.statement !== 'string'
          || typeof row?.source_note !== 'string')) {
        throw Object.assign(new Error('Policy did not match the active organization'), { status: 409 })
      }
      return data
    },
    async propose({ organizationId, requestId, statement, sourceNote, supersedesId = null }) {
      if (![organizationId, requestId].every(validId)
        || (supersedesId && !validId(supersedesId))
        || typeof statement !== 'string' || !statement.trim()
        || statement.trim().length > 1000
        || typeof sourceNote !== 'string' || sourceNote.trim().length < 20
        || sourceNote.trim().length > 1000) throw new TypeError('Sourced policy draft required')
      const { data, error } = await client.rpc('propose_organization_ai_policy', {
        p_organization_id: organizationId, p_request_id: requestId,
        p_statement: statement.trim(), p_source_note: sourceNote.trim(),
        p_supersedes_id: supersedesId,
      })
      if (error) throw failure(error, 'Unable to propose organization policy')
      if (data?.policy_id !== requestId
        || !['candidate', 'confirmed', 'rejected', 'superseded', 'retired'].includes(data.status)) {
        throw Object.assign(new Error('Policy proposal receipt did not match'), { status: 409 })
      }
      return data
    },
    async review({ organizationId, policyId, requestId, decision, evidence }) {
      if (![organizationId, policyId, requestId].every(validId)
        || !['confirm', 'reject', 'retire'].includes(decision)
        || typeof evidence !== 'string' || !evidence.trim()
        || evidence.trim().length > 1000) throw new TypeError('Exact policy decision required')
      const { data, error } = await client.rpc('review_organization_ai_policy', {
        p_organization_id: organizationId, p_policy_id: policyId, p_request_id: requestId,
        p_decision: decision, p_evidence: evidence.trim(),
      })
      if (error) throw failure(error, 'Unable to review organization policy')
      if (data?.policy_id !== policyId
        || data.status !== ({ confirm: 'confirmed', reject: 'rejected', retire: 'retired' })[decision]) {
        throw Object.assign(new Error('Policy review receipt did not match'), { status: 409 })
      }
      return data
    },
  }
}

export const organizationPolicyRepository = createOrganizationPolicyRepository(supabase)
