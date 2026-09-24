export function dollarsToMicrousd(value) {
  const amount = String(value || '').trim()
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(amount)) {
    throw new TypeError('Enter a positive USD amount with at most six decimal places')
  }
  const [dollars, fraction = ''] = amount.split('.')
  const micros = BigInt(dollars) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (micros <= 0n || micros > 9_223_372_036_854_775_807n) {
    throw new TypeError('Enter a positive provider charge')
  }
  return micros.toString()
}

export function createContextChatReleaseReviewTransport(client) {
  async function call(name, args, { signal } = {}) {
    signal?.throwIfAborted()
    let query = client.rpc(name, args)
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await query
    if (error) throw Object.assign(new Error(error.message || 'Private AI review failed'), { status: error.status })
    return data
  }
  function evidenceFields(providerReference, evidence) {
    const reference = String(providerReference || '').trim()
    const explanation = String(evidence || '').trim()
    if (reference.length < 8 || reference.length > 160 || explanation.length < 20 || explanation.length > 1000) {
      throw new TypeError('Provider reference and detailed billing evidence are required')
    }
    return { reference, explanation }
  }
  return Object.freeze({
    list: (organizationId, offset = 0, scope) => call('list_context_chat_release_candidates', {
      p_organization_id: organizationId, p_offset: offset,
    }, scope),
    release: ({ organizationId, messageId, requestId, providerReference,
      providerCheckedAt, confirmedNoCharge, evidence }, scope) => {
      if (confirmedNoCharge !== true) throw new TypeError('Confirm provider billing shows no charge')
      const { reference, explanation } = evidenceFields(providerReference, evidence)
      return call('release_context_chat_confirmed_no_charge', {
        p_organization_id: organizationId, p_message_id: messageId, p_request_id: requestId,
        p_provider_reference: reference, p_provider_checked_at: providerCheckedAt,
        p_confirmed_no_charge: true, p_evidence: explanation,
      }, scope)
    },
    settleCharge: ({ organizationId, messageId, requestId, providerReference,
      providerCheckedAt, actualCostUsd, confirmedCharge, evidence }, scope) => {
      if (confirmedCharge !== true) throw new TypeError('Confirm the exact provider charge')
      const { reference, explanation } = evidenceFields(providerReference, evidence)
      const actualCostMicrousd = dollarsToMicrousd(actualCostUsd)
      return call('settle_context_chat_confirmed_charge', {
        p_organization_id: organizationId, p_message_id: messageId, p_request_id: requestId,
        p_provider_reference: reference, p_provider_checked_at: providerCheckedAt,
        p_actual_cost_microusd: actualCostMicrousd, p_evidence: explanation,
      }, scope)
    },
  })
}
