export function createContextChatRunnerRepository(client) {
  async function invoke(input, { organizationId, signal } = {}) {
    if (!organizationId) throw Object.assign(new Error('Selected organization is required'), { status: 400 })
    signal?.throwIfAborted()
    const { data, error, status } = await client.functions.invoke('context-chat-runner', {
      body: { ...input, organization_id: organizationId }, signal,
    })
    if (error || data?.error || status >= 400) {
      let detail = data
      try { detail = await error?.context?.json() || data } catch { /* Keep the original transport failure. */ }
      const notSubmitted=detail?.status==='no_submission_recorded'&&detail?.must_not_submit===true
      const pendingCosts=['prior_cycle_reconciliation_required','unmeasured_cost_reconciliation_required'].includes(detail?.spend_readiness_status)
      const message=notSubmitted?(pendingCosts
        ? 'Your message is saved. No AI submission was recorded at this check; the original request may still be in progress. Organization spending needs verified charge reconciliation. Recovery has not sent another request.'
        : 'Your message is saved. No AI submission was recorded at this check; the original request may still be in progress. Recovery has not requested another reply.')
        : detail?.error || error?.message || 'Private AI reply is unavailable'
      const failure = new Error(message)
      failure.status = error?.context?.status || status || detail?.status
      failure.mustNotSubmit = detail?.must_not_submit === true
      failure.outcome = detail?.status || ''
      failure.spendReadinessStatus=notSubmitted?detail?.spend_readiness_status:undefined
      failure.reconciliationSources=notSubmitted&&Array.isArray(detail?.reconciliation_sources)?detail.reconciliation_sources.filter(source=>['design_media','design_video','pipeline','context_chat','workshop_chat','other'].includes(source)):[]
      throw failure
    }
    return data
  }
  return Object.freeze({
    run: (input, scope) => invoke(input, scope),
    recover: (messageId, scope) => invoke({ message_id: messageId, recover_only: true }, scope),
  })
}
