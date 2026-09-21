import { useEffect, useMemo, useState } from 'react'

const BUTTON = 'rounded-lg border border-violet-400/30 px-3 py-2 text-xs font-semibold text-violet-100 disabled:cursor-not-allowed disabled:opacity-40'
const clean = value => typeof value === 'string' ? value.trim() : ''

export default function DesignAssetReviewPanel({
  row, reviews = [], contextKey, currentUserId, canSubmit, canDecide, onReview, onRefresh,
}) {
  const versions = useMemo(() => [...(row.assetVersions || [])].sort((a, b) => b.version_number - a.version_number), [row.assetVersions])
  const [versionId, setVersionId] = useState(versions[0]?.id || '')
  const [note, setNote] = useState('')
  const [intent, setIntent] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setVersionId(versions[0]?.id || ''); setNote(''); setIntent(null); setError('') },
    [contextKey, row.assetId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (intent && reviews.some(item => item.operation_key === intent.operation_key
      && item.asset_version_id === intent.asset_version_id && item.event_type === intent.event_type)) {
      setIntent(null); setError('')
    }
  }, [reviews, intent])
  const selected = versions.find(item => item.id === versionId) || null
  const history = reviews.filter(item => item.asset_version_id === versionId)
  const submission = history.find(item => item.event_type === 'submitted')
  const decision = history.find(item => ['approved', 'changes_requested'].includes(item.event_type))
  const approved = versions.find(version => reviews.some(item => item.asset_version_id === version.id
    && item.event_type === 'approved'))
  const canDecideExact = canDecide && submission && !decision && submission.actor_id !== currentUserId
  async function send(eventType) {
    if (!selected || busy || !onReview || (intent && intent.event_type !== eventType)) return
    const request = intent || { asset_version_id: selected.id, event_type: eventType,
      note: clean(note), operation_key: crypto.randomUUID() }
    if (request.event_type === 'changes_requested' && !request.note) { setError('Explain the requested changes.'); return }
    setIntent(request); setBusy(true); setError('')
    try {
      if (!await onReview(request)) setError('Review status is uncertain. Refresh it, then retry this exact request key if needed.')
    } catch (reason) { setError(reason?.message || 'Review status is uncertain. Refresh it before retrying.') }
    finally { setBusy(false) }
  }
  async function checkStatus() {
    if (!onRefresh || busy) return
    setBusy(true); setError('')
    try {
      if (!await onRefresh()) setError('Review status could not be refreshed. Keep this exact request key.')
    } catch (reason) { setError(reason?.message || 'Review status could not be refreshed.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Exact Design asset review" className="mt-5 rounded-xl border border-violet-400/20 p-4">
    <h4 className="font-semibold">Exact asset version review</h4>
    <p className="mt-1 text-xs text-slate-400">Working version: v{versions[0]?.version_number || 'unknown'}. Approved original: {approved ? `v${approved.version_number} · ${approved.id}` : 'none recorded'}. Review never edits the stored file or approves a later version.</p>
    <label className="mt-3 block text-xs font-semibold text-slate-400">Version to inspect
      <select className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 p-2 text-sm text-white" value={versionId}
        disabled={Boolean(intent)} onChange={event => { setVersionId(event.target.value); setNote(''); setError('') }}>
        {versions.map(version => <option key={version.id} value={version.id}>v{version.version_number} · {version.id.slice(0, 8)}</option>)}
      </select>
    </label>
    {selected && <p className="mt-2 text-xs text-slate-500">Selected exact version {selected.id} · {selected.width || '?'}×{selected.height || '?'} · {selected.source_kind.replaceAll('_', ' ')}</p>}
    <div className="mt-3 space-y-1 text-xs">{history.map(event => <p key={event.id}>{event.event_type.replaceAll('_', ' ')} · {new Date(event.created_at).toLocaleString()} · actor {event.actor_id.slice(0, 8)}{event.object_checksum ? ` · SHA-256 ${event.object_checksum.slice(0, 12)}…` : ''}{event.note ? ` · ${event.note}` : ''}</p>)}</div>
    {!intent && selected && !submission && <button type="button" className={BUTTON + ' mt-3'} disabled={!canSubmit || busy} onClick={() => send('submitted')}>Submit this exact version for Design review</button>}
    {!intent && canDecideExact && <>
      <label className="mt-3 block text-xs font-semibold text-slate-400">Decision note
        <textarea rows="2" maxLength="2000" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 p-2 text-sm text-white" value={note} onChange={event => setNote(event.target.value)} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={busy} onClick={() => send('approved')}>Approve this exact version</button><button type="button" className={BUTTON} disabled={busy || !clean(note)} onClick={() => send('changes_requested')}>Request changes</button></div>
    </>}
    {submission && !decision && !canDecideExact && <p className="mt-3 text-xs text-amber-200">Awaiting an authorized Design reviewer other than the submitter.</p>}
    {intent && <div className="mt-3 rounded-lg border border-amber-400/20 p-3 text-xs"><p>Request {intent.operation_key.slice(0, 8)} holds {intent.event_type.replaceAll('_', ' ')} for exact version {intent.asset_version_id.slice(0, 8)}. Check the saved result before retrying.</p><div className="mt-2 flex gap-2"><button type="button" className={BUTTON} disabled={busy} onClick={checkStatus}>Refresh exact review status</button><button type="button" className={BUTTON} disabled={busy} onClick={() => send(intent.event_type)}>Retry same request</button></div></div>}
    {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
  </section>
}