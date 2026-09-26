import { useEffect, useRef, useState } from 'react'

export default function DesignVideoPromotion({ studio, jobId, onNavigationBusyChange }) {
  const [targets, setTargets] = useState([])
  const [targetKey, setTargetKey] = useState('')
  const [preview, setPreview] = useState(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [done, setDone] = useState(null)
  const request = useRef(null)
  const inFlight = useRef(false)
  const sequence = useRef(0)
  useEffect(() => { onNavigationBusyChange?.(Boolean(busy || (locked && !done)), jobId) }, [busy, locked, done, jobId, onNavigationBusyChange])
  useEffect(() => {
    const attempt = ++sequence.current
    studio.listEngagements().then(rows => {
      if (attempt !== sequence.current) return
      setTargets((rows || []).flatMap(engagement => (engagement.engagement_services || [])
        .filter(service => service.status === 'active' && service.service_catalog?.department_id === 'design'
          && service.service_catalog?.is_active === true)
        .map(service => ({ key: `${engagement.id}:${service.id}`, engagement, service }))))
    }).catch(() => { if (attempt === sequence.current) setNotice('Project targets unavailable.') })
    return () => { sequence.current++ } // eslint-disable-line react-hooks/exhaustive-deps -- Invalidate all in-flight UI operations on unmount.
  }, [studio])
  async function inspect() {
    if (inFlight.current || locked) return
    const target = targets.find(item => item.key === targetKey)
    if (!target) return
    const attempt = ++sequence.current
    const input = { job_id: jobId, target_engagement_id: target.engagement.id, target_service_id: target.service.id }
    inFlight.current = true; setBusy(true); setPreview(null); setNotice('')
    try {
      const result = await studio.previewVideoPromotion(input)
      if (attempt === sequence.current) setPreview({ input, result })
    } catch { if (attempt === sequence.current) setNotice('Preview unavailable. Check current source and target access.') }
    finally { inFlight.current = false; if (attempt === sequence.current) setBusy(false) }
  }
  async function confirm() {
    if (inFlight.current || done || !preview) return
    const attempt = sequence.current
    request.current ||= { ...preview.input, expected_checksum: preview.result.checksum, operation_key: crypto.randomUUID() }
    inFlight.current = true; setBusy(true); setLocked(true); setNotice('')
    try {
      const result = await studio.promotePrivateVideo(request.current)
      if (attempt === sequence.current) { setDone(result); setNotice('Unapproved project draft saved. Refresh the project Asset Library to view it.') }
    } catch { if (attempt === sequence.current) setNotice('Completion is unconfirmed. Retry this same operation; no new generation will run.') }
    finally { inFlight.current = false; if (attempt === sequence.current) setBusy(false) }
  }
  return <section className="mt-3 rounded border border-cyan-500/30 p-3" aria-label="Use private video in project">
    <p className="font-semibold">Use in project</p>
    <p className="mt-1">Copies this exact saved video to an unapproved draft. No regeneration, approval transfer, or licensing inference.</p>
    <label className="mt-2 block">Project target<select className="ml-2 rounded bg-slate-900 p-2" value={targetKey} disabled={busy || locked}
      onChange={event => { sequence.current++; setTargetKey(event.target.value); setPreview(null); setNotice('') }}>
      <option value="">Choose context with active Design service</option>
      {targets.map(target => <option key={target.key} value={target.key}>{target.engagement.name} · {target.service.service_catalog.name}</option>)}
    </select></label>
    <button type="button" className="mt-2 rounded border px-2 py-1 disabled:opacity-40" disabled={busy || locked || !targetKey} onClick={inspect}>Preview draft copy</button>
    {preview && <div className="mt-2"><p>{preview.result.name} · {preview.result.mime_type} · unapproved draft</p>
      <p>Recorded rights notes: {preview.result.rights_notes || 'None recorded; no usage rights inferred.'}</p>
      <button type="button" className="mt-2 rounded border border-cyan-400 px-2 py-1 disabled:opacity-40" disabled={busy || Boolean(done)} onClick={confirm}>{locked && !done ? 'Retry same draft copy' : 'Confirm unapproved draft copy'}</button>
    </div>}
    {notice && <p role="status" className="mt-2 text-amber-200">{notice}</p>}
    {done && <p className="mt-2 break-all">Exact saved version: {done.version_id}</p>}
  </section>
}
