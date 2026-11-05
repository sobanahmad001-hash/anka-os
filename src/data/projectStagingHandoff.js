import {uuid} from '../../supabase/functions/_shared/websiteStagingContracts.js'
import {deliveryScope, sameDeliveryScope, freezeDelivery, projectDeliveryTargetContext} from './projectDeliveryTargetContext.js'

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const exactId = value => {if (!uuid(value)) throw Error('Exact staging handoff identity required'); return value}
const active = signal => {if (signal?.aborted) throw Error('Project delivery context changed')}
const sourceKeys = ['architecture', 'content', 'brief', 'site_system']
function sources(value) {
  if (!value || Object.keys(value).length !== sourceKeys.length) throw Error('Exact canonical source versions required')
  return Object.fromEntries(sourceKeys.map(key => {
    const ref = value[key]
    if (!uuid(ref?.version_id) || !hash(ref?.checksum)) throw Error('Exact canonical source version and checksum required')
    return [key, {version_id: ref.version_id, checksum: ref.checksum}]
  }))
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
async function checksum(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

// This adapter reads existing canonical records only. It exposes no deploy, publish,
// inspect, bind, provider-test or resend operation. Proposals are not authorization.
export function createProjectStagingHandoff({staging, blocks}) {
  return Object.freeze({
    async propose(scope, input, {signal} = {}) {
      active(signal)
      const context = deliveryScope(scope)
      const selection = {target_id: exactId(input.targetId), job_id: exactId(input.jobId), page_id: exactId(input.pageId), design_id: exactId(input.designId), package_sha256: input.packageSha256, sources: sources(input.sources)}
      if (!hash(selection.package_sha256)) throw Error('Exact completed package checksum required')
      const workspace = await staging.workspace(scope, {signal})
      active(signal)
      const resolved = projectDeliveryTargetContext(scope, workspace, {targetId: selection.target_id})
      if (resolved.state !== 'ready') return resolved
      const build = await blocks.workspace(scope, {designId: selection.design_id, signal})
      active(signal)
      if (!sameDeliveryScope(build, scope) || !Array.isArray(build.jobs)) throw Error('Build workspace belongs to another project')
      const matches = build.jobs.filter(job => job.id === selection.job_id)
      if (matches.length !== 1) return freezeDelivery({state: 'package_unavailable', next_action: 'select_exact_completed_package'})
      const job = matches[0]
      if (!sameDeliveryScope(job, scope) || job.page_id !== selection.page_id || job.website_page_design_id !== selection.design_id || job.artifact_sha256 !== selection.package_sha256) throw Error('Selected package differs from canonical build')
      if (job.status !== 'complete' || !Array.isArray(job.stale_sources) || job.stale_sources.length) return freezeDelivery({state: 'package_needs_review', next_action: 'review_current_sources_and_build'})
      const review = await blocks.review(scope, selection.design_id, {signal})
      active(signal)
      if (!sameDeliveryScope(review, scope) || review.design_id !== selection.design_id || review.page_id !== selection.page_id || !sameDeliveryScope(review.manifest?.scope, scope) || review.manifest.scope.page_id !== selection.page_id || !same(sources(review.manifest.sources), selection.sources)) throw Error('Selected source versions differ from canonical design')
      if (!Array.isArray(review.stale_sources) || review.stale_sources.length) return freezeDelivery({state: 'package_needs_review', next_action: 'review_current_sources_and_build'})
      const dryRun = await staging.dryRun(scope, selection.target_id, selection.job_id, {signal})
      active(signal)
      const destination = resolved.destination
      if (!sameDeliveryScope(dryRun, scope) || dryRun.target_id !== selection.target_id || dryRun.job_id !== selection.job_id || dryRun.page_id !== selection.page_id || dryRun.site_id !== destination.site_id || dryRun.base_url !== destination.base_url || dryRun.package_sha256 !== selection.package_sha256 || !hash(dryRun.review_sha256) || !(dryRun.remote_head === null || uuid(dryRun.remote_head)) || dryRun.environment !== 'staging' || dryRun.published !== false) throw Error('Exact staging review differs from selected destination or package')
      const snapshot = {...context, kind: 'website_staging_handoff', destination, selection, review_sha256: dryRun.review_sha256, remote_head: dryRun.remote_head, environment: 'staging', published: false, publication_authorized: false}
      const proposal = {...snapshot, proposal_sha256: await checksum(snapshot)}
      active(signal)
      return freezeDelivery({state: 'ready_for_review', proposal, next_action: 'review_private_staging_delivery', execution_available: false})
    },

    async status(scope, proposal, requestId, {offset = 0, signal} = {}) {
      active(signal)
      exactId(requestId)
      if (!sameDeliveryScope(proposal, scope) || proposal.kind !== 'website_staging_handoff' || proposal.environment !== 'staging' || proposal.published !== false || proposal.publication_authorized !== false) throw Error('Original staging proposal context differs')
      const {proposal_sha256: digest, ...snapshot} = proposal
      if (!hash(digest) || digest !== await checksum(snapshot)) throw Error('Original reviewed staging proposal changed')
      if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw Error('Bounded staging history offset required')
      const workspace = await staging.workspace(scope, {offset, signal})
      active(signal)
      if (!sameDeliveryScope(workspace, scope) || !Array.isArray(workspace.runs)) throw Error('Staging history belongs to another project')
      const matches = workspace.runs.filter(run => run.request_id === requestId)
      if (matches.length > 1) throw Error('Duplicate original staging receipt')
      const run = matches[0]
      if (!run) return freezeDelivery({state: 'unverified', request_id: requestId, next_action: workspace.has_more ? 'read_more_history' : 'recover_original_request', has_more: workspace.has_more === true})
      if (!sameDeliveryScope(run, scope) || run.target_id !== proposal.selection.target_id || run.job_id !== proposal.selection.job_id || run.page_id !== proposal.selection.page_id || run.review_sha256 !== proposal.review_sha256 || run.remote_head !== proposal.remote_head || (scope.actorId && run.created_by !== scope.actorId)) throw Error('Original request belongs to different reviewed inputs')
      exactId(run.id)
      const evidence = run.evidence
      let preview = null
      if (run.status === 'staged') {
        if (evidence?.environment !== 'staging' || evidence.published !== false || evidence.preview_verified !== true || evidence.site_id !== proposal.destination.site_id || evidence.base_url !== proposal.destination.base_url || evidence.package_sha256 !== proposal.selection.package_sha256 || evidence.preview_url !== proposal.destination.base_url + '/?anka_staging_preview=' + requestId) throw Error('Verified private preview evidence differs')
        preview = evidence.preview_url
      }
      return freezeDelivery({state: run.status === 'staged' ? 'staged' : run.status === 'failed' ? 'failed' : 'unverified',
        request_id: requestId, run_id: run.id, proposal_sha256: digest, selection: structuredClone(proposal.selection), destination: structuredClone(proposal.destination),
        preview_url: preview, evidence_basis: 'retained_receipt', remote_head_verified: false,
        environment: 'staging', published: false, publication_authorized: false,
        next_action: preview ? 'review_private_preview' : 'recover_original_request'})
    },
  })
}
