import { useEffect, useRef, useState } from 'react'
import { departmentChat } from '../data/departmentChatRepository.js'

const types = { txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
export default function DesignPrivateAttachmentPanel({ conversationKey, conversationId, requestScope, busy, ensureConversation, run, selectedIds, onSelection }) {
  const [rows, setRows] = useState([]), [file, setFile] = useState(null), [classification, setClassification] = useState('internal'), [consent, setConsent] = useState(false)
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const attempt = useRef(null), revision = useRef(0), fileInput = useRef(null)
  const savedId = useRef(conversationId); savedId.current = conversationId
  useEffect(() => {
    attempt.current = null; setFile(null); setConsent(false)
    const token = ++revision.current
    setRows([]); onSelection([]); setNotice(''); setError('')
    if (!savedId.current) return () => { revision.current = token + 1 }
    departmentChat.listDesignPrivateAttachments({ conversation_id: savedId.current }, requestScope)
      .then(value => { if (token === revision.current && !requestScope.signal?.aborted) setRows(value) })
      .catch(reason => { if (token === revision.current && !requestScope.signal?.aborted) setError(reason.message) })
    return () => { revision.current = token + 1 }
  }, [conversationKey, requestScope, onSelection])
  const mime = file ? types[file.name.split('.').pop().toLowerCase()] : ''
  const referenceOnly = mime?.startsWith('image/')
  async function upload() {
    if (!file || !mime || (!referenceOnly && !consent)) return
    await run(async () => {
      setError(''); setNotice('')
      const token = revision.current
      try {
        if (!attempt.current) {
          if (file.size < 1 || file.size > 5 * 1024 * 1024 || mime.includes('wordprocessingml') && file.size > 4 * 1024 * 1024) throw Error('Choose a file up to 5 MiB (DOCX: 4 MiB).')
          const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('')
          const unfinished = rows.find(row => row.status === 'reserved' && row.expected_sha256 === sha && row.original_name === file.name && row.declared_bytes === file.size && row.claimed_mime === mime && row.classification === classification && row.ai_use_allowed === consent)
          attempt.current = { attachment_id: unfinished?.id || crypto.randomUUID(), original_name: file.name, claimed_mime: mime, byte_size: file.size, sha256_hex: sha, classification, ai_use_allowed: consent, file }
        }
        const conversation = await ensureConversation()
        const saved = await departmentChat.uploadDesignPrivateAttachment({ ...attempt.current, conversation_id: conversation.id }, requestScope)
        if (requestScope.signal?.aborted || token !== revision.current) return
        const latestRows = await departmentChat.listDesignPrivateAttachments({ conversation_id: conversation.id }, requestScope)
        if (requestScope.signal?.aborted || token !== revision.current) return
        setRows(latestRows)
        attempt.current = null; setFile(null); setConsent(false); if (fileInput.current) fileInput.current.value = ''
        setNotice(`${saved.original_name} saved privately. Select it below before Send. No AI request was made.`)
      } catch (reason) { if (!requestScope.signal?.aborted && token === revision.current) setError(reason.message + ' Retry Upload uses the same file request; it does not send to AI.') }
    })
  }
  async function remove(row) {
    await run(async () => {
      const token = revision.current
      await departmentChat.revokeDesignPrivateAttachment({ conversation_id: conversationId, attachment_id: row.id }, requestScope)
      if (token !== revision.current || requestScope.signal?.aborted) return
      onSelection(selectedIds.filter(id => id !== row.id))
      setRows(previous => previous.map(a => a.id === row.id ? { ...a, status: 'revoked' } : a))
      setNotice('Reference removed from future sends. Original and past source receipts are retained.')
    })
  }
  async function download(row) {
    await run(async () => {
      const token = revision.current
      const result = await departmentChat.downloadDesignPrivateAttachment({ conversation_id: conversationId, attachment_id: row.id }, requestScope)
      const blob = result instanceof Response ? await result.blob() : result
      if (token !== revision.current || requestScope.signal?.aborted) return
      if (!(blob instanceof Blob) || blob.size > 5 * 1024 * 1024) throw Error('Original download is unavailable.')
      const url = URL.createObjectURL(blob)
      try { const link = document.createElement('a'); link.href = url; link.download = row.original_name; link.click() }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
    })
  }
  function select(row, checked) {
    const ids = checked ? [...selectedIds, row.id] : selectedIds.filter(id => id !== row.id)
    if (ids.length > 3 || rows.filter(a => ids.includes(a.id)).reduce((sum, a) => sum + (a.text_characters || 0), 0) > 24000) { setError('Select up to three files and 24,000 extracted characters.'); return }
    setError(''); onSelection(ids)
  }
  return <div className="design-private-attachments" aria-label="Private Design references">
    <p>{conversationId ? 'Files stay in this owner-only Design chat.' : 'The first Upload saves an empty owner-only Design chat. It does not send a message or create a brief.'} Uploading never calls AI.</p>
    <p>PDF text (20 pages), DOCX main text, TXT, MD, PNG or JPEG. Up to 5 MiB per file; DOCX 4 MiB. No scans, OCR, encrypted PDFs or video. Images are references only—not animation inputs.</p>
    <label>Reference file<input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setConsent(false); attempt.current = null; setError('') }} /></label>
    <label>Classification<select value={classification} disabled={busy || Boolean(attempt.current)} onChange={e => setClassification(e.target.value)}><option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential</option></select></label>
    <label><input type="checkbox" checked={consent} disabled={busy || Boolean(attempt.current)} onChange={e => setConsent(e.target.checked)} />I allow extracted text from this file to be sent to the selected AI provider when I select it and press Send.</label>
    <button type="button" disabled={busy || !file || !mime || !referenceOnly && !consent} onClick={upload}>{attempt.current ? 'Retry same upload' : 'Upload reference'}</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <ul>{rows.filter(a => a.status !== 'revoked').map(row => <li key={row.id}>
      <label><input type="checkbox" checked={selectedIds.includes(row.id)} disabled={busy || row.status !== 'ready'} onChange={e => select(row, e.target.checked)} />{row.original_name}</label>
      <span>{row.status === 'ready' ? row.reference_only ? 'Reference only; image pixels are not sent to AI.' : `${row.text_characters} extracted characters` : 'Upload unfinished—choose the same file and retry.'}</span>
      {row.status === 'ready' && <button type="button" disabled={busy} onClick={() => download(row)}>Download original</button>}
      <button type="button" disabled={busy} onClick={() => remove(row)}>Remove reference</button>
    </li>)}</ul>
  </div>
}
