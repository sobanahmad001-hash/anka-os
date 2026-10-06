import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { createWorkshopExecution } from '../data/workshopExecution.js'
const api = createWorkshopExecution((body, signal) => supabase.functions.invoke('integration-gateway', { body, signal }))
const BUTTON = 'rounded-lg border border-[var(--anka-line)] px-3 py-2 text-sm disabled:opacity-50'
export default function WorkshopExecutionPanel({ scope, actorId }) {
  const storageKey = `anka-workshop-execution:${actorId}:${scope.organization_id}:${scope.project_id}:${scope.engagement_id}`
  const [snapshot, setSnapshot] = useState(null)
  const [draft, setDraft] = useState({})
  const [review, setReview] = useState(false)
  const [command, setCommand] = useState(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null') } catch { return null } })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const flight = useRef(false)
  const controller = useRef(null)
  const changes = snapshot?.workshops.filter(row => draft[row.department_id] !== row.enabled)
    .map(row => ({ department_id: row.department_id, enabled: draft[row.department_id] })) || []
  useEffect(() => { controller.current = new AbortController(); return () => controller.current.abort() }, [])
  useEffect(() => {
    if (!command && !changes.length) return
    const guard = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [command, changes.length])
  function retain(value) {
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
        setSnapshot(next); setDraft(Object.fromEntries(next.workshops.map(row => [row.department_id, row.enabled]))); setReview(false)
      } else {
        const original = command || { request_id: crypto.randomUUID(), expected_token: snapshot.token, selections: changes }
        if (!command) retain(original)
        const result = action === 'recover' ? await api.recover(scope, original, signal) : await api.save(scope, original, signal)
        if (!result) { setMessage('No committed receipt found yet. Check again or retry this exact request.'); return }
        retain(null); setSnapshot(null); setDraft({}); setReview(false)
        setMessage('Workshop activation settings saved. Load settings to inspect current status. Model, pricing and spending checks still apply; no message was sent.')
      }
    } catch (failure) {
      if (signal.aborted) return
      setError(failure.message)
      if (failure.definitive && action !== 'recover') { retain(null); setSnapshot(null); setDraft({}); setReview(false) }
    } finally { flight.current = false; if (!signal.aborted) setBusy(false) }
  }
  return <section className="workspace-card mt-6 p-5" aria-label="Workshop AI activation">
    <h2 className="font-semibold">Workshop AI activation</h2>
    <p className="mt-2 text-sm text-[var(--anka-muted)]">Enable AI replies for individual Workshops in this project. Existing model approvals, project access and spending checks still apply. Saving these settings does not send a message.</p>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--anka-danger)]">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {command ? <div className="mt-4 space-y-3"><p className="break-all text-sm">Original request: {command.request_id}. Check its outcome before another review.</p>
      <div className="flex flex-wrap gap-2"><button className={BUTTON} disabled={busy} onClick={() => run('recover')}>Check original activation save</button><button className={BUTTON} disabled={busy} onClick={() => run('save')}>Retry exact activation save</button></div></div>
      : <button className={`${BUTTON} mt-4`} disabled={busy} onClick={() => run('read')}>Load activation settings</button>}
    {snapshot && !command && <div className="mt-4 space-y-4">
      <p className="font-semibold">{snapshot.project_name}</p><p className="break-all text-xs">Engagement: {scope.engagement_id}</p>
      <fieldset disabled={busy || review} className="space-y-3"><legend className="mb-2 font-medium">Workshops enabled for AI replies</legend>
      {snapshot.workshops.map(row => <label key={row.department_id} className="flex items-start gap-3 rounded-lg border border-[var(--anka-line)] p-3 text-sm">
        <input type="checkbox" checked={draft[row.department_id]} disabled={!row.eligible && !row.enabled}
          onChange={event => setDraft(old => ({ ...old, [row.department_id]: event.target.checked }))} />
        <span className="capitalize">{row.department_id}<span className="mt-1 block normal-case text-[var(--anka-muted)]">{!row.eligible ? 'Unavailable: an active service and linked approved model are required.' : row.enabled ? 'Enabled in saved settings.' : 'Off in saved settings.'}</span></span>
      </label>)}</fieldset>
      {review ? <div className="space-y-3 rounded-lg border border-[var(--anka-line)] p-3"><h3 className="font-semibold">Review Workshop activation</h3>
        <ul className="list-inside list-disc text-sm">{changes.map(row => <li key={row.department_id}>{row.department_id}: {row.enabled ? 'enable AI replies' : 'turn AI replies off'}</li>)}</ul>
        <p className="text-sm">Apply only these changes to {snapshot.project_name}. Turning a Workshop off blocks new dispatch claims; an already claimed request may finish. Other projects and model choices stay unchanged.</p>
        <div className="flex flex-wrap gap-2"><button className={BUTTON} disabled={busy || !changes.length} onClick={() => run('save')}>Save reviewed activation</button><button className={BUTTON} disabled={busy} onClick={() => setReview(false)}>Back to activation selection</button></div>
      </div> : <button className={BUTTON} disabled={busy || !changes.length} onClick={() => setReview(true)}>Review activation changes</button>}
    </div>}
  </section>
}
