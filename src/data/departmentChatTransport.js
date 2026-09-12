import { readDepartmentChatAnswerStream } from './departmentChatStreaming.js'

function failure(error, envelope, detail) {
  const status = [error?.context?.status, envelope?.status, error?.status, error?.statusCode, detail?.status, detail?.statusCode]
    .map(Number).find(value => Number.isInteger(value) && value >= 400 && value <= 599)
  return Object.assign(new Error(detail?.error || error?.message || 'Department Chat request failed'), {
    status, outcome: detail?.outcome || error?.outcome, code: error?.code,
  })
}

export function createDepartmentChatRepository(client) {
  async function invoke(action, input = {}, { organizationId, signal } = {}) {
    if (!organizationId) throw Object.assign(new Error('Selected organization is required'), { status: 400 })
    signal?.throwIfAborted()
    const envelope = await client.functions.invoke('department-chat', { body: { ...input, action, organization_id: organizationId }, signal })
    const { data, error } = envelope
    if (error || data?.error || envelope.status >= 400) {
      let detail = data
      try { detail = await error?.context?.json() || data } catch { /* Preserve transport status for non-JSON errors. */ }
      throw failure(error, envelope, detail)
    }
    return data instanceof Blob || data instanceof Response ? data : data?.data
  }
  async function uploadAttachment(departmentId, input, scope) {
    const { file, ...metadata } = input
    if (!(file instanceof Blob)) throw new Error('Choose a local file to upload')
    const claimedMime = metadata.claimed_mime || file.type
    const reserved = await invoke('reserve_attachment', {
      ...metadata, department_id: departmentId,
      original_name: metadata.original_name || file.name,
      claimed_mime: claimedMime,
    }, scope)
    const { bucket, path, token } = reserved.upload
    const uploaded = await client.storage.from(bucket).uploadToSignedUrl(path, token, file, {
      contentType: claimedMime,
    })
    if (uploaded.error) {
      try {
        await invoke('discard_attachment', {
          department_id: departmentId, conversation_id: metadata.conversation_id,
          engagement_id: metadata.engagement_id, project_id: metadata.project_id,
          attachment_id: reserved.attachment.id,
        }, scope)
      } catch { /* The unreadable staging reservation expires independently. */ }
      throw failure(uploaded.error, uploaded)
    }
    return invoke('finalize_attachment', {
      department_id: departmentId, conversation_id: metadata.conversation_id,
      engagement_id: metadata.engagement_id, project_id: metadata.project_id,
      attachment_id: reserved.attachment.id,
    }, scope)
  }
  return Object.freeze({
    getOfficialRecord: async (organizationId, decision, { signal } = {}) => {
      const table = decision.artifact_version_id ? 'artifact_versions' : 'work_items'
      const id = decision.artifact_version_id || decision.work_item_id
      if (!organizationId || !id) throw new Error('Official record identity is required')
      signal?.throwIfAborted()
      let query = client.from(table).select('*').eq('organization_id', organizationId).eq('id', id)
      if (signal) query = query.abortSignal(signal)
      const envelope = await query.single()
      if (envelope.error || envelope.status >= 400) throw failure(envelope.error, envelope)
      return envelope.data
    },
    answer: async (departmentId, input, scope, observer = {}) => {
      const stream = await invoke('answer', { ...input, department_id: departmentId }, scope)
      return readDepartmentChatAnswerStream(stream, observer)
    },
    proposeArtifact: (departmentId, input, scope) => invoke('propose_artifact', { ...input, department_id: departmentId }, scope),
    proposeWorkItem: (departmentId, input, scope) => invoke('propose_work_item', { ...input, department_id: departmentId }, scope),
    confirmProposal: (proposalId, scope) => invoke('confirm_proposal', { proposal_id: proposalId }, scope),
    rejectProposal: (proposalId, scope) => invoke('reject_proposal', { proposal_id: proposalId }, scope),
    listConversations: (departmentId, input, scope) => invoke('list_conversations', { ...input, department_id: departmentId }, scope),
    createConversation: (departmentId, input, scope) => invoke('create_conversation', { ...input, department_id: departmentId }, scope),
    getConversation: (departmentId, input, scope) => invoke('get_conversation', { ...input, department_id: departmentId }, scope),
    listConversationShareCandidates: (departmentId, input, scope) => invoke('list_conversation_share_candidates', { ...input, department_id: departmentId }, scope),
    setConversationShares: (departmentId, input, scope) => invoke('set_conversation_shares', { ...input, department_id: departmentId }, scope),
    renameConversation: (departmentId, input, scope) => invoke('rename_conversation', { ...input, department_id: departmentId }, scope),
    setConversationState: (departmentId, input, scope) => invoke('set_conversation_state', { ...input, department_id: departmentId }, scope),
    getCapabilities: (departmentId, input, scope) => invoke('get_capabilities', { ...input, department_id: departmentId }, scope),
    uploadAttachment,
    discardAttachment: (departmentId, input, scope) => invoke('discard_attachment', { ...input, department_id: departmentId }, scope),
    listAttachments: (departmentId, input, scope) => invoke('list_attachments', { ...input, department_id: departmentId }, scope),
    downloadAttachment: (departmentId, input, scope) => invoke('download_attachment', { ...input, department_id: departmentId }, scope),
  })
}
