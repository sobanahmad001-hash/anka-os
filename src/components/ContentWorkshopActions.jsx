import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { contentWorkshopActionTarget } from '../data/contentWorkshopActions.js'
const CARDS = [['prepare_content', 'Open Content writer'], ['prepare_request', 'Prepare Content request']]
export default function ContentWorkshopActions({ organizationId, projectId, engagement, services, unavailable, busy = false }) {
  const navigate = useNavigate()
  const [pending, setPending] = useState(null)
  const scope = JSON.stringify([organizationId, projectId, engagement?.id, engagement?.brand_id])
  const target = action => contentWorkshopActionTarget(action, { organizationId, projectId, engagement, services, unavailable })
  const eligible = Boolean(target('prepare_content'))
  useEffect(() => { setPending(null) }, [scope, eligible])
  const requested = pending?.scope === scope && target(pending.action) ? pending.action : null
  return <section aria-label="Content editor actions" className="space-y-3 rounded-xl border border-slate-800 p-4">
    <h3 className="font-semibold">Content editors</h3>
    <p className="text-xs text-slate-400">Open the existing editor for this engagement. Save and approval remain separate steps. Conversation text is not transferred.</p>
    <div className="flex flex-wrap gap-2">{CARDS.map(([action, label]) => <button key={action} type="button" disabled={busy || !target(action)} onClick={() => { if (!busy && target(action)) setPending({ action, scope }) }} className="rounded-lg border border-violet-500/30 px-3 py-2 text-sm disabled:opacity-50">{label}</button>)}</div>
    {!target('prepare_content') && <p className="text-xs text-amber-200">An active Content service and complete engagement context are required.</p>}
    {requested && <div role="group" aria-label="Confirm Content editor handoff" className="space-y-3">
      <p className="text-sm text-amber-200">Opening an editor may discard unsaved chat text. Save it first or stay here. No draft is saved or moved automatically.</p>
      {busy && <p role="status">Wait for the current conversation operation to finish.</p>}
      <button type="button" onClick={() => setPending(null)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm">Stay in chat</button>
      <button type="button" disabled={busy} onClick={() => { const destination = target(requested); if (busy || !destination) return; setPending(null); navigate(destination) }} className="rounded-lg bg-violet-600 px-3 py-2 text-sm disabled:opacity-50">Open editor</button>
    </div>}
  </section>
}
