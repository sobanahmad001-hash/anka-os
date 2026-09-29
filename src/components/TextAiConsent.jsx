import { useEffect, useRef, useState } from 'react'
import { hasTextAiConsent } from '../data/textAiConsent.js'

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
    if (hasTextAiConsent(grant.current, scopeKey)) return Promise.resolve(true)
    pending.current?.(false)
    return new Promise(resolve => { pending.current = resolve; setRequest({ key: scopeKey }) })
  }
  const finish = accepted => {
    const valid = Boolean(accepted && pending.current && request?.key === activeKey.current)
    if (valid) grant.current = { key: activeKey.current }
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
    <h2 className="text-lg font-semibold">Allow AI replies in this conversation?</h2>
    <p className="mt-3">Send {engagementHistory ? "your prompt and this conversation’s existing messages, including any participant messages already in it," : "up to 12 recent completed messages through the selected message, containing your messages and verified AI replies (subject to text limits),"} to {provider} · {model} for organization-billed replies in {scope}.</p>
    <p className="mt-3">{!engagementHistory && "Teammate-authored messages, private files and private memory are excluded. "}{canonical ? 'Include the bounded OpenAI canonical summary selected for this reply. Record IDs, emails, contact details, task and work-item descriptions, files, transcripts, private memory, and teammate messages are excluded. The sample may be incomplete.' : 'No canonical summary is included.'} {sources ? 'Your explicitly selected approved artifact versions are included as sources, under their existing permissions.' : 'No approved artifact versions are selected.'} {engagementHistory ? <>{selectedAttachmentIds.length > 0 ? 'Only validated text from selected TXT/MD/DOCX files is sent; selecting other file types does not include text.' : 'No attachments are selected; no attachment content is sent.'} PNG/JPEG are reference-only and are never sent to the model. PDF and scanned/OCR documents remain unavailable.</> : 'No files are included.'}</p>
    <p className="mt-3">This acknowledgement stays in memory while this scoped conversation is open. Material changes to the sharing scope or recipients require confirmation again. Switching models on the same approved provider connection does not.</p>
    <div className="mt-4 flex gap-3"><button ref={cancel} type="button" onClick={onCancel}>Cancel</button><button ref={accept} type="button" onClick={onConfirm}>Allow and ask Anka AI</button></div>
  </section></div>
}
