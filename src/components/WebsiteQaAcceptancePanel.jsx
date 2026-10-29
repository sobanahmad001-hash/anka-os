import {useEffect, useRef, useState} from 'react'
import {WEBSITE_QA_EVIDENCE, completeQaEvidence, qaAcceptanceKey} from '../data/websiteQaAcceptance.js'

export default function WebsiteQaAcceptancePanel({scope, runId, repository, canRecord, disabled, signal, onLockChange, onSaved}) {
  const key = qaAcceptanceKey(scope), draftKey = key + ':' + runId + ':draft'
  const [draft] = useState(() => {try {return JSON.parse(sessionStorage.getItem(draftKey) || 'null')} catch {return null}})
  const [evidence, setEvidence] = useState(() => Object.fromEntries(WEBSITE_QA_EVIDENCE.filter(([id]) => typeof draft?.evidence?.[id] === 'string' && draft.evidence[id].length <= 1000).map(([id]) => [id, draft.evidence[id]])))
  const [evidenceSha, setEvidenceSha] = useState(draft?.reviewSha256 || null)
  const [pending, setPending] = useState(() => {try {return JSON.parse(sessionStorage.getItem(key) || 'null')} catch {return {unavailable: true}}})
  const [review, setReview] = useState(null), [artifactId, setArtifactId] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(null), [notice, setNotice] = useState('')
  const [choices, setChoices] = useState([])
  const alive = useRef(false), flight = useRef(false), latest = useRef(null)
  latest.current = {canRecord, disabled, review, artifactId, evidence, confirmed, pending, runId}
  const current = () => alive.current && !signal?.aborted
  const dirty = Object.values(evidence).some(value => typeof value === 'string' && value.length)
  useEffect(() => {alive.current = true; return () => {alive.current = false}}, [])
  useEffect(() => {onLockChange?.(busy || dirty || Boolean(pending)); return () => onLockChange?.(false)}, [busy, dirty, pending, onLockChange])
  useEffect(() => {try {if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({evidence,reviewSha256:evidenceSha})); else sessionStorage.removeItem(draftKey)} catch { /* Visible notes remain available for manual preservation. */ }}, [draftKey, evidence, evidenceSha, dirty])

  async function act(fn) {
    if (flight.current || !current()) return
    flight.current = true; setBusy(true); setError(''); setNotice('')
    try {await fn()} catch (reason) {
      if (current()) {
        setError(reason.message)
        if (reason.knownRollback) {sessionStorage.removeItem(key); setPending(null); setReview(null); setConfirmed(false)}
      }
    } finally {flight.current = false; if (current()) setBusy(false)}
  }
  async function inspect() {
    const selected = latest.current
    if (!selected.canRecord || selected.disabled || selected.pending) return
    const result = await repository.qaReview(scope, selected.runId, selected.artifactId || null, {signal})
    if (!current() || latest.current.runId !== selected.runId || latest.current.artifactId !== selected.artifactId) return
    setChoices(result.artifacts)
    if (dirty && evidenceSha !== result.review_sha256) {setReview(null);setConfirmed(false);setError('Reviewed inputs changed. Preserve or discard the old QA notes before reviewing the new snapshot.');return}
    setReview(result); setConfirmed(false)
  }
  async function settled(record) {
    sessionStorage.removeItem(key); setPending(null); setSaved(record); setEvidence({}); setReview(null); setConfirmed(false)
    setNotice('QA acceptance recorded in an immutable Development launch-checklist version. Delivery approval and publication are unchanged.')
    try {await onSaved?.()} catch {if (current()) setError('QA acceptance is saved. Refresh Development history to see its launch-checklist version.')}

  }
  async function save() {
    const selected = latest.current
    if (!selected.canRecord || selected.disabled || selected.pending || !selected.review || !selected.confirmed || !completeQaEvidence(selected.evidence)) return
    if (selected.review.snapshot.run_id !== selected.runId || selected.review.snapshot.artifact_id !== (selected.artifactId || null)) return
    const input = {runId: selected.runId, artifactId: selected.artifactId || null, expectedVersionId: selected.review.snapshot.artifact_version_id, reviewSha256: selected.review.review_sha256, evidence: selected.evidence, confirmed: true, requestId: crypto.randomUUID()}
    sessionStorage.setItem(key, JSON.stringify(input)); setPending(input)
    const result = await repository.qaSave(scope, input, {signal})
    if (current()) await settled(result)
  }
  async function recover() {
    const original = latest.current.pending
    if (!original?.requestId) throw Error('Original QA recovery storage is unavailable. No save was resent.')
    const result = await repository.qaRecover(scope, original.requestId, {signal})
    if (!current()) return
    if (result && result.run_id !== original.runId) throw Error('Original QA receipt identifies another page preview; no save was resent.')
    if (result) await settled(result)
    else setNotice('No original QA receipt is visible yet. Keep this request and recover again; no save was resent.')
  }
  const locked = busy || disabled || Boolean(pending)
  const existingChoices = choices
  return <section aria-label="Save page QA acceptance" className="space-y-3 rounded-lg border border-slate-500/40 p-3">
    <h4 className="font-semibold">Save page QA acceptance</h4>
    <p>Record your manual QA findings for this exact retained preview. This creates a launch-checklist version and keeps existing checklist notes.</p>
    {pending && <p role="status">An original QA save needs recovery. New writes stay blocked.<button type="button" className="workspace-button" disabled={busy || disabled} onClick={() => act(recover)}>Recover original QA save</button></p>}
    {!canRecord && <p>Recording a new QA acceptance requires current Development authority and an active Website implementation service.</p>}
    <label className="block">Development launch checklist<select aria-label="QA launch checklist" className="w-full" value={artifactId} disabled={locked || !canRecord || dirty} onChange={event => {setArtifactId(event.target.value); setReview(null); setConfirmed(false)}}><option value="">Create first checklist if none exists</option>{existingChoices.map(row => <option key={row.id} value={row.id}>{row.title || 'Launch checklist'}</option>)}</select></label>
    <button type="button" className="workspace-button" disabled={locked || !canRecord} onClick={() => act(inspect)}>Review exact QA acceptance inputs</button>
    {review && !pending && <>
      {!artifactId && existingChoices.length > 0 && <p role="status">Select an existing launch checklist above, then review its current version.</p>}
      <details><summary>Exact acceptance record</summary><p>Page: {review.snapshot.page_id}. Package: {review.snapshot.package_sha256}. Current checklist version: {review.snapshot.artifact_version_id || 'First version'}.</p></details>
      <div className="grid gap-3 md:grid-cols-2">{WEBSITE_QA_EVIDENCE.map(([id, label]) => <label className="block" key={id}>{label}<textarea aria-label={label} className="w-full rounded-lg border border-slate-500/40 p-2" rows="3" maxLength="1000" disabled={locked || !canRecord} value={typeof evidence[id] === 'string' ? evidence[id] : ''} onChange={event => {setEvidence({...evidence, [id]: event.target.value}); setEvidenceSha(review.review_sha256); setConfirmed(false)}}/></label>)}</div>
      <label className="block"><input type="checkbox" checked={confirmed} disabled={locked || !canRecord} onChange={event => setConfirmed(event.target.checked)}/> I tested all seven QA areas on this exact preview and accept these findings.</label>
      <button type="button" className="workspace-button" disabled={locked || !canRecord || !confirmed || !completeQaEvidence(evidence) || (!artifactId && existingChoices.length > 0)} onClick={() => act(save)}>Record reviewed QA acceptance</button>
      {review.records.length > 0 && <details><summary>Earlier acceptance receipts for this page version</summary>{review.records.map(row => <p key={row.id}>{row.created_at} · launch-checklist version {row.artifact_version_id}</p>)}</details>}
    </>}
    {dirty && !pending && <button type="button" className="workspace-button" disabled={busy || disabled} onClick={() => {setEvidence({}); setConfirmed(false)}}>Discard unsaved QA notes</button>}
    {saved && <p>Saved launch-checklist version: {saved.artifact_version_id} · retained preview {saved.run_id}.</p>}
    <p className="text-sm">Acceptance records human QA findings. Current remote head verification, delivery approval, live publication and rollback rehearsal remain separate.</p>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>
}
