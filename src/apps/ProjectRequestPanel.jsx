import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { canShowAuthorityAdministration } from '../data/authorityAdministration.js'
import { projectRequestRepository } from '../data/projectRequestRepository.js'

const INPUT = 'mt-1 w-full rounded-lg border border-white/10 bg-[#111622] px-3 py-2 text-sm text-white'
const empty = { name: '', description: '', engagementType: 'internal', clientId: '', brandId: '', startDate: '', dueDate: '' }

export default function ProjectRequestPanel({ organizationId, membership, scopeRevision, requestSignal, onAccessError }) {
  const navigate = useNavigate()
  const admin = canShowAuthorityAdministration(membership)
  const [snapshot, setSnapshot] = useState(null)
  const [form, setForm] = useState(empty)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const submitId = useRef(null)
  const conversionIds = useRef(new Map())
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setSnapshot(null); setForm(empty); setShowForm(false); setError(''); setNotice(''); setLoading(true)
    submitId.current = null
    conversionIds.current.clear()
    projectRequestRepository.snapshot(organizationId, { signal: requestSignal }).then(data => {
      if (current === generation.current && !requestSignal?.aborted) setSnapshot(data)
    }).catch(cause => {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to load project requests')
      }
    }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current += 1 }
  }, [organizationId, onAccessError, requestSignal, scopeRevision])

  const refresh = async (current) => {
    const data = await projectRequestRepository.snapshot(organizationId, { signal: requestSignal })
    if (current === generation.current && !requestSignal?.aborted) setSnapshot(data)
  }
  const change = patch => {
    setForm(value => ({ ...value, ...patch }))
    submitId.current = null
    setError('')
  }
  const submit = async event => {
    event.preventDefault()
    if (saving) return
    const current = generation.current
    const id = submitId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    submitId.current = id
    setSaving(true); setError(''); setNotice('')
    try {
      await projectRequestRepository.submit({ organizationId, requestId: id, ...form })
      await refresh(current)
      if (current === generation.current) {
        setShowForm(false); setForm(empty); submitId.current = null
        setNotice('Project request submitted. An organization owner or admin can create the official draft.')
      }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to submit project request. Retrying keeps the same request ID.')
      }
    } finally { if (current === generation.current) setSaving(false) }
  }
  const convert = async request => {
    if (converting) return
    const current = generation.current
    const id = conversionIds.current.get(request.request_id) || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure conversion ID is unavailable.'); return }
    conversionIds.current.set(request.request_id, id)
    setConverting(request.request_id); setError(''); setNotice('')
    try {
      const result = await projectRequestRepository.convert({ organizationId,
        sourceRequestId: request.request_id, requestId: id })
      await refresh(current)
      if (current === generation.current) {
        conversionIds.current.delete(request.request_id)
        navigate(`/sphere/workspace/projects/${result.project_id}?tab=services`)
      }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to create the draft. Retrying keeps the same conversion ID.')
      }
    } finally { if (current === generation.current) setConverting('') }
  }
  const client = snapshot?.clients.find(row => row.id === form.clientId)
  return <section aria-label="Project requests" className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-slate-100">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Project requests</h2><p className="mt-1 text-xs text-slate-500">A request does not create a project or appoint a manager. Only an owner or admin can convert it to an official draft.</p></div>{!admin && <button type="button" onClick={() => setShowForm(value => !value)} className="rounded-lg border border-violet-400/30 px-3 py-2 text-sm text-violet-200">{showForm ? 'Close request form' : 'Request a project'}</button>}</div>
    {loading && <p className="mt-4 text-sm text-slate-400">Loading project requests…</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm text-emerald-200">{notice}</p>}
    {showForm && snapshot && !admin && <form onSubmit={submit} className="mt-5 grid gap-4 border-t border-white/10 pt-5 md:grid-cols-2">
      <label className="text-xs text-slate-400">Work type<select className={INPUT} value={form.engagementType} onChange={event => change({ engagementType: event.target.value, clientId: '', brandId: '' })}><option value="internal">Internal Work</option><option value="project">Client project</option><option value="retainer">Client retainer</option></select></label>
      <label className="text-xs text-slate-400">Project name<input className={INPUT} required maxLength={240} value={form.name} onChange={event => change({ name: event.target.value })} /></label>
      {form.engagementType !== 'internal' && <><label className="text-xs text-slate-400">Client<select className={INPUT} required value={form.clientId} onChange={event => change({ clientId: event.target.value, brandId: '' })}><option value="">Select client</option>{snapshot.clients.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-xs text-slate-400">Brand<select className={INPUT} required value={form.brandId} onChange={event => change({ brandId: event.target.value })}><option value="">Select brand</option>{(client?.brands || []).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></>}
      <label className="text-xs text-slate-400">Suggested start<input className={INPUT} type="date" value={form.startDate} onChange={event => change({ startDate: event.target.value })} /></label>
      <label className="text-xs text-slate-400">Suggested due date<input className={INPUT} type="date" min={form.startDate || undefined} value={form.dueDate} onChange={event => change({ dueDate: event.target.value })} /></label>
      <label className="text-xs text-slate-400 md:col-span-2">Brief<textarea className={INPUT} rows={3} value={form.description} onChange={event => change({ description: event.target.value })} /></label>
      <div className="md:col-span-2"><button type="submit" disabled={saving || !form.name.trim()} className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold disabled:opacity-40">{saving ? 'Submitting…' : 'Submit project request'}</button></div>
    </form>}
    {snapshot && <div className="mt-5 space-y-3 border-t border-white/10 pt-4">{snapshot.requests.length ? snapshot.requests.map(request => <div key={request.request_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-3"><div><p className="text-sm font-medium">{request.payload.name}</p><p className="mt-1 text-xs text-slate-500">{request.payload.engagement_type.replaceAll('_', ' ')} · {request.status}{admin ? ` · Requested by ${request.requester_id}` : ''}</p></div>{request.status === 'converted' && request.converted_project_id ? <button type="button" onClick={() => navigate(`/sphere/workspace/projects/${request.converted_project_id}`)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs">Open draft</button> : admin && <button type="button" disabled={Boolean(converting)} onClick={() => convert(request)} className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs text-violet-200 disabled:opacity-40">{converting === request.request_id ? 'Creating draft…' : 'Create official draft'}</button>}</div>) : <p className="text-sm text-slate-500">No project requests in this organization.</p>}</div>}
  </section>
}
