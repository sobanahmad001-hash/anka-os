import { useEffect, useRef, useState } from 'react'
import { hasTextAiConsent, textAiConsentNeedsReview, readTextAiConsent, rememberTextAiConsent } from '../data/textAiConsent.js'

export function useTextAiConsent(scopeKey) {
  const grant = useRef(null)
  const activeKey = useRef(scopeKey)
  const pending = useRef(null)
  const [request, setRequest] = useState(null)
  if (activeKey.current !== scopeKey) { activeKey.current = scopeKey; grant.current = null }
  useEffect(() => {
    setRequest(null)
    return () => { pending.current?.(false); pending.current = null }
  }, [scopeKey])
  const confirm = () => {
    if (activeKey.current !== scopeKey) return Promise.resolve(false)
    if (!textAiConsentNeedsReview(scopeKey)) return Promise.resolve(true)
    let saved = null
    try { saved = readTextAiConsent(scopeKey, globalThis.sessionStorage) } catch { /* Review when storage is blocked. */ }
    if (hasTextAiConsent(saved, scopeKey)) return Promise.resolve(true)
    if (hasTextAiConsent(grant.current, scopeKey)) return Promise.resolve(true)
    pending.current?.(false)
    return new Promise(resolve => { pending.current = resolve; setRequest({ key: scopeKey }) })
  }
  const finish = accepted => {
    const valid = Boolean(accepted && pending.current && request?.key === activeKey.current)
    if (valid) {
      grant.current = { key: activeKey.current }
      try { rememberTextAiConsent(activeKey.current, globalThis.sessionStorage) } catch { /* Keep mounted consent only. */ }
    }
    pending.current?.(valid); pending.current = null; setRequest(null)
  }
  return { confirm, dialog: request?.key === scopeKey ? { onConfirm: () => finish(true), onCancel: () => finish(false) } : null }
}

export default function TextAiConsent({ onConfirm, onCancel, provider, model, scope, canonical = false, sources = false, selectedAttachmentIds = [], engagementHistory = false }) {
  const cancel = useRef(null)
  const accept = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    cancel.current?.focus()
    return () => previous?.focus?.()
  }, [])
  return <div role="dialog" aria-modal="true" aria-label="Confirm AI data sharing" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel() }
    if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === cancel.current ? accept : cancel).current?.focus() }
  }}><section className="max-w-lg rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-6 text-[var(--anka-ink)]">
    <h2 className="text-lg font-semibold">Include these additional sources?</h2>
    <p className="mt-3">Send {engagementHistory ? "your prompt and this conversation’s existing messages, including any participant messages already in it," : "up to 12 recent completed messages through the selected message, containing your messages and verified AI replies (subject to text limits),"} to {provider} · {model} for organization-billed replies in {scope}.</p>
    <p className="mt-3">{!engagementHistory && "Teammate-authored messages, private files and private memory are excluded. "}{canonical ? 'Include the bounded OpenAI canonical summary selected for this reply. Record IDs, emails, contact details, task and work-item descriptions, files, transcripts, private memory, and teammate messages are excluded. The sample may be incomplete.' : 'No canonical summary is included.'} {sources ? 'Your explicitly selected approved artifact versions are included as sources, under their existing permissions.' : 'No approved artifact versions are selected.'} {engagementHistory ? <>{selectedAttachmentIds.length > 0 ? 'Only validated text from selected supported documents is sent; reference-only files do not contribute text.' : 'No attachments are selected; no attachment content is sent.'} PNG/JPEG are reference-only and are never sent to the model. File support and extraction limits are shown in the attachment panel; scanned/OCR content is not extracted.</> : 'No files are included.'}</p>
    <p className="mt-3">This choice is remembered in this browser tab for these exact sources, conversation, provider connection and recipients. Changed sources or sharing scope need a new review. Server access checks still apply on every Send.</p>
    <div className="mt-4 flex gap-3"><button ref={cancel} type="button" onClick={onCancel}>Cancel</button><button ref={accept} type="button" onClick={onConfirm}>Allow and ask Anka AI</button></div>
  </section></div>
}
