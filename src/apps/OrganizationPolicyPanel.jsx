import { useEffect, useRef, useState } from 'react'
import { organizationPolicyRepository } from '../data/organizationPolicyRepository.js'
import _OrganizationPolicyPurgePanel from './OrganizationPolicyPurgePanel.jsx'

export default function OrganizationPolicyPanel({ organizationId, scopeRevision, onAccessError }) {
  const [policies, setPolicies] = useState(null)
  const [statement, setStatement] = useState('')
  const [sourceNote, setSourceNote] = useState('')
  const [supersedesId, setSupersedesId] = useState('')
  const [review, setReview] = useState(null)
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const requestId = useRef(null)

  useEffect(() => {
    const current = ++generation.current
    setPolicies(null); setError(''); setReview(null); setStatement('')
    setSourceNote(''); setSupersedesId(''); requestId.current = null
    if (!organizationId) return () => { generation.current += 1 }
    organizationPolicyRepository.list(organizationId)
      .then(data => { if (current === generation.current) setPolicies(data) })
      .catch(cause => {
        if (current === generation.current) {
          onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
          setError(cause.message || 'Unable to load organization policy.')
        }
      })
    return () => { generation.current += 1 }
  }, [organizationId, scopeRevision, onAccessError])

  const reload = async current => {
    const data = await organizationPolicyRepository.list(organizationId)
    if (current === generation.current) setPolicies(data)
  }
  const propose = async event => {
    event.preventDefault()
    if (busy) return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await organizationPolicyRepository.propose({ organizationId, requestId: id,
        statement, sourceNote, supersedesId: supersedesId || null })
      await reload(current)
      if (current === generation.current) {
        setStatement(''); setSourceNote(''); setSupersedesId(''); requestId.current = null
      }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to propose policy. Retrying keeps the request ID.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }
  const decide = async event => {
    event.preventDefault()
    if (busy || !review) return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await organizationPolicyRepository.review({ organizationId, policyId: review.id,
        requestId: id, decision: review.decision, evidence })
      await reload(current)
      if (current === generation.current) { setReview(null); setEvidence(''); requestId.current = null }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to review policy. Retrying keeps the request ID.')
      }
    } finally { if (current === generation.current) setBusy(false) }
  }
  const chooseReview = (id, decision) => {
    setReview({ id, decision }); setEvidence(''); requestId.current = null
  }
  return <section aria-label="Organization policy memory" className="space-y-5 rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5 text-[var(--anka-ink)]">
    <div><h2 className="font-semibold">Organization policy memory</h2>
      <p className="mt-1 text-sm text-[var(--anka-muted)]">Write a policy draft and its source basis. A different owner or operations admin must approve it. Project, department, and private lessons never become organization policy automatically. These policies are not sent to an AI provider from this screen.</p></div>
    {error && <p role="alert" className="rounded-lg border border-[var(--anka-danger)] p-3 text-xs text-[var(--anka-danger)]">{error}</p>}
    {!policies && !error && <p className="text-sm text-[var(--anka-muted)]">Loading current policies…</p>}
    {policies && <>
      <div className="grid gap-4 lg:grid-cols-2">
        <div><h3 className="text-sm font-medium">Confirmed policies</h3>
          {policies.confirmed.length ? policies.confirmed.map(item =>
            <article key={item.id} className="mt-2 rounded-lg border border-[var(--anka-line)] p-3">
              <p className="text-sm text-[var(--anka-ink)]">{item.statement}</p>
              <p className="mt-2 text-xs text-[var(--anka-muted)]">Source basis: {item.source_note}</p>
              <p className="mt-1 text-[11px] text-[var(--anka-muted)]">Approved {item.reviewed_at ? new Date(item.reviewed_at).toLocaleDateString() : 'date unavailable'} · {item.id}</p>
              <div className="mt-3 flex gap-3"><button type="button" onClick={() => { setSupersedesId(item.id); requestId.current = null }} className="text-xs text-[var(--anka-violet)]">Propose correction</button><button type="button" onClick={() => chooseReview(item.id, 'retire')} className="text-xs text-[var(--anka-muted)]">Retire</button></div>
            </article>) : <p className="mt-2 text-xs text-[var(--anka-muted)]">No approved organization policies.</p>}
        </div>
        <div><h3 className="text-sm font-medium">Awaiting owner review</h3>
          {policies.candidates.length ? policies.candidates.map(item =>
            <article key={item.id} className="mt-2 rounded-lg border border-[var(--anka-line)] p-3">
              <p className="text-sm text-[var(--anka-ink)]">{item.statement}</p>
              <p className="mt-2 text-xs text-[var(--anka-muted)]">Source basis: {item.source_note}</p>
              <div className="mt-3 flex gap-3"><button type="button" onClick={() => chooseReview(item.id, 'confirm')} className="text-xs text-[var(--anka-success)]">Confirm</button><button type="button" onClick={() => chooseReview(item.id, 'reject')} className="text-xs text-[var(--anka-danger)]">Reject</button></div>
            </article>) : <p className="mt-2 text-xs text-[var(--anka-muted)]">No current candidates visible to your role.</p>}
        </div>
      </div>
      <form onSubmit={propose} className="rounded-xl border border-[var(--anka-line)] p-4">
        <h3 className="text-sm font-medium">Propose organization policy</h3>
        {supersedesId && <p className="mt-2 text-xs text-[var(--anka-violet)]">Correcting policy {supersedesId}. <button type="button" onClick={() => { setSupersedesId(''); requestId.current = null }} className="underline">Clear correction</button></p>}
        <label className="mt-3 block text-xs text-[var(--anka-muted)]">Policy statement<textarea required maxLength={1000} value={statement} onChange={event => { setStatement(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-sm text-[var(--anka-ink)]" /></label>
        <label className="mt-3 block text-xs text-[var(--anka-muted)]">Source basis and decision context<textarea required minLength={20} maxLength={1000} value={sourceNote} onChange={event => { setSourceNote(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-sm text-[var(--anka-ink)]" /></label>
        <button type="submit" disabled={busy || !statement.trim() || sourceNote.trim().length < 20} className="mt-3 rounded-lg bg-[var(--anka-violet)] px-4 py-2 text-xs font-semibold text-[var(--anka-on-violet)] disabled:opacity-40">Request owner review</button>
      </form>
      {review && <form onSubmit={decide} className="rounded-xl border border-[var(--anka-violet)] p-4">
        <h3 className="text-sm font-medium">{review.decision} exact policy</h3>
        <label className="mt-3 block text-xs text-[var(--anka-muted)]">Decision evidence<textarea required maxLength={1000} value={evidence} onChange={event => { setEvidence(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-sm text-[var(--anka-ink)]" /></label>
        <div className="mt-3 flex gap-3"><button type="submit" disabled={busy || !evidence.trim()} className="rounded-lg bg-[var(--anka-violet)] px-3 py-2 text-xs font-semibold text-[var(--anka-on-violet)] disabled:opacity-40">Record decision</button><button type="button" onClick={() => { setReview(null); requestId.current = null }} className="text-xs text-[var(--anka-muted)]">Cancel</button></div>
      </form>}
      {policies.history.length > 0 && <details className="rounded-xl border border-[var(--anka-line)] p-4"><summary className="cursor-pointer text-sm">Protected policy history · {policies.history.length}</summary><div className="mt-3 space-y-2">{policies.history.map(item => <p key={item.id} className="text-xs text-[var(--anka-muted)]">{item.status} · {item.statement} · {item.id}</p>)}</div></details>}
      <_OrganizationPolicyPurgePanel organizationId={organizationId} policies={policies} onPurged={() => reload(generation.current)} />
    </>}
  </section>
}
