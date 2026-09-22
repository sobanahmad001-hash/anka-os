import { useEffect, useRef, useState } from 'react'
import { departmentMemoryRepository } from '../data/departmentMemoryRepository.js'

const LABELS = { content: 'Content', design: 'Design', development: 'Development', marketing: 'Marketing' }

export default function DepartmentMemoryPanel({ organizationId, projectId, workstreams = [], projectLessons = [], scopeRevision, onAccessError }) {
  const departments = [...new Set(workstreams.map(item => item.department_id).filter(id => LABELS[id]))]
  const firstDepartment = departments[0] || ''
  const [departmentId, setDepartmentId] = useState('')
  const [memory, setMemory] = useState(null)
  const [sourceMemoryId, setSourceMemoryId] = useState('')
  const [statement, setStatement] = useState('')
  const [sanitizationNote, setSanitizationNote] = useState('')
  const [review, setReview] = useState(null)
  const [evidence, setEvidence] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const requestId = useRef(null)

  useEffect(() => { setDepartmentId(firstDepartment) }, [projectId, scopeRevision, firstDepartment])
  useEffect(() => {
    const current = ++generation.current
    setMemory(null); setError(''); setReview(null); requestId.current = null
    if (!departmentId) return () => { generation.current += 1 }
    departmentMemoryRepository.list(organizationId, departmentId)
      .then(data => { if (current === generation.current) setMemory(data) })
      .catch(cause => {
        if (current !== generation.current) return
        if (cause.status !== 403) onAccessError?.(cause, { membershipMismatch: false })
        setError(cause.status === 403 ? 'This department memory is not available to your current role.' : cause.message)
      })
    return () => { generation.current += 1 }
  }, [organizationId, departmentId, scopeRevision, onAccessError])
  const refresh = async (current = generation.current) => {
    const data = await departmentMemoryRepository.list(organizationId, departmentId)
    if (current === generation.current) setMemory(data)
  }
  const propose = async event => {
    event.preventDefault()
    if (busy || !departmentId || !sourceMemoryId) return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await departmentMemoryRepository.propose({ organizationId, projectId, departmentId,
        requestId: id, sourceMemoryId, statement, sanitizationNote })
      await refresh(current)
      if (current === generation.current) {
        setSourceMemoryId(''); setStatement(''); setSanitizationNote(''); requestId.current = null
      }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to propose generalized method. Retrying keeps its request ID.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }
  const decide = async event => {
    event.preventDefault()
    if (busy || !review) return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await departmentMemoryRepository.review({ organizationId, departmentId,
        memoryId: review.id, requestId: id, decision: review.decision, evidence })
      await refresh(current)
      if (current === generation.current) { setReview(null); setEvidence(''); requestId.current = null }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to review department method. Retrying keeps its request ID.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }
  const chooseReview = (id, decision) => { setReview({ id, decision }); setEvidence(''); requestId.current = null }
  if (!departments.length) return null
  return <section aria-label="Department memory" className="mt-5 border-t border-white/10 pt-5">
    <h4 className="font-semibold">Department methods</h4>
    <p className="mt-1 text-sm text-slate-400">A project lesson becomes reusable across this department only after a sanitized proposal and independent review. Original project access and source validity are checked on every read.</p>
    <label className="mt-3 block max-w-xs text-xs text-slate-400">Operating department<select value={departmentId} onChange={event => { setDepartmentId(event.target.value); setSourceMemoryId(''); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white">{departments.map(id => <option key={id} value={id}>{LABELS[id]}</option>)}</select></label>
    {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
    {memory && <><div className="mt-4 grid gap-4 lg:grid-cols-2"><div><h5 className="text-sm font-medium">Confirmed methods</h5>{memory.confirmed.length ? memory.confirmed.map(item => <article key={item.id} className="mt-2 rounded-lg border border-white/10 p-3"><p className="text-sm text-slate-200">{item.generalized_statement}</p><a href={`/sphere/workspace/projects/${encodeURIComponent(item.project_id)}?tab=discussion`} className="mt-2 inline-block text-xs text-violet-300">Source project discussion · {item.source_comment_id.slice(0, 8)}</a><button type="button" onClick={() => chooseReview(item.id, 'retire')} className="ml-3 text-xs text-slate-400">Retire</button></article>) : <p className="mt-2 text-xs text-slate-500">No confirmed methods.</p>}</div><div><h5 className="text-sm font-medium">Awaiting department review</h5>{memory.candidates.length ? memory.candidates.map(item => <article key={item.id} className="mt-2 rounded-lg border border-white/10 p-3"><p className="text-sm text-slate-200">{item.generalized_statement}</p><p className="mt-1 text-xs text-slate-500">Sanitization: {item.sanitization_note}</p><div className="mt-2 flex gap-3"><button type="button" onClick={() => chooseReview(item.id, 'confirm')} className="text-xs text-emerald-300">Confirm</button><button type="button" onClick={() => chooseReview(item.id, 'reject')} className="text-xs text-rose-300">Reject</button></div></article>) : <p className="mt-2 text-xs text-slate-500">No current candidates visible to your role.</p>}</div></div>
      <form onSubmit={propose} className="mt-5 rounded-xl border border-white/10 p-4"><h5 className="text-sm font-medium">Propose a generalized method</h5><p className="mt-1 text-xs text-slate-500">Choose a confirmed lesson from this project. Remove client names, identifiers, assets, and project-specific instructions before requesting wider use.</p><label className="mt-3 block text-xs text-slate-400">Source project lesson<select required value={sourceMemoryId} onChange={event => { setSourceMemoryId(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm"><option value="">Select confirmed lesson</option>{projectLessons.map(item => <option key={item.id} value={item.id}>{item.statement.slice(0, 100)}</option>)}</select></label><label className="mt-3 block text-xs text-slate-400">Generalized method<textarea required maxLength={1000} value={statement} onChange={event => { setStatement(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label><label className="mt-3 block text-xs text-slate-400">What did you remove or generalize?<textarea required minLength={20} maxLength={1000} value={sanitizationNote} onChange={event => { setSanitizationNote(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label><button type="submit" disabled={busy || !sourceMemoryId || !statement.trim() || sanitizationNote.trim().length < 20} className="mt-3 rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold disabled:opacity-40">Request department review</button></form>
      {review && <form onSubmit={decide} className="mt-4 rounded-xl border border-violet-400/20 p-4"><h5 className="text-sm font-medium">{review.decision} exact department method</h5><label className="mt-3 block text-xs text-slate-400">Review evidence<textarea required maxLength={1000} value={evidence} onChange={event => { setEvidence(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label><div className="mt-3 flex gap-3"><button type="submit" disabled={busy || !evidence.trim()} className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold disabled:opacity-40">Record decision</button><button type="button" onClick={() => { setReview(null); requestId.current = null }} className="text-xs text-slate-400">Cancel</button></div></form>}
    </>}
  </section>
}
