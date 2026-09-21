import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { pipelineRunIntents } from '../data/pipelineRunIntents.js'

export default function PipelineRunIntentPanel({ organizationId, engagement, assets, workItems = [], membership, signal }) {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [assetIds, setAssetIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reviewingId, setReviewingId] = useState('')
  const [reason, setReason] = useState('')
  const [planningId, setPlanningId] = useState('')
  const [planWorkIds, setPlanWorkIds] = useState([])
  const [acknowledgedJobId, setAcknowledgedJobId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const startRequestId = useRef('')
  const reviewRequest = useRef(null)
  const planRequest = useRef(null)
  const inputApprovalRequest = useRef(null)
  const allowed = ['system_owner', 'operations_admin'].includes(membership?.role)

  async function refresh() {
    try {
      const result = await pipelineRunIntents.list(organizationId, engagement.id, { signal })
      if (!signal?.aborted) setRows(result || [])
      if (!signal?.aborted) setError('')
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // The parent remounts this workspace when organization scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, engagement.id, signal])

  function toggleAsset(id) {
    startRequestId.current = ''
    setAssetIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  }

  async function start() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (!startRequestId.current) startRequestId.current = crypto.randomUUID()
      const result = await pipelineRunIntents.start({
        organizationId, engagementId: engagement.id, requestId: startRequestId.current, assetIds,
      }, { signal })
      setNotice(`Run request ${result.idempotent_replay ? 'recovered' : 'recorded'} for review. No provider job or spend started.`)
      startRequestId.current = ''
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }

  async function decide(runIntentId, decision) {
    const normalizedReason = reason.trim()
    const fingerprint = [runIntentId, decision, normalizedReason].join(':')
    if (reviewRequest.current?.fingerprint !== fingerprint) {
      reviewRequest.current = { fingerprint, id: crypto.randomUUID() }
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await pipelineRunIntents.review({
        organizationId, runIntentId, requestId: reviewRequest.current.id,
        decision, reason: normalizedReason,
      }, { signal })
      setNotice(`Review ${result.idempotent_replay ? 'recovered' : 'recorded'}. This permits planning only; execution and spend remain blocked.`)
      reviewRequest.current = null
      setReviewingId('')
      setReason('')
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }

  async function approveInputs(jobId) {
    if (acknowledgedJobId !== jobId) return
    if (inputApprovalRequest.current?.jobId !== jobId) {
      inputApprovalRequest.current = { jobId, id: crypto.randomUUID() }
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await pipelineRunIntents.approveInputs({
        organizationId, jobId, requestId: inputApprovalRequest.current.id, acknowledged: true,
      }, { signal })
      setNotice(`Exact text inputs ${result.idempotent_replay ? 'recovered' : 'acknowledged'}. The job remains blocked from provider execution and spend.`)
      inputApprovalRequest.current = null
      setAcknowledgedJobId('')
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }
  function toggleWork(id) {
    planRequest.current = null
    setPlanWorkIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  }

  async function plan(runIntentId) {
    const fingerprint = [runIntentId, ...planWorkIds].join(':')
    if (planRequest.current?.fingerprint !== fingerprint) {
      planRequest.current = { fingerprint, id: crypto.randomUUID() }
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await pipelineRunIntents.plan({
        organizationId, runIntentId, requestId: planRequest.current.id,
        workItemIds: planWorkIds,
      }, { signal })
      setNotice(`Linked work plan ${result.idempotent_replay ? 'recovered' : 'recorded'}. Existing work items were not changed.`)
      planRequest.current = null
      setPlanningId('')
      setPlanWorkIds([])
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }

  return <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5">
    <h2 className="font-semibold">Manual pipeline runs</h2>
    <p className="mt-1 text-xs text-slate-500">Pin the current project activation, published preset and selected assets, then request separate planning review. Unconfigured requests remain blocked. This cannot submit provider work or spend budget.</p>
    {allowed && <div className="mt-4">
      <p className="text-xs font-medium text-slate-300">Pin assets (up to 20)</p>
      <div className="mt-2 space-y-2">{assets.map(asset => <label key={asset.id} className="flex gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={assetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)} />
        <span>{asset.name} Â· {asset.asset_kind}</span>
      </label>)}</div>
      <button type="button" disabled={busy || !['planning', 'active'].includes(engagement.status) || assetIds.length > 20}
        onClick={start} className="mt-4 rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
        {busy ? 'Recordingâ€¦' : 'Request manual run review'}
      </button>
    </div>}
    {notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
    <div className="mt-5 space-y-2">
      {loading && <p className="text-xs text-slate-500">Loading run requestsâ€¦</p>}
      {!loading && rows.length === 0 && <p className="text-xs text-slate-500">No manual run requests yet.</p>}
      {rows.map(row => <div key={row.id} className="rounded-lg border border-white/[0.06] p-3 text-xs text-slate-400">
        <span className="font-medium text-slate-200">{row.review ? row.review.decision.replaceAll('_', ' ') : row.status.replaceAll('_', ' ')}</span>
        <span className="ml-2">{new Date(row.requested_at).toLocaleString()}</span>
        <p className="mt-1">Pinned preset {row.input_manifest?.pipeline?.version_id?.slice(0, 8)} Â· {row.input_manifest?.assets?.length || 0} assets Â· hash {row.input_sha256.slice(0, 12)}</p>
        <p className="mt-1">{row.project_activation_id ? `Project activation ${row.project_activation_id.slice(0, 8)} Â· steps hash ${row.selected_steps_sha256.slice(0, 12)}` : 'Unconfigured or historical request Â· provider execution blocked'}</p>
        {row.review?.reason && <p className="mt-1">Review reason: {row.review.reason}</p>}
        {row.plan && <p className="mt-2 text-emerald-300">Linked plan: {row.plan.work_manifest.length} work items pinned Â· hash {row.plan.work_sha256.slice(0, 12)}. No task status was changed.</p>}
        {row.job && <p className="mt-1 text-amber-300">Execution job: {row.job.steps?.length ?? 0} pinned work items Â· {row.job.configured_steps?.length ?? 0} configured step instances Â· {row.job.status.replaceAll('_', ' ')} Â· {row.job.blocked_reason} No provider request has been sent.</p>}
        {row.job?.input_approval && <p className="mt-1 text-emerald-300">Exact text inputs acknowledged by the requester. Provider execution remains blocked.</p>}
        <RunCardDetails row={row} />
        {allowed && row.requested_by === user?.id && row.plan && row.job && !row.job.input_approval
          && row.review?.decision === 'accepted_for_planning' && <div className="mt-2">
            {(row.input_manifest?.assets?.length || 0) > 0
              ? <p className="text-amber-300">Selected assets need separate AI-use classification before this job can be acknowledged.</p>
              : <><label className="flex items-start gap-2 text-slate-300">
                <input type="checkbox" checked={acknowledgedJobId === row.job.id}
                  onChange={event => setAcknowledgedJobId(event.target.checked ? row.job.id : '')} />
                <span>I confirm this exact engagement and work context may be sent to the organization-approved text AI model. No assets are selected.</span>
              </label>
              <button type="button" disabled={busy || acknowledgedJobId !== row.job.id}
                onClick={() => approveInputs(row.job.id)}
                className="mt-2 rounded-lg border border-violet-500 px-3 py-1.5 font-semibold text-violet-200 disabled:opacity-40">
                Acknowledge exact inputs
              </button></>}
          </div>}
        {allowed && !row.review && row.requested_by !== user?.id && <div className="mt-2">
          {reviewingId === row.id ? <div className="space-y-2">
            <label className="block">Review reason (required to reject)
              <textarea maxLength={1000} value={reason} onChange={event => setReason(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white" />
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => decide(row.id, 'accepted_for_planning')} className="rounded-lg bg-violet-500 px-3 py-1.5 font-semibold text-white disabled:opacity-40">Accept for planning</button>
              <button type="button" disabled={busy || !reason.trim()} onClick={() => decide(row.id, 'rejected')} className="rounded-lg border border-red-400/40 px-3 py-1.5 font-semibold text-red-300 disabled:opacity-40">Reject</button>
              <button type="button" disabled={busy} onClick={() => { setReviewingId(''); setReason('') }} className="px-2">Cancel</button>
            </div>
          </div> : <button type="button" onClick={() => { setReviewingId(row.id); setReason('') }} className="font-semibold text-violet-300">Review request</button>}
        </div>}
        {!row.review && row.requested_by === user?.id && <p className="mt-1 text-amber-300">Another owner or operations admin must review this request.</p>}
        {allowed && row.review?.decision === 'accepted_for_planning' && !row.plan && row.requested_by === user?.id && <div className="mt-2">
          {planningId === row.id ? <div className="space-y-2">
            <p>Choose 1 to 50 existing engagement work items, in run order.</p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {workItems.map(item => <label key={item.id} className="flex gap-2">
                <input type="checkbox" checked={planWorkIds.includes(item.id)} onChange={() => toggleWork(item.id)} />
                <span>{item.title} Â· {item.status}</span>
              </label>)}
            </div>
            <button type="button" disabled={busy || planWorkIds.length < 1 || planWorkIds.length > 50}
              onClick={() => plan(row.id)} className="rounded-lg bg-violet-500 px-3 py-1.5 font-semibold text-white disabled:opacity-40">Pin linked work plan</button>
            <button type="button" disabled={busy} onClick={() => { setPlanningId(''); setPlanWorkIds([]); planRequest.current = null }} className="ml-2 px-2">Cancel</button>
          </div> : <button type="button" onClick={() => { setPlanningId(row.id); setPlanWorkIds([]); planRequest.current = null }} className="font-semibold text-violet-300">Link work items</button>}
        </div>}
      </div>)}
    </div>
  </section>
}

function RunCardDetails({ row }) {
  const work = row.plan?.work_manifest || []
  const configured = [...(row.job?.configured_steps || [])].sort((a, b) => a.ordinal - b.ordinal)
  const phase = row.review?.decision === 'rejected' ? 'Rejected'
    : !row.review ? 'Awaiting review'
      : !row.plan ? 'Awaiting linked work'
        : 'Waiting for configuration'
  return <details className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
    <summary className="cursor-pointer font-semibold text-slate-200">Run card · {phase}</summary>
    <p className="mt-2">Exact request {row.id.slice(0, 8)} · {row.project_activation_id ? 'project activation ' + row.project_activation_id.slice(0, 8) : 'no project activation'}</p>
    <p className="mt-1">Provider spend recorded for this job: none. Execution and output release remain blocked.</p>
    <h4 className="mt-3 font-semibold text-slate-300">Configured execution steps ({configured.length})</h4>
    {configured.length ? <ol className="mt-1 max-h-64 list-decimal space-y-1 overflow-y-auto pl-5">
      {configured.map(step => <li key={step.id}>
        {step.definition_step?.label || step.step_key} · instance {step.instance_number} · {step.definition_step?.kind?.replaceAll('_', ' ')} · {step.status.replaceAll('_', ' ')}
        {step.definition_step?.depends_on?.length ? ' · after ' + step.definition_step.depends_on.join(', ') : ''}
      </li>)}
    </ol> : <p className="mt-1 text-slate-500">No configured step instances are linked to this request.</p>}
    <h4 className="mt-3 font-semibold text-slate-300">Linked ordinary work items ({work.length})</h4>
    {work.length ? <ol className="mt-1 max-h-64 list-decimal space-y-1 overflow-y-auto pl-5">
      {work.map(item => <li key={item.id}>{item.title} · {item.department_id || 'unassigned'} · version {item.row_version}</li>)}
    </ol> : <p className="mt-1 text-slate-500">No work plan has been linked.</p>}
  </details>
}
