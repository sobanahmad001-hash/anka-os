import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function RecurringAssignmentDelegation({ project, client = supabase }) {
  const [versionId, setVersionId] = useState('')
  const [versions, setVersions] = useState([])
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [revision, setRevision] = useState(0)
  const inFlight = useRef(false)
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    setSnapshot(null); setConfirmed(false)
    let query = client.rpc('get_recurring_assignment_delegation', {
      p_organization_id: project.organization_id, p_project_id: project.id, p_plan_version_id: versionId || null,
    })
    if (query.abortSignal) query = query.abortSignal(controller.signal)
    Promise.resolve(query).then(({ data, error }) => {
      if (controller.signal.aborted) return
      if (error) throw error
      if (data?.organization_id !== project.organization_id || data.project_id !== project.id || typeof data.can_manage !== 'boolean') throw new Error('Delegation scope mismatch')
      if (!versionId) {
        if (!Array.isArray(data.versions) || data.versions.some(v => !v.id || !v.title || !Number.isInteger(v.version_number))) throw new Error('Invalid version list')
        setVersions(data.versions)
      } else {
        if (data.plan_version_id !== versionId || !data.token || typeof data.approved_version !== 'boolean' ||
          data.snapshot?.payload?.version?.id !== versionId || !Array.isArray(data.snapshot?.payload?.templates) ||
          !Array.isArray(data.snapshot?.history)) throw new Error('Invalid delegation snapshot')
        setSnapshot(data)
      }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message || 'Delegation unavailable') })
    return () => controller.abort()
  }, [project.organization_id, project.id, client, versionId, revision])

  async function change(enabled) {
    if (!snapshot?.can_manage || inFlight.current || (enabled && (!confirmed || !snapshot.approved_version))) return
    inFlight.current = true; setBusy(true); setError('')
    const requestId = crypto.randomUUID()
    try {
      const { data, error } = await client.rpc('change_recurring_assignment_delegation', {
        p_organization_id: project.organization_id, p_project_id: project.id, p_plan_version_id: versionId,
        p_enabled: enabled, p_expected_token: snapshot.token, p_request_id: requestId,
      })
      if (error) throw error
      if (data?.organization_id !== project.organization_id || data.project_id !== project.id ||
        data.plan_version_id !== versionId || data.request_id !== requestId) throw new Error('Delegation response scope mismatch')
    } catch (cause) {
      if (alive.current) setError(cause.code === '40001' ? 'Delegation changed elsewhere. Reload and review before retrying.'
        : cause.message || 'Save outcome unknown. Reload before retrying.')
    } finally {
      inFlight.current = false
      if (alive.current) { setBusy(false); setSnapshot(null); setConfirmed(false); setRevision(value => value + 1) }
    }
  }
  const active = snapshot?.snapshot.history.some(row => row.status === 'active')
  return <section aria-label="Recurring assignment delegation" className="space-y-4 rounded-xl border border-white/10 p-5">
    <h2 className="font-semibold">Recurring assignment delegation</h2>
    <p className="text-sm text-slate-400">A current same-project PM or organization admin must explicitly approve each immutable version’s assignments. Scheduled and manual generation reproduce only this payload; changes require a new approval. This grants no general machine authority, specialist review or release rights.</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <label className="text-sm">Plan version <select value={versionId} disabled={busy} className="ml-2 rounded border border-slate-600 bg-slate-900 p-2"
      onChange={event => { setSnapshot(null); setConfirmed(false); setError(''); setVersionId(event.target.value) }}>
      <option value="">Select an immutable version</option>
      {versions.map(version => <option key={version.id} value={version.id}>{version.title} — v{version.version_number}</option>)}
    </select></label>
    <button disabled={busy} className="ml-3 rounded border border-slate-600 px-3 py-2 text-sm" onClick={() => { setError(''); setRevision(value => value + 1) }}>Reload delegation</button>
    {snapshot && <>
      <p className="text-sm">{snapshot.approved_version ? 'Plan version approved.' : 'Plan version approval is required first.'} {active ? 'An active delegation is recorded; current authority, service, project and assignees are rechecked at execution.' : 'No active delegation. Generation is blocked until explicitly approved.'}</p>
      <ul className="space-y-2">{snapshot.snapshot.payload.templates.map(item => <li key={item.template_key} className="rounded border border-slate-700 p-3 text-sm">
        {item.title} — {item.department_id} — assignee: {item.default_assignee_id || 'Unassigned'}
        <span className="block text-xs text-slate-400">Template {item.template_key}; start +{item.start_offset_days} days; due +{item.due_offset_days} days</span>
      </li>)}</ul>
      <details className="text-xs text-slate-400"><summary>Exact immutable version and payload</summary><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(snapshot.snapshot.payload, null, 2)}</pre></details>
      {!snapshot.can_manage && <p className="text-sm text-amber-300">Only current same-project PMs and organization admins can approve or withdraw delegation.</p>}
      {!active && <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || !snapshot.can_manage || !snapshot.approved_version} onChange={event => setConfirmed(event.target.checked)} />I approve only this exact version and assignment payload.</label>}
      <button className="rounded border border-violet-400/40 px-3 py-2 text-sm disabled:opacity-40"
        disabled={busy || !snapshot.can_manage || (!active && (!confirmed || !snapshot.approved_version))} onClick={() => change(!active)}>
        {active ? 'Withdraw assignment delegation' : 'Approve exact assignments'}
      </button>
      <details className="text-xs text-slate-400"><summary>Delegation history ({snapshot.snapshot.history.length})</summary>
        <ul>{snapshot.snapshot.history.map(row => <li key={row.id}>{row.status}; approved by {row.approved_by} at {row.approved_at}; withdrawn {row.revoked_at || 'never'}</li>)}</ul>
      </details>
    </>}
  </section>
}
