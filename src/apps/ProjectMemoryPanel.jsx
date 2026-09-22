import { useEffect, useRef, useState } from 'react'
import { projectMemoryRepository } from '../data/projectMemoryRepository.js'
import _ProjectMemoryPurgePanel from './ProjectMemoryPurgePanel.jsx'
import _DepartmentMemoryPanel from './DepartmentMemoryPanel.jsx'

export default function ProjectMemoryPanel({ organizationId, projectId, sourceCommentId, workstreams, scopeRevision, requestSignal, onAccessError }) {
  const [memory, setMemory] = useState(null)
  const [statement, setStatement] = useState('')
  const [supersedesId, setSupersedesId] = useState('')
  const [review, setReview] = useState(null)
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const requestId = useRef(null)
  const generation = useRef(0)

  const load = async (current = generation.current) => {
    const data = await projectMemoryRepository.list(organizationId, projectId, { signal: requestSignal })
    if (current === generation.current && !requestSignal?.aborted) setMemory(data)
  }
  useEffect(() => {
    const current = ++generation.current
    setMemory(null); setStatement(''); setSupersedesId(''); setReview(null); setEvidence('')
    setError(''); setLoading(true); requestId.current = null
    projectMemoryRepository.list(organizationId, projectId, { signal: requestSignal })
      .then(data => { if (current === generation.current && !requestSignal?.aborted) setMemory(data) })
      .catch(cause => {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to load project memory.')
      }
    }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current += 1 }
  }, [organizationId, projectId, scopeRevision, requestSignal, onAccessError])

  const propose = async event => {
    event.preventDefault()
    if (busy || !sourceCommentId || !statement.trim()) return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await projectMemoryRepository.propose({ organizationId, projectId, requestId: id,
        sourceCommentId, statement, supersedesId: supersedesId || null })
      await load(current)
      if (current === generation.current) { setStatement(''); setSupersedesId(''); requestId.current = null }
    } catch (cause) {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to propose this lesson. Retrying keeps its request ID.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }

  const decide = async event => {
    event.preventDefault()
    if (busy || !review || !evidence.trim()) return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await projectMemoryRepository.review({ organizationId, projectId,
        memoryId: review.id, requestId: id, decision: review.decision, evidence })
      await load(current)
      if (current === generation.current) { setReview(null); setEvidence(''); requestId.current = null }
    } catch (cause) {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to record the decision. Retrying keeps its request ID.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }
  const chooseReview = (id, decision) => { setReview({ id, decision }); setEvidence(''); requestId.current = null }
  const sourceLink = id => <a href={`#project-message-${id}`} className="text-xs text-violet-300 hover:text-violet-200">Source message</a>

  return <section aria-label="Project memory" className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
    <h3 className="font-semibold">Project memory</h3>
    <p className="mt-1 text-sm text-slate-400">Sourced lessons stay in this project. A project authority must confirm each candidate before reuse. Changing or removing its source stops reuse immediately.</p>
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    {loading && <p className="mt-3 text-sm text-slate-400">Loading memory…</p>}
    {memory && <>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div><h4 className="text-sm font-medium">Confirmed lessons</h4>{memory.confirmed.length ? <div className="mt-2 space-y-2">{memory.confirmed.map(item => <article key={item.id} className="rounded-xl border border-white/10 p-3"><p className="whitespace-pre-wrap text-sm text-slate-200">{item.statement}</p><div className="mt-2 flex flex-wrap gap-3">{sourceLink(item.source_comment_id)}<button type="button" onClick={() => { setSupersedesId(item.id); globalThis.document?.getElementById('project-memory-proposal')?.scrollIntoView?.({ behavior: 'smooth' }) }} className="text-xs text-violet-300">Propose correction</button><button type="button" onClick={() => chooseReview(item.id, 'retire')} className="text-xs text-slate-400">Retire</button></div></article>)}</div> : <p className="mt-2 text-sm text-slate-500">No confirmed lessons.</p>}</div>
        <div><h4 className="text-sm font-medium">Awaiting independent review</h4>{memory.candidates.length ? <div className="mt-2 space-y-2">{memory.candidates.map(item => <article key={item.id} className="rounded-xl border border-white/10 p-3"><p className="whitespace-pre-wrap text-sm text-slate-200">{item.statement}</p><div className="mt-2 flex flex-wrap gap-3">{sourceLink(item.source_comment_id)}<button type="button" onClick={() => chooseReview(item.id, 'confirm')} className="text-xs text-emerald-300">Confirm</button><button type="button" onClick={() => chooseReview(item.id, 'reject')} className="text-xs text-rose-300">Reject</button></div></article>)}</div> : <p className="mt-2 text-sm text-slate-500">No current candidates visible to your role.</p>}</div>
      </div>
      <form id="project-memory-proposal" onSubmit={propose} className="mt-5 border-t border-white/10 pt-4">
        <h4 className="text-sm font-medium">Propose a lesson from discussion</h4>
        <p className="mt-1 text-xs text-slate-500">{sourceCommentId ? 'The selected project message is the exact source.' : 'Select “Propose lesson” on a project message first.'}</p>
        {supersedesId && <p className="mt-2 text-xs text-violet-300">This proposes a correction to a confirmed lesson. <button type="button" onClick={() => { setSupersedesId(''); requestId.current = null }} className="underline">Clear correction</button></p>}
        <label className="mt-3 block text-xs text-slate-400">Lesson statement<textarea rows={3} maxLength={1000} value={statement} onChange={event => { setStatement(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-xl border border-white/10 bg-[#111622] px-3 py-2 text-sm text-white" /></label>
        <button type="submit" disabled={busy || !sourceCommentId || !statement.trim()} className="mt-3 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Propose for review</button>
      </form>
      {review && <form onSubmit={decide} className="mt-4 rounded-xl border border-violet-400/20 p-4"><h4 className="text-sm font-medium">{review.decision === 'confirm' ? 'Confirm' : review.decision === 'reject' ? 'Reject' : 'Retire'} this exact lesson</h4><p className="mt-1 text-xs text-slate-400">The server checks current project authority and source before confirmation. Your decision is recorded with evidence.</p><label className="mt-3 block text-xs text-slate-400">Decision evidence<textarea required rows={2} maxLength={1000} value={evidence} onChange={event => { setEvidence(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-xl border border-white/10 bg-[#111622] px-3 py-2 text-sm text-white" /></label><div className="mt-3 flex gap-3"><button type="submit" disabled={busy || !evidence.trim()} className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Record decision</button><button type="button" onClick={() => { setReview(null); requestId.current = null }} className="text-xs text-slate-400">Cancel</button></div></form>}
      <_DepartmentMemoryPanel organizationId={organizationId} projectId={projectId} workstreams={workstreams} projectLessons={memory.confirmed} scopeRevision={scopeRevision} onAccessError={onAccessError} />
      <_ProjectMemoryPurgePanel organizationId={organizationId} projectId={projectId} scopeRevision={scopeRevision} onAccessError={onAccessError} onPurged={() => load()} />
    </>}
  </section>
}
