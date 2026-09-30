import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { canShowAuthorityAdministration } from '../data/authorityAdministration.js'
import { projectDraftRepository } from '../data/projectDraftRepository.js'
import { canManageProjectServices, createProjectServiceProposalQueue, projectServiceProposalContextKey, submitProjectServiceProposals } from '../data/projectServiceProposalQueue.js'
import { projectServiceScopeRepository } from '../data/projectServiceScopeRepository.js'

const inputClass = 'mt-1 w-full rounded-lg border border-white/10 bg-[#111622] px-3 py-2 text-sm text-white'
const blank = { serviceId: '', scopeStatement: '', exclusions: '', quantity: 1, unit: '', recurrence: '', ownerId: '', startDate: '', targetDate: '' }
const title = value => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export default function ProjectServiceScopePanel(props) {
  const { user } = useAuth()
  const contextKey = projectServiceProposalContextKey({ ...props, actorId: user?.id })
  return <ServiceScopePanel key={contextKey} {...props} user={user} />
}

function ServiceScopePanel({ project, organizationId, membership, scopeRevision, requestSignal, onChanged, onAccessError, user }) {
  const admin = canShowAuthorityAdministration(membership)
  const [snapshot, setSnapshot] = useState(null)
  const [canManage, setCanManage] = useState(admin)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [forms, setForms] = useState({})
  const [results, setResults] = useState({})
  const [queue, setQueue] = useState(createProjectServiceProposalQueue)
  const dispatching = useRef(false)
  const [review, setReview] = useState(null)
  const [proposalReview, setProposalReview] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const pending = useRef(null)
  const proposalState = useRef(null)
  proposalState.current = { forms, review: proposalReview }
  const generation = useRef(0)

  const authorization = useRef({ revision: 0, allowed: admin, mounted: false })
  const dispatchScope = useRef(null)
  // Context-key unmounts invalidate mutations before another service can dispatch.
  useLayoutEffect(() => {
    authorization.current.mounted = true
    const context = authorization.current
    return () => { context.mounted = false; context.revision += 1 }
  }, [])
  useLayoutEffect(() => {
    dispatchScope.current = { requestSignal, scopeRevision, ready: false }
    return () => { dispatchScope.current = null; generation.current += 1 }
  }, [requestSignal, scopeRevision])

  const refresh = useCallback(async current => {
    const data = await projectServiceScopeRepository.snapshot(organizationId, project.id, { signal: requestSignal })
    if (current === generation.current && !requestSignal?.aborted) setSnapshot(data)
  }, [organizationId, project.id, requestSignal])

  useEffect(() => {
    const current = ++generation.current
    setReview(null); setAcknowledged(false); setProposalReview(null)
    setError(''); setNotice(''); setLoading(true)
    if (dispatchScope.current) dispatchScope.current.ready = false
    Promise.all([
      projectServiceScopeRepository.snapshot(organizationId, project.id, { signal: requestSignal }),
      canManageProjectServices({ organizationId, projectId: project.id, actorId: user?.id, membership,
        hasOwnManagerBinding: projectDraftRepository.hasOwnManagerBinding, signal: requestSignal }).then(manager => {
        // Apply a denial immediately, even while the independent snapshot is pending.
        if (current === generation.current && !requestSignal?.aborted) {
          if (authorization.current.allowed !== manager) {
            authorization.current.revision += 1
            authorization.current.allowed = manager
            setQueue(createProjectServiceProposalQueue()); setForms({}); setResults({})
            setSaving(false); pending.current = null
          }
          setCanManage(manager)
        }
        return manager
      }),
    ]).then(([data]) => {
      if (current === generation.current && !requestSignal?.aborted) {
        dispatchScope.current.ready = true
        setSnapshot(data)
      }
    }).catch(cause => {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to load service scope.')
      }
    }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current += 1 }
  }, [admin, membership, organizationId, project.id, requestSignal, scopeRevision, user?.id, onAccessError])

  const run = async (action, scope, extra = {}) => {
    if (saving || dispatching.current || loading || !canManage || !dispatchScope.current?.ready || requestSignal?.aborted) return
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
        pending.current = null; setReview(null); setAcknowledged(false)
        setNotice(`Service scope ${action === 'add' ? 'proposed' : action === 'cancel' ? 'cancelled' : action + 'd'}.`)
        onChanged?.()
      }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.status === 409 ? `${cause.message} Refresh the impact review before retrying.` : cause.message)
      }
    } finally { if (authorization.current.mounted) setSaving(false) }
  }

  const reviewProposals = event => {
    event.preventDefault()
    if (saving || dispatching.current || loading || !canManage || !dispatchScope.current?.ready || requestSignal?.aborted || !Object.keys(forms).length) return
    if (Object.values(forms).some(form => !Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 1)) {
      setError('Each service quantity must be a positive whole number.'); return
    }
    if (Object.values(forms).some(form => !form.unit?.trim() || form.unit.trim().length > 80 || !form.recurrence?.trim() || form.recurrence.trim().length > 120)) { setError('Specify each service unit and recurrence before review.'); return }
    setError('')
    setProposalReview({ identity: JSON.stringify(forms) })
  }

  const submitProposals = async event => {
    event.preventDefault()
    // Any edit or changed read scope invalidates the reviewed values before dispatch.
    const reviewed = proposalState.current
    if (!reviewed?.review || reviewed.review.identity !== JSON.stringify(reviewed.forms)) return
    if (saving || dispatching.current || loading || !canManage || !dispatchScope.current?.ready || requestSignal?.aborted) return
    const current = generation.current
    const revision = authorization.current.revision
    const scope = dispatchScope.current
    const isCurrent = () => authorization.current.mounted && revision === authorization.current.revision
    const canDispatch = () => isCurrent() && authorization.current.allowed
      && dispatchScope.current === scope && scope?.ready && !requestSignal?.aborted
    dispatching.current = true
    setError(''); setNotice('')
    try {
      await submitProjectServiceProposals({ queue, items: Object.values(reviewed.forms), organizationId, projectId: project.id,
        change: command => projectServiceScopeRepository.change(command), isCurrent, canDispatch,
        refresh: () => refresh(current), onChanged, onError: setError, onSaving: setSaving,
        onResult: (serviceId, result) => {
          setResults(values => ({ ...values, [serviceId]: result }))
          if (result.status === 'succeeded') {
            setForms(values => { const next = { ...values }; delete next[serviceId]; return next })
          }
          if (result.error) onAccessError?.(result.error, { membershipMismatch: result.error.status === 403 })
        },
      })
    } finally { dispatching.current = false }
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
  const available = snapshot?.catalog.filter(service => !queue.succeeded.has(service.id) && !snapshot.scopes.some(scope => scope.service_id === service.id)) || []
  return <section aria-label="Selected services" className="space-y-5">
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <h2 className="font-semibold">Selected services · scope</h2>
      <p className="mt-1 text-sm text-slate-400">Services define what is included. Pipelines define how delivery runs. Add services as scope grows; proposals do not start delivery. Activation is a separate action after the project is active.</p>
      {loading && <p className="mt-4 text-sm text-slate-400">Loading service scope…</p>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-emerald-200">{notice}</p>}
      {snapshot && <div className="mt-5 space-y-3">{snapshot.scopes.length ? snapshot.scopes.map(scope => {
        const service = snapshot.catalog.find(row => row.id === scope.service_id)
        const owner = snapshot.members.find(row => row.id === scope.owner_id)
        return <article key={scope.id} className="rounded-xl border border-white/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-xs font-semibold uppercase text-violet-300">{title(service?.department_id || 'other')}</p><h3 className="font-medium">{service?.name || 'Previously selected service'}</h3><p className="mt-1 text-xs text-slate-400">{title(scope.status)} · {title(scope.source)} · Quantity {scope.quantity} {scope.unit || '(unit unspecified)'} · {scope.recurrence || 'Recurrence unspecified'}{owner ? ` · ${owner.name}` : ''}{scope.target_date ? ` · Target ${scope.target_date}` : ''}</p></div>
            {canManage && <div className="flex flex-wrap gap-2">
              {scope.status === 'proposed' && <button type="button" disabled={saving || project.status !== 'active'} onClick={() => run('activate', scope)} className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs text-violet-200 disabled:opacity-40">Activate service</button>}
              {scope.status === 'active' && ['pause', 'complete', 'cancel'].map(action => <button type="button" key={action} disabled={saving} onClick={() => beginReview(scope, action)} className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-40">{title(action)}…</button>)}
              {['on_hold', 'cancelled'].includes(scope.status) && <button type="button" disabled={saving || project.status !== 'active'} onClick={() => beginReview(scope, 'resume')} className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs text-violet-200 disabled:opacity-40">Resume service</button>}
            </div>}</div>
          {scope.scope_statement && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{scope.scope_statement}</p>}
          {scope.exclusions && <p className="mt-2 text-xs text-slate-400">Exclusions: {scope.exclusions}</p>}
          {scope.status === 'proposed' && project.status !== 'active' && <p className="mt-2 text-xs text-slate-500">Activate the project before activating this service.</p>}
        </article>
      }) : <p className="text-sm text-slate-500">No services selected yet.</p>}</div>}
    </div>
    {snapshot && canManage && (available.length > 0 || Object.keys(forms).length > 0 || Object.keys(results).length > 0) && <form onSubmit={reviewProposals} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <h2 className="font-semibold">Propose services</h2>
      <p className="mt-2 text-sm text-slate-400">Each service saves independently, in sequence. Partial success is possible; a failed save does not stop the others. Proposals do not activate services.</p>
      <div className="mt-4 space-y-4">{[...new Set(available.map(service => service.department_id || 'other'))].map(department => <fieldset key={department} disabled={saving} className="rounded-xl border border-white/10 p-4">
        <legend className="px-1 text-xs font-semibold uppercase text-violet-300">{title(department)}</legend>
        <div className="flex flex-wrap gap-4">{available.filter(service => (service.department_id || 'other') === department).map(service => <label key={service.id} className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={Boolean(forms[service.id])} disabled={Boolean(results[service.id])} onChange={event => {
            const checked = event.target.checked
            setForms(values => { const next = { ...values }; if (checked) next[service.id] = { ...blank, serviceId: service.id, unit: service.unit || '', recurrence: service.recurrence || '' }; else delete next[service.id]; return next })
          }} />{service.name}
        </label>)}</div>
      </fieldset>)}</div>
      {Object.values(forms).map(form => {
        const service = snapshot.catalog.find(row => row.id === form.serviceId)
        const update = field => event => setForms(values => ({ ...values, [form.serviceId]: { ...values[form.serviceId], [field]: event.target.value } }))
        return <fieldset key={form.serviceId} disabled={saving || Boolean(results[form.serviceId])} className="mt-4 rounded-xl border border-white/10 p-4">
          <legend className="px-1 text-sm font-medium">{service?.name || 'Selected service'}</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs text-slate-400">Owner<select className={inputClass} value={form.ownerId} onChange={update('ownerId')}><option value="">Unassigned</option>{snapshot.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            <label className="text-xs text-slate-400">Quantity<input required min="1" step="1" type="number" className={inputClass} value={form.quantity} onChange={update('quantity')} /></label>
            <label className="text-xs text-slate-400">Unit<input required maxLength="80" placeholder="For example, page or article" className={inputClass} value={form.unit} onChange={update('unit')} /></label>
            <label className="text-xs text-slate-400">Recurrence<input required maxLength="120" placeholder="For example, one-time or 4 articles per month" className={inputClass} value={form.recurrence} onChange={update('recurrence')} /><span className="mt-1 block">Describes agreed scope; does not schedule work.</span></label>
            <label className="text-xs text-slate-400">Start<input type="date" className={inputClass} value={form.startDate} onChange={update('startDate')} /></label>
            <label className="text-xs text-slate-400">Target<input type="date" min={form.startDate || undefined} className={inputClass} value={form.targetDate} onChange={update('targetDate')} /></label>
            <label className="text-xs text-slate-400 md:col-span-2">Included scope<textarea className={inputClass} rows={3} value={form.scopeStatement} onChange={update('scopeStatement')} /></label>
            <label className="text-xs text-slate-400 md:col-span-2">Exclusions<textarea className={inputClass} rows={2} value={form.exclusions} onChange={update('exclusions')} /></label>
          </div>
        </fieldset>
      })}
      <div aria-live="polite" className="mt-4 space-y-2">{Object.entries(results).map(([serviceId, result]) => <p key={serviceId} className={`text-sm ${result.status === 'succeeded' ? 'text-emerald-200' : result.status === 'failed' ? 'text-rose-200' : 'text-slate-400'}`}>
        {snapshot.catalog.find(service => service.id === serviceId)?.name || 'Selected service'}: {result.status === 'succeeded' ? 'Proposal saved.' : result.status === 'failed' ? `Save failed or could not be confirmed: ${result.error?.message || 'Unknown error'}. Retry uses the same request ID and original values to avoid duplicate proposals.` : 'Saving…'}
      </p>)}</div>
      {Object.values(results).some(result => result.status === 'failed') && <p className="mt-3 text-xs text-slate-400">Attempted service values remain visible and are locked for safe retry because a failed response may still have saved.</p>}
      {proposalReview?.identity === JSON.stringify(forms) && Object.keys(forms).length > 0 && <section aria-label="Service proposal review" className="mt-4 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-4">
        <h3 className="font-semibold">Review proposed scope</h3>
        <p className="mt-2 text-sm text-[var(--anka-muted)]">Confirm these services and their details. Each proposal saves independently. Saving does not activate services, assign delivery work, or start a pipeline.</p>
        {Object.values(forms).map(form => <article key={form.serviceId} className="mt-3 border-t border-[var(--anka-line)] pt-3 text-sm">
          <h4 className="font-medium">{snapshot.catalog.find(service => service.id === form.serviceId)?.name || 'Selected service'}</h4>
          <p>Quantity {form.quantity} {form.unit} · Recurrence {form.recurrence} · {snapshot.members.find(member => member.id === form.ownerId)?.name || 'Unassigned'} · Start {form.startDate || 'Not set'} · Target {form.targetDate || 'Not set'}</p>
          <p className="mt-2 whitespace-pre-wrap">Included scope: {form.scopeStatement || 'Not specified'}</p>
          <p className="mt-1 whitespace-pre-wrap">Exclusions: {form.exclusions || 'Not specified'}</p>
        </article>)}
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={submitProposals} className="rounded-lg bg-[var(--anka-violet)] px-4 py-2 text-sm font-semibold text-[var(--anka-on-violet)] disabled:opacity-40">{saving ? 'Saving…' : Object.values(results).some(result => result.status === 'failed') ? 'Confirm safe retry of reviewed proposals' : 'Confirm and save reviewed proposals'}</button><button type="button" disabled={saving} onClick={() => setProposalReview(null)} className="rounded-lg border border-[var(--anka-line)] px-4 py-2 text-sm">Return to service details</button></div>
      </section>}
      {proposalReview?.identity !== JSON.stringify(forms) && <button type="submit" disabled={saving || !Object.keys(forms).length} className="mt-4 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold disabled:opacity-40">{Object.values(results).some(result => result.status === 'failed') ? 'Review failed / selected proposals' : 'Review selected proposals'}</button>}
    </form>}
    {selectedReview && <div role="dialog" aria-modal="false" aria-label="Service impact review" className="rounded-2xl border border-amber-400/30 bg-amber-500/[0.07] p-5">
      <h2 className="font-semibold">Review impact before {review.action}</h2>
      <p className="mt-2 text-sm text-slate-300">This project currently has {snapshot.impact.project_tasks} project tasks, {snapshot.impact.engagement_work_items} engagement work items, and {snapshot.impact.deliverables} deliverables. Exact links to this service are not recorded, so these are project-wide counts. All linked records will remain intact.</p>
      <label className="mt-4 flex gap-2 text-sm text-slate-200"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed the current project-wide work and will preserve it.</label>
      <div className="mt-4 flex gap-2"><button type="button" disabled={!acknowledged || saving} onClick={() => run(review.action, selectedReview, { impactToken: selectedReview.impact_token, impactAcknowledged: true })} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{saving ? 'Saving…' : `Confirm ${review.action}`}</button><button type="button" onClick={() => { setReview(null); setAcknowledged(false) }} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Keep current scope</button></div>
    </div>}
  </section>
}
