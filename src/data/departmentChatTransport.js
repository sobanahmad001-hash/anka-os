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
  // Design upload retries recover the same reserved original after a response
  // loss. This map is scoped to this repository instance; never redispatch AI.
  const designProjectUploads = new Map()
  async function uploadDesignProjectReference(input, scope) {
    const { file, ...metadata } = input
    if (!(file instanceof Blob) || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a local reference file up to 5 MiB')
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('')
    const claimedMime = metadata.claimed_mime || file.type
    const key = JSON.stringify([scope.organizationId, metadata.conversation_id, metadata.project_id, metadata.engagement_id, metadata.original_name || file.name, claimedMime, file.size, digest, metadata.data_classification, metadata.ai_use_allowed === true, metadata.share_with_recipients === true])
    let pending = designProjectUploads.get(key)
    if (!pending) {
      if (designProjectUploads.size >= 100) throw new Error('Too many unfinished uploads. Reload saved references before continuing.')
      const reserved = await invoke('reserve_attachment', { ...metadata, department_id: 'design', original_name: metadata.original_name || file.name, claimed_mime: claimedMime }, scope)
      pending = { reserved, uploaded: false }
      designProjectUploads.set(key, pending)
    }
    const identity = { department_id: 'design', conversation_id: metadata.conversation_id, project_id: metadata.project_id, engagement_id: metadata.engagement_id, attachment_id: pending.reserved.attachment.id }
    scope?.signal?.throwIfAborted()
    if (!pending.uploaded) {
      const { bucket, path, token } = pending.reserved.upload
      const uploaded = await client.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: claimedMime, upsert: false })
      if (uploaded.error) {
        // A prior request may have stored the immutable bytes. Exact finalize
        // can recover them; never discard a possibly successful upload.
        try { const recovered = await invoke('finalize_attachment', identity, scope); designProjectUploads.delete(key); return recovered }
        catch { throw failure(uploaded.error, uploaded) }
      }
      pending.uploaded = true
    }
    const result = await invoke('finalize_attachment', identity, scope)
    designProjectUploads.delete(key)
    return result
  }
  async function uploadAttachment(departmentId, input, scope) {
    if (departmentId === 'design') return uploadDesignProjectReference(input, scope)
    const { file, ...metadata } = input
    if (!(file instanceof Blob)) throw new Error('Choose a local file to upload')
    const claimedMime = metadata.claimed_mime || file.type
    const reserved = await invoke('reserve_attachment', {
      ...metadata, department_id: departmentId,
      original_name: metadata.original_name || file.name,
      claimed_mime: claimedMime,
    }, scope)
    scope?.signal?.throwIfAborted()
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
    listContextConversations: (input, scope) => invoke('list_context_conversations', input, scope),
    createContextConversation: (input, scope) => invoke('create_context_conversation', input, scope),
    startContextConversation: (input, scope) => invoke('start_context_conversation', input, scope),
    renameContextConversation: (input, scope) => invoke('rename_context_conversation', input, scope),
    getContextConversation: (input, scope) => invoke('get_context_conversation', input, scope),
    appendContextHumanMessage: (input, scope) => invoke('append_context_human_message', input, scope),
    getProjectContextSharing: (input, scope) => invoke('get_project_context_sharing', input, scope),
    setProjectContextSharing: (input, scope) => invoke('set_project_context_sharing', input, scope),
    getContextChatReadiness: (input, scope) => invoke('get_context_chat_readiness', input, scope),
    listConversations: (departmentId, input, scope) => invoke('list_conversations', { ...input, department_id: departmentId }, scope),
    searchConversations: (departmentId, input, scope) => invoke('search_conversations', { ...input, department_id: departmentId }, scope),
    createConversation: (departmentId, input, scope) => invoke('create_conversation', { ...input, department_id: departmentId }, scope),
    listSourceVersions: (departmentId, input, scope) => invoke('list_source_versions', { ...input, department_id: departmentId }, scope),
    previewSourceVersion: (departmentId, input, scope) => invoke('preview_source_version', { ...input, department_id: departmentId }, scope),
    getUnsentDraft: (departmentId, input, scope) => invoke('get_unsent_draft', { ...input, department_id: departmentId }, scope),
    saveUnsentDraft: (departmentId, input, scope) => invoke('save_unsent_draft', { ...input, department_id: departmentId }, scope),
    discardUnsentDraft: (departmentId, input, scope) => invoke('discard_unsent_draft', { ...input, department_id: departmentId }, scope),
    getConversation: (departmentId, input, scope) => invoke('get_conversation', { ...input, department_id: departmentId }, scope),
    listConversationShareCandidates: (departmentId, input, scope) => invoke('list_conversation_share_candidates', { ...input, department_id: departmentId }, scope),
    setConversationShares: (departmentId, input, scope) => invoke('set_conversation_shares', { ...input, department_id: departmentId }, scope),
    renameConversation: (departmentId, input, scope) => invoke('rename_conversation', { ...input, department_id: departmentId }, scope),
    setConversationState: (departmentId, input, scope) => invoke('set_conversation_state', { ...input, department_id: departmentId }, scope),
    getCapabilities: (departmentId, input, scope) => invoke('get_capabilities', { ...input, department_id: departmentId }, scope),
    uploadDesignPrivateAttachment: async (input, scope) => {
      const { file, ...metadata } = input
      if (!(file instanceof Blob) || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a local reference file up to 5 MiB')
      const reserved = await invoke('design_private_attachment_reserve', metadata, scope)
      scope?.signal?.throwIfAborted()
      if (reserved.upload) {
        const { bucket, path, token } = reserved.upload
        const uploaded = await client.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: metadata.claimed_mime, upsert: false })
        // An interrupted prior upload can already exist. Finalization validates
        // exact bytes/checksum; never overwrite, discard or allocate another ID.
        if (uploaded.error) {
          try { return await invoke('design_private_attachment_finalize', metadata, scope) }
          catch { throw failure(uploaded.error, uploaded) }
        }
      }
      return invoke('design_private_attachment_finalize', metadata, scope)
    },
    listDesignPrivateAttachments: (input, scope) => invoke('design_private_attachment_list', input, scope),
    revokeDesignPrivateAttachment: (input, scope) => invoke('design_private_attachment_revoke', input, scope),
    downloadDesignPrivateAttachment: (input, scope) => invoke('design_private_attachment_download', input, scope),
    uploadProjectDocument: async (input, scope) => {
      const { file, ...metadata } = input
      if (!(file instanceof Blob) || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a local reference file up to 5 MiB')
      const reserved = await invoke('project_document_attachment_reserve', metadata, scope)
      scope?.signal?.throwIfAborted()
      if (reserved.upload) {
        const { bucket, path, token } = reserved.upload
        const uploaded = await client.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: metadata.claimed_mime, upsert: false })
        // An interrupted prior upload can already exist. Finalization validates
        // exact bytes/checksum; never overwrite, discard or allocate another ID.
        if (uploaded.error) {
          try { return await invoke('project_document_attachment_finalize', metadata, scope) }
          catch { throw failure(uploaded.error, uploaded) }
        }
      }
      return invoke('project_document_attachment_finalize', metadata, scope)
    },
    listProjectDocuments: (input, scope) => invoke('project_document_attachment_list', input, scope),
    revokeProjectDocument: (input, scope) => invoke('project_document_attachment_revoke', input, scope),
    downloadProjectDocument: (input, scope) => invoke('project_document_attachment_download', input, scope),
    uploadAttachment,
    discardAttachment: (departmentId, input, scope) => invoke('discard_attachment', { ...input, department_id: departmentId }, scope),
    listAttachments: (departmentId, input, scope) => invoke('list_attachments', { ...input, department_id: departmentId }, scope),
    downloadAttachment: (departmentId, input, scope) => invoke('download_attachment', { ...input, department_id: departmentId }, scope),
  })
}
