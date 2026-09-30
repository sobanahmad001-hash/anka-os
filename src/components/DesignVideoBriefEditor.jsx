import { useCallback, useEffect, useRef, useState } from 'react'
import { VIDEO_BRIEF_FIELDS, emptyVideoBrief, normalizeVideoBrief, requireVideoBriefVersion, validateVideoBrief, videoBriefCreativeContent, videoBriefSignature } from '../../supabase/functions/_shared/designVideoBrief.js'

// Provider-free preparation/confirmation. Generate remains a separate guarded action.
export default function DesignVideoBriefEditor({ studio, context, actorId, organizationId, settings, script, onScriptChange, onRestoreSettings, onConfirmed, onNavigationBusyChange, onDraftDirtyChange }) {
  const [fields, setFields] = useState(emptyVideoBrief), [saved, setSaved] = useState(null), [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(null), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [historyChecked, setHistoryChecked] = useState(false)
  const alive = useRef(true), flight = useRef(false), attempt = useRef(null), reviewRef = useRef(null), previewButton = useRef(null)
  const scopeKey = JSON.stringify(context)
  const recoveryKey = `anka-video-brief-recovery:${actorId}:${organizationId}:${scopeKey}`
  const draft = { ...fields, ...Object.fromEntries(['mode','duration_seconds','aspect_ratio','resolution','output_format','generate_audio'].map(key => [key,settings[key]])), script_storyboard: script }, signature = videoBriefSignature(draft)
  const valid = validateVideoBrief(draft)
  useEffect(() => { if (!preview) return; reviewRef.current?.querySelector?.('button')?.focus?.({preventScroll:true}); reviewRef.current?.scrollIntoView?.({block:'start',behavior:'instant'}) }, [preview])
  let confirmed = null
  try { if (saved) confirmed = requireVideoBriefVersion({ ...saved, organizationId, actorId, context, draft }) } catch { /* Changed drafts require another explicit confirmation. */ }
  const confirmedId = confirmed?.id || ''
  const onConfirmedRef = useRef(onConfirmed); onConfirmedRef.current = onConfirmed
  useEffect(() => { onConfirmedRef.current?.(confirmedId ? saved : null) }, [confirmedId, signature, saved])
  useEffect(() => { onNavigationBusyChange?.(busy || Boolean(pending)); return () => onNavigationBusyChange?.(false) }, [busy, pending, onNavigationBusyChange])
  const draftDirty = !confirmedId && VIDEO_BRIEF_FIELDS.some(([key]) => Boolean(draft[key]?.trim()))
  useEffect(() => { onDraftDirtyChange?.(draftDirty); return () => onDraftDirtyChange?.(false) }, [draftDirty, onDraftDirtyChange])
  const restore = useCallback(result => {
    const next = result?.version?.content?.video_brief
    if (!next) return false
    const exact = normalizeVideoBrief(next)
    requireVideoBriefVersion({ ...result, organizationId, actorId, context: JSON.parse(scopeKey), draft: exact })
    setSaved(result); setFields(exact); onScriptChange(exact.script_storyboard); onRestoreSettings(exact)
    return true
  }, [organizationId, actorId, scopeKey, onScriptChange, onRestoreSettings])
  useEffect(() => {
    alive.current = true
    let active = true, operationKey = null
    try {
      const record = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null')
      if (record && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(record.operation_key)) { operationKey = record.operation_key; setPending(record) }
    } catch { setNotice('Brief recovery storage is unavailable. Keep this view open.') }
    if (!studio?.getVideoBrief) { setLoading(false); setNotice('Saved video briefs are unavailable. Generation requires an exact confirmed version.'); return () => { active = false; alive.current = false } }
    studio.getVideoBrief({ ...JSON.parse(scopeKey), ...(operationKey ? { operation_key: operationKey } : {}) }).then(result => {
      if (!active) return
      setHistoryChecked(true)
      if (restore(result) && operationKey) { sessionStorage.removeItem(recoveryKey); setPending(null); setNotice('Original brief confirmation recovered. No new confirmation or generation was sent.') }
      else if (operationKey) setNotice('The original confirmation is not visible yet. Check recovery before confirming or generating.')
    }).catch(() => { if (active) setNotice('Saved brief history could not be checked. Confirming and generating remain unavailable until recovery succeeds.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; alive.current = false }
  }, [studio, scopeKey, recoveryKey, restore])
  async function recover() {
    if (flight.current || !studio?.getVideoBrief) return
    flight.current = true; setBusy(true)
    try {
      const result = await studio.getVideoBrief({ ...context, ...(pending ? { operation_key: pending.operation_key } : {}) })
      if (!alive.current) return
      if (pending && !result?.version) throw new Error('Original confirmation is not visible yet. No new write or generation was sent.')
      if (result?.version) restore(result)
      sessionStorage.removeItem(recoveryKey); setPending(null); attempt.current = null; setHistoryChecked(true); setLoading(false); setNotice('Saved brief inspected. No new confirmation or generation was sent.')
    } catch (error) { if (alive.current) setNotice(error.message || 'Brief recovery remains unavailable.') }
    finally { flight.current = false; if (alive.current) setBusy(false) }
  }
  async function confirm() {
    if (flight.current || pending || loading || !historyChecked || !preview || preview.signature !== signature || !studio?.confirmVideoBrief) return
    flight.current = true; setBusy(true); setNotice('')
    try {
      const operationKey = crypto.randomUUID(), record = { operation_key: operationKey }
      sessionStorage.setItem(recoveryKey, JSON.stringify(record))
      if (sessionStorage.getItem(recoveryKey) !== JSON.stringify(record)) throw new Error('Scoped confirmation recovery must be available before saving.')
      const input = { ...context, creative_brief_id: saved?.brief?.id || null, expected_revision: saved?.brief?.revision || 0, operation_key: operationKey, video_brief: structuredClone(preview.draft) }
      attempt.current = input; setPending(record)
      const result = await studio.confirmVideoBrief(input)
      if (!alive.current) return
      requireVideoBriefVersion({ ...result, organizationId, actorId, context, draft: preview.draft })
      setSaved(result); setPreview(null); setPending(null); attempt.current = null; sessionStorage.removeItem(recoveryKey)
      setNotice(`Confirmed canonical video brief v${result.version.version_number}. No video was generated.`)
    } catch (error) { if (alive.current) setNotice(error.message || 'Confirmation outcome is uncertain. Check the original saved version before proceeding.') }
    finally { flight.current = false; if (alive.current) setBusy(false) }
  }
  return <section className="design-tools-workbench design-video-brief" aria-label="Versioned video brief">
    <h3>Video brief · {saved ? `v${saved.version.version_number}` : 'unsaved'}</h3>
    <p>Complete unknowns before confirming. For assets or required text, write an explicit “None” when applicable. Reference uploads and clip/template editing are unavailable here; no media is regenerated while preparing a brief.</p>
    <fieldset disabled={busy || Boolean(pending) || loading} className="grid gap-3 mt-3 md:grid-cols-2">
      {VIDEO_BRIEF_FIELDS.map(([key,label,maxLength]) => <label className={key === 'script_storyboard' ? 'block md:col-span-2' : 'block'} key={key}>{label}<textarea aria-label={label} rows={key === 'script_storyboard' ? 4 : 2} maxLength={maxLength} className="mt-1 w-full rounded bg-slate-900 p-2" value={draft[key]} onChange={event => { setPreview(null); if (key === 'script_storyboard') onScriptChange(event.target.value); else setFields(previous => ({ ...previous, [key]: event.target.value })) }} /></label>)}
    </fieldset>
    {!valid.valid && <p className="mt-2 text-amber-300">{[...valid.missing.map(label => `${label} is required`), ...valid.errors].join(' · ')}</p>}
    <button ref={previewButton} className="mt-3 rounded border border-[var(--anka-line)] px-3 py-2" type="button" disabled={!valid.valid || busy || Boolean(pending) || loading || !historyChecked} onClick={() => { const content=videoBriefCreativeContent(draft,context); setPreview({ draft:structuredClone(draft),signature,content }) }}>Preview complete video brief</button>
    {preview && preview.signature === signature && <section ref={reviewRef} style={{scrollMarginTop:112}} aria-label="Confirm exact video brief" className="mt-3 rounded border p-3"><h3>Review this exact version</h3><p>{preview.draft.mode} · {preview.draft.duration_seconds}s · {preview.draft.resolution} · {preview.draft.aspect_ratio} · {preview.draft.output_format} · Audio {preview.draft.generate_audio ? 'on' : 'off'}</p><pre className="whitespace-pre-wrap">{preview.content.instructions}</pre><p>Confirm saves one immutable owner-private canonical brief version. It does not generate media, copy to a project, approve or deliver anything. Generate later sends this complete prompt and exact settings through the separately approved connection and quote.</p><button className="rounded bg-[var(--anka-violet)] text-[var(--anka-on-violet)] px-3 py-2" type="button" disabled={busy || Boolean(pending)} onClick={confirm}>Confirm video brief version</button><button type="button" disabled={busy || Boolean(pending)} onClick={() => { setPreview(null); previewButton.current?.focus?.() }}>Keep editing brief</button></section>}
    {confirmedId && <p role="status">Exact brief v{saved.version.version_number} confirmed. Changing any field or setting requires a new confirmation.</p>}
    {(pending || notice || loading) && <p role="status">{loading ? 'Checking saved brief…' : notice || 'Checking the original confirmation…'}</p>}
    {(pending || notice && !confirmedId) && <button type="button" disabled={busy} onClick={recover}>Check saved brief</button>}
  </section>
}
