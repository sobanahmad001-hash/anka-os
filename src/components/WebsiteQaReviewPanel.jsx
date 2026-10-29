import {useCallback, useState} from 'react'
import {websiteQaReview} from '../data/websiteQaReview.js'
import WebsiteQaAcceptancePanel from './WebsiteQaAcceptancePanel.jsx'
import {qaAcceptanceKey} from '../data/websiteQaAcceptance.js'

export default function WebsiteQaReviewPanel({data, scope, disabled = false, repository, canRecord = false, signal, onAcceptanceLockChange, onSaved}) {
  const [runId, setRunId] = useState(() => {try {return JSON.parse(sessionStorage.getItem(qaAcceptanceKey(scope)) || 'null')?.runId || ''} catch {return ''}})
  const [acceptanceLocked, setAcceptanceLocked] = useState(false)
  const acceptanceLockChanged = useCallback(value => {setAcceptanceLocked(value); onAcceptanceLockChange?.(value)}, [onAcceptanceLockChange])
  const review = runId ? websiteQaReview(data, scope, runId) : null
  return <section aria-label="Website page QA review" className="space-y-3 rounded-lg border border-slate-500/40 p-3" style={{minWidth: 0, overflowWrap: 'anywhere'}}>
    <h3 className="font-semibold">Website page QA review</h3>
    <p>Review one exact retained page preview before recording QA evidence in Development artifacts. This review does not approve delivery or publish a website.</p>
    <label className="block">Retained page preview<select aria-label="Page preview for QA" className="w-full" value={runId} disabled={disabled || acceptanceLocked} onChange={event => setRunId(event.target.value)}><option value="">Choose manually</option>{data.runs.map(run => <option key={run.id} value={run.id}>{run.page_key || run.page_id} · {run.created_at} · {run.status}</option>)}</select></label>
    {review && !review.valid && <p role="alert">This preview is unavailable in the current project history. Select a retained version again.</p>}
    {review?.valid && <>
      <p>{review.run.page_key || review.run.page_id} · {review.target?.base_url || 'Target evidence unavailable'}</p>
      <details><summary>Exact page version and package</summary><dl><dt>Page version</dt><dd>{review.run.id}</dd><dt>Package checksum</dt><dd>{review.job?.artifact_sha256 || 'Package evidence unavailable'}</dd></dl></details>
      <ul className="grid gap-2 lg:grid-cols-2">{review.checks.map(check => <li key={check.id} className="rounded-lg border border-slate-500/30 p-2"><details><summary><strong>{check.status === 'verified' ? 'Receipt checked' : 'Needs review'}: {check.label}</strong></summary><p className="mt-2 text-sm">{check.detail}</p></details></li>)}</ul>
      {review.previewUrl && <a className="workspace-button" href={review.previewUrl} target="_blank" rel="noreferrer">Open this authenticated QA preview</a>}
      <details><summary>Manual QA evidence still required</summary><p className="mt-2">Desktop and mobile layout; keyboard and focus; headings and image descriptions; reduced motion; links and metadata; asset and security checks; performance; exact remote head; and a rollback rehearsal.</p><p className="mt-2">Record findings against this page version and package checksum using page revision notes and Development technical or launch artifacts.</p></details>
      <p className="text-sm">This is a read-only receipt review. Saved QA acceptance, live target approval and publication remain separate.</p>
    </>}
    {runId && repository?.qaReview && <WebsiteQaAcceptancePanel key={runId} scope={scope} runId={runId} repository={repository} canRecord={canRecord} disabled={disabled} signal={signal} onLockChange={acceptanceLockChanged} onSaved={onSaved}/>}
  </section>
}
