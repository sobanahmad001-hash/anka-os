import { useEffect, useRef, useState } from 'react'

export default function OrganizationDeactivation({ organizationId, userId, actorId, status, client, requestSignal, onDeactivated }) {
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)
  const running = useRef(false)
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const usable = () => alive.current && !requestSignal?.aborted
  async function act(deactivate) {
    if (running.current || !usable() || (deactivate && (!confirmed || userId === actorId || status === 'revoked'))) return
    running.current = true; setBusy(true); setError('')
    const requestId = crypto.randomUUID()
    try {
      const { data, error } = await client.rpc(deactivate ? 'deactivate_organization_member' : 'get_organization_deactivation_history', {
        p_organization_id: organizationId, p_user_id: userId, ...(deactivate ? { p_request_id: requestId } : {}),
      })
      if (!usable()) return
      if (error) throw error
      if (data?.organization_id !== organizationId || data.user_id !== userId ||
        (deactivate ? data.request_id !== requestId || data.status !== 'revoked' || data.auth_account_preserved !== true : !Array.isArray(data.history))) {
        throw new Error('Deactivation response scope mismatch')
      }
      if (deactivate) onDeactivated(data)
      else setHistory(data.history)
    } catch (cause) { if (usable()) setError(cause.message || 'Outcome unknown. Reload membership before retrying; no automatic retry was made.') }
    finally { running.current = false; if (usable()) { setBusy(false); setConfirmed(false) } }
  }
  return <section aria-label="Organization access deactivation" className="space-y-3 border-t border-slate-700 pt-4">
    <h3 className="font-medium">Deactivate selected-organization access</h3>
    <p className="text-sm text-slate-400">Preserves membership, work and history. Revokes this organization’s current membership and derived authority, and records assigned work for reassignment review. Other organizations, global profile and Auth sessions are unchanged. Permanent deletion is a separate reviewed process.</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || status === 'revoked' || userId === actorId}
      onChange={event => setConfirmed(event.target.checked)} />I intend to deactivate this member only in the selected organization.</label>
    <button disabled={busy || !confirmed || status === 'revoked' || userId === actorId} onClick={() => act(true)}
      className="rounded border border-red-400/40 px-3 py-2 text-sm disabled:opacity-40">{status === 'revoked' ? 'Already deactivated' : 'Deactivate organization access'}</button>
    <button disabled={busy} onClick={() => act(false)} className="ml-3 rounded border border-slate-600 px-3 py-2 text-sm">Load deactivation / reassignment history</button>
    {history && <ul className="space-y-3 text-sm">{history.map(entry => <li key={entry.id}>
      Deactivated {entry.created_at}. Assignment snapshot — review current work before reassigning:
      <ul>{entry.reassignment_records.map(row => <li key={row.kind + row.id}>{row.kind}: {row.title} ({row.id}); project {row.project_id}; recorded version {row.row_version}</li>)}</ul>
    </li>)}</ul>}
  </section>
}
