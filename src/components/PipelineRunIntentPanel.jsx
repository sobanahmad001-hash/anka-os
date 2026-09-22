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
  const [manualDraft, setManualDraft] = useState(null)
  const [outputDraft, setOutputDraft] = useState(null)
  const [executionStatus, setExecutionStatus] = useState({})
  const [statusBusyId, setStatusBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const startRequestId = useRef('')
  const reviewRequest = useRef(null)
  const planRequest = useRef(null)
  const inputApprovalRequest = useRef(null)
  const manualActionRequest = useRef(null)
  const outputReviewRequest = useRef(null)
  const allowed = ['system_owner', 'operations_admin'].includes(membership?.role)
  const manualEligible = ['system_owner', 'operations_admin', 'department_manager', 'project_manager', 'project_owner'].includes(membership?.role)
  const reviewEligible = ['system_owner', 'operations_admin', 'executive', 'department_manager'].includes(membership?.role)

  async function refresh() {
    try {
      const result = await pipelineRunIntents.list(organizationId, engagement.id, { signal })
      if (!signal?.aborted) {
        setRows(result || [])
        setExecutionStatus({})
      }
      if (!signal?.aborted) setError('')
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  async function readExecutionStatus(jobId) {
    setStatusBusyId(jobId)
    setError('')
    try {
      const result = await pipelineRunIntents.getExecutionStatus({
        organizationId, jobId,
      }, { signal })
      if (!signal?.aborted) setExecutionStatus(current => ({ ...current, [jobId]: result }))
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setStatusBusyId('')
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
  async function advanceManualStep(row, step, action, evidence = '') {
    const normalizedEvidence = String(evidence).trim()
    const version = step.progress?.state_version || 1
    const fingerprint = [row.job.id, step.id, version, action, normalizedEvidence].join(':')
    if (manualActionRequest.current?.fingerprint !== fingerprint) {
      manualActionRequest.current = { fingerprint, id: crypto.randomUUID() }
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await pipelineRunIntents.advanceManualStep({
        organizationId, jobId: row.job.id, stepId: step.id,
        requestId: manualActionRequest.current.id, expectedVersion: version,
        action, evidence: normalizedEvidence,
      }, { signal })
      setNotice(`Manual step ${result.idempotent_replay ? 'recovered' : 'recorded'}: ${result.status.replaceAll('_', ' ')}. Provider execution remains blocked.`)
      manualActionRequest.current = null
      setManualDraft(null)
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }
  async function openOutput(outputId) {
    setBusy(true)
    setError('')
    try {
      const result = await pipelineRunIntents.getOutputForReview({ organizationId, outputId }, { signal })
      if (!signal?.aborted) setOutputDraft({ outputId, content: result.content, evidence: '' })
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }

  async function reviewOutput(step, decision) {
    const outputId = step.output?.id
    if (!outputId || outputDraft?.outputId !== outputId) return
    const evidence = outputDraft.evidence.trim()
    const expectedVersion = step.progress?.state_version || 1
    const fingerprint = [outputId, expectedVersion, decision, evidence].join(':')
    if (outputReviewRequest.current?.fingerprint !== fingerprint) {
      outputReviewRequest.current = { fingerprint, id: crypto.randomUUID() }
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await pipelineRunIntents.reviewOutput({
        organizationId, outputId, requestId: outputReviewRequest.current.id,
        expectedVersion, decision, evidence,
      }, { signal })
      setNotice(`AI output ${result.idempotent_replay ? 'review recovered' : result.decision}. No publication occurred.`)
      outputReviewRequest.current = null
      setOutputDraft(null)
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
        <span>{asset.name} · {asset.asset_kind}</span>
      </label>)}</div>
      <button type="button" disabled={busy || !['planning', 'active'].includes(engagement.status) || assetIds.length > 20}
        onClick={start} className="mt-4 rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
        {busy ? 'Recording…' : 'Request manual run review'}
      </button>
    </div>}
    {notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
    <div className="mt-5 space-y-2">
      {loading && <p className="text-xs text-slate-500">Loading run requests…</p>}
      {!loading && rows.length === 0 && <p className="text-xs text-slate-500">No manual run requests yet.</p>}
      {rows.map(row => <div key={row.id} className="rounded-lg border border-white/[0.06] p-3 text-xs text-slate-400">
        <span className="font-medium text-slate-200">{row.review ? row.review.decision.replaceAll('_', ' ') : row.status.replaceAll('_', ' ')}</span>
        <span className="ml-2">{new Date(row.requested_at).toLocaleString()}</span>
        <p className="mt-1">Pinned preset {row.input_manifest?.pipeline?.version_id?.slice(0, 8)} · {row.input_manifest?.assets?.length || 0} assets · hash {row.input_sha256.slice(0, 12)}</p>
        <p className="mt-1">{row.project_activation_id ? `Project activation ${row.project_activation_id.slice(0, 8)} · steps hash ${row.selected_steps_sha256.slice(0, 12)}` : 'Unconfigured or historical request · provider execution blocked'}</p>
        {row.review?.reason && <p className="mt-1">Review reason: {row.review.reason}</p>}
        {row.plan && <p className="mt-2 text-emerald-300">Linked plan: {row.plan.work_manifest.length} work items pinned · hash {row.plan.work_sha256.slice(0, 12)}. No task status was changed.</p>}
        {row.job && <p className="mt-1 text-amber-300">Execution job: {row.job.steps?.length ?? 0} pinned work items · {row.job.configured_steps?.length ?? 0} configured step instances. Read execution status for current provider and budget state.</p>}
        {row.job?.input_approval && <p className="mt-1 text-emerald-300">Exact text inputs acknowledged by the requester. Provider dispatch still requires current routing, budget and paid-execution settings.</p>}
        {allowed && row.job && <div className="mt-2">
          <button type="button" disabled={Boolean(statusBusyId)}
            onClick={() => readExecutionStatus(row.job.id)}
            className="font-semibold text-violet-300 disabled:opacity-40">
            {statusBusyId === row.job.id ? 'Reading execution status…' : 'Read execution status'}
          </button>
          {executionStatus[row.job.id] && <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
            <p>Prepared attempts, claims and budget come from the current audit. An uncertain result must not be retried.</p>
            <ul className="mt-1 space-y-1">{(executionStatus[row.job.id].steps || []).map(item =>
              <li key={item.step_id}>{item.step_key}: {executionStepState(item)}
                {item.reserved_max_microusd != null ? ` · reserved ceiling ${item.reserved_max_microusd} µUSD` : ''}
                {item.accounted_cost_microusd != null ? ` · accounted token cost ${item.accounted_cost_microusd} µUSD` : ''}
              </li>)}</ul>
          </div>}
        </div>}
        <RunCardDetails row={row} userId={user?.id} manualEligible={manualEligible}
          reviewEligible={reviewEligible} outputDraft={outputDraft} setOutputDraft={setOutputDraft}
          onOpenOutput={openOutput} onReviewOutput={reviewOutput}
          manualDraft={manualDraft} setManualDraft={setManualDraft} busy={busy}
          onManualAction={advanceManualStep} />
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
                <span>{item.title} · {item.status}</span>
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

function RunCardDetails({ row, userId, manualEligible, reviewEligible, outputDraft, setOutputDraft,
  onOpenOutput, onReviewOutput, manualDraft, setManualDraft, busy, onManualAction }) {
  const work = row.plan?.work_manifest || []
  const configured = [...(row.job?.configured_steps || [])].sort((a, b) => a.ordinal - b.ordinal)
  const anyManualProgress = configured.some(step => step.progress?.status && step.progress.status !== 'waiting')
  const phase = row.review?.decision === 'rejected' ? 'Rejected'
    : !row.review ? 'Awaiting review'
      : !row.plan ? 'Awaiting linked work'
        : anyManualProgress ? 'Manual steps in progress' : 'Awaiting configured steps'
  return <details className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
    <summary className="cursor-pointer font-semibold text-slate-200">Run card · {phase}</summary>
    <p className="mt-2">Exact request {row.id.slice(0, 8)} · {row.project_activation_id ? 'project activation ' + row.project_activation_id.slice(0, 8) : 'no project activation'}</p>
    <p className="mt-1">Only reconciled output costs appear here; claimed or uncertain provider outcomes may still hold budget. Outputs are never published automatically.</p>
    <h4 className="mt-3 font-semibold text-slate-300">Configured execution steps ({configured.length})</h4>
    {configured.length ? <ol className="mt-1 max-h-64 list-decimal space-y-2 overflow-y-auto pl-5">
      {configured.map(step => {
        const kind = step.definition_step?.kind
        const status = step.progress?.status || step.status
        const dependenciesReady = (step.definition_step?.depends_on || []).every(key =>
          configured.filter(other => other.step_key === key).every(other => other.progress?.status === 'completed'))
        const canAct = manualEligible && row.job?.input_approval && dependenciesReady
        const draftOpen = manualDraft?.stepId === step.id
        const evidenceAction = kind === 'approval_gate' ? 'approve' : 'complete'
        return <li key={step.id}>
          {step.definition_step?.label || step.step_key} · instance {step.instance_number} · {kind?.replaceAll('_', ' ')} · {status?.replaceAll('_', ' ')}
          {step.definition_step?.depends_on?.length ? ' · after ' + step.definition_step.depends_on.join(', ') : ''}
          {step.output && <p className="mt-1 text-emerald-300">
            AI output {step.output.id.slice(0, 8)} · {step.output.provider} / {step.output.model_id}
            · reconciled {step.output.measured_cost_microusd} µUSD · {step.output.review?.decision || 'pending human review'}.
            This output is not published.
          </p>}
          {reviewEligible && step.output && !step.output.review && userId !== row.requested_by && <div className="mt-1">
            <button type="button" disabled={busy} onClick={() => onOpenOutput(step.output.id)}
              className="font-semibold text-violet-300 disabled:opacity-40">Inspect exact AI output</button>
            {outputDraft?.outputId === step.output.id && <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-sans text-slate-200">{outputDraft.content}</pre>
              <textarea maxLength={1000} value={outputDraft.evidence}
                onChange={event => setOutputDraft({ ...outputDraft, evidence: event.target.value })}
                placeholder="Record review evidence" className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white" />
              <div className="mt-2 flex gap-3">
                <button type="button" disabled={busy || !outputDraft.evidence.trim()}
                  onClick={() => onReviewOutput(step, 'accepted')}
                  className="font-semibold text-emerald-300 disabled:opacity-40">Accept output</button>
                <button type="button" disabled={busy || !outputDraft.evidence.trim()}
                  onClick={() => onReviewOutput(step, 'rejected')}
                  className="font-semibold text-red-300 disabled:opacity-40">Reject output</button>
                <button type="button" onClick={() => setOutputDraft(null)} className="text-slate-400">Close</button>
              </div>
            </div>}
          </div>}
          {canAct && kind === 'human' && status === 'waiting' && <button type="button" disabled={busy}
            onClick={() => onManualAction(row, step, 'start')} className="ml-2 font-semibold text-violet-300 disabled:opacity-40">Start</button>}
          {canAct && kind === 'human' && status === 'in_progress' && <button type="button" disabled={busy}
            onClick={() => onManualAction(row, step, 'pause')} className="ml-2 font-semibold text-violet-300 disabled:opacity-40">Pause</button>}
          {canAct && kind === 'human' && status === 'paused' && <button type="button" disabled={busy}
            onClick={() => onManualAction(row, step, 'resume')} className="ml-2 font-semibold text-violet-300 disabled:opacity-40">Resume</button>}
          {canAct && ((kind === 'human' && status === 'in_progress')
            || (kind === 'approval_gate' && status === 'waiting' && userId !== row.requested_by))
            && <div className="mt-1">
              {draftOpen && manualDraft.action === evidenceAction ? <>
                <textarea maxLength={1000} value={manualDraft.evidence}
                  onChange={event => setManualDraft({ ...manualDraft, evidence: event.target.value })}
                  placeholder="Record the completed work or approval evidence"
                  className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white" />
                <button type="button" disabled={busy || !manualDraft.evidence.trim()}
                  onClick={() => onManualAction(row, step, evidenceAction, manualDraft.evidence)}
                  className="font-semibold text-violet-300 disabled:opacity-40">Confirm {evidenceAction}</button>
                <button type="button" onClick={() => setManualDraft(null)} className="ml-3 text-slate-400">Cancel</button>
              </> : <button type="button" disabled={busy}
                onClick={() => setManualDraft({ stepId: step.id, action: evidenceAction, evidence: '' })}
                className="font-semibold text-violet-300 disabled:opacity-40">{evidenceAction === 'approve' ? 'Review gate' : 'Record completion'}</button>}
            </div>}
        </li>
      })}
    </ol> : <p className="mt-1 text-slate-500">No configured step instances are linked to this request.</p>}
    <h4 className="mt-3 font-semibold text-slate-300">Linked ordinary work items ({work.length})</h4>
    {work.length ? <ol className="mt-1 max-h-64 list-decimal space-y-1 overflow-y-auto pl-5">
      {work.map(item => <li key={item.id}>{item.title} · {item.department_id || 'unassigned'} · version {item.row_version}</li>)}
    </ol> : <p className="mt-1 text-slate-500">No work plan has been linked.</p>}
  </details>
}

function executionStepState(item) {
  if (!item.attempt_id) return 'no AI attempt prepared'
  if (!item.initial_claimed_at) return 'budget reserved; provider submission not claimed'
  if (item.reservation_status === 'uncertain') return 'provider outcome unknown; do not retry'
  if (item.reservation_status === 'released') return 'confirmed refusal; budget released'
  if (item.reservation_status === 'settled') return 'output reconciled for human review'
  if (item.claimed_routes > item.confirmed_rejections) return 'provider submission claimed; reconciliation pending'
  return 'all claimed routes refused; budget recovery pending'
}
