import { useEffect, useRef, useState } from 'react'
import { projectMemoryPurgeRepository } from '../data/projectMemoryPurgeRepository.js'

export default function ProjectMemoryPurgePanel({ organizationId, projectId, scopeRevision, onPurged, onAccessError }) {
  const [history, setHistory] = useState(null)
  const [preview, setPreview] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const requestId = useRef(null)

  useEffect(() => {
    const current = ++generation.current
    setHistory(null); setPreview(null); setSelectedId(''); setError('')
    setConfirmation(''); setReason(''); requestId.current = null
    projectMemoryPurgeRepository.history(organizationId, projectId)
      .then(rows => { if (current === generation.current) setHistory(rows) })
      .catch(cause => {
        if (current !== generation.current || cause?.status === 403) return
        onAccessError?.(cause, { membershipMismatch: false })
        setError(cause.message || 'Unable to load protected memory history.')
      })
    return () => { generation.current += 1 }
  }, [organizationId, projectId, scopeRevision, onAccessError])

  const choose = async id => {
    const current = generation.current
    setSelectedId(id); setPreview(null); setConfirmation(''); setReason('')
    setError(''); requestId.current = null; setBusy(true)
    try {
      const data = await projectMemoryPurgeRepository.preview(organizationId, projectId, id)
      if (current === generation.current) setPreview(data)
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to preview this memory chain.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }
  const purge = async event => {
    event.preventDefault()
    if (busy || !preview || selectedId === '' || confirmation !== 'PURGE') return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure purge request ID is unavailable.'); return }
    requestId.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await projectMemoryPurgeRepository.purge({ organizationId, projectId,
        memoryId: selectedId, requestId: id, memoryIds: preview.memory_ids,
        confirmation, reason })
      const rows = await projectMemoryPurgeRepository.history(organizationId, projectId)
      if (current === generation.current) {
        setHistory(rows); setPreview(null); setSelectedId(''); setConfirmation('')
        setReason(''); requestId.current = null
        await onPurged?.()
      }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to purge. Retrying keeps the exact request ID.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }

  if (history === null && !error) return null
  return <section aria-label="Protected memory history" className="mt-5 border-t border-white/10 pt-4">
    <h4 className="text-sm font-medium">Protected history and explicit purge</h4>
    <p className="mt-1 text-xs text-slate-500">System owner only. Source removal and retirement stop reuse but retain history. Purge permanently erases every linked lesson in the preview and its review text, leaving a content-free audit receipt.</p>
    {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
    {history?.length ? <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{history.map(item => <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-white/10 p-2"><div><p className="text-xs text-slate-300">{item.statement}</p><p className="mt-1 text-[11px] text-slate-500">{item.status} · {item.id}</p></div><button type="button" disabled={busy} onClick={() => choose(item.id)} className="text-xs text-rose-300 disabled:opacity-40">Preview purge</button></div>)}</div> : <p className="mt-3 text-xs text-slate-500">No protected history in this project.</p>}
    {preview && <form onSubmit={purge} className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/10 p-4"><h5 className="text-sm font-medium text-rose-200">Permanently purge {preview.memory_ids.length} linked lesson{preview.memory_ids.length === 1 ? '' : 's'}</h5><p className="mt-1 text-xs text-slate-400">Review the exact IDs below. This cannot be undone.</p><ul className="mt-2 space-y-1 text-[11px] text-slate-400">{preview.records.map(item => <li key={item.id}>{item.status} · {item.id}</li>)}</ul><label className="mt-3 block text-xs text-slate-300">Reason<textarea required minLength={10} maxLength={1000} value={reason} onChange={event => { setReason(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label><label className="mt-3 block text-xs text-slate-300">Type PURGE<input required value={confirmation} onChange={event => { setConfirmation(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label><div className="mt-3 flex gap-3"><button type="submit" disabled={busy || confirmation !== 'PURGE' || reason.trim().length < 10} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold disabled:opacity-40">Permanently purge reviewed lessons</button><button type="button" onClick={() => { setPreview(null); setSelectedId(''); requestId.current = null }} className="text-xs text-slate-400">Cancel</button></div></form>}
  </section>
}
