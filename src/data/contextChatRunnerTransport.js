const guardedOutcomeMessages = Object.freeze({
  pending_append: 'Your reply is pending in chat. Check recovery for the original message; its outcome is not yet confirmed.',
  charged_without_reply: 'A charge was recorded without a saved reply. Check recovery for the original message; another reply will not be requested by recovery.',
  not_settled: 'The original reply request is not yet settled. Check recovery again; its outcome remains uncertain.',
  already_claimed: 'The original reply request has already been claimed. Check recovery; its outcome is not yet confirmed.',
  outcome_unknown: 'The original reply outcome could not be verified. The original request will not be sent again. Check recovery for its recorded status.',
})

export function createContextChatRunnerRepository(client) {
  async function invoke(input, { organizationId, signal } = {}) {
    if (!organizationId) throw Object.assign(new Error('Selected organization is required'), { status: 400 })
    signal?.throwIfAborted()
    const { data, error, status } = await client.functions.invoke('context-chat-runner', {
      body: { ...input, organization_id: organizationId }, signal,
    })
    if (error || data?.error || status >= 400) {
      let detail = data
      try {
        const response = typeof error?.context?.clone === 'function' ? error.context.clone() : error?.context
        detail = await response?.json() || data
      } catch { /* Keep the original transport failure. */ }
      const notSubmitted=detail?.status==='no_submission_recorded'&&detail?.must_not_submit===true
      const pendingCosts=['prior_cycle_reconciliation_required','unmeasured_cost_reconciliation_required'].includes(detail?.spend_readiness_status)
      const message=notSubmitted?(pendingCosts
        ? 'Your message is saved. No AI submission was recorded at this check; the original request may still be in progress. Organization spending needs verified charge reconciliation. Recovery has not sent another request.'
        : 'Your message is saved. No AI submission was recorded at this check; the original request may still be in progress. Recovery has not requested another reply.')
        : detail?.must_not_submit === true && Object.hasOwn(guardedOutcomeMessages, detail?.status)
          ? guardedOutcomeMessages[detail.status]
          : detail?.error || error?.message || 'Private AI reply is unavailable'
      const failure = new Error(message)
      failure.status = [error?.context?.status, status, error?.status, error?.statusCode, detail?.status, detail?.statusCode]
        .map(Number).find(value => Number.isInteger(value) && value >= 400 && value <= 599)
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
