import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { contextChatReleaseReview } from '../data/contextChatReleaseReviewRepository.js'

const input = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white'

export default function ContextChatReleaseReviewPanel() {
  const { user } = useAuth()
  const { activeOrganizationId, activeMembership, requestSignal, scopeRevision } = useOrganization()
  if (!user?.id || !activeOrganizationId || !['system_owner', 'operations_admin'].includes(activeMembership?.role)) return null
  return <ScopedReviewPanel key={[user.id, activeOrganizationId, scopeRevision].join(':')}
    organizationId={activeOrganizationId} reviewerId={user.id} signal={requestSignal} />
}

function ScopedReviewPanel({ organizationId, reviewerId, signal }) {
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef(null)

  async function load(offset = 0) {
    const page = await contextChatReleaseReview.list(organizationId, offset, { signal })
    if (signal.aborted) return
    const rows = page.items || []
    setItems(current => offset ? [...current, ...rows.filter(row => !current.some(item => item.claim_id === row.claim_id))] : rows)
    setHasMore(Boolean(page.has_more))
  }
  useEffect(() => {
    let current = true
    contextChatReleaseReview.list(organizationId, 0, { signal })
      .then(page => {
        if (!current || signal.aborted) return
        setItems(page.items || [])
        setHasMore(Boolean(page.has_more))
      })
      .catch(reason => { if (current && !signal.aborted) setError(reason.message) })
      .finally(() => { if (current && !signal.aborted) setLoading(false) })
    return () => { current = false }
  }, [organizationId, signal])

  async function submitReview(event, item) {
    event.preventDefault()
    if (!draft || draft.claimId !== item.claim_id || busy || !draft.confirmed) return
    const checked = new Date(draft.checkedAt)
    if (!Number.isFinite(checked.getTime())) { setError('Enter the time you checked provider billing.'); return }
    const checkedAt = checked.toISOString()
    const fingerprint = [item.claim_id, draft.reference.trim(), checkedAt, draft.evidence.trim()].join(':')
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await contextChatReleaseReview.release({
        organizationId, messageId: item.message_id, requestId: request.current.id,
        providerReference: draft.reference, providerCheckedAt: checkedAt,
        confirmedNoCharge: true, evidence: draft.evidence,
      }, { signal })
      if (signal.aborted) return
      setNotice(result.idempotent_replay ? 'The prior review is already recorded.' : 'No-charge review recorded; held budget released.')
      setDraft(null)
      request.current = null
      await load()
    } catch (reason) { if (!signal.aborted) setError(reason.message) }
    finally { if (!signal.aborted) setBusy(false) }
  }

  return <section className="mt-6 rounded-2xl border border-amber-900/60 bg-slate-900/70 p-5" aria-label="Private AI billing review">
    <h2 className="text-lg font-semibold text-white">Private AI billing review</h2>
    <p className="mt-1 text-sm text-slate-400">Review only a different person's held claim after the provider confirms no charge. Private conversation text stays hidden. A charged or uncertain outcome must stay reserved until actual cost is reconciled.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading held claims…</p>
      : !items.length ? <p className="mt-4 text-sm text-slate-500">No held private AI claims need review.</p>
        : <div className="mt-4 space-y-3">{items.map(item => <div key={item.claim_id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          <p className="text-sm font-semibold text-white">{item.provider} · {item.model_id} · {item.reservation_status}</p>
          <p className="mt-1 break-all text-xs text-slate-400">Claim {item.claim_id} · Message {item.message_id} · Requester {item.actor_id}</p>
          <p className="mt-1 text-xs text-slate-400">Claimed {new Date(item.claimed_at).toLocaleString()} · Maximum held {'$' + (Number(item.max_cost_microusd) / 1_000_000).toFixed(4)}</p>
          {item.outcome_evidence && <p className="mt-2 break-all text-xs text-amber-200">Recorded outcome: {item.outcome_evidence}</p>}
          {item.actor_id === reviewerId ? <p className="mt-2 text-xs text-slate-400">The requester cannot release their own claim.</p>
            : draft?.claimId === item.claim_id ? <form onSubmit={event => submitReview(event, item)} className="mt-3 space-y-2">
              <label className="block text-xs text-slate-300">Provider billing reference
                <input className={input} minLength={8} maxLength={160} required value={draft.reference}
                  onChange={event => setDraft(current => ({ ...current, reference: event.target.value }))} />
              </label>
              <label className="block text-xs text-slate-300">Billing check time
                <input type="datetime-local" className={input} required value={draft.checkedAt}
                  onChange={event => setDraft(current => ({ ...current, checkedAt: event.target.value }))} />
              </label>
              <label className="block text-xs text-slate-300">No-charge evidence
                <textarea className={input} minLength={20} maxLength={1000} required rows={3} value={draft.evidence}
                  onChange={event => setDraft(current => ({ ...current, evidence: event.target.value }))} />
              </label>
              <label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={draft.confirmed}
                onChange={event => setDraft(current => ({ ...current, confirmed: event.target.checked }))} />
                I independently checked provider billing for this exact claim and confirmed no charge.</label>
              <div className="flex gap-3">
                <button type="submit" disabled={busy || !draft.confirmed} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Record review and release held budget</button>
                <button type="button" disabled={busy} onClick={() => setDraft(null)} className="text-xs text-slate-400">Cancel</button>
              </div>
            </form> : <button type="button" className="mt-2 text-xs font-semibold text-amber-300"
              onClick={() => { request.current = null; setDraft({ claimId: item.claim_id, reference: '', checkedAt: '', evidence: '', confirmed: false }) }}>Review no charge</button>}
        </div>)}</div>}
    {hasMore && <button type="button" disabled={busy} onClick={() => load(items.length).catch(reason => setError(reason.message))}
      className="mt-4 text-xs font-semibold text-violet-300 disabled:opacity-40">Load more held claims</button>}
  </section>
}
