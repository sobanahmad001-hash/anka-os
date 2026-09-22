import { useEffect, useRef, useState } from 'react'
import { privateMemoryRepository } from '../data/privateMemoryRepository.js'

export default function PrivateMemoryPanel({ organizationId, ownerId, experimentJobs = [], scopeRevision, onAccessError }) {
  const [memory, setMemory] = useState(null)
  const [sourceKind, setSourceKind] = useState('owner_note')
  const [sourceNote, setSourceNote] = useState('')
  const [sourceJobId, setSourceJobId] = useState('')
  const [statement, setStatement] = useState('')
  const [supersedesId, setSupersedesId] = useState('')
  const [retireId, setRetireId] = useState('')
  const [retireReason, setRetireReason] = useState('')
  const [preview, setPreview] = useState(null)
  const [purgeMemoryId, setPurgeMemoryId] = useState('')
  const [purgeReason, setPurgeReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const saveRequest = useRef(null)
  const retireRequest = useRef(null)
  const purgeRequest = useRef(null)
  const availableJobs = experimentJobs.filter(job => job.status === 'succeeded')
  const load = async (current = generation.current) => {
    const data = await privateMemoryRepository.list(organizationId, ownerId)
    if (current === generation.current) setMemory(data)
  }
  useEffect(() => {
    const current = ++generation.current
    setMemory(null); setError(''); setPreview(null); setRetireId('')
    saveRequest.current = null; retireRequest.current = null; purgeRequest.current = null
    if (!organizationId || !ownerId) return () => { generation.current += 1 }
    privateMemoryRepository.list(organizationId, ownerId)
      .then(data => { if (current === generation.current) setMemory(data) })
      .catch(cause => {
        if (current !== generation.current) return
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to load private memory.')
      })
    return () => { generation.current += 1 }
  }, [organizationId, ownerId, scopeRevision, onAccessError])
  const save = async event => {
    event.preventDefault()
    if (busy) return
    const id = saveRequest.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    saveRequest.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await privateMemoryRepository.save({ organizationId, requestId: id, sourceKind,
        sourceNote: sourceKind === 'owner_note' ? sourceNote : null,
        sourceJobId: sourceKind === 'design_experiment' ? sourceJobId : null,
        statement, supersedesId: supersedesId || null })
      await load(current)
      if (current === generation.current) {
        setSourceNote(''); setSourceJobId(''); setStatement(''); setSupersedesId(''); saveRequest.current = null
      }
    } catch (cause) { if (current === generation.current) setError(cause.message || 'Unable to save. Retrying keeps the request ID.') }
    finally { if (current === generation.current) setBusy(false) }
  }
  const retire = async event => {
    event.preventDefault()
    if (busy || !retireId) return
    const id = retireRequest.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    retireRequest.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await privateMemoryRepository.retire({ organizationId, memoryId: retireId,
        requestId: id, reason: retireReason })
      await load(current)
      if (current === generation.current) { setRetireId(''); setRetireReason(''); retireRequest.current = null }
    } catch (cause) { if (current === generation.current) setError(cause.message || 'Unable to retire private memory.') }
    finally { if (current === generation.current) setBusy(false) }
  }
  const inspectPurge = async id => {
    const current = generation.current
    setPreview(null); setPurgeMemoryId(id); setPurgeReason(''); setConfirmation('')
    purgeRequest.current = null; setBusy(true); setError('')
    try {
      const data = await privateMemoryRepository.previewPurge(organizationId, id, ownerId)
      if (current === generation.current) setPreview(data)
    } catch (cause) { if (current === generation.current) setError(cause.message || 'Unable to preview private purge.') }
    finally { if (current === generation.current) setBusy(false) }
  }
  const purge = async event => {
    event.preventDefault()
    if (busy || !preview) return
    const id = purgeRequest.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    purgeRequest.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await privateMemoryRepository.purge({ organizationId, memoryId: purgeMemoryId,
        requestId: id, memoryIds: preview.memory_ids, confirmation, reason: purgeReason })
      await load(current)
      if (current === generation.current) {
        setPreview(null); setPurgeMemoryId(''); setPurgeReason(''); setConfirmation(''); purgeRequest.current = null
      }
    } catch (cause) { if (current === generation.current) setError(cause.message || 'Unable to purge. Retrying keeps the exact request ID.') }
    finally { if (current === generation.current) setBusy(false) }
  }
  if (!organizationId || !ownerId) return null
  return <section aria-label="Owner-private memory" className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-white">
    <h3 className="font-semibold">My private memory</h3><p className="mt-1 text-sm text-slate-400">Only you can read these confirmed notes and experiment lessons. They never enter a project or wider scope automatically, and they are not sent to an AI provider from this screen.</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    {memory ? <><div className="mt-4 grid gap-4 lg:grid-cols-2"><div><h4 className="text-sm font-medium">Current private lessons</h4>{memory.confirmed.length ? memory.confirmed.map(item => <article key={item.id} className="mt-2 rounded-lg border border-white/10 p-3"><p className="text-sm text-slate-200">{item.statement}</p><p className="mt-1 text-xs text-slate-500">{item.source_kind === 'owner_note' ? item.source_note : `Design experiment ${item.source_job_id?.slice(0, 8)}`}</p><div className="mt-2 flex gap-3"><button type="button" onClick={() => { setSupersedesId(item.id); saveRequest.current = null }} className="text-xs text-violet-300">Correct</button><button type="button" onClick={() => { setRetireId(item.id); setRetireReason(''); retireRequest.current = null }} className="text-xs text-slate-400">Retire</button></div></article>) : <p className="mt-2 text-xs text-slate-500">No current private lessons.</p>}</div><div><h4 className="text-sm font-medium">Protected history</h4><div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{memory.history.map(item => <div key={item.id} className="flex items-start justify-between gap-2 rounded-lg border border-white/10 p-2"><div><p className="text-xs text-slate-300">{item.statement}</p><p className="mt-1 text-[11px] text-slate-500">{item.status} · {item.id}</p></div><button type="button" disabled={busy} onClick={() => inspectPurge(item.id)} className="text-xs text-rose-300 disabled:opacity-40">Preview purge</button></div>)}</div>{!memory.history.length && <p className="text-xs text-slate-500">No private history.</p>}</div></div>
      <form onSubmit={save} className="mt-5 rounded-xl border border-white/10 p-4"><h4 className="text-sm font-medium">Save a private lesson</h4>{supersedesId && <p className="mt-2 text-xs text-violet-300">Correcting {supersedesId}. <button type="button" onClick={() => { setSupersedesId(''); saveRequest.current = null }} className="underline">Clear</button></p>}<label className="mt-3 block text-xs text-slate-400">Source<select value={sourceKind} onChange={event => { setSourceKind(event.target.value); saveRequest.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm"><option value="owner_note">My explicit note</option>{availableJobs.length > 0 && <option value="design_experiment">Completed private Design experiment</option>}</select></label>{sourceKind === 'owner_note' ? <label className="mt-3 block text-xs text-slate-400">Original note<textarea required maxLength={2000} value={sourceNote} onChange={event => { setSourceNote(event.target.value); saveRequest.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label> : <label className="mt-3 block text-xs text-slate-400">Completed owner-private experiment<select required value={sourceJobId} onChange={event => { setSourceJobId(event.target.value); saveRequest.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm"><option value="">Select exact experiment</option>{availableJobs.map(job => <option key={job.id} value={job.id}>{job.prompt?.slice(0, 90) || job.id}</option>)}</select></label>}<label className="mt-3 block text-xs text-slate-400">Lesson<textarea required maxLength={1000} value={statement} onChange={event => { setStatement(event.target.value); saveRequest.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label><button type="submit" disabled={busy || !statement.trim() || (sourceKind === 'owner_note' ? !sourceNote.trim() : !sourceJobId)} className="mt-3 rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold disabled:opacity-40">Save privately</button></form>
      {retireId && <form onSubmit={retire} className="mt-4 rounded-xl border border-white/10 p-4"><h4 className="text-sm font-medium">Retire {retireId}</h4><label className="mt-2 block text-xs text-slate-400">Reason<textarea required maxLength={1000} value={retireReason} onChange={event => { setRetireReason(event.target.value); retireRequest.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label><div className="mt-2 flex gap-3"><button type="submit" disabled={busy || !retireReason.trim()} className="text-xs text-rose-300">Record retirement</button><button type="button" onClick={() => setRetireId('')} className="text-xs text-slate-400">Cancel</button></div></form>}
      {preview && <form onSubmit={purge} className="mt-4 rounded-xl border border-rose-500/30 p-4"><h4 className="text-sm font-medium text-rose-200">Permanently purge {preview.memory_ids.length} linked private lesson{preview.memory_ids.length === 1 ? '' : 's'}</h4><ul className="mt-2 space-y-1 text-xs text-slate-400">{preview.records.map(row => <li key={row.id}>{row.status} · {row.id}</li>)}</ul><label className="mt-3 block text-xs text-slate-400">Reason<textarea required minLength={10} maxLength={1000} value={purgeReason} onChange={event => { setPurgeReason(event.target.value); purgeRequest.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label><label className="mt-3 block text-xs text-slate-400">Type PURGE<input required value={confirmation} onChange={event => { setConfirmation(event.target.value); purgeRequest.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm" /></label><div className="mt-3 flex gap-3"><button type="submit" disabled={busy || confirmation !== 'PURGE' || purgeReason.trim().length < 10} className="text-xs font-semibold text-rose-300 disabled:opacity-40">Permanently purge reviewed lessons</button><button type="button" onClick={() => setPreview(null)} className="text-xs text-slate-400">Cancel</button></div></form>}
    </> : <p className="mt-3 text-sm text-slate-400">Loading private memory…</p>}
  </section>
}
