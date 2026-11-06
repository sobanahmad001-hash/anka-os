import { prepareWebsiteNativeManifest } from '../../supabase/functions/_shared/websiteNativeDraft.js'
import { validateWebsiteNativeDesign, websiteNativeSnapshotChecksum } from '../../supabase/functions/_shared/websiteNativeDesign.js'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const id = v => typeof v === 'string' && UUID.test(v)
const sha = v => typeof v === 'string' && HASH.test(v)
const need = (v, message) => { if (!v) throw Error(message) }
const object = v => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
const sorted = v => Array.isArray(v) ? v.map(sorted) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v
function exact(v, fields) { need(object(v) && Object.keys(v).sort().join(',') === [...fields].sort().join(','), 'Exact native Chat action fields required') }
const identityFields = ['organization_id', 'project_id', 'conversation_id', 'source_message_id', 'request_id']
function identity(v) { exact(v, identityFields); need(Object.values(v).every(id), 'Original Project Chat identities required'); return structuredClone(v) }
function work(v) { exact(v, ['id', 'row_version']); need(id(v.id) && Number.isSafeInteger(v.row_version) && v.row_version > 0, 'Exact existing Work and row version required') }
function selection(v, scope) {
  if (v === null) return
  exact(v, ['version', 'organization_id', 'project_id', 'engagement_id', 'plan_id', 'group_id', 'phase', 'partition', 'context_sha256'])
  need(v.version === 1 && ['organization_id', 'project_id', 'engagement_id'].every(k => id(v[k]) && v[k] === scope[k])
    && id(v.plan_id) && id(v.group_id) && typeof v.phase === 'string' && /^(branding|website|marketing)\.[a-z_]{1,40}$/.test(v.phase) && sha(v.context_sha256), 'Exact original selected stage scope required')
  exact(v.partition, v.partition?.kind === 'website_page' ? ['kind', 'id', 'architecture_version_id'] : ['kind', 'id'])
  need(['engagement', 'website_page', 'campaign_asset', 'recurring_occurrence'].includes(v.partition.kind) && id(v.partition.id)
    && (v.partition.kind !== 'website_page' || id(v.partition.architecture_version_id)), 'Exact original stage partition required')
}
function context(v, i) {
  exact(v, ['engagement_id', 'selection', 'handoff_request_id', 'source_work', 'receiving_work', 'page_id', 'architecture_version_id', 'brief_version_id', 'site_version_id', 'direction_version_id', 'expected_parent_design_id'])
  need(['engagement_id', 'handoff_request_id', 'page_id', 'architecture_version_id', 'brief_version_id', 'site_version_id'].every(k => id(v[k]))
    && (v.direction_version_id === null || id(v.direction_version_id)) && (v.expected_parent_design_id === null || id(v.expected_parent_design_id)), 'Exact native design prerequisites and explicit parent required')
  work(v.source_work); work(v.receiving_work)
  need(v.source_work.id !== v.receiving_work.id, 'Source Content Work and receiving Design Work must differ')
  selection(v.selection, { ...i, engagement_id: v.engagement_id })
  if (v.selection?.partition.kind === 'website_page') need(v.selection.partition.id === v.page_id && v.selection.partition.architecture_version_id === v.architecture_version_id, 'Selected page differs from native Design target')
  return structuredClone(v)
}
function source(v, i, c) {
  need(object(v) && object(v.scope) && ['organization_id', 'project_id'].every(k => v.scope[k] === i[k])
    && v.scope.engagement_id === c.engagement_id && v.scope.page_id === c.page_id && v.architecture?.artifact_version_id === c.architecture_version_id
    && id(v.architecture?.approval_id) && sha(v.architecture?.content_checksum) && v.brief_version?.id === c.brief_version_id && sha(v.brief_version?.content_checksum)
    && v.site_version?.id === c.site_version_id && sha(v.site_version?.request_sha256) && id(v.content_version?.id) && sha(v.content_version?.content_checksum)
    && v.design_head === c.expected_parent_design_id && sha(v.review_sha256) && sha(v.chat_review_sha256), 'Native source differs from exact reviewed Chat scope or design parent')
  need(!['handoff_receipt', 'source_work', 'receiving_work', 'content_approval'].some(k => Object.hasOwn(v, k)), 'Duplicate native Chat metadata aliases are forbidden')
  const m = v.chat_context
  exact(m, ['version', 'organization_id', 'project_id', 'engagement_id', 'conversation_id', 'source_message_id', 'actor_id', 'context', 'handoff_receipt', 'source_work', 'receiving_work', 'content_approval'])
  need(m.version === 1 && ['organization_id', 'project_id', 'conversation_id', 'source_message_id'].every(k => m[k] === i[k]) && m.engagement_id === c.engagement_id && id(m.actor_id)
    && same(m.context, c) && same(m.source_work, c.source_work) && same(m.receiving_work, c.receiving_work), 'Chat source metadata differs from current reviewed context')
  const h = m.handoff_receipt, a = m.content_approval
  exact(h, ['version', 'request_id', 'organization_id', 'project_id', 'engagement_id', 'conversation_id', 'source_message_id', 'actor_id', 'kind', 'status', 'selection', 'source_work', 'output', 'handoff', 'review_required'])
  need(h.version === 1 && h.kind === 'handoff_design' && h.status === 'handoff_recorded' && h.review_required === false && id(h.source_message_id)
    && ['organization_id', 'project_id', 'engagement_id', 'conversation_id', 'actor_id'].every(k => h[k] === m[k]) && h.request_id === c.handoff_request_id, 'Original Content handoff scope required')
  work(h.source_work); selection(h.selection, h)
  exact(h.output, ['artifact_id', 'artifact_version_id', 'version_number', 'content_checksum'])
  exact(h.handoff, ['request_id', 'approval_id', 'receiving_service_id', 'receiving_workstream_id', 'receiving_work_item_id'])
  exact(a, ['artifact_id', 'artifact_version_id', 'content_checksum', 'approval_id'])
  need(Object.values(h.handoff).every(id) && h.handoff.request_id === c.handoff_request_id && h.source_work.id === c.source_work.id && h.handoff.receiving_work_item_id === c.receiving_work.id
    && id(a.artifact_id) && id(a.artifact_version_id) && id(a.approval_id) && sha(a.content_checksum)
    && a.artifact_id === h.output.artifact_id && a.artifact_version_id === h.output.artifact_version_id && a.content_checksum === h.output.content_checksum
    && a.approval_id === h.handoff.approval_id && a.artifact_version_id === v.content_version.id && a.content_checksum === v.content_version.content_checksum
    && Number.isSafeInteger(h.output.version_number) && h.output.version_number > 0, 'Exact approved handoff Content and distinct receiving Work required')
  return v
}
export async function prepareProjectChatNativeDesignAction(originalIdentity, originalContext, originalSource, layout) {
  const i = identity(originalIdentity), c = context(originalContext, i), s = source(structuredClone(originalSource), i, c)
  const manifest = await prepareWebsiteNativeManifest(s, structuredClone(layout))
  const value = { version: 1, identity: i, context: c, chat_review_sha256: s.chat_review_sha256, review_sha256: s.review_sha256, architecture_approval_id: s.architecture.approval_id, manifest }
  return freeze({ ...value, sha256: await websiteNativeSnapshotChecksum(value) })
}
const rpcIdentity = i => ({ p_organization_id: i.organization_id, p_project_id: i.project_id, p_conversation_id: i.conversation_id, p_source_message_id: i.source_message_id, p_request_id: i.request_id })
function receipt(r, i, c) {
  exact(r, ['version', 'kind', 'status', ...identityFields, 'engagement_id', 'actor_id', 'selection', 'handoff_request_id', 'source_work', 'receiving_work', 'output', 'review_required'])
  need(object(r) && r.version === 1 && r.kind === 'save_native_design' && r.status === 'design_draft_saved' && r.review_required === true
    && ['organization_id', 'project_id', 'conversation_id'].every(k => r[k] === i[k]) && ['engagement_id', 'actor_id', 'request_id', 'source_message_id', 'handoff_request_id'].every(k => id(r[k]))
    && (!i.request_id || i.request_id === r.request_id) && (!i.source_message_id || i.source_message_id === r.source_message_id)
    && Object.hasOwn(r, 'selection'), 'Receipt differs from original native Design Chat request')
  work(r.source_work); work(r.receiving_work); selection(r.selection, r)
  need(r.source_work.id !== r.receiving_work.id, 'Native receipt conflates source and receiving Work')
  const o = r.output
  exact(o, ['kind', 'design_id', 'page_id', 'parent_design_id', 'version_number', 'request_sha256'])
  need(o.kind === 'website_native_design' && id(o.design_id) && id(o.page_id) && (o.parent_design_id === null || id(o.parent_design_id))
    && Number.isSafeInteger(o.version_number) && o.version_number > 0 && sha(o.request_sha256), 'Exact native design result required, not an artifact version or completion')
  if (r.selection?.partition.kind === 'website_page') need(r.selection.partition.id === o.page_id, 'Receipt result differs from original selected page')
  if (c) need(r.engagement_id === c.engagement_id && r.handoff_request_id === c.handoff_request_id && same(r.selection, c.selection)
    && same(r.source_work, c.source_work) && same(r.receiving_work, c.receiving_work) && o.page_id === c.page_id && o.parent_design_id === c.expected_parent_design_id, 'Saved native result differs from exact reviewed handoff, Work or parent')
  return freeze(structuredClone(r))
}
export function createProjectChatNativeDesignRepository(client) {
  need(typeof client?.rpc === 'function' && typeof client?.functions?.invoke === 'function', 'Authenticated native Design client required')
  const read = async (name, args, { signal } = {}) => {
    signal?.throwIfAborted(); let request = client.rpc(name, args)
    if (signal && request.abortSignal) request = request.abortSignal(signal)
    const { data, error } = await request; signal?.throwIfAborted(); if (error) throw error; return data
  }
  return Object.freeze({
    prepare: prepareProjectChatNativeDesignAction,
    async load(originalIdentity, originalContext, options) {
      const i = identity(originalIdentity), c = context(originalContext, i)
      const data = await read('get_project_chat_native_design_source', { p_organization_id: i.organization_id, p_project_id: i.project_id, p_conversation_id: i.conversation_id, p_source_message_id: i.source_message_id, p_context: c }, options)
      return freeze(structuredClone(source(data, i, c)))
    },
    async confirm(proposal, { signal } = {}) {
      exact(proposal, ['version', 'identity', 'context', 'chat_review_sha256', 'review_sha256', 'architecture_approval_id', 'manifest', 'sha256'])
      const { sha256: expected, ...snapshot } = structuredClone(proposal)
      need(snapshot.version === 1 && sha(expected) && expected === await websiteNativeSnapshotChecksum(snapshot), 'Reviewed native proposal changed')
      const i = identity(snapshot.identity), c = context(snapshot.context, i)
      need(sha(snapshot.chat_review_sha256) && sha(snapshot.review_sha256) && id(snapshot.architecture_approval_id), 'Exact reviewed native source required')
      const manifest = validateWebsiteNativeDesign(snapshot.manifest)
      need(['organization_id', 'project_id'].every(k => manifest.scope[k] === i[k]) && manifest.scope.engagement_id === c.engagement_id && manifest.scope.page_id === c.page_id
        && manifest.sources.architecture.version_id === c.architecture_version_id && manifest.sources.brief.version_id === c.brief_version_id && manifest.sources.site_system.version_id === c.site_version_id, 'Reviewed native manifest differs from original context')
      const original = freeze({ ...snapshot, sha256: expected })
      signal?.throwIfAborted()
      try {
        const envelope = await client.functions.invoke('website-native-design', { body: { action: 'save_chat_design', ...i, engagement_id: c.engagement_id, context: c, chat_review_sha256: snapshot.chat_review_sha256, review_sha256: snapshot.review_sha256, architecture_approval_id: snapshot.architecture_approval_id, manifest: snapshot.manifest }, signal })
        let details = envelope.data
        if (envelope.error?.context?.clone) try { details = await envelope.error.context.clone().json() } catch { /* Preserve unknown original request. */ }
        if (envelope.error || details?.error) throw Object.assign(new Error(details?.error || envelope.error?.message || 'Native Design result is unknown'), { code: details?.code, knownRollback: details?.rollback_verified === true })
        return receipt(envelope.data?.data, i, c)
      } catch (cause) {
        throw Object.assign(new Error(cause?.message || 'Check the original native Design request'), { cause, code: cause?.code, knownRollback: cause?.knownRollback === true, outcome: cause?.knownRollback === true ? cause.code === '40001' ? 'stale' : 'blocked' : 'unknown', proposal: original })
      }
    },
    async recover(originalIdentity, options) {
      const i = identity(originalIdentity), data = await read('recover_project_chat_native_design_action', rpcIdentity(i), options)
      need(object(data) && ['recorded', 'not_recorded'].includes(data.status), 'Original native recovery unavailable')
      if (data.status === 'not_recorded') { need(data.must_not_submit === true, 'Missing receipt cannot authorize resend'); return freeze(structuredClone(data)) }
      return freeze({ ...data, receipt: receipt(data.receipt, i) })
    },
    async list(scope, { limit = 25, offset = 0, signal } = {}) {
      exact(scope, ['organization_id', 'project_id', 'conversation_id'])
      need(Object.values(scope).every(id) && Number.isSafeInteger(limit) && limit >= 1 && limit <= 50 && Number.isSafeInteger(offset) && offset >= 0, 'Bounded original native Chat history required')
      const data = await read('read_project_chat_native_design_actions', { p_organization_id: scope.organization_id, p_project_id: scope.project_id, p_conversation_id: scope.conversation_id, p_limit: limit, p_offset: offset }, { signal })
      need(object(data) && data.limit === limit && data.offset === offset && typeof data.has_more === 'boolean' && Array.isArray(data.items) && data.items.length <= limit, 'Native receipt page differs from requested bounds')
      const items = data.items.map(r => receipt(r, scope)); need(new Set(items.map(r => r.request_id)).size === items.length, 'Duplicate native request receipts')
      return freeze({ ...data, items })
    },
    async design(scope, designId, options) {
      exact(scope, ['organization_id', 'project_id', 'engagement_id']); need(Object.values(scope).every(id) && id(designId), 'Exact saved native design identity required')
      const data = await read('get_website_native_design', { p_organization_id: scope.organization_id, p_project_id: scope.project_id, p_engagement_id: scope.engagement_id, p_design_id: designId }, options)
      need(object(data) && ['organization_id', 'project_id', 'engagement_id'].every(k => data[k] === scope[k]) && data.design_id === designId, 'Saved native design belongs to another context')
      return freeze(structuredClone(data))
    },
  })
}
