// Local review and transport only. The transactional backend owns authorization and current material validation.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const validId = v => typeof v === 'string' && UUID.test(v)
const need = (ok, message) => { if (!ok) throw Error(message) }
const record = v => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const exact = (v, keys) => { need(record(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(','), 'Exact reviewed action fields required') }
const text = (v, max, required = false) => typeof v === 'string' && v.length <= max && (!required || !!v.trim())
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }
function canonical(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + Array.from(v, canonical).join(',') + ']'
  need(record(v), 'Reviewed actions must contain plain JSON only')
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))].map(n => n.toString(16).padStart(2, '0')).join('')
}
function identity(i) {
  exact(i, ['organizationId', 'projectId', 'conversationId', 'sourceMessageId', 'requestId'])
  need(Object.values(i).every(validId), 'Original project Chat and request identities required')
  return { ...i }
}
function work(w, create, allowStageSlot = false) {
  if (w?.id === null && create) {
    const hasSlot = Object.hasOwn(w, 'stage_slot')
    exact(w, ['id', 'title', 'description', ...(hasSlot ? ['stage_slot'] : [])])
    need(text(w.title, 240, true) && text(w.description, 20000), 'Review explicit new Work title and description')
    if (hasSlot) {
      need(allowStageSlot, 'Stage slot belongs only to selected-stage source Content Work creation')
      const slot = w.stage_slot
      exact(slot, ['step_key', 'instance', 'dependencies'])
      const validSlot = s => text(s.step_key, 120, true) && Number.isSafeInteger(s.instance) && s.instance >= 1 && s.instance <= 50
      need(validSlot(slot) && Array.isArray(slot.dependencies) && slot.dependencies.length <= 100, 'Bounded explicit stage slot and existing prerequisite instances required')
      for (const dep of slot.dependencies) { exact(dep, ['step_key', 'instance']); need(validSlot(dep), 'Exact declared prerequisite instance required') }
      need(new Set(slot.dependencies.map(d => d.step_key + ':' + d.instance)).size === slot.dependencies.length
        && !slot.dependencies.some(d => d.step_key === slot.step_key && d.instance === slot.instance), 'Distinct non-self prerequisite instances required')
    }
  } else {
    exact(w, ['id', 'row_version'])
    need(validId(w.id) && Number.isSafeInteger(w.row_version) && w.row_version > 0, 'Exact existing Work version required')
  }
}
function selection(s, i, engagementId) {
  if (s === null) return
  exact(s, ['version', 'organization_id', 'project_id', 'engagement_id', 'plan_id', 'group_id', 'phase', 'partition', 'context_sha256'])
  need(s.version === 1 && s.organization_id === i.organizationId && s.project_id === i.projectId && s.engagement_id === engagementId
    && validId(s.plan_id) && validId(s.group_id) && typeof s.phase === 'string' && /^(branding|website|marketing)\.[a-z_]{1,40}$/.test(s.phase)
    && HASH.test(s.context_sha256 || ''), 'Exact same-project selected stage required; invalid selection cannot become ordinary Chat')
  const p = s.partition
  exact(p, p?.kind === 'website_page' ? ['kind', 'id', 'architecture_version_id'] : ['kind', 'id'])
  need(['engagement', 'website_page', 'campaign_asset', 'recurring_occurrence'].includes(p.kind) && validId(p.id)
    && (p.kind !== 'website_page' || validId(p.architecture_version_id)), 'Exact selected partition required')
}
function action(a, i) {
  const common = ['version', 'kind', 'engagement_id', 'selection', 'source_work']
  const save = ['active_service_id', 'artifact_id', 'expected_parent_version_id', 'content', 'change_summary', 'ai_use_allowed', 'data_classification']
  const handoff = ['artifact_version_id', 'content_checksum', 'approval_id', 'receiving_service_id', 'receiving_workstream_id', 'receiving_work', 'recipient_note']
  need(a?.version === 1 && ['save_content', 'handoff_design'].includes(a.kind) && validId(a.engagement_id), 'Supported explicit Content action required')
  exact(a, [...common, ...(a.kind === 'save_content' ? save : handoff)])
  selection(a.selection, i, a.engagement_id)
  work(a.source_work, a.kind === 'save_content', a.selection !== null)
  if (a.kind === 'save_content') {
    need(validId(a.active_service_id) && (a.artifact_id === null && a.expected_parent_version_id === null
      || validId(a.artifact_id) && validId(a.expected_parent_version_id)), 'Exact Content service and parent version required')
    need(record(a.content) && a.content.schema_version === 2 && a.content.variant_number === 1
      && ['website_page_copy', 'blog_article', 'social_copy', 'campaign_copy', 'custom_text'].includes(a.content.output_type)
      && text(a.content.working_title, 160, true) && text(a.content.body, 120000, true), 'Review complete existing Content Writer v2 content')
    if (a.content.output_type === 'website_page_copy') {
      need(validId(a.content.source_architecture_version_id) && text(a.content.target_page_key, 1208, true), 'Exact Website Architecture and page key required')
      if (a.selection?.partition.kind === 'website_page') need(a.content.source_architecture_version_id === a.selection.partition.architecture_version_id, 'Writer architecture differs from selected page context')
    }
    need(text(a.change_summary, 1000) && typeof a.ai_use_allowed === 'boolean' && ['public', 'internal', 'confidential', 'restricted'].includes(a.data_classification), 'Explicit draft policy and summary required')
  } else {
    need(['artifact_version_id', 'approval_id', 'receiving_service_id', 'receiving_workstream_id'].every(k => validId(a[k])) && HASH.test(a.content_checksum || '') && text(a.recipient_note, 4000), 'Exact approved output and explicit Design destination required')
    work(a.receiving_work, true)
    need(a.receiving_work.id === null || a.receiving_work.id !== a.source_work.id, 'Receiving Design Work must differ from source Content Work')
  }
  need(canonical(a).length <= 250000, 'Review a bounded Content action')
  return structuredClone(a)
}
export async function prepareProjectChatContentAction(originalIdentity, reviewedAction) {
  const i = identity(originalIdentity), a = action(reviewedAction, i)
  const snapshot = { version: 1, identity: i, action: a }
  return freeze({ ...snapshot, sha256: await digest(snapshot) })
}
const rpcIdentity = i => ({ p_organization_id: i.organizationId, p_project_id: i.projectId, p_conversation_id: i.conversationId, p_source_message_id: i.sourceMessageId, p_request_id: i.requestId })
function receipt(r, i, a) {
  need(record(r) && r.version === 1 && r.organization_id === i.organizationId && r.project_id === i.projectId
    && r.conversation_id === i.conversationId && (!i.sourceMessageId || r.source_message_id === i.sourceMessageId)
    && (!i.requestId || r.request_id === i.requestId) && ['request_id', 'source_message_id', 'actor_id', 'engagement_id'].every(k => validId(r[k])), 'Receipt differs from original project Chat request')
  need(['save_content', 'handoff_design'].includes(r.kind) && r.status === (r.kind === 'save_content' ? 'content_saved' : 'handoff_recorded'), 'Canonical operation receipt required; completion is not inferred')
  need(Object.hasOwn(r, 'selection'), 'Original receipt selection must be explicit, including ordinary Chat null')
  selection(r.selection, i, r.engagement_id)
  work(r.source_work, false)
  const o = r.output
  need(record(o) && validId(o.artifact_id) && validId(o.artifact_version_id) && Number.isSafeInteger(o.version_number) && o.version_number > 0 && HASH.test(o.content_checksum || ''), 'Exact canonical output receipt required')
  if (r.kind === 'save_content') need(r.handoff === null && r.review_required === true, 'A saved draft requires review and cannot claim a handoff')
  else {
    const h = r.handoff
    need(record(h) && ['request_id', 'approval_id', 'receiving_service_id', 'receiving_workstream_id', 'receiving_work_item_id'].every(k => validId(h[k]))
      && h.receiving_work_item_id !== r.source_work.id && r.review_required === false, 'Exact distinct Design handoff receipt required')
  }
  if (a) {
    need(r.kind === a.kind && r.engagement_id === a.engagement_id && canonical(r.selection) === canonical(a.selection)
      && (a.source_work.id === null || a.source_work.id === r.source_work.id), 'Receipt differs from reviewed source action or original selection')
    if (a.kind === 'save_content') need(a.artifact_id === null || a.artifact_id === o.artifact_id, 'Saved artifact differs from reviewed target')
    else need(o.artifact_version_id === a.artifact_version_id && o.content_checksum === a.content_checksum && r.handoff.approval_id === a.approval_id
      && r.handoff.receiving_service_id === a.receiving_service_id && r.handoff.receiving_workstream_id === a.receiving_workstream_id
      && (a.receiving_work.id === null || r.handoff.receiving_work_item_id === a.receiving_work.id), 'Handoff receipt differs from exact reviewed source or destination')
  }
  return freeze(structuredClone(r))
}
export function createProjectChatActionRepository(client) {
  need(typeof client?.rpc === 'function', 'Authenticated RPC client required')
  const read = async (name, args) => { const { data, error } = await client.rpc(name, args); if (error) throw error; return data }
  return Object.freeze({
    prepare: prepareProjectChatContentAction,
    async confirm(proposal) {
      exact(proposal, ['version', 'identity', 'action', 'sha256'])
      const fresh = await prepareProjectChatContentAction(proposal.identity, proposal.action)
      need(proposal.version === 1 && proposal.sha256 === fresh.sha256, 'Reviewed proposal changed; prepare it again before confirming')
      try { return receipt(await read('apply_project_chat_content_action', { ...rpcIdentity(fresh.identity), p_action: fresh.action }), fresh.identity, fresh.action) }
      catch (cause) {
        const code = cause?.code, known = ['22023', '42501', '40001', '55000', '23505', '54000'].includes(code)
        throw Object.assign(new Error(cause?.message || 'Result uncertain; check the original request'), { cause, code, outcome: known ? (code === '40001' ? 'stale' : 'blocked') : 'unknown', knownRollback: known, proposal: fresh })
      }
    },
    async recover(originalIdentity) {
      const i = identity(originalIdentity), data = await read('recover_project_chat_content_action', rpcIdentity(i))
      need(record(data) && ['recorded', 'not_recorded'].includes(data.status), 'Original action recovery unavailable')
      if (data.status === 'not_recorded') { need(data.must_not_submit === true, 'Absence does not authorize submission'); return freeze(structuredClone(data)) }
      return freeze({ ...data, receipt: receipt(data.receipt, i) })
    },
    async list(scope, { limit = 25, offset = 0 } = {}) {
      exact(scope, ['organizationId', 'projectId', 'conversationId'])
      need(Object.values(scope).every(validId) && Number.isSafeInteger(limit) && limit >= 1 && limit <= 50 && Number.isSafeInteger(offset) && offset >= 0, 'Bounded original Chat receipt page required')
      const data = await read('read_project_chat_content_actions', { p_organization_id: scope.organizationId, p_project_id: scope.projectId, p_conversation_id: scope.conversationId, p_limit: limit, p_offset: offset })
      need(record(data) && data.limit === limit && data.offset === offset && typeof data.has_more === 'boolean' && Array.isArray(data.items) && data.items.length <= limit, 'Receipt page differs from requested bounds')
      const items = data.items.map(r => receipt(r, scope))
      need(new Set(items.map(r => r.request_id)).size === items.length, 'Duplicate original action receipts')
      return freeze({ ...data, items })
    },
  })
}
