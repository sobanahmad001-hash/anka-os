import { useCallback, useEffect, useRef, useState } from 'react'
import { useOrganization } from '../context/OrganizationContext.jsx'
import ContentWriterEditor from './ContentWriterEditor.jsx'
import { approvedVisionLanguage, bestContentStage, resolveContentLanguage } from '../data/contentStudio.js'

// Reuses the canonical writer and scoped repository; chat text is never an input.
export default function ContentChatWriterPane({ workspace, studio, refresh, refreshing = false, stale = false, onStateChange }) {
  const { activeOrganizationId, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false), alive = useRef(true), heading = useRef(null)
  const identity = JSON.stringify([activeOrganizationId, scopeRevision, workspace?.engagement?.id, workspace?.engagement?.project_id])
  const current = useRef(identity); current.current = identity
  const allowed = workspace?.engagement?.organization_id === activeOrganizationId && !requestSignal?.aborted
  const access = useRef(null); access.current = { allowed, stale, refreshing, uncertain, identity }
  useEffect(() => { alive.current = true; heading.current?.focus(); return () => { alive.current = false } }, [])
  useEffect(() => { onStateChange?.({ dirty, saving }); return () => onStateChange?.({ dirty: false, saving: false }) }, [dirty, saving, onStateChange])
  const onDirtyChange = useCallback(value => setDirty(value), [])
  async function act(callback, success) {
    const latest = access.current
    if (!latest.allowed || latest.stale || latest.refreshing || latest.uncertain || latest.identity !== identity || requestSignal?.aborted || lock.current || !alive.current) return null
    const requested = identity
    const valid = () => alive.current && current.current === requested && !requestSignal?.aborted
    lock.current = true; setSaving(true); setError(''); setNotice('')
    try {
      const result = await callback()
      if (!valid()) return null
      setNotice(typeof success === 'function' ? success(result) : success)
      // A committed save remains committed if its follow-up read fails.
      // The parent marks a failed refresh stale, preventing another write.
      await refresh()
      return valid() ? result : null
    } catch (reason) {
      if (valid()) {
        handleOrganizationAccessError?.(reason)
        setError(reason.message || 'Content save could not be confirmed.')
        setUncertain(true)
      }
      return null
    } finally { lock.current = false; if (valid()) setSaving(false) }
  }
  if (!allowed) return <p role="status">Content writer is unavailable in this context.</p>
  return <section className="content-chat-writer-body">
    <h3 ref={heading} tabIndex={-1} className="font-semibold">Content writer · canonical versions</h3>
    <p className="mt-2 text-xs text-[var(--anka-muted)]">Edit an exact saved version or a new text draft. Preview the destination before confirming an unapproved version.</p>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--anka-danger)]">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-[var(--anka-success)]">{notice}</p>}
    {uncertain && <p role="alert" className="mt-3 text-sm text-[var(--anka-warning)]">The save outcome needs review. Refresh the saved outputs and inspect the latest version. Close and reopen this editor before another save; no automatic retry is sent.</p>}
    <ContentWriterEditor workspace={workspace} studio={studio} saving={saving} act={act} onRefresh={refresh} refreshing={refreshing} stale={stale || uncertain} stageId={bestContentStage(workspace.stages || [], 'content')?.id || null} compactLabels defaultLanguage={resolveContentLanguage({ approvedBrandLanguage: approvedVisionLanguage(workspace), organizationDefaultLanguage: workspace.organizationSettings?.content_language || workspace.organizationSettings?.default_language }).language} onDirtyChange={onDirtyChange} />
  </section>
}
