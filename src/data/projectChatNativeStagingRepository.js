import { stagingOrigin } from '../../supabase/functions/_shared/websiteStagingContracts.js'
import { nativeChatTransport as n } from './projectChatNativeBuildRepository.js'
function review(v, i, c) {
  n.need(n.object(v) && ['organization_id', 'project_id'].every(k => v[k] === i[k]) && v.engagement_id === c.engagement_id && ['job_id', 'page_id', 'target_id'].every(k => v[k] === c[k]) && n.id(v.site_id) && (v.remote_head === null || n.id(v.remote_head)) && n.sha(v.package_sha256) && v.environment === 'staging' && v.published === false && stagingOrigin(v.base_url) === v.base_url, 'Exact bound private staging dry-run required')
  n.metadata(v, i, c, true); return v
}
function state(v, r, reviewed) {
  n.need(stagingOrigin(r.output.base_url) === r.output.base_url, 'Original bound staging origin required')
  if (reviewed) n.need(r.output.package_sha256 === reviewed.package_sha256 && r.output.base_url === reviewed.base_url && r.output.site_id === reviewed.site_id, 'Claim differs from reviewed staging package or bound site')
  n.exact(v, ['kind', 'status', 'evidence'])
  n.need(v.kind === 'website_private_staging' && ['processing', 'uncertain', 'staged', 'failed'].includes(v.status) && (v.evidence === null || n.object(v.evidence) && new TextEncoder().encode(JSON.stringify(v.evidence)).length <= 16000), 'Original private staging state required')
  if (v.evidence !== null) {
    const e = v.evidence
    n.need(e.environment === 'staging' && e.published === false && e.request_id === r.request_id && e.site_id === r.output.site_id && e.package_sha256 === r.output.package_sha256 && e.base_url === r.output.base_url, 'Original staging evidence differs')
    if (reviewed) n.need(e.package_sha256 === reviewed.package_sha256 && e.base_url === reviewed.base_url && e.site_id === reviewed.site_id, 'Staging evidence differs from reviewed package or bound site')
    n.need(v.status === 'staged' || !Object.hasOwn(e, 'preview_url'), 'Pending or failed evidence cannot provide a preview')
  }
  if (v.status === 'staged') n.need(v.evidence?.status === 'staged' && v.evidence.preview_verified === true && v.evidence.preview_url === v.evidence.base_url + '/?anka_staging_preview=' + r.request_id, 'Verified original staging preview required')
  return v
}
export const prepareProjectChatNativeStagingAction = (i, c, r) => n.prepare(i, c, r, review, true)
export function createProjectChatNativeStagingRepository(client) {
  const t = n.transport(client)
  return Object.freeze({
    async review(i, c, options) { i = n.identity(i, true); c = n.context(c, i, true); const body = { action: 'dry-run-chat', ...i, engagement_id: c.engagement_id, context: c }; return t.invoke('website-staging', body, v => review(v, i, c), null, options) },
    prepare: prepareProjectChatNativeStagingAction,
    async confirm(p, options) { p = await n.proposal(p, review, true); return t.invoke('website-staging', { action: 'deploy-chat', ...p.identity, engagement_id: p.context.engagement_id, context: p.context, remote_head: p.review.remote_head, review_sha256: p.review.review_sha256, chat_review_sha256: p.review.chat_review_sha256 }, v => n.result(v, p.identity, p.context, (s, r) => state(s, r, p.review), true, p.review.chat_context.actor_id), p, options) },
    async recover(i, options) { i = n.identity(i); return n.recovery(await t.read('recover_project_chat_native_staging_action', n.args(i), options), i, state, true) },
    async reconcile(i, engagementId, options) { i = n.identity(i); n.need(n.id(engagementId), 'Original staging engagement required'); return t.invoke('website-staging', { action: 'recover-chat', ...i, engagement_id: engagementId }, v => { const result = n.result(v, i, null, state, true); n.need(result.receipt.engagement_id === engagementId, 'Original staging engagement differs'); return result }, n.copy({ identity: i, engagement_id: engagementId }), options) },
    list: (scope, options) => n.list(t, 'staging', scope, options, state, true),
  })
}
