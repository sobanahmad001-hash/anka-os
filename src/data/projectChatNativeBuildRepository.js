import { websiteNativeSnapshotChecksum } from '../../supabase/functions/_shared/websiteNativeDesign.js'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id = v => typeof v === 'string' && UUID.test(v)
const sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const need = (v, message) => { if (!v) throw Error(message) }
const object = v => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const exact = (v, keys) => need(object(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(','), 'Exact native Chat fields required')
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }
const copy = v => freeze(structuredClone(v))
const sorted = v => Array.isArray(v) ? v.map(sorted) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
const identityKeys = ['organization_id', 'project_id', 'conversation_id', 'source_message_id', 'request_id']
function identity(v, review = false) { exact(v, identityKeys.filter(k => !review || k !== 'request_id')); need(Object.values(v).every(id), 'Original Chat identities required'); return structuredClone(v) }
function selection(v, scope) {
  if (v === null) return
  exact(v, ['version', 'organization_id', 'project_id', 'engagement_id', 'plan_id', 'group_id', 'phase', 'partition', 'context_sha256'])
  need(v.version === 1 && ['organization_id', 'project_id', 'engagement_id'].every(k => id(v[k]) && v[k] === scope[k]) && id(v.plan_id) && id(v.group_id) && typeof v.phase === 'string' && /^(branding|website|marketing)\.[a-z_]{1,40}$/.test(v.phase) && sha(v.context_sha256), 'Original selected stage required')
  exact(v.partition, v.partition?.kind === 'website_page' ? ['kind', 'id', 'architecture_version_id'] : ['kind', 'id'])
  need(['engagement', 'website_page', 'campaign_asset', 'recurring_occurrence'].includes(v.partition.kind) && id(v.partition.id) && (v.partition.kind !== 'website_page' || id(v.partition.architecture_version_id)), 'Exact selected partition required')
}
function preserveStage(current, original) {
  const omit = v => v === null ? null : Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'context_sha256'))
  need(same(omit(current), omit(original)), 'Origin stage must be preserved except its verified context hash')
}
function context(v, i, stage = false) {
  exact(v, stage ? ['engagement_id', 'selection', 'build_request_id', 'job_id', 'design_id', 'page_id', 'target_id', 'previous_run_id'] : ['engagement_id', 'selection', 'design_request_id', 'design_id', 'page_id'])
  need(Object.entries(v).every(([k, value]) => k === 'selection' || k === 'previous_run_id' && value === null || id(value)), 'Exact native source context required')
  selection(v.selection, { ...i, engagement_id: v.engagement_id })
  if (v.selection?.partition.kind === 'website_page') need(v.selection.partition.id === v.page_id, 'Selected stage page differs')
  return structuredClone(v)
}
const receiptKeys = ['version', 'kind', 'status', ...identityKeys, 'engagement_id', 'actor_id', 'selection', 'origin_request_id', 'output']
function claim(r, i, c, stage = false) {
  exact(r, receiptKeys)
  need(r.version === 1 && r.kind === (stage ? 'stage_native_package' : 'build_native_package') && r.status === 'claimed' && [...identityKeys, 'engagement_id', 'actor_id', 'origin_request_id'].every(k => id(r[k])) && ['organization_id', 'project_id', 'conversation_id', ...i.request_id ? ['request_id', 'source_message_id'] : []].every(k => r[k] === i[k]), 'Original native Chat claim differs')
  selection(r.selection, r)
  exact(r.output, stage ? ['kind', 'run_id', 'job_id', 'design_id', 'page_id', 'target_id', 'site_id', 'previous_run_id', 'package_sha256', 'base_url'] : ['kind', 'job_id', 'design_id', 'page_id'])
  need(r.output.kind === (stage ? 'website_private_staging' : 'website_native_package') && Object.entries(r.output).every(([k, v]) => k === 'kind' ? true : k === 'package_sha256' ? sha(v) : k === 'base_url' ? typeof v === 'string' : k === 'previous_run_id' && v === null || id(v)), 'Typed native claim output required')
  if (r.selection?.partition.kind === 'website_page') need(r.selection.partition.id === r.output.page_id, 'Claim stage page differs')
  if (c) need(r.engagement_id === c.engagement_id && same(r.selection, c.selection) && r.origin_request_id === c[stage ? 'build_request_id' : 'design_request_id'] && ['design_id', 'page_id', ...stage ? ['job_id', 'target_id', 'previous_run_id'] : []].every(k => r.output[k] === c[k]), 'Claim differs from reviewed native context')
  return r
}
function metadata(v, i, c, stage = false) {
  const m = v.chat_context
  exact(m, ['version', 'organization_id', 'project_id', 'engagement_id', 'conversation_id', 'source_message_id', 'actor_id', 'context', 'origin_receipt'])
  need(m.version === 1 && ['organization_id', 'project_id', 'conversation_id', 'source_message_id'].every(k => m[k] === i[k]) && m.engagement_id === c.engagement_id && id(m.actor_id) && same(m.context, c) && sha(v.review_sha256) && sha(v.chat_review_sha256), 'Exact reviewed Chat metadata required')
  const r = m.origin_receipt
  if (stage) claim(r, { organization_id: i.organization_id, project_id: i.project_id, conversation_id: i.conversation_id })
  else {
    exact(r, ['version', 'kind', 'status', ...identityKeys, 'engagement_id', 'actor_id', 'selection', 'handoff_request_id', 'source_work', 'receiving_work', 'output', 'review_required'])
    need(r.version === 1 && r.kind === 'save_native_design' && r.status === 'design_draft_saved' && r.review_required === true && ['request_id', 'source_message_id', 'handoff_request_id'].every(k => id(r[k])), 'Original native Design receipt required')
    selection(r.selection, r)
    for (const w of [r.source_work, r.receiving_work]) { exact(w, ['id', 'row_version']); need(id(w.id) && Number.isSafeInteger(w.row_version) && w.row_version > 0, 'Original Design Work reference required') }
    need(r.source_work.id !== r.receiving_work.id, 'Original Design Work references must remain distinct')
    exact(r.output, ['kind', 'design_id', 'page_id', 'parent_design_id', 'version_number', 'request_sha256'])
    need(r.output.kind === 'website_native_design' && id(r.output.design_id) && id(r.output.page_id) && (r.output.parent_design_id === null || id(r.output.parent_design_id)) && Number.isSafeInteger(r.output.version_number) && r.output.version_number > 0 && sha(r.output.request_sha256), 'Original native Design output required')
  }
  need(['organization_id', 'project_id', 'engagement_id', 'conversation_id', 'actor_id'].every(k => r[k] === m[k]) && r.request_id === c[stage ? 'build_request_id' : 'design_request_id'] && r.output.design_id === c.design_id && r.output.page_id === c.page_id && (!stage || r.output.job_id === c.job_id), 'Origin receipt differs from exact native source')
  preserveStage(c.selection, r.selection)
}
function review(v, i, c) {
  need(object(v) && ['organization_id', 'project_id'].every(k => v[k] === i[k]) && v.engagement_id === c.engagement_id && v.design_id === c.design_id && v.page_id === c.page_id && v.manifest?.scope?.organization_id === i.organization_id && v.manifest?.scope?.project_id === i.project_id && v.manifest?.scope?.engagement_id === c.engagement_id && v.manifest?.scope?.page_id === c.page_id && Array.isArray(v.stale_sources) && v.stale_sources.length === 0 && v.delivery_approved === false && v.staging === false && v.published === false, 'Exact current native build review required')
  metadata(v, i, c); return v
}
function state(v) {
  exact(v, ['kind', 'status', 'original_status', 'execution_window_expired', 'artifact_sha256', 'source_sha256', 'package_bytes', 'source_bytes', 'stale_sources', 'failure_reason'])
  need(v.kind === 'website_native_package' && ['processing', 'complete', 'failed'].includes(v.status) && ['processing', 'complete', 'failed'].includes(v.original_status) && typeof v.execution_window_expired === 'boolean' && (v.execution_window_expired ? v.status === 'failed' && v.original_status === 'processing' : v.status === v.original_status) && ['artifact_sha256', 'source_sha256'].every(k => v[k] === null || sha(v[k])) && ['package_bytes', 'source_bytes'].every(k => v[k] === null || Number.isSafeInteger(v[k]) && v[k] > 0) && Array.isArray(v.stale_sources) && v.stale_sources.every(x => typeof x === 'string') && (v.failure_reason === null || typeof v.failure_reason === 'string'), 'Exact original native job state required')
  if (v.status === 'complete') need(sha(v.artifact_sha256) && sha(v.source_sha256) && v.package_bytes > 0 && v.source_bytes > 0, 'Completed package checksums and lengths required')
  return v
}
async function prepare(i, c, r, validate, stage = false) {
  i = identity(i); c = context(c, i, stage); r = structuredClone(r); validate(r, i, c)
  const value = { version: 1, identity: i, context: c, review: r }
  return copy({ ...value, sha256: await websiteNativeSnapshotChecksum(value) })
}
async function proposal(p, validate, stage = false) {
  exact(p, ['version', 'identity', 'context', 'review', 'sha256'])
  const { sha256: hash, ...v } = structuredClone(p)
  need(v.version === 1 && sha(hash) && await websiteNativeSnapshotChecksum(v) === hash, 'Reviewed native proposal changed')
  identity(v.identity); context(v.context, v.identity, stage); validate(v.review, v.identity, v.context)
  return copy({ ...v, sha256: hash })
}
const args = i => Object.fromEntries(Object.entries(i).map(([k, v]) => [`p_${k}`, v]))
function transport(client) {
  need(typeof client?.rpc === 'function' && typeof client?.functions?.invoke === 'function', 'Authenticated native Chat client required')
  return {
    async read(name, input, { signal } = {}) { signal?.throwIfAborted(); let q = client.rpc(name, input); if (signal && q.abortSignal) q = q.abortSignal(signal); const result = await q; signal?.throwIfAborted(); if (result.error) throw result.error; return result.data },
    async invoke(name, body, validate, original, { signal } = {}) {
      signal?.throwIfAborted()
      try {
        const envelope = await client.functions.invoke(name, { body, signal }); let detail = envelope.data
        if (envelope.error?.context?.clone) try { detail = await envelope.error.context.clone().json() } catch { /* Keep original request uncertain. */ }
        if (envelope.error || detail?.error) throw Object.assign(Error(detail?.error || envelope.error?.message || 'Native outcome is unknown'), { code: detail?.code, knownRollback: detail?.rollback_verified === true && detail?.request_retained !== true, requestRetained: detail?.request_retained === true })
        return copy(validate(envelope.data?.data))
      } catch (cause) { throw Object.assign(Error(cause?.message || 'Check the original native request'), { cause, code: cause?.code, knownRollback: cause?.knownRollback === true, requestRetained: cause?.requestRetained === true, outcome: cause?.knownRollback === true ? cause.code === '40001' ? 'stale' : 'blocked' : 'unknown', proposal: original }) }
    },
  }
}
function result(v, i, c, validateState, stage = false, actor = null) { exact(v, ['receipt', 'state', 'replayed']); need(typeof v.replayed === 'boolean', 'Native replay marker required'); claim(v.receipt, i, c, stage); if (actor) need(v.receipt.actor_id === actor, 'Original reviewed actor differs'); validateState(v.state, v.receipt); return v }
function recovery(v, i, validateState, stage = false) {
  need(object(v) && v.must_not_submit === true, 'Recovery never authorizes submission')
  if (v.status === 'not_recorded') exact(v, ['status', 'must_not_submit'])
  else { exact(v, ['status', 'receipt', 'state', 'must_not_submit']); need(v.status === 'recorded', 'Original native recovery required'); claim(v.receipt, i, null, stage); validateState(v.state, v.receipt) }
  return copy(v)
}
async function list(t, operation, scope, options = {}, validateState, stage = false) {
  exact(scope, ['organization_id', 'project_id', 'conversation_id']); need(Object.values(scope).every(id), 'Owned Chat scope required')
  const { limit = 25, offset = 0, signal } = options
  need(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 && Number.isSafeInteger(offset) && offset >= 0 && offset <= 10000, 'Bounded native Chat history required')
  const v = await t.read(`read_project_chat_native_${operation}_actions`, { ...args(scope), p_limit: limit, p_offset: offset }, { signal })
  exact(v, ['items', 'limit', 'offset', 'has_more']); need(v.limit === limit && v.offset === offset && typeof v.has_more === 'boolean' && Array.isArray(v.items) && v.items.length <= limit, 'Exact native history page required')
  for (const item of v.items) { exact(item, ['receipt', 'state']); claim(item.receipt, scope, null, stage); validateState(item.state, item.receipt) }
  need(new Set(v.items.map(x => x.receipt.request_id)).size === v.items.length, 'Duplicate native claim history')
  return copy(v)
}
// Shared validation is used only by the companion native staging transport.
export const nativeChatTransport = Object.freeze({ id, sha, need, object, exact, copy, identity, context, metadata, prepare, proposal, args, transport, result, recovery, list })
export const prepareProjectChatNativeBuildAction = (i, c, r) => prepare(i, c, r, review)
export function createProjectChatNativeBuildRepository(client) {
  const t = transport(client)
  return Object.freeze({
    async review(i, c, options) { i = identity(i, true); c = context(c, i); return copy(review(await t.read('get_project_chat_native_build_review', { ...args(i), p_context: c }, options), i, c)) },
    prepare: prepareProjectChatNativeBuildAction,
    async confirm(p, options) { p = await proposal(p, review); return t.invoke('website-native-build', { action: 'build_chat', ...p.identity, engagement_id: p.context.engagement_id, context: p.context, review_sha256: p.review.review_sha256, chat_review_sha256: p.review.chat_review_sha256 }, v => result(v, p.identity, p.context, state, false, p.review.chat_context.actor_id), p, options) },
    async recover(i, options) { i = identity(i); return recovery(await t.read('recover_project_chat_native_build_action', args(i), options), i, state) },
    list: (scope, options) => list(t, 'build', scope, options, state),
  })
}
