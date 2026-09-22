export function createContextChatReleaseReviewTransport(client) {
  async function call(name, args, { signal } = {}) {
    signal?.throwIfAborted()
    let query = client.rpc(name, args)
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await query
    if (error) throw Object.assign(new Error(error.message || 'Private AI review failed'), { status: error.status })
    return data
  }
  return Object.freeze({
    list: (organizationId, offset = 0, scope) => call('list_context_chat_release_candidates', {
      p_organization_id: organizationId, p_offset: offset,
    }, scope),
    release: ({ organizationId, messageId, requestId, providerReference,
      providerCheckedAt, confirmedNoCharge, evidence }, scope) => {
      if (confirmedNoCharge !== true) throw new TypeError('Confirm provider billing shows no charge')
      const reference = String(providerReference || '').trim()
      const explanation = String(evidence || '').trim()
      if (reference.length < 8 || reference.length > 160 || explanation.length < 20 || explanation.length > 1000) {
        throw new TypeError('Provider reference and a detailed no-charge explanation are required')
      }
      return call('release_context_chat_confirmed_no_charge', {
        p_organization_id: organizationId, p_message_id: messageId, p_request_id: requestId,
        p_provider_reference: reference, p_provider_checked_at: providerCheckedAt,
        p_confirmed_no_charge: true, p_evidence: explanation,
      }, scope)
    },
  })
}
