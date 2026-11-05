import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectStagingHandoff} from './projectStagingHandoff.js'

const id = n => 'b0000000-0000-4000-8000-' + String(n).padStart(12, '0')
const scope = {organizationId: id(1), projectId: id(2), engagementId: id(3), actorId: id(20)}
const row = {organization_id: id(1), project_id: id(2), engagement_id: id(3)}
const sha = 'a'.repeat(64)
function fixture() {
  const calls = [], source = Object.fromEntries(['architecture', 'content', 'brief', 'site_system'].map((key, i) => [key, {version_id: id(10 + i), checksum: sha}]))
  const input = {targetId: id(4), jobId: id(7), pageId: id(8), designId: id(9), packageSha256: sha, sources: source}
  const target = {...row, id: id(4), connection_id: id(5), site_id: id(6), current: true, version_number: 1, connection_revision: '2026-10-29T11:00:00Z', base_url: 'https://stage.example.test'}
  const job = {...row, id: input.jobId, page_id: input.pageId, website_page_design_id: input.designId, artifact_sha256: sha, status: 'complete', stale_sources: []}
  const review = {...row, design_id: input.designId, page_id: input.pageId, manifest: {scope: {...row, page_id: input.pageId}, sources: source}, stale_sources: []}
  const dry = {...row, target_id: target.id, job_id: job.id, page_id: job.page_id, site_id: target.site_id, base_url: target.base_url, package_sha256: sha, review_sha256: 'b'.repeat(64), remote_head: null, environment: 'staging', published: false}
  const workspace = {...row, targets: [target], runs: [], has_more: false}
  const forbidden = () => {throw Error('Unexpected write/recovery/provider operation')}
  const staging = {workspace: async () => {calls.push('workspace'); return workspace}, dryRun: async () => {calls.push('dryRun'); return dry}, deploy: forbidden, recover: forbidden, inspect: forbidden, bind: forbidden}
  const builds = {...row, jobs: [job]}
  const blocks = {workspace: async (_scope, options) => {calls.push(['buildWorkspace', options.designId]); return builds}, review: async () => {calls.push('review'); return review}, build: forbidden}
  const adapter = createProjectStagingHandoff({staging, blocks})
  return {adapter, calls, input, target, job, review, dry, workspace, builds, staging}
}
async function proposed(f) {return (await f.adapter.propose(scope, f.input)).proposal}
function runFor(f, requestId = id(30)) {
  return {...row, id: id(31), request_id: requestId, created_by: scope.actorId, target_id: f.target.id, job_id: f.job.id, page_id: f.job.page_id, review_sha256: f.dry.review_sha256, remote_head: null, status: 'staged', evidence: {environment: 'staging', published: false, preview_verified: true, site_id: f.target.site_id, base_url: f.target.base_url, package_sha256: sha, preview_url: f.target.base_url + '/?anka_staging_preview=' + requestId}}
}
test('proposal preserves exact source versions and destination, with a stable immutable checksum', async () => {
  const f = fixture(), first = await f.adapter.propose(scope, f.input), second = await f.adapter.propose(scope, f.input)
  assert.equal(first.state, 'ready_for_review')
  assert.equal(first.execution_available, false)
  assert.deepEqual(first.proposal.selection.sources, f.input.sources)
  assert.equal(first.proposal.proposal_sha256, second.proposal.proposal_sha256)
  assert.ok(Object.isFrozen(first.proposal.selection.sources.content))
  f.input.sources.content.version_id = id(99)
  assert.equal(first.proposal.selection.sources.content.version_id, id(11))
  assert.equal(first.proposal.publication_authorized, false)
})
test('unavailable target and stale/incomplete package return actionable states before dry-run', async () => {
  const f = fixture(); f.target.current = false
  assert.equal((await f.adapter.propose(scope, f.input)).state, 'destination_unavailable')
  assert.deepEqual(f.calls, ['workspace'])
  for (const change of [{status: 'processing'}, {stale_sources: ['Content']}]) {
    const f = fixture(); Object.assign(f.job, change)
    assert.equal((await f.adapter.propose(scope, f.input)).state, 'package_needs_review')
    assert.equal(f.calls.includes('dryRun'), false)
  }
})
test('other page/design/package/scope and changed source versions cannot pass canonical checks', async () => {
  for (const change of [{page_id: id(99)}, {website_page_design_id: id(99)}, {artifact_sha256: 'c'.repeat(64)}, {project_id: id(99)}]) {
    const f = fixture(); Object.assign(f.job, change)
    await assert.rejects(f.adapter.propose(scope, f.input)); assert.equal(f.calls.includes('dryRun'), false)
  }
  const f = fixture(); f.review.manifest.sources = structuredClone(f.input.sources); f.review.manifest.sources.content.version_id = id(99)
  await assert.rejects(f.adapter.propose(scope, f.input)); assert.equal(f.calls.includes('dryRun'), false)
})
test('changed receiver identity, package, page, publication flag or remote head cannot become a proposal', async () => {
  for (const change of [{site_id: id(99)}, {base_url: 'https://live.example.test'}, {package_sha256: 'c'.repeat(64)}, {page_id: id(99)}, {published: true}, {remote_head: 'bad'}]) {
    const f = fixture(); Object.assign(f.dry, change); await assert.rejects(f.adapter.propose(scope, f.input))
  }
})
test('aborted requests and abort after an awaited read cannot continue to a later operation', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort()
  await assert.rejects(f.adapter.propose(scope, f.input, {signal: controller.signal})); assert.equal(f.calls.length, 0)
  const g = fixture(), next = new AbortController()
  g.staging.workspace = async () => {next.abort(); return g.workspace}
  await assert.rejects(g.adapter.propose(scope, g.input, {signal: next.signal})); assert.equal(g.calls.length, 0)
})
test('history status returns exact verified private preview and sanitized canonical identities without recovery', async () => {
  const f = fixture(), proposal = await proposed(f), run = runFor(f)
  run.evidence.secret = 'synthetic secret'; f.workspace.runs.push(run)
  const status = await f.adapter.status(scope, proposal, id(30))
  assert.equal(status.state, 'staged'); assert.equal(status.preview_url, run.evidence.preview_url)
  assert.equal(status.evidence_basis, 'retained_receipt'); assert.equal(status.remote_head_verified, false)
  assert.deepEqual(status.selection, proposal.selection)
  assert.equal(status.published, false); assert.equal(JSON.stringify(status).includes('synthetic secret'), false)
})
test('missing/paged/processing history never infers success or rollback and never resends', async () => {
  const f = fixture(), proposal = await proposed(f)
  assert.equal((await f.adapter.status(scope, proposal, id(30))).state, 'unverified')
  f.workspace.has_more = true
  assert.equal((await f.adapter.status(scope, proposal, id(30))).next_action, 'read_more_history')
  f.workspace.runs.push({...runFor(f), status: 'processing', evidence: null})
  const status = await f.adapter.status(scope, proposal, id(30))
  assert.equal(status.state, 'unverified'); assert.equal(status.preview_url, null)
})
test('status rejects altered proposals, foreign original requests and false preview evidence', async () => {
  for (const change of [{job_id: id(99)}, {page_id: id(99)}, {review_sha256: 'c'.repeat(64)}, {created_by: id(99)}, {remote_head: id(99)}]) {
    const f = fixture(), proposal = await proposed(f); f.workspace.runs.push({...runFor(f), ...change})
    await assert.rejects(f.adapter.status(scope, proposal, id(30)))
  }
  for (const change of [{preview_verified: false}, {site_id: id(99)}, {package_sha256: 'c'.repeat(64)}, {preview_url: 'https://live.example.test'}, {published: true}]) {
    const f = fixture(), proposal = await proposed(f), run = runFor(f); Object.assign(run.evidence, change); f.workspace.runs.push(run)
    await assert.rejects(f.adapter.status(scope, proposal, id(30)))
  }
  const f = fixture(), proposal = structuredClone(await proposed(f)); proposal.selection.page_id = id(99)
  await assert.rejects(f.adapter.status(scope, proposal, id(30)))
})
