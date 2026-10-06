import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { createWorkshopModelMappings, mappingKey } from '../data/workshopModelMappings.js'
const api = createWorkshopModelMappings((body, signal) => supabase.functions.invoke('integration-gateway', { body, signal }))
const BUTTON = 'rounded-lg border border-[var(--anka-line)] px-3 py-2 text-sm disabled:opacity-50'
export default function WorkshopModelMappingPanel({ organizationId, projectId, engagementId, membership }) {
  const { user } = useAuth()
  if (!projectId || !['system_owner', 'operations_admin', 'executive'].includes(membership?.role)) return null
  return <MappingPanel key={`${organizationId}:${projectId}:${engagementId}:${user?.id}`} scope={{ organization_id: organizationId, project_id: projectId, engagement_id: engagementId }} actorId={user?.id} />
}
function MappingPanel({ scope, actorId }) {
  const storageKey = `anka-workshop-mapping:${actorId}:${scope.organization_id}:${scope.project_id}:${scope.engagement_id}`
  const [snapshot, setSnapshot] = useState(null)
  const [selected, setSelected] = useState([])
  const [review, setReview] = useState(false)
  const [command, setCommand] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null') } catch { return null }
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const flight = useRef(false)
  const controller = useRef(null)
  useEffect(() => { controller.current = new AbortController(); return () => controller.current.abort() }, [])
  useEffect(() => {
    if (!command && !selected.length) return
    const guard = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [command, selected.length])
  function retain(value) {
    // Persist before dispatch: a lost response can be recovered after navigation/reload.
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value))
    else sessionStorage.removeItem(storageKey)
    setCommand(value)
  }
  async function run(action) {
    if (flight.current) return
    flight.current = true; setBusy(true); setError(''); setMessage('')
    const signal = controller.current.signal
    try {
      if (action === 'read') {
        const next = await api.read(scope, signal)
        setSnapshot(next); setSelected([]); setReview(false)
      } else {
        const original = command || { request_id: crypto.randomUUID(), expected_token: snapshot.token,
          selections: selected.map(key => { const row = snapshot.candidates.find(item => mappingKey(item) === key); return { connection_id: row.connection_id, department_id: row.department_id } }) }
        if (!command) retain(original)
        const result = action === 'recover' ? await api.recover(scope, original, signal) : await api.save(scope, original, signal)
        if (!result) { setMessage('No committed receipt found yet. You may check again or retry this exact request.'); return }
        retain(null); setSnapshot(null); setSelected([]); setReview(false)
        setMessage(`Mapping save confirmed: ${result.added.length} new links. Load again to inspect current eligibility. Existing provider and spend checks still apply.`)
      }
    } catch (failure) {
      if (signal.aborted) return
      setError(failure.message)
      if (failure.definitive && action !== 'recover') { retain(null); setSnapshot(null); setSelected([]); setReview(false) }
    } finally { flight.current = false; if (!signal.aborted) setBusy(false) }
  }
  return <section className="workspace-card mt-6 p-5" aria-label="Workshop model connections">
    <h2 className="font-semibold">Workshop model connections</h2>
    <p className="mt-2 text-sm text-[var(--anka-muted)]">Link existing approved text connections to this project’s active Workshops. Existing links and model choices are preserved. This saves configuration only; it does not send a message.</p>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--anka-danger)]">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {command ? <div className="mt-4 space-y-3"><p className="text-sm">Original request: <span className="break-all">{command.request_id}</span>. Check its outcome before starting another review.</p>
      <div className="flex flex-wrap gap-2"><button className={BUTTON} disabled={busy} onClick={() => run('recover')}>Check original save</button>
      <button className={BUTTON} disabled={busy} onClick={() => run('save')}>Retry exact save</button></div></div>
      : <button className={`${BUTTON} mt-4`} disabled={busy} onClick={() => run('read')}>Load eligible connections</button>}
    {snapshot && !command && <div className="mt-4 space-y-4">
      <p className="text-sm font-semibold">{snapshot.project_name}</p>
      <p className="break-all text-xs text-[var(--anka-muted)]">Engagement: {scope.engagement_id}</p>
      {!snapshot.candidates.length && <p>No eligible approved connections. Existing services and model approvals are required.</p>}
      {['content', 'design', 'marketing'].map(department => <fieldset key={department} disabled={busy || review} className="space-y-2">
        <legend className="font-medium capitalize">{department}</legend>
        {!snapshot.candidates.some(row => row.department_id === department) && <p className="text-sm text-[var(--anka-muted)]">No eligible connection for this Workshop.</p>}
        {snapshot.candidates.filter(row => row.department_id === department).map(row => <label key={mappingKey(row)} className="flex items-start gap-3 rounded-lg border border-[var(--anka-line)] p-3 text-sm">
          <input type="checkbox" disabled={row.linked} checked={row.linked || selected.includes(mappingKey(row))}
            onChange={e => setSelected(old => e.target.checked ? [...old, mappingKey(row)] : old.filter(k => k !== mappingKey(row)))} />
          <span className="min-w-0 break-words">{row.display_name}{row.linked ? ' — already linked' : ''}<span className="mt-1 block text-xs text-[var(--anka-muted)]">{row.models.map(m => m.model_id + (m.model_id === 'gpt-6-astra' ? ' (explicit choice only)' : '')).join(', ')}</span></span>
        </label>)}
      </fieldset>)}
      {review ? <div className="space-y-3 rounded-lg border border-[var(--anka-line)] p-3"><h3 className="font-semibold">Review {selected.length} new links</h3>
        <ul className="list-inside list-disc text-sm">{snapshot.candidates.filter(row => selected.includes(mappingKey(row))).map(row => <li key={mappingKey(row)}>{row.department_id}: {row.display_name} — {row.models.map(m => m.model_id).join(', ')}</li>)}</ul>
        <p className="text-sm">Save only these links to {snapshot.project_name}. Provider, pricing and spend checks still apply when you use a Workshop.</p>
        <div className="flex gap-2"><button className={BUTTON} disabled={busy} onClick={() => run('save')}>Save reviewed links</button><button className={BUTTON} disabled={busy} onClick={() => setReview(false)}>Back to selection</button></div>
      </div> : <button className={BUTTON} disabled={busy || !selected.length || selected.length > 30} onClick={() => setReview(true)}>Review selected links</button>}
    </div>}
  </section>
}
