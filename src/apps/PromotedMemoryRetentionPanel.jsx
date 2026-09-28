import { useEffect, useRef, useState } from 'react'
import { promotedMemoryRetentionRepository } from '../data/promotedMemoryRetentionRepository.js'

export default function PromotedMemoryRetentionPanel({ organizationId, scopeRevision, onAccessError }) {
  const [history, setHistory] = useState(null)
  const [preview, setPreview] = useState(null)
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const requestId = useRef(null)

  useEffect(() => {
    const current = ++generation.current
    setHistory(null); setPreview(null); setError(''); requestId.current = null
    if (!organizationId) return () => { generation.current += 1 }
    promotedMemoryRetentionRepository.list(organizationId)
      .then(data => { if (current === generation.current) setHistory(data) })
      .catch(cause => {
        if (current !== generation.current || cause.status === 403) return
        onAccessError?.(cause, { membershipMismatch: false })
        setError(cause.message || 'Unable to load promotion history.')
      })
    return () => { generation.current += 1 }
  }, [organizationId, scopeRevision, onAccessError])

  const inspect = async (kind, id) => {
    setBusy(true); setError(''); setPreview(null); setReason(''); setConfirmation('')
    requestId.current = null
    const current = generation.current
    try {
      const next = await promotedMemoryRetentionRepository.preview(organizationId, kind, id)
      if (current === generation.current) setPreview(next)
    } catch (cause) {
      if (current === generation.current) setError(cause.message || 'Unable to preview promoted memory.')
    } finally { if (current === generation.current) setBusy(false) }
  }
  const purge = async event => {
    event.preventDefault()
    if (busy || !preview || confirmation !== 'PURGE') return
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    const current = generation.current
    setBusy(true); setError('')
    try {
      await promotedMemoryRetentionRepository.purge({ organizationId,
        memoryKind: preview.memory_kind, memoryId: preview.memory_id,
        requestId: id, fingerprint: preview.fingerprint, confirmation, reason })
      const next = await promotedMemoryRetentionRepository.list(organizationId)
      if (current === generation.current) {
        setHistory(next); setPreview(null); setReason(''); setConfirmation('')
        requestId.current = null
      }
    } catch (cause) {
      if (current === generation.current) setError(cause.message || 'Unable to purge promoted memory.')
    } finally { if (current === generation.current) setBusy(false) }
  }

  if (!history && !error) return null
  const rows = history ? [
    ...history.department.map(item => ({ ...item, kind: 'department',
      label: item.generalized_statement })),
    ...history.client_brand.map(item => ({ ...item, kind: 'client_brand',
      label: item.scope_kind === 'brand' ? 'Brand requirement' : 'Client requirement' })),
  ] : []
  return <section aria-label="Promoted memory retention" className="mt-6 rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5 text-[var(--anka-ink)]">
    <h2 className="font-semibold">Promoted memory retention</h2>
    <p className="mt-1 text-sm text-[var(--anka-muted)]">Owner-only history for department and client/brand promotions, including records whose project source was revoked or purged. Preview a record before permanent erasure. Source revocation has already stopped its reuse.</p>
    {error && <p role="alert" className="mt-3 text-xs text-[var(--anka-danger)]">{error}</p>}
    {history && <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
      {rows.map(item => <div key={item.kind + item.id} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--anka-line)] p-3">
        <div><p className="text-xs text-[var(--anka-ink)]">{item.label}</p>
          <p className="mt-1 text-[11px] text-[var(--anka-muted)]">{item.kind.replace('_', ' ')} · {item.status} · {item.id}</p></div>
        <button type="button" disabled={busy} onClick={() => inspect(item.kind, item.id)} className="shrink-0 text-xs text-[var(--anka-danger)] disabled:opacity-40">Preview purge</button>
      </div>)}
      {!rows.length && <p className="text-xs text-[var(--anka-muted)]">No protected promoted memory records.</p>}
    </div>}
    {preview && <form onSubmit={purge} className="mt-4 rounded-xl border border-[var(--anka-danger)] p-4">
      <h3 className="text-sm font-medium text-[var(--anka-danger)]">Permanently purge exact {preview.memory_kind.replace('_', ' ')} record</h3>
      <p className="mt-2 text-xs text-[var(--anka-ink)]">{preview.statement || 'No source text is stored in this promotion record.'}</p>
      <p className="mt-2 text-[11px] text-[var(--anka-muted)]">Record {preview.memory_id} · Source project lesson {preview.source_project_memory_id} · {preview.status}</p>
      <label className="mt-3 block text-xs text-[var(--anka-muted)]">Reason<textarea required minLength={10} maxLength={1000} value={reason} onChange={event => { setReason(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-sm text-[var(--anka-ink)]" /></label>
      <label className="mt-3 block text-xs text-[var(--anka-muted)]">Type PURGE<input required value={confirmation} onChange={event => { setConfirmation(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-sm text-[var(--anka-ink)]" /></label>
      <div className="mt-3 flex gap-3"><button type="submit" disabled={busy || confirmation !== 'PURGE' || reason.trim().length < 10} className="text-xs font-semibold text-[var(--anka-danger)] disabled:opacity-40">Permanently purge reviewed record</button><button type="button" onClick={() => { setPreview(null); requestId.current = null }} className="text-xs text-[var(--anka-muted)]">Cancel</button></div>
    </form>}
  </section>
}
