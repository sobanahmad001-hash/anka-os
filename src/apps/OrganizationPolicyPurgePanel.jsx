import { useRef, useState } from 'react'
import { organizationPolicyRepository } from '../data/organizationPolicyRepository.js'

export default function OrganizationPolicyPurgePanel({ organizationId, policies, onPurged }) {
  const [preview, setPreview] = useState(null)
  const [targetId, setTargetId] = useState('')
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const requestId = useRef(null)
  const records = [...policies.confirmed, ...policies.candidates, ...policies.history]

  const inspect = async policyId => {
    setBusy(true); setError(''); setPreview(null); setTargetId(policyId)
    setReason(''); setConfirmation(''); requestId.current = null
    try {
      setPreview(await organizationPolicyRepository.previewPurge(organizationId, policyId))
    } catch (cause) {
      setError(cause.status === 403 ? 'Only an active system owner may purge policy history.' :
        cause.message || 'Unable to preview policy history.')
    } finally { setBusy(false) }
  }
  const purge = async event => {
    event.preventDefault()
    if (busy || !preview || confirmation !== 'PURGE') return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    setBusy(true); setError('')
    try {
      await organizationPolicyRepository.purge({ organizationId, policyId: targetId,
        requestId: id, policyIds: preview.policy_ids, confirmation, reason })
      setPreview(null); setTargetId(''); setReason(''); setConfirmation('')
      requestId.current = null
      await onPurged?.()
    } catch (cause) {
      setError(cause.message || 'Purge did not complete. Review the exact IDs again if the chain changed.')
    } finally { setBusy(false) }
  }

  if (!records.length) return null
  return <section aria-label="Policy history purge" className="rounded-xl border border-[var(--anka-danger)] p-4">
    <h3 className="text-sm font-medium text-[var(--anka-danger)]">Protected history purge</h3>
    <p className="mt-1 text-xs text-[var(--anka-muted)]">Only a system owner can erase a full policy correction chain. Review every linked ID first. The audit keeps a content-free tombstone.</p>
    <div className="mt-3 max-h-44 space-y-2 overflow-y-auto">{records.map(item =>
      <div key={item.id} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--anka-line)] p-2">
        <p className="text-xs text-[var(--anka-muted)]">{item.status || 'candidate'} · {item.statement} · {item.id}</p>
        <button type="button" disabled={busy} onClick={() => inspect(item.id)} className="shrink-0 text-xs text-[var(--anka-danger)] disabled:opacity-40">Preview purge</button>
      </div>)}</div>
    {error && <p role="alert" className="mt-3 text-xs text-[var(--anka-danger)]">{error}</p>}
    {preview && <form onSubmit={purge} className="mt-4 rounded-lg border border-[var(--anka-danger)] p-4">
      <h4 className="text-sm font-medium text-[var(--anka-danger)]">Permanently purge {preview.policy_ids.length} linked polic{preview.policy_ids.length === 1 ? 'y' : 'ies'}</h4>
      <ul className="mt-2 space-y-1 text-xs text-[var(--anka-muted)]">{preview.records.map(item =>
        <li key={item.id}>{item.status} · {item.id}</li>)}</ul>
      <label className="mt-3 block text-xs text-[var(--anka-muted)]">Reason<textarea required minLength={10} maxLength={1000} value={reason} onChange={event => { setReason(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-sm text-[var(--anka-ink)]" /></label>
      <label className="mt-3 block text-xs text-[var(--anka-muted)]">Type PURGE<input required value={confirmation} onChange={event => { setConfirmation(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-sm text-[var(--anka-ink)]" /></label>
      <div className="mt-3 flex gap-3"><button type="submit" disabled={busy || confirmation !== 'PURGE' || reason.trim().length < 10} className="text-xs font-semibold text-[var(--anka-danger)] disabled:opacity-40">Permanently purge reviewed policies</button><button type="button" onClick={() => { setPreview(null); requestId.current = null }} className="text-xs text-[var(--anka-muted)]">Cancel</button></div>
    </form>}
  </section>
}
