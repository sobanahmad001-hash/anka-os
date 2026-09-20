import { useCallback, useEffect, useRef, useState } from 'react'
import { projectTaskProposalRepository } from '../data/projectTaskProposalRepository.js'

const STATUSES = ['backlog', 'ready', 'in_progress', 'blocked', 'ready_for_review', 'changes_required', 'done', 'cancelled']
const label = value => value?.replaceAll('_', ' ') || 'Unknown'

export default function ProjectTaskProposalPanel({ organizationId, projectId, tasks, sourceCommentId,
  scopeRevision, requestSignal, onAccessError, onApplied }) {
  const [proposals, setProposals] = useState([])
  const [taskId, setTaskId] = useState('')
  const [nextStatus, setNextStatus] = useState('')
  const [rationale, setRationale] = useState('')
  const [impact, setImpact] = useState('')
  const [costNote, setCostNote] = useState('')
  const [supersedesId, setSupersedesId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const requestId = useRef(null)
  const generation = useRef(0)
  const task = tasks.find(item => item.id === taskId && !item.archived_at)

  useEffect(() => { requestId.current = null }, [sourceCommentId])

  const refresh = useCallback(async current => {
    const rows = await projectTaskProposalRepository.list(organizationId, projectId, { signal: requestSignal })
    if (current === generation.current && !requestSignal?.aborted) setProposals(rows)
  }, [organizationId, projectId, requestSignal])
  useEffect(() => {
    const current = ++generation.current
    setProposals([]); setTaskId(''); setNextStatus(''); setRationale(''); setImpact('')
    setCostNote(''); setSupersedesId(null); setError(''); setLoading(true); requestId.current = null
    refresh(current).catch(cause => {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to load proposals.')
      }
    }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current += 1 }
  }, [organizationId, projectId, scopeRevision, requestSignal, onAccessError, refresh])

  const clear = () => {
    setTaskId(''); setNextStatus(''); setRationale(''); setImpact(''); setCostNote('')
    setSupersedesId(null); requestId.current = null
  }
  const submit = async event => {
    event.preventDefault()
    if (busy || !task) return
    const current = generation.current
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure proposal ID is unavailable.'); return }
    requestId.current = id; setBusy(true); setError('')
    try {
      await projectTaskProposalRepository.create({ organizationId, projectId, proposalId: id,
        taskId: task.id, expectedRowVersion: Number(task.row_version), beforeStatus: task.status,
        proposedStatus: nextStatus, rationale, impact, costNote, sourceCommentId, supersedesId })
      await refresh(current)
      if (current === generation.current && !requestSignal?.aborted) clear()
    } catch (cause) {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to save proposal. Retry keeps the same ID.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }
  const decide = async (proposal, decision) => {
    if (busy) return
    const current = generation.current
    setBusy(true); setError('')
    try {
      const result = await projectTaskProposalRepository.decide({ organizationId, projectId,
        proposalId: proposal.id, decision })
      await refresh(current)
      if (current === generation.current && result.status === 'applied') onApplied?.()
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to record decision.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }
  const revise = proposal => {
    setTaskId(proposal.task_id); setNextStatus(proposal.proposed_status)
    setRationale(proposal.rationale); setImpact(proposal.impact); setCostNote(proposal.cost_note)
    setSupersedesId(proposal.id); requestId.current = null
  }
  const change = setter => event => { setter(event.target.value); requestId.current = null }
  return <section aria-label="Project task change proposals" className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
    <h2 className="font-semibold">Proposed task changes</h2>
    <p className="mt-1 text-sm text-slate-400">A proposal records the exact task version, impact, and cost. It changes no work until an authorized team member confirms it.</p>
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-400">Loading proposals…</p> : <div className="mt-4 space-y-3">
      {proposals.map(proposal => <article key={proposal.id} className="rounded-xl border border-white/10 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{tasks.find(item => item.id === proposal.task_id)?.title || 'Project Task'}</strong><span className="text-xs text-slate-400">{label(proposal.status)}</span></div>
        <p className="mt-2 text-slate-300">{label(proposal.before_status)} → {label(proposal.proposed_status)} · Task version {proposal.expected_row_version}</p>
        <p className="mt-2 text-slate-400">Reason: {proposal.rationale}</p>
        <p className="mt-1 text-slate-400">Impact: {proposal.impact}</p>
        <p className="mt-1 text-slate-400">Cost: {proposal.cost_note}</p>
        {proposal.source_comment_id && <p className="mt-1 text-xs text-violet-300">Linked to project discussion message</p>}
        {proposal.failure_reason && <p className="mt-2 text-xs text-amber-300">Approved, but not applied: {proposal.failure_reason}. Create a new proposal after reviewing the task.</p>}
        {proposal.status === 'pending' && <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => decide(proposal, 'approve')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium disabled:opacity-40">Confirm and apply</button>
          <button type="button" disabled={busy} onClick={() => decide(proposal, 'reject')} className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Reject</button>
          <button type="button" disabled={busy} onClick={() => revise(proposal)} className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Revise</button>
        </div>}
      </article>)}
      {!proposals.length && <p className="text-sm text-slate-500">No change proposals yet.</p>}
    </div>}
    <form onSubmit={submit} className="mt-6 space-y-3 border-t border-white/10 pt-5">
      <h3 className="font-medium">{supersedesId ? 'Revise proposal' : 'Propose a task status change'}</h3>
      {sourceCommentId && <p className="text-xs text-violet-300">Source: selected project discussion message</p>}
      <label className="block text-xs text-slate-400">Project Task<select required value={taskId} onChange={change(setTaskId)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white"><option value="">Select task</option>{tasks.filter(item => !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.title} · v{item.row_version}</option>)}</select></label>
      {task && <p className="text-xs text-slate-400">Current status: {label(task.status)} · Exact version: {task.row_version}</p>}
      <label className="block text-xs text-slate-400">Proposed status<select required value={nextStatus} onChange={change(setNextStatus)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white"><option value="">Select status</option>{STATUSES.filter(status => status !== task?.status).map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label>
      {[[rationale, setRationale, 'Reason', 4000], [impact, setImpact, 'Impact on work', 4000], [costNote, setCostNote, 'Cost or resource impact', 2000]].map(([value, setter, title, maximum]) => <label key={title} className="block text-xs text-slate-400">{title}<textarea required rows={2} maxLength={maximum} value={value} onChange={change(setter)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white" /></label>)}
      <div className="flex gap-2"><button type="submit" disabled={busy || !task || !nextStatus} className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save proposal'}</button>{supersedesId && <button type="button" onClick={clear} className="rounded-lg border border-white/10 px-3 py-2 text-sm">Cancel revision</button>}</div>
    </form>
  </section>
}
