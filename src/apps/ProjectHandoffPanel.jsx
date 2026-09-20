import { useCallback, useEffect, useRef, useState } from 'react'
import { projectHandoffRepository } from '../data/projectHandoffRepository.js'

export default function ProjectHandoffPanel({ organizationId, projectId, workstreams, sourceCommentId,
  scopeRevision, requestSignal, onAccessError }) {
  const [handoffs, setHandoffs] = useState([])
  const [requestingId, setRequestingId] = useState('')
  const [receivingId, setReceivingId] = useState('')
  const [title, setTitle] = useState('')
  const [output, setOutput] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [priority, setPriority] = useState('medium')
  const [requiredBy, setRequiredBy] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(null)
  const generation = useRef(0)
  const activeWorkstreams = workstreams.filter(row => row.status === 'active')
  const name = (id, fallback = 'Project-wide') => workstreams.find(row => row.id === id)?.name || fallback
  const showSource = commentId => {
    const target = globalThis.document?.getElementById(`project-message-${commentId}`)
    if (target) target.scrollIntoView?.({ behavior: 'smooth' })
    else setError('This source message is earlier in the discussion. Load earlier messages to view it.')
  }
  const refresh = useCallback(async current => {
    const rows = await projectHandoffRepository.list(organizationId, projectId, { signal: requestSignal })
    if (current === generation.current && !requestSignal?.aborted) setHandoffs(rows)
  }, [organizationId, projectId, requestSignal])
  useEffect(() => {
    const current = ++generation.current
    setHandoffs([]); setRequestingId(''); setReceivingId(''); setTitle(''); setOutput('')
    setAcceptance(''); setPriority('medium'); setRequiredBy(''); setError(''); setLoading(true)
    requestId.current = null
    refresh(current).catch(cause => {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to load project handoffs.')
      }
    }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current += 1 }
  }, [organizationId, projectId, scopeRevision, requestSignal, onAccessError, refresh])
  useEffect(() => { requestId.current = null }, [sourceCommentId])
  const change = setter => event => { setter(event.target.value); requestId.current = null }
  const submit = async event => {
    event.preventDefault()
    if (saving) return
    const current = generation.current
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure handoff ID is unavailable.'); return }
    requestId.current = id; setSaving(true); setError('')
    try {
      await projectHandoffRepository.create({ organizationId, projectId, requestId: id, sourceCommentId,
        requestingWorkstreamId: requestingId || null, receivingWorkstreamId: receivingId,
        title, requestedOutput: output, acceptanceCriteria: acceptance, priority,
        requiredBy: requiredBy || null })
      await refresh(current)
      if (current === generation.current && !requestSignal?.aborted) {
        setRequestingId(''); setReceivingId(''); setTitle(''); setOutput(''); setAcceptance('')
        setPriority('medium'); setRequiredBy(''); requestId.current = null
      }
    } catch (cause) {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to create handoff. Retry keeps its ID.')
      }
    } finally { if (current === generation.current) setSaving(false) }
  }
  return <section aria-label="Project handoffs" className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
    <h2 className="font-semibold">Requests and handoffs</h2>
    <p className="mt-1 text-sm text-slate-400">A handoff creates a canonical internal Request for the receiving workstream. Its source discussion stays linked; this does not approve or release an output.</p>
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-400">Loading handoffs…</p> : <div className="mt-4 space-y-3">
      {handoffs.map(item => <article key={item.id} className="rounded-xl border border-white/10 p-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><strong>{item.title}</strong><span className="text-xs text-slate-400">{item.status.replaceAll('_', ' ')}</span></div>
        <p className="mt-2 text-slate-400">{name(item.requesting_workstream_id)} → {name(item.receiving_workstream_id, 'Unassigned workstream')} · {item.priority}</p>
        <p className="mt-2 text-slate-300">{item.requested_output}</p>
        {item.acceptance_criteria && <p className="mt-1 text-slate-400">Acceptance: {item.acceptance_criteria}</p>}
        {item.source_project_comment_id && <button type="button" onClick={() => showSource(item.source_project_comment_id)} className="mt-2 text-xs text-violet-300">Source discussion message · {item.source_project_comment_id}</button>}
      </article>)}
      {!handoffs.length && <p className="text-sm text-slate-500">No canonical handoffs recorded.</p>}
    </div>}
    <form onSubmit={submit} className="mt-6 space-y-3 border-t border-white/10 pt-5">
      <h3 className="font-medium">Create internal handoff</h3>
      {sourceCommentId ? <p className="text-xs text-violet-300">Source: selected project discussion message</p> : <p className="text-xs text-slate-400">Select “Create handoff” on a discussion message to preserve its source.</p>}
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs text-slate-400">From workstream<select value={requestingId} onChange={change(setRequestingId)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white"><option value="">Project-wide</option>{activeWorkstreams.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="block text-xs text-slate-400">Receiving workstream<select required value={receivingId} onChange={change(setReceivingId)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white"><option value="">Select workstream</option>{activeWorkstreams.filter(row => row.id !== requestingId).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>
      <label className="block text-xs text-slate-400">Title<input required maxLength={240} value={title} onChange={change(setTitle)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white" /></label>
      <label className="block text-xs text-slate-400">Expected output<textarea required rows={3} maxLength={8000} value={output} onChange={change(setOutput)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white" /></label>
      <label className="block text-xs text-slate-400">Acceptance criteria<textarea rows={2} maxLength={4000} value={acceptance} onChange={change(setAcceptance)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white" /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs text-slate-400">Priority<select value={priority} onChange={change(setPriority)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white">{['low', 'medium', 'high', 'urgent'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="block text-xs text-slate-400">Required by<input type="date" value={requiredBy} onChange={change(setRequiredBy)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] p-2 text-sm text-white" /></label></div>
      <button type="submit" disabled={saving || !sourceCommentId || !receivingId || !title.trim() || !output.trim()} className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Creating…' : 'Create handoff request'}</button>
    </form>
  </section>
}
