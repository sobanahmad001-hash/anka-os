import {uuid, stagingOrigin} from '../../supabase/functions/_shared/websiteStagingContracts.js'

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const same = (row, scope) => row?.organization_id === scope.organizationId && row?.project_id === scope.projectId && row?.engagement_id === scope.engagementId

// A read-only projection of existing receipts, never a publication authorization.
export function websiteQaReview(data, scope, runId) {
  const checks = []
  const add = (id, label, verified, detail) => checks.push({id, label, status: verified ? 'verified' : 'needs_review', detail})
  if (!same(data, scope) || ![scope.organizationId, scope.projectId, scope.engagementId, runId].every(uuid)) return {valid: false, checks, previewUrl: null}
  if (!['runs', 'jobs', 'targets', 'issues'].every(key => Array.isArray(data[key]) && data[key].every(row => row && typeof row === 'object'))) return {valid: false, checks, previewUrl: null}
  const matches = data.runs.filter(row => row.id === runId)
  const run = matches[0]
  if (matches.length !== 1 || !same(run, scope) || ![run.page_id, run.job_id, run.target_id, run.request_id].every(uuid)) return {valid: false, checks, previewUrl: null}
  const jobs = data.jobs.filter(row => row.id === run.job_id && row.page_id === run.page_id)
  const targets = data.targets.filter(row => row.id === run.target_id && same(row, scope))
  const job = jobs.length === 1 ? jobs[0] : null
  const target = targets.length === 1 ? targets[0] : null
  const evidence = run.evidence
  let previewUrl = null
  try {
    if (target && uuid(run.request_id) && uuid(target.site_id) && stagingOrigin(target.base_url) === target.base_url && evidence?.base_url === target.base_url && evidence.environment === 'staging' && evidence.published === false && evidence.preview_verified === true && evidence.preview_url === target.base_url + '/?anka_staging_preview=' + run.request_id) previewUrl = evidence.preview_url
  } catch { /* Invalid destinations are never linked. */ }
  add('preview', 'Verified private preview receipt', run.status === 'staged' && Boolean(previewUrl), 'A staging receipt does not establish the current remote page head or live publication.')
  if (run.status !== 'staged') previewUrl = null
  add('package', 'Exact saved package', Boolean(job && hash(job.artifact_sha256) && evidence?.package_sha256 === job.artifact_sha256), 'The retained package checksum must match this staging result and registered page.')
  add('target', 'Current staging connection binding', target?.current === true, 'Connection access and the exact target binding must still be current.')
  add('sources', 'Current source versions', Boolean(job && Array.isArray(job.stale_sources) && job.stale_sources.length === 0 && Array.isArray(run.stale_sources) && run.stale_sources.length === 0), 'Changed or unavailable source-version evidence needs a new review.')
  const complete = data.offset === 0 && data.has_more === false
  const runTime = Date.parse(run.created_at)
  const relevantRuns = data.runs.filter(row => row.page_id === run.page_id && row.target_id === run.target_id && row.status === 'staged')
  const currentHistory = complete && Number.isFinite(runTime) && relevantRuns.every(row => same(row, scope) && Number.isFinite(Date.parse(row.created_at)) && (row.id === run.id || Date.parse(row.created_at) < runTime))
  add('revision', 'Most recent retained page preview', currentHistory, 'Partial history or a newer preview prevents a current-version conclusion. Remote head still needs inspection.')
  add('links', 'Staging link resolution', Array.isArray(evidence?.unresolved_paths) && evidence.unresolved_paths.length === 0, 'Missing link evidence or unresolved page paths require review.')
  const events = data.issues.filter(row => row.run_id === run.id)
  const opened = events.filter(row => row.kind === 'opened')
  const issueIds = new Set(opened.map(row => row.issue_id))
  const cleanIssues = complete && events.every(row => uuid(row.id) && uuid(row.issue_id) && row.page_id === run.page_id && ['opened', 'resolved'].includes(row.kind)) && opened.length === issueIds.size && events.filter(row => row.kind === 'resolved').every(row => opened.some(first => first.issue_id === row.issue_id && row.previous_event_id === first.id)) && opened.every(first => events.filter(row => row.kind === 'resolved' && row.issue_id === first.issue_id && row.previous_event_id === first.id).length === 1)
  add('issues', 'Recorded revision issues resolved', cleanIssues, 'Only complete, correctly linked issue history can establish that recorded issues are closed; this is not QA acceptance.')
  const prior = data.runs.filter(row => row.id === run.previous_run_id && same(row, scope) && row.page_id === run.page_id && row.target_id === run.target_id && row.status === 'staged')
  add('predecessor', 'Retained predecessor reference', uuid(run.previous_run_id) && prior.length === 1, 'A retained reference is not a verified rollback mechanism or rehearsal.')
  return {valid: true, run, job, target, checks, previewUrl, publicationAuthorized: false}
}
