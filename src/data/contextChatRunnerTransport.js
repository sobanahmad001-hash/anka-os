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
      const failure = new Error(detail?.error || error?.message || 'Private AI reply is unavailable')
      failure.status = error?.context?.status || status || detail?.status
      failure.mustNotSubmit = detail?.must_not_submit === true
      failure.outcome = detail?.status || ''
      throw failure
    }
    return data
  }
  return Object.freeze({
    run: (input, scope) => invoke(input, scope),
    recover: (messageId, scope) => invoke({ message_id: messageId, recover_only: true }, scope),
  })
}
