import { websiteNativeSnapshotChecksum } from '../../supabase/functions/_shared/websiteNativeDesign.js'
const id = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const need = (v, message) => { if (!v) throw Error(message) }
const exact = (v, keys) => need(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(','), 'Exact positioning fields required')
const frozen = v => { if (v && typeof v === 'object') { Object.values(v).forEach(frozen); Object.freeze(v) } return v }
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
function scope(s) { exact(s, ['organization_id', 'project_id', 'engagement_id', 'actor_id', 'conversation_id']); need(Object.values(s).every(id), 'Exact owned Project Chat scope required'); return structuredClone(s) }
const args = s => ({ p_organization_id: s.organization_id, p_project_id: s.project_id, p_engagement_id: s.engagement_id })
function messageInScope(message, s, conversation) {
  if (message?.conversation_id !== s.conversation_id) return false
  if (Object.hasOwn(message, 'organization_id')) return message.organization_id === s.organization_id
  // History rows carry their organization on the returned conversation.
  return conversation?.id === message.conversation_id &&
    conversation.organization_id === s.organization_id && conversation.project_id === s.project_id &&
    conversation.owner_id === s.actor_id && conversation.context_kind === 'project_team'
}
function meta(m, conversationId = null) {
  exact(m, ['version_id', 'version_number', 'wording_sha256', 'binding_id', 'conversation_id'])
  need(id(m.version_id) && Number.isSafeInteger(m.version_number) && m.version_number > 0 && hash(m.wording_sha256) && id(m.binding_id) && (m.conversation_id === null || id(m.conversation_id)) && (!conversationId || m.conversation_id === conversationId), 'Exact saved positioning version required')
  return m
}
export function createProjectPositioningOutputRepository(client) {
  need(typeof client?.rpc === 'function', 'Authenticated positioning RPC client required')
  async function rpc(name, input, { signal } = {}) { signal?.throwIfAborted(); let q = client.rpc(name, input); if (signal && q.abortSignal) q = q.abortSignal(signal); const { data, error } = await q; signal?.throwIfAborted(); if (error) throw Object.assign(Error('Positioning could not be verified. Preserve the original request and check recovery.'), { code: error.code, knownRollback: ['22023', '42501', '40001', '23505'].includes(error.code) }); return data }
  async function read(s, versionId = null, options) {
    s = scope(s); need(versionId === null || id(versionId), 'Exact selected positioning version required')
    const data = await rpc('read_project_positioning_output', { ...args(s), p_conversation_id: s.conversation_id, p_version_id: versionId }, options)
    exact(data, ['organization_id', 'project_id', 'engagement_id', 'actor_id', 'binding_id', 'current', 'selected'])
    need(['organization_id', 'project_id', 'engagement_id', 'actor_id'].every(k => data[k] === s[k]) && (data.binding_id === null || id(data.binding_id)), 'Positioning read belongs to another scope')
    if (data.current !== null) meta(data.current)
    if (versionId === null) need(data.selected === null, 'Metadata reads must not disclose wording')
    else {
      const selected = data.selected
      exact(selected, ['version_id', 'version_number', 'wording_sha256', 'binding_id', 'conversation_id', 'wording'])
      const { wording, ...metadata } = selected; meta(metadata, s.conversation_id)
      need(metadata.version_id === versionId && typeof wording === 'string' && wording.trim().length > 0, 'Exact owned saved wording required')
    }
    return frozen(structuredClone(data))
  }
  return Object.freeze({
    review: (s, options) => read(s, null, options),
    async prepare(s, source, approval, wording, reviewed, requestId, attested, conversation) {
      s = scope(s)
      need(attested === true && id(requestId) && id(reviewed?.binding_id) && ['organization_id', 'project_id', 'engagement_id', 'actor_id'].every(k => reviewed[k] === s[k]), 'Review the chosen wording and explicitly attest to the selected owner approval message')
      need(messageInScope(source, s, conversation) && source.status === 'completed' && ['assistant', 'user'].includes(source.role) && id(source.id) && typeof source.body === 'string' && typeof wording === 'string' && wording.trim().length > 0 && wording.length <= 8000 && source.body.includes(wording), 'Select exact wording from a completed saved message in this conversation')
      need(messageInScope(approval, s, conversation) && approval.status === 'completed' && approval.role === 'user' && approval.author_id === s.actor_id && id(approval.id) && Number.isSafeInteger(source.sequence) && Number.isSafeInteger(approval.sequence) && approval.sequence >= source.sequence, 'Select a separate completed owner approval message at or after the source; wording is never parsed as approval')
      if (source.id === approval.id) need(source.role === 'user' && source.author_id === s.actor_id, 'Only owner-authored wording may use the same approval message')
      if (reviewed.current !== null) meta(reviewed.current)
      const value = { version: 1, scope: s, source_message_id: source.id, approval_message_id: approval.id, wording, binding_id: reviewed.binding_id, expected_version_id: reviewed.current?.version_id ?? null, request_id: requestId, attested: true }
      return frozen({ ...value, sha256: await websiteNativeSnapshotChecksum(value) })
    },
    async confirm(proposal, options) {
      exact(proposal, ['version', 'scope', 'source_message_id', 'approval_message_id', 'wording', 'binding_id', 'expected_version_id', 'request_id', 'attested', 'sha256'])
      const { sha256, ...p } = structuredClone(proposal); scope(p.scope)
      need(p.version === 1 && p.attested === true && hash(sha256) && sha256 === await websiteNativeSnapshotChecksum(p), 'Reviewed positioning proposal changed')
      need([p.source_message_id,p.approval_message_id,p.binding_id,p.request_id].every(id) && (p.expected_version_id === null || id(p.expected_version_id)) && typeof p.wording === 'string' && p.wording.trim().length > 0 && p.wording.length <= 8000, 'Exact reviewed positioning source and request required')
      try {
        const result = await rpc('save_project_positioning_output', { ...args(p.scope), p_conversation_id: p.scope.conversation_id, p_source_message_id: p.source_message_id, p_approval_message_id: p.approval_message_id, p_wording: p.wording, p_binding_id: p.binding_id, p_expected_version_id: p.expected_version_id, p_request_id: p.request_id, p_attested: true }, options)
        meta(result, p.scope.conversation_id); need(result.version_id === p.request_id && result.binding_id === p.binding_id, 'Saved positioning receipt differs; check the original request')
        return frozen(structuredClone(result))
      } catch (cause) { throw Object.assign(Error(cause.message), { cause, code: cause.code, knownRollback: cause.knownRollback === true, proposal: frozen({ ...p, sha256 }) }) }
    },
    async recover(s, requestId, options) { s = scope(s); need(id(requestId), 'Original positioning request required'); const result = await rpc('recover_project_positioning_output', { ...args(s), p_conversation_id: s.conversation_id, p_request_id: requestId }, options); if (result === null) return null; meta(result, s.conversation_id); need(result.version_id === requestId, 'Recovery differs from original positioning request'); return frozen(structuredClone(result)) },
    async continuation(s, output, options) {
      s = scope(s); meta(output, s.conversation_id)
      const data = await read(s, output.version_id, options), { wording, ...selected } = data.selected
      need(data.binding_id === output.binding_id && data.current && same(data.current, output) && same(selected, output), 'Positioning or its foundation binding changed. Review the current exact version; your draft is kept.')
      return frozen({ scope: s, output: structuredClone(output), wording })
    },
    async stageProductStructure(review, existingText, currentScope, options) {
      const s = scope(currentScope); need(same(s, scope(review.scope)), 'Continue in the original owned positioning conversation')
      const latest = await this.continuation(s, review.output, options)
      need(latest.wording === review.wording && typeof existingText === 'string', 'Reviewed saved positioning wording changed')
      const section = 'Continue with product and service structure for this project.\nI reviewed this exact saved positioning version and choose to disclose its wording in this original private Project Chat as reference material:\n\n' + latest.wording + '\n\nDraft product and service structure for review. Do not apply project changes or claim completed work.'
      const text = existingText ? existingText + '\n\n' + section : section
      need(text.length <= 8000, 'Keep your draft and review a shorter positioning version before adding it; no truncation is allowed')
      return frozen({ text, handoff: { scope: s, output: latest.output, wording: latest.wording, composer_section: section } })
    },
    async beforeSend({ text, handoff, scope: s }, options) { need(same(scope(s), scope(handoff.scope)) && typeof text === 'string' && text.includes(handoff.composer_section), 'The original conversation or disclosed positioning text changed; your draft is kept'); const latest = await this.continuation(s, handoff.output, options); need(latest.wording === handoff.wording, 'Saved positioning wording changed'); return { text } },
  })
}
