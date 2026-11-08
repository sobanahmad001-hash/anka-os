import { useEffect, useState } from 'react'
import { pipelineRunIntents } from '../data/pipelineRunIntents.js'

export default function WebsiteDeliveryVersion({ organizationId, projectId, stepId, repository = pipelineRunIntents }) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    repository.readDeliveryVersion({ organizationId, projectId, stepId }, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult(value) })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [open, organizationId, projectId, stepId, repository])

  return <div>
    <button type="button" aria-expanded={open} onClick={() => {
      setOpen(!open)
      setResult(null)
      setError(false)
    }}>{open ? 'Close delivery review' : 'Open delivery review and approved copy'}</button>
    {open && (error ? <p role="alert">The approved handoff could not be opened.</p>
      : !result ? <p role="status">Loading delivery review…</p>
      : result.pending ? <p role="status">Awaiting a version-specific delivery review.</p>
      : <article aria-label="Approved delivery copy">
        <h5>{result.version.content.working_title} · Copy v{result.version.version_number}</h5>
        <p className="whitespace-pre-wrap">{result.version.content.body}</p>
        <p>{result.version.content.cta}</p>
        <dl className="break-all">
          <dt>Delivery review</dt><dd>{result.review.evidence}</dd>
          <dt>Review record</dt><dd>{result.receipt.review_event_id}</dd>
          <dt>Registered page</dt><dd>{result.receipt.page_id}</dd>
          <dt>Architecture version</dt><dd>{result.receipt.architecture_version_id}</dd>
          <dt>Approved copy version</dt><dd>{result.version.id}</dd>
        </dl>
      </article>)}
  </div>
}
