import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { canShowAuthorityAdministration } from '../data/authorityAdministration.js'
import { projectDraftRepository } from '../data/projectDraftRepository.js'
import { projectServiceScopeRepository } from '../data/projectServiceScopeRepository.js'

const inputClass = 'mt-1 w-full rounded-lg border border-white/10 bg-[#111622] px-3 py-2 text-sm text-white'
const blank = { serviceId: '', scopeStatement: '', exclusions: '', quantity: 1, ownerId: '', startDate: '', targetDate: '' }
const title = value => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export default function ProjectServiceScopePanel({ project, organizationId, membership, scopeRevision, requestSignal, onChanged, onAccessError }) {
  const { user } = useAuth()
  const admin = canShowAuthorityAdministration(membership)
  const [snapshot, setSnapshot] = useState(null)
  const [canManage, setCanManage] = useState(admin)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState(blank)
  const [review, setReview] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const pending = useRef(null)
  const generation = useRef(0)

  const refresh = useCallback(async current => {
    const data = await projectServiceScopeRepository.snapshot(organizationId, project.id, { signal: requestSignal })
    if (current === generation.current && !requestSignal?.aborted) setSnapshot(data)
  }, [organizationId, project.id, requestSignal])

  useEffect(() => {
    const current = ++generation.current
    setSnapshot(null); setCanManage(admin); setForm(blank); setReview(null); setAcknowledged(false)
    setError(''); setNotice(''); setLoading(true); pending.current = null
    Promise.all([
      projectServiceScopeRepository.snapshot(organizationId, project.id, { signal: requestSignal }),
      admin || !user?.id ? Promise.resolve(admin) : projectDraftRepository.hasOwnManagerBinding(
        organizationId, project.id, user.id, { signal: requestSignal }),
    ]).then(([data, manager]) => {
      if (current === generation.current && !requestSignal?.aborted) { setSnapshot(data); setCanManage(manager) }
    }).catch(cause => {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to load service scope.')
      }
    }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current += 1 }
  }, [admin, organizationId, project.id, requestSignal, scopeRevision, user?.id, onAccessError])

  const run = async (action, scope, extra = {}) => {
    if (saving) return
    const current = generation.current
    const identity = JSON.stringify({ action, scopeId: scope?.id || null, revision: scope?.revision || null, extra })
    if (pending.current?.identity !== identity) pending.current = { identity, id: globalThis.crypto?.randomUUID?.() }
    if (!pending.current.id) { setError('A secure request ID is unavailable.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      await projectServiceScopeRepository.change({ organizationId, projectId: project.id,
        requestId: pending.current.id, action, scopeId: scope?.id, expectedRevision: scope?.revision, ...extra })
      await refresh(current)
      if (current === generation.current) {
        pending.current = null; setForm(blank); setReview(null); setAcknowledged(false)
        setNotice(`Service scope ${action === 'add' ? 'proposed' : action === 'cancel' ? 'cancelled' : action + 'd'}.`)
        onChanged?.()
      }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.status === 409 ? `${cause.message} Refresh the impact review before retrying.` : cause.message)
      }
    } finally { if (current === generation.current) setSaving(false) }
  }

  const beginReview = async (scope, action) => {
    const current = generation.current
    setError(''); setAcknowledged(false)
    try {
      await refresh(current)
      if (current === generation.current) setReview({ scopeId: scope.id, action })
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to refresh impact review.')
      }
    }
  }
  const selectedReview = snapshot?.scopes.find(scope => scope.id === review?.scopeId)
  const available = snapshot?.catalog.filter(service => !snapshot.scopes.some(scope => scope.service_id === service.id)) || []
  return <section aria-label="Selected services" className="space-y-5">
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <h2 className="font-semibold">Selected services</h2>
      <p className="mt-1 text-sm text-slate-400">Proposals do not start delivery. Activation is a separate action after the project is active.</p>
      {loading && <p className="mt-4 text-sm text-slate-400">Loading service scope…</p>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-emerald-200">{notice}</p>}
      {snapshot && <div className="mt-5 space-y-3">{snapshot.scopes.length ? snapshot.scopes.map(scope => {
        const service = snapshot.catalog.find(row => row.id === scope.service_id)
        const owner = snapshot.members.find(row => row.id === scope.owner_id)
        return <article key={scope.id} className="rounded-xl border border-white/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{service?.name || 'Previously selected service'}</h3><p className="mt-1 text-xs text-slate-400">{title(scope.status)} · {title(scope.source)} · Quantity {scope.quantity}{owner ? ` · ${owner.name}` : ''}{scope.target_date ? ` · Target ${scope.target_date}` : ''}</p></div>
            {canManage && <div className="flex flex-wrap gap-2">
              {scope.status === 'proposed' && <button type="button" disabled={saving || project.status !== 'active'} onClick={() => run('activate', scope)} className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs text-violet-200 disabled:opacity-40">Activate service</button>}
              {scope.status === 'active' && ['pause', 'complete', 'cancel'].map(action => <button type="button" key={action} disabled={saving} onClick={() => beginReview(scope, action)} className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-40">{title(action)}…</button>)}
              {['on_hold', 'cancelled'].includes(scope.status) && <button type="button" disabled={saving || project.status !== 'active'} onClick={() => run('resume', scope)} className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs text-violet-200 disabled:opacity-40">Resume service</button>}
            </div>}</div>
          {scope.scope_statement && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{scope.scope_statement}</p>}
          {scope.exclusions && <p className="mt-2 text-xs text-slate-400">Exclusions: {scope.exclusions}</p>}
          {scope.status === 'proposed' && project.status !== 'active' && <p className="mt-2 text-xs text-slate-500">Activate the project before activating this service.</p>}
        </article>
      }) : <p className="text-sm text-slate-500">No services selected yet.</p>}</div>}
    </div>
    {snapshot && canManage && available.length > 0 && <form onSubmit={event => { event.preventDefault(); run('add', null, { serviceId: form.serviceId,
      scopeStatement: form.scopeStatement, exclusions: form.exclusions, quantity: Number(form.quantity),
      ownerId: form.ownerId, startDate: form.startDate, targetDate: form.targetDate }) }} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <h2 className="font-semibold">Propose a service</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-xs text-slate-400">Catalogue service<select required className={inputClass} value={form.serviceId} onChange={event => { setForm(value => ({ ...value, serviceId: event.target.value })); pending.current = null }}><option value="">Select service</option>{available.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
        <label className="text-xs text-slate-400">Owner<select className={inputClass} value={form.ownerId} onChange={event => setForm(value => ({ ...value, ownerId: event.target.value }))}><option value="">Unassigned</option>{snapshot.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="text-xs text-slate-400">Quantity<input required min="1" type="number" className={inputClass} value={form.quantity} onChange={event => setForm(value => ({ ...value, quantity: event.target.value }))} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-400">Start<input type="date" className={inputClass} value={form.startDate} onChange={event => setForm(value => ({ ...value, startDate: event.target.value }))} /></label><label className="text-xs text-slate-400">Target<input type="date" min={form.startDate || undefined} className={inputClass} value={form.targetDate} onChange={event => setForm(value => ({ ...value, targetDate: event.target.value }))} /></label></div>
        <label className="text-xs text-slate-400 md:col-span-2">Included scope<textarea className={inputClass} rows={3} value={form.scopeStatement} onChange={event => setForm(value => ({ ...value, scopeStatement: event.target.value }))} /></label>
        <label className="text-xs text-slate-400 md:col-span-2">Exclusions<textarea className={inputClass} rows={2} value={form.exclusions} onChange={event => setForm(value => ({ ...value, exclusions: event.target.value }))} /></label>
      </div><button type="submit" disabled={saving || !form.serviceId} className="mt-4 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold disabled:opacity-40">{saving ? 'Saving…' : 'Save proposal'}</button>
    </form>}
    {selectedReview && <div role="dialog" aria-modal="false" aria-label="Service impact review" className="rounded-2xl border border-amber-400/30 bg-amber-500/[0.07] p-5">
      <h2 className="font-semibold">Review impact before {review.action}</h2>
      <p className="mt-2 text-sm text-slate-300">This project currently has {snapshot.impact.project_tasks} project tasks, {snapshot.impact.engagement_work_items} engagement work items, and {snapshot.impact.deliverables} deliverables. Exact links to this service are not recorded, so these are project-wide counts. All linked records will remain intact.</p>
      <label className="mt-4 flex gap-2 text-sm text-slate-200"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed the current project-wide work and will preserve it.</label>
      <div className="mt-4 flex gap-2"><button type="button" disabled={!acknowledged || saving} onClick={() => run(review.action, selectedReview, { impactToken: selectedReview.impact_token, impactAcknowledged: true })} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{saving ? 'Saving…' : `Confirm ${review.action}`}</button><button type="button" onClick={() => { setReview(null); setAcknowledged(false) }} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Keep current scope</button></div>
    </div>}
  </section>
}
