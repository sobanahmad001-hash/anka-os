import { useEffect, useRef, useState } from 'react'
import { clientBrandMemoryRepository } from '../data/clientBrandMemoryRepository.js'

export default function ClientBrandMemoryPanel({
  organizationId, projectId, projectLessons = [], scopeRevision, onAccessError,
}) {
  const [memory, setMemory] = useState(null)
  const [sourceMemoryId, setSourceMemoryId] = useState('')
  const [scopeKind, setScopeKind] = useState('brand')
  const [review, setReview] = useState(null)
  const [evidence, setEvidence] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const requestId = useRef(null)

  useEffect(() => {
    const current = ++generation.current
    setMemory(null); setError(''); setReview(null); setSourceMemoryId('')
    requestId.current = null
    clientBrandMemoryRepository.list(organizationId, projectId)
      .then(data => { if (current === generation.current) setMemory(data) })
      .catch(cause => {
        if (current !== generation.current) return
        // Internal projects have no client/brand engagement, so no wider scope exists.
        if (cause.status !== 403) {
          onAccessError?.(cause, { membershipMismatch: false })
          setError(cause.message || 'Unable to load client and brand memory.')
        }
      })
    return () => { generation.current += 1 }
  }, [organizationId, projectId, scopeRevision, onAccessError])

  const reload = async current => {
    const data = await clientBrandMemoryRepository.list(organizationId, projectId)
    if (current === generation.current) setMemory(data)
  }
  const propose = async event => {
    event.preventDefault()
    if (busy || !sourceMemoryId) return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await clientBrandMemoryRepository.propose({ organizationId, projectId, requestId: id,
        sourceMemoryId, scopeKind })
      await reload(current)
      if (current === generation.current) { setSourceMemoryId(''); requestId.current = null }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to propose this promotion.')
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
      await clientBrandMemoryRepository.review({ organizationId, projectId,
        memoryId: review.id, requestId: id, decision: review.decision, evidence })
      await reload(current)
      if (current === generation.current) { setReview(null); setEvidence(''); requestId.current = null }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to record this decision.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }
  const chooseReview = (id, decision) => {
    setReview({ id, decision }); setEvidence(''); requestId.current = null
  }
  if (!memory && !error) return null
  return <section aria-label="Client and brand memory" className="mt-5 border-t border-white/10 pt-5">
    <h4 className="font-semibold">Client and brand requirements</h4>
    <p className="mt-1 text-sm text-slate-400">A confirmed project lesson can be deliberately promoted to this brand or its client. A different leader reviews it. The original message and project lesson must remain unchanged and active on every read.</p>
    {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
    {memory && <>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div><h5 className="text-sm font-medium">Confirmed for this context</h5>
          {memory.confirmed.length ? memory.confirmed.map(item =>
            <article key={item.id} className="mt-2 rounded-lg border border-white/10 p-3">
              <span className="text-[11px] uppercase text-violet-300">{item.scope_kind}</span>
              <p className="mt-1 text-sm text-slate-200">{item.statement}</p>
              <a href={item.project_id === projectId ? '#project-message-' + item.source_comment_id : '/sphere/workspace/projects/' + encodeURIComponent(item.project_id) + '?tab=discussion'} className="mt-2 inline-block text-xs text-violet-300">Source project discussion · {item.source_comment_id.slice(0, 8)}</a>
              <button type="button" onClick={() => chooseReview(item.id, 'retire')} className="ml-3 text-xs text-slate-400">Retire</button>
            </article>) : <p className="mt-2 text-xs text-slate-500">No confirmed client or brand requirements.</p>}
        </div>
        <div><h5 className="text-sm font-medium">Awaiting leadership review</h5>
          {memory.candidates.length ? memory.candidates.map(item =>
            <article key={item.id} className="mt-2 rounded-lg border border-white/10 p-3">
              <span className="text-[11px] uppercase text-violet-300">{item.scope_kind}</span>
              <p className="mt-1 text-sm text-slate-200">{item.statement}</p>
              <div className="mt-2 flex gap-3">
                <button type="button" onClick={() => chooseReview(item.id, 'confirm')} className="text-xs text-emerald-300">Confirm</button>
                <button type="button" onClick={() => chooseReview(item.id, 'reject')} className="text-xs text-rose-300">Reject</button>
              </div>
            </article>) : <p className="mt-2 text-xs text-slate-500">No current candidates visible to your role.</p>}
        </div>
      </div>
      <form onSubmit={propose} className="mt-5 rounded-xl border border-white/10 p-4">
        <h5 className="text-sm font-medium">Promote a confirmed project lesson</h5>
        <p className="mt-1 text-xs text-slate-500">The exact lesson text is reused. Choose client scope only if it applies across every brand for this client.</p>
        <label className="mt-3 block text-xs text-slate-400">Source lesson
          <select required value={sourceMemoryId} onChange={event => { setSourceMemoryId(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm">
            <option value="">Select confirmed lesson</option>
            {projectLessons.map(item => <option key={item.id} value={item.id}>{item.statement.slice(0, 100)}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-xs text-slate-400">Reuse scope
          <select value={scopeKind} onChange={event => { setScopeKind(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm">
            <option value="brand">This brand</option><option value="client">All brands for this client</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !sourceMemoryId} className="mt-3 rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold disabled:opacity-40">Request leadership review</button>
      </form>
      {review && <form onSubmit={decide} className="mt-4 rounded-xl border border-violet-400/20 p-4">
        <h5 className="text-sm font-medium">{review.decision} exact client or brand lesson</h5>
        <label className="mt-3 block text-xs text-slate-400">Review evidence
          <textarea required maxLength={1000} value={evidence} onChange={event => { setEvidence(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" />
        </label>
        <div className="mt-3 flex gap-3">
          <button type="submit" disabled={busy || !evidence.trim()} className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold disabled:opacity-40">Record decision</button>
          <button type="button" onClick={() => { setReview(null); requestId.current = null }} className="text-xs text-slate-400">Cancel</button>
        </div>
      </form>}
    </>}
  </section>
}
