import { useEffect, useMemo, useRef, useState } from 'react'

import {
  buildContentHandoffPreview, contentHandoffDestinations, contentHandoffReadiness,
  contentHandoffTargetKey, contentHandoffWorkOptions, contentHandoffWorkstreams, isCurrentContentHandoffPreview,
} from '../data/contentHandoffs.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40'

export default function ContentHandoffPanel({
  organizationId, artifact, version, approval, sourceReferences = [], services = [], workstreams = [], tasks = [], workItems = [],
  projectId = '', engagementId = '', stale = false, onConfirm, onChanged,
}) {
  const [destinationId, setDestinationId] = useState('')
  const [workKey, setWorkKey] = useState('')
  const [workstreamId, setWorkstreamId] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [confirmed, setConfirmed] = useState(null)
  const operation = useRef(null)
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)

  const destinations = useMemo(() => contentHandoffDestinations(services, engagementId), [services, engagementId])
  const destination = destinations.find(item => item.id === destinationId) || null
  const workOptions = useMemo(() => contentHandoffWorkOptions({ tasks, workItems, destination, projectId, engagementId }),
    [tasks, workItems, destination, projectId, engagementId])
  const work = workOptions.find(item => `${item.kind}:${item.id}` === workKey) || null
  const workstreamOptions = useMemo(() => contentHandoffWorkstreams(workstreams, destination, projectId),
    [workstreams, destination, projectId])
  const workstream = workstreamOptions.find(item => item.id === workstreamId) || null
  const readiness = contentHandoffReadiness({ organizationId, artifact, version, approval, sourceReferences, destination, workstream, work, stale })
  const targetKey = contentHandoffTargetKey({
    organizationId, artifact, version, approval, sourceReferences, destination, workstream, work, note, stale,
  })
  const currentPreview = isCurrentContentHandoffPreview(preview, targetKey) ? preview : null
  const currentConfirmed = confirmed?.key === targetKey ? confirmed : null

  useEffect(() => {
    setDestinationId(''); setWorkstreamId(''); setWorkKey(''); setNote(''); setPreview(null); setConfirmed(null); setSendError(''); operation.current = null
  }, [organizationId, artifact?.id, version?.id, version?.content_checksum, engagementId])

  useEffect(() => {
    if (destinationId && !destinations.some(item => item.id === destinationId)) {
      setDestinationId(''); setWorkstreamId(''); setWorkKey(''); setPreview(null)
    }
  }, [destinationId, destinations])

  useEffect(() => {
    if (workKey && !workOptions.some(item => `${item.kind}:${item.id}` === workKey)) {
      setWorkKey(''); setPreview(null)
    }
  }, [workKey, workOptions])

  useEffect(() => {
    if (workstreamId && !workstreamOptions.some(item => item.id === workstreamId)) {
      setWorkstreamId(''); setPreview(null)
    }
  }, [workstreamId, workstreamOptions])

  function preparePreview() {
    if (!readiness.previewReady) return
    setPreview(buildContentHandoffPreview({ organizationId, artifact, version, approval,
      sourceReferences, destination, workstream, work, note, stale }))
  }

  async function confirmHandoff() {
    if (!currentPreview || !readiness.officialActionAvailable || sending || !onConfirm) return
    if (operation.current?.key !== targetKey) operation.current = { key: targetKey, id: crypto.randomUUID() }
    setSending(true); setSendError('')
    try {
      const result = await onConfirm({
        p_project_id: projectId, p_request_id: operation.current.id,
        p_artifact_version_id: version.id, p_content_checksum: version.content_checksum,
        p_approval_id: approval.id, p_receiving_service_id: destination.id,
        p_receiving_workstream_id: workstream.id, p_work_kind: work?.kind || null,
        p_work_id: work?.id || null, p_recipient_note: note.trim(),
      })
      setConfirmed({ ...result, key: targetKey, recipientLabel: destination.label,
        workstreamLabel: workstream.label, workLabel: work ? `${work.kind} ${work.id}` : 'none' }); await onChanged?.()
    } catch (reason) { setSendError(reason?.message || 'Content handoff failed; retry this exact confirmation.') }
    finally { setSending(false) }
  }

  return <section className="mt-6 rounded-2xl border border-amber-900/40 bg-slate-900/70 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Content B07</p>
        <h3 className="mt-1 text-xl font-semibold text-white">Exact-version N3 handoff</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Review this immutable Content version and recipient before creating an internal N3 handoff request. Confirmation does not publish or create downstream work.</p></div>
      <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${approval ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>
        {approval ? 'Approved exact version' : 'Unapproved collaboration preview'}
      </span>
    </div>

    <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2">
      <Meta label="Selected version" value={`Version ${version.version_number} · ${version.id}`} />
      <Meta label="Checksum" value={version.content_checksum} />
      <Meta label="Recorded sources" value={`${sourceReferences.length} exact version link${sourceReferences.length === 1 ? '' : 's'}`} />
      <Meta label="Approval identity" value={approval?.id || 'No approval recorded for this exact version'} />
    </dl>

    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <label className="text-xs text-slate-500">Active recipient service
        <select className={`${INPUT} mt-1`} value={destinationId} onChange={event => { setDestinationId(event.target.value); setWorkstreamId(''); setWorkKey('') }} disabled={stale || sending}>
          <option value="">Select Design or Marketing service</option>
          {destinations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-500">Active recipient project workstream
        <select className={`${INPUT} mt-1`} value={workstreamId} onChange={event => setWorkstreamId(event.target.value)} disabled={!destination || stale || sending}>
          <option value="">Select matching workstream</option>
          {workstreamOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-500">Existing downstream work (optional)
        <select className={`${INPUT} mt-1`} value={workKey} onChange={event => setWorkKey(event.target.value)} disabled={!destination || stale || sending}>
          <option value="">No existing work reference</option>
          {workOptions.map(item => <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.label} · {item.status}</option>)}
        </select>
      </label>
    </div>
    {destination && !workOptions.length && <p className="mt-3 text-xs text-slate-500">No existing work is visible for this recipient. Confirmation will not create a task or work item.</p>}
    {!destinations.length && <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-3 text-xs text-slate-400">No active Design or Marketing service is available in this engagement. No service will be activated automatically.</p>}
    <label className="mt-4 block text-xs text-slate-500">Recipient note
      <textarea className={`${INPUT} mt-1 min-h-24`} value={note} onChange={event => setNote(event.target.value)} maxLength={4000} disabled={stale || sending} placeholder="Optional context for the recipient" />
    </label>

    {readiness.officialMissing.length > 0 && <p className="mt-4 text-xs leading-5 text-amber-300">Official handoff needs: {readiness.officialMissing.join(', ')}.</p>}
    {readiness.missing.length > 0 && <p className="mt-4 text-xs leading-5 text-amber-300">Preview needs: {readiness.missing.join(', ')}.</p>}
    {preview && !currentPreview && <p className="mt-4 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">The selection, approval, source access, or refresh state changed. The previous preview is not current; use a fresh authorized snapshot and prepare it again.</p>}
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" className={PRIMARY} disabled={!readiness.previewReady || sending} onClick={preparePreview}>Prepare handoff preview</button>
      <button type="button" className={PRIMARY} disabled={!currentPreview || !readiness.officialActionAvailable || sending || Boolean(currentConfirmed)} onClick={confirmHandoff}>{sending ? 'Confirming...' : 'Confirm internal N3 handoff'}</button>
    </div>

    {sendError && <p role="alert" className="mt-4 text-xs text-red-300">{sendError}</p>}
    {currentConfirmed && <p role="status" className="mt-4 text-xs text-emerald-300">Internal handoff recorded for version {currentConfirmed.artifact_version_id}; N3 request {currentConfirmed.request_id}{currentConfirmed.replayed ? ' (replayed)' : ''}. Recipient: {currentConfirmed.recipientLabel}; workstream: {currentConfirmed.workstreamLabel}; existing work: {currentConfirmed.workLabel}.</p>}
    {currentPreview && <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/70 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">Read-only preview · no delivery</p>
      <p className="mt-2 text-sm text-slate-200">{currentPreview.source.title} · version {currentPreview.source.versionNumber} will be presented to {currentPreview.recipient.label}.</p>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <Meta label="Exact version ID" value={currentPreview.source.versionId} />
        <Meta label="Exact checksum" value={currentPreview.source.checksum} />
        <Meta label="Readiness" value={currentPreview.review.status === 'approved' ? 'Approved exact version' : 'Unapproved collaboration preview'} />
        <Meta label="Recipient workstream" value={workstream?.label || 'No active workstream selected'} />
        <Meta label="Existing work" value={currentPreview.work ? `${currentPreview.work.label} · ${currentPreview.work.kind} · ${currentPreview.work.id}` : 'None selected; creation unavailable'} />
      </dl>
      {currentPreview.note && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-300">{currentPreview.note}</p>}
      <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Recorded source identities</p>
        {currentPreview.sources.length ? <ul className="mt-2 space-y-1 text-xs text-slate-400">{currentPreview.sources.map(item => <li key={`${item.path}:${item.id}`} className="break-all">{item.path} · {item.id} · {item.accessible ? 'accessible' : 'not accessible'}</li>)}</ul>
          : <p className="mt-2 text-xs text-slate-500">No source-version links were recorded; none were substituted.</p>}
      </div>
      <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Exact saved Content payload</p>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-3 text-xs leading-5 text-slate-300">{JSON.stringify(currentPreview.source.content, null, 2)}</pre>
      </div>
    </div>}

    <p className="mt-5 text-xs leading-5 text-slate-500">An approved exact version is required for official internal handoff. Unapproved versions remain collaboration previews. This action creates only a canonical N3 discussion-linked request and exact-version link; no task, service, publication, or approval is created.</p>
  </section>
}

function Meta({ label, value }) {
  return <div className="rounded-xl bg-slate-900/80 p-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{label}</dt><dd className="mt-1 break-all text-xs text-slate-300">{value}</dd></div>
}
