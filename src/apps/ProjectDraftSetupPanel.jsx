import { useEffect, useMemo, useRef, useState } from 'react'
import { projectDraftRepository } from '../data/projectDraftRepository.js'

const INPUT = 'mt-1 w-full rounded-xl border border-white/10 bg-[#111622] px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/30'
const blank = (initialType) => ({ name: '', description: '', engagementType: initialType,
  clientId: '', brandId: '', managerId: '', startDate: '', dueDate: '', scope: '', exclusions: '', reviewed: false })

export default function ProjectDraftSetupPanel({ organizationId, scopeRevision, requestSignal, initialType = 'internal', onCreated, onCancel, onAccessError }) {
  const [form, setForm] = useState(() => blank(initialType))
  const [options, setOptions] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(null)
  const generation = useRef(0)
  const context = useRef({ organizationId, scopeRevision })
  context.current = { organizationId, scopeRevision }

  useEffect(() => {
    const current = ++generation.current
    setForm(blank(initialType))
    setOptions(null)
    setError('')
    setLoading(true)
    requestId.current = null
    projectDraftRepository.options(organizationId, { signal: requestSignal }).then((data) => {
      if (current === generation.current && !requestSignal?.aborted) setOptions(data)
    }).catch((cause) => {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to load project setup')
      }
    }).finally(() => {
      if (current === generation.current) setLoading(false)
    })
    return () => { generation.current += 1 }
  }, [initialType, onAccessError, organizationId, requestSignal, scopeRevision])

  const client = useMemo(() => options?.clients.find(row => row.id === form.clientId), [options, form.clientId])
  const change = (patch) => {
    setForm(current => ({ ...current, ...patch, reviewed: false }))
    requestId.current = null
    setError('')
  }
  const submit = async (event) => {
    event.preventDefault()
    if (saving || !form.reviewed) return
    const scope = { ...context.current, generation: generation.current }
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable in this browser.'); return }
    requestId.current = id
    setSaving(true)
    setError('')
    try {
      const result = await projectDraftRepository.create({
        organizationId, requestId: id, ...form,
      })
      if (scope.generation === generation.current && scope.organizationId === context.current.organizationId
        && scope.scopeRevision === context.current.scopeRevision && !requestSignal?.aborted) onCreated(result)
    } catch (cause) {
      if (scope.generation === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to save draft project. Retrying uses the same request ID.')
      }
    } finally {
      if (scope.generation === generation.current) setSaving(false)
    }
  }

  return <section aria-label="New draft project" className="mt-6 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-lg font-semibold">New draft project</h2><p className="mt-1 text-sm text-slate-400">Save a canonical planning project. No service, pipeline, schedule, AI job, delivery, or publication starts here.</p></div>
      <button type="button" onClick={onCancel} className="rounded-lg border border-white/10 px-3 py-2 text-sm">Close</button>
    </div>
    {loading && <p className="mt-5 text-sm text-slate-400">Loading authorized setup choices…</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    {options && <form onSubmit={submit} className="mt-5 space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field title="Work type"><select className={INPUT} value={form.engagementType} onChange={event => change({ engagementType: event.target.value, clientId: '', brandId: '' })}>
          <option value="internal">Internal Work</option><option value="project">Client project</option><option value="retainer">Client retainer</option>
        </select></Field>
        <Field title="Project name"><input className={INPUT} required maxLength={240} value={form.name} onChange={event => change({ name: event.target.value })} /></Field>
        {form.engagementType !== 'internal' && <>
          <Field title="Client"><select className={INPUT} required value={form.clientId} onChange={event => change({ clientId: event.target.value, brandId: '' })}>
            <option value="">Select client</option>{options.clients.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></Field>
          <Field title="Brand"><select className={INPUT} required value={form.brandId} onChange={event => change({ brandId: event.target.value })}>
            <option value="">Select brand</option>{(client?.brands || []).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></Field>
        </>}
        <Field title="Initial project manager"><select className={INPUT} value={form.managerId} onChange={event => change({ managerId: event.target.value })}>
          <option value="">Assign later; keep as draft</option>{options.members.map(row => <option key={row.id} value={row.id}>{row.name} · {row.role.replaceAll('_', ' ')}</option>)}
        </select></Field>
        <div className="grid grid-cols-2 gap-3"><Field title="Start date"><input className={INPUT} type="date" value={form.startDate} onChange={event => change({ startDate: event.target.value })} /></Field><Field title="Due date"><input className={INPUT} type="date" min={form.startDate || undefined} value={form.dueDate} onChange={event => change({ dueDate: event.target.value })} /></Field></div>
      </div>
      <Field title="Brief"><textarea className={INPUT} rows={3} value={form.description} onChange={event => change({ description: event.target.value })} /></Field>
      <Field title="Scope"><textarea className={INPUT} rows={3} value={form.scope} onChange={event => change({ scope: event.target.value })} /></Field>
      <Field title="Exclusions"><textarea className={INPUT} rows={2} value={form.exclusions} onChange={event => change({ exclusions: event.target.value })} /></Field>
      <div className="rounded-xl border border-white/10 bg-black/10 p-4 text-sm text-slate-300">
        <p className="font-medium">Review draft</p>
        <p className="mt-1">{form.name.trim() || 'Unnamed project'} · {form.engagementType === 'internal' ? 'Internal Work' : (client?.name || 'Client not selected')} · {form.managerId ? 'Initial PM selected' : 'No PM yet'}</p>
        <p className="mt-2 text-xs text-slate-500">Activation requires an active assigned PM. Client work also keeps its client, brand, and engagement identity. Project requests from heads or contributors are not available in this form.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-300"><input type="checkbox" className="mt-1" checked={form.reviewed} onChange={event => setForm(current => ({ ...current, reviewed: event.target.checked }))} />I reviewed the project identity and draft details.</label>
      <button type="submit" disabled={saving || !form.reviewed || !form.name.trim()} className="rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving draft…' : 'Save draft project'}</button>
    </form>}
  </section>
}

function Field({ title, children }) {
  return <label className="block text-xs font-medium text-slate-400">{title}{children}</label>
}
