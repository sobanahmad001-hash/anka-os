import { useEffect, useMemo, useRef, useState } from 'react'
import { INTERNAL_WORK_DEPARTMENTS, internalProjectSetup } from '../data/internalProjectSetupRepository.js'

const INPUT = 'mt-2 w-full rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] px-3 py-2.5 text-sm text-[var(--anka-ink)] outline-none focus:border-[var(--anka-focus)] focus:ring-2 focus:ring-[var(--anka-focus)]'
const EMPTY_FORM = { name: '', description: '', ownerId: '', startDate: '', dueDate: '', scope: '', exclusions: '', workstreams: {}, confirmed: false }
const fallbackUuid = () => globalThis.crypto?.randomUUID?.() || null

function failureKind(error) {
  if (error?.status === 403) return 'denied'
  if (error?.status === 409) return 'stale'
  return 'error'
}

export default function InternalProjectSetupPanel({ activeOrganization, scopeRevision, requestSignal, onCreated, onCancel, onAccessError }) {
  const context = useRef({ activeOrganization, scopeRevision })
  context.current = { activeOrganization, scopeRevision }
  const generation = useRef(0)
  const [options, setOptions] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [requestId, setRequestId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState('')

  const loadOptions = async () => {
    const request = { ...context.current, generation: ++generation.current }
    setLoading(true)
    setError('')
    setErrorKind('')
    try {
      const value = await internalProjectSetup.getOptions(activeOrganization, { signal: requestSignal })
      if (request.generation === generation.current && request.activeOrganization === context.current.activeOrganization && request.scopeRevision === context.current.scopeRevision && !requestSignal?.aborted) setOptions(value)
    } catch (cause) {
      if (cause.name !== 'AbortError' && request.generation === generation.current) {
        onAccessError(cause, { membershipMismatch: cause.membershipMismatch })
        setError(cause.message || 'Unable to load Internal Work setup choices.')
        setErrorKind(failureKind(cause))
      }
    } finally {
      if (request.generation === generation.current) setLoading(false)
    }
  }

  useEffect(() => {
    setOptions(null)
    setForm(EMPTY_FORM)
    setRequestId(null)
    loadOptions()
    return () => { generation.current += 1 }
    // loadOptions intentionally follows the active organization scope only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganization, scopeRevision, requestSignal])

  const membersByDepartment = useMemo(() => new Map((options?.departments || []).map((department) => [department.id, (options?.members || []).filter((member) => member.departmentId === department.id)])), [options])
  const selected = Object.entries(form.workstreams).filter(([, ownerId]) => ownerId).map(([departmentId, ownerId]) => ({ departmentId, ownerId }))

  const change = (patch) => {
    setForm((current) => ({ ...current, ...patch, confirmed: 'confirmed' in patch ? patch.confirmed : false }))
    if (!('confirmed' in patch)) setRequestId(null)
    setError('')
    setErrorKind('')
  }

  const toggleDepartment = (departmentId, enabled) => {
    const members = membersByDepartment.get(departmentId) || []
    const ownerId = enabled ? (members.some((member) => member.id === form.ownerId) ? form.ownerId : members[0]?.id || '') : ''
    change({ workstreams: { ...form.workstreams, [departmentId]: ownerId } })
  }

  const submit = async (event) => {
    event.preventDefault()
    if (saving) return
    if (!form.confirmed) { setError('Confirm the exact project and workstream effect before creating.'); setErrorKind('error'); return }
    const nextRequestId = requestId || fallbackUuid()
    if (!nextRequestId) { setError('A secure setup request ID could not be created.'); setErrorKind('error'); return }
    setRequestId(nextRequestId)
    setSaving(true)
    setError('')
    setErrorKind('')
    const request = { ...context.current, generation: ++generation.current }
    try {
      const result = await internalProjectSetup.create({
        organizationId: activeOrganization, requestId: nextRequestId, name: form.name, description: form.description,
        ownerId: form.ownerId, startDate: form.startDate, dueDate: form.dueDate,
        scope: form.scope, exclusions: form.exclusions, workstreams: selected,
      }, { signal: requestSignal })
      if (request.generation === generation.current && request.activeOrganization === context.current.activeOrganization && request.scopeRevision === context.current.scopeRevision && !requestSignal?.aborted) await onCreated(result)
    } catch (cause) {
      if (cause.name !== 'AbortError' && request.generation === generation.current) {
        onAccessError(cause, { membershipMismatch: cause.membershipMismatch })
        setError(cause.message || 'Unable to create Internal Work.')
        setErrorKind(failureKind(cause))
      }
    } finally {
      if (request.generation === generation.current) setSaving(false)
    }
  }

  const errorTitle = errorKind === 'denied' ? 'Setup access denied' : errorKind === 'stale' ? 'Setup request is stale' : 'Setup could not be completed'

  return <section aria-labelledby="internal-setup-title" className="mt-6 rounded-3xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--anka-violet)]">Atomic setup</p><h2 id="internal-setup-title" className="mt-2 text-xl font-semibold text-[var(--anka-ink)]">New Internal Work</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--anka-muted)]">Creates one canonical internal project and only the initial workstreams selected below. It creates no client, engagement, service, milestone, or schedule.</p></div><button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-[var(--anka-line)] px-3 py-2 text-sm text-[var(--anka-ink)] outline-none focus:ring-2 focus:ring-[var(--anka-focus)] disabled:opacity-50">Cancel</button></div>
    {loading && <p className="mt-5 text-sm text-[var(--anka-muted)]" role="status">Loading active team owners and organization departments...</p>}
    {!loading && !options && <div className="mt-5 rounded-xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] p-4" role="alert"><p className="font-medium text-[var(--anka-danger)]">{errorTitle}</p><p className="mt-1 text-sm text-[var(--anka-danger)]">{error}</p><button type="button" onClick={loadOptions} className="mt-3 rounded-lg border border-[var(--anka-line)] px-3 py-2 text-sm text-[var(--anka-ink)] outline-none focus:ring-2 focus:ring-[var(--anka-focus)]">Try again</button></div>}
    {!loading && options && <form className="mt-6 space-y-6" onSubmit={submit}>
      <div className="grid gap-4 lg:grid-cols-2"><Field title="Project name"><input required value={form.name} onChange={(event) => change({ name: event.target.value })} className={INPUT} /></Field><Field title="Project owner"><select required value={form.ownerId} onChange={(event) => change({ ownerId: event.target.value })} className={INPUT}><option value="">Select an active team member</option>{options.members.map((member) => <option key={member.id} value={member.id}>{member.name} - {member.role.replaceAll('_', ' ')}</option>)}</select></Field><Field title="Project brief"><textarea rows="3" value={form.description} onChange={(event) => change({ description: event.target.value })} className={INPUT} /></Field><Field title="Scope"><textarea rows="3" value={form.scope} onChange={(event) => change({ scope: event.target.value })} className={INPUT} /></Field><Field title="Explicit exclusions"><textarea rows="3" value={form.exclusions} onChange={(event) => change({ exclusions: event.target.value })} className={INPUT} /></Field><div className="grid grid-cols-2 gap-3"><Field title="Start date"><input type="date" value={form.startDate} onChange={(event) => change({ startDate: event.target.value })} className={INPUT} /></Field><Field title="Due date"><input type="date" value={form.dueDate} onChange={(event) => change({ dueDate: event.target.value })} className={INPUT} /></Field></div></div>
      <fieldset><legend className="text-sm font-semibold text-[var(--anka-ink)]">Initial workstreams</legend><p className="mt-1 text-xs leading-5 text-[var(--anka-muted)]">Select at least one. Each owner must be an active member of that department in this organization.</p><div className="mt-3 grid gap-3 md:grid-cols-2">{options.departments.map((department) => { const members = membersByDepartment.get(department.id) || []; const checked = Boolean(form.workstreams[department.id]); return <div key={department.id} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4"><label className="flex items-center gap-3 text-sm font-medium text-[var(--anka-ink)]"><input type="checkbox" checked={checked} disabled={!members.length || saving} onChange={(event) => toggleDepartment(department.id, event.target.checked)} className="h-4 w-4 accent-[var(--anka-violet)]" />{department.name}</label>{members.length ? <select aria-label={`${department.name} workstream owner`} disabled={!checked || saving} value={form.workstreams[department.id] || ''} onChange={(event) => change({ workstreams: { ...form.workstreams, [department.id]: event.target.value } })} className={INPUT}><option value="">Select owner</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select> : <p className="mt-2 text-xs text-[var(--anka-warning)]">No active owner belongs to this department.</p>}</div> })}</div>{!options.departments.length && <p className="mt-3 text-sm text-[var(--anka-warning)]">No canonical departments belong to the active organization.</p>}</fieldset>
      <label className="flex items-start gap-3 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4 text-sm text-[var(--anka-ink)]"><input type="checkbox" checked={form.confirmed} onChange={(event) => change({ confirmed: event.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--anka-violet)]" /><span>I confirm this creates one internal project and {selected.length} selected workstream{selected.length === 1 ? '' : 's'} in one transaction, with no client, engagement, services, milestones, or schedule.</span></label>
      {error && options && <div role="alert" className={`rounded-xl border p-4 ${errorKind === 'stale' ? 'border-[var(--anka-warning)] bg-[var(--anka-warning-soft)] text-[var(--anka-warning)]' : 'border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] text-[var(--anka-danger)]'}`}><p className="font-medium">{errorTitle}</p><p className="mt-1 text-sm">{error}</p></div>}
      <div className="flex flex-wrap justify-end gap-3"><button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-[var(--anka-line)] px-4 py-2.5 text-sm text-[var(--anka-ink)] outline-none focus:ring-2 focus:ring-[var(--anka-focus)] disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || !form.confirmed || !form.name.trim() || !form.ownerId || selected.length === 0} className="rounded-xl bg-[var(--anka-violet)] px-4 py-2.5 text-sm font-semibold text-[var(--anka-on-violet)] outline-none focus:ring-2 focus:ring-[var(--anka-focus)] disabled:cursor-not-allowed disabled:opacity-40">{saving ? 'Creating atomically...' : 'Create Internal Work'}</button></div>
    </form>}
  </section>
}

function Field({ title, children }) { return <label className="text-xs font-semibold text-[var(--anka-muted)]">{title}{children}</label> }
