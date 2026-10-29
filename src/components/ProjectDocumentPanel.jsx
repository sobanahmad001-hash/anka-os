import { useEffect, useRef, useState } from 'react'
import AttachmentUseStatus from './AttachmentUseStatus.jsx'
import { departmentChat } from '../data/departmentChatRepository.js'

const types = { txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  }
export default function ProjectDocumentPanel({ conversationKey, conversationId, requestScope, busy, ensureConversation, run, selectedIds, onSelection, onReadyForChat, initialFile=null }) {
  const [rows, setRows] = useState([]), [file, setFile] = useState(initialFile), [classification, setClassification] = useState('internal'), [consent, setConsent] = useState(false)
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const attempt = useRef(null), revision = useRef(0), fileInput = useRef(null)
  const savedId = useRef(conversationId); savedId.current = conversationId
  useEffect(() => {
    attempt.current = null; setFile(initialFile); setConsent(false)
    const token = ++revision.current
    setRows([]); onSelection([]); setNotice(''); setError('')
    if (!savedId.current) return () => { revision.current = token + 1 }
    departmentChat.listProjectDocuments({ conversation_id: savedId.current }, requestScope)
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
        const saved = await departmentChat.uploadProjectDocument({ ...attempt.current, conversation_id: conversation.id }, requestScope)
        if (requestScope.signal?.aborted || token !== revision.current) return
        const latestRows = await departmentChat.listProjectDocuments({ conversation_id: conversation.id }, requestScope)
        if (requestScope.signal?.aborted || token !== revision.current) return
        setRows(latestRows)
        const readyRow=latestRows.find(row=>row.id===saved.id&&row.status==='ready'&&row.ai_use_allowed===true)
        const nextIds=[...new Set([...selectedIds,saved.id])]
        const canSelect=readyRow&&nextIds.length<=3&&latestRows.filter(row=>nextIds.includes(row.id)).reduce((sum,row)=>sum+(row.text_characters||0),0)<=24000
        if(canSelect)onSelection(nextIds)
        attempt.current = null; setFile(initialFile); setConsent(false); if (fileInput.current) fileInput.current.value = ''
        setNotice(`${saved.original_name} saved privately. ${canSelect?'Selected for your next Send.':'Select eligible references below before Send.'} No AI request was made.`);if(canSelect)onReadyForChat?.(readyRow)
      } catch (reason) { if (!requestScope.signal?.aborted && token === revision.current) setError(reason.message + ' Retry Upload uses the same file request; it does not send to AI.') }
    })
  }
  async function remove(row) {
    await run(async () => {
      const token = revision.current
      await departmentChat.revokeProjectDocument({ conversation_id: conversationId, attachment_id: row.id }, requestScope)
      if (token !== revision.current || requestScope.signal?.aborted) return
      onSelection(selectedIds.filter(id => id !== row.id))
      setRows(previous => previous.map(a => a.id === row.id ? { ...a, status: 'revoked' } : a))
      setNotice('Reference removed from future sends. Original and past source receipts are retained.')
    })
  }
  async function download(row) {
    await run(async () => {
      const token = revision.current
      const result = await departmentChat.downloadProjectDocument({ conversation_id: conversationId, attachment_id: row.id }, requestScope)
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
  return <div className="project-document-panel" aria-label="Project document references">
    <p>Uploading in a new Chat first saves a private Chat with a human attachment note, without an AI reply. Original files are private to you in this saved Project Chat. Shared teammates can see chat answers, but cannot download these originals. Uploading never calls AI.</p>
    <p>PDF text (20 pages), DOCX main text, TXT or Markdown. Up to 5 MiB per file; DOCX 4 MiB. No scans, OCR, encrypted PDFs or video. Spreadsheets use the separate reviewed import flow.</p>
    {file && <p>Selected file: {file.name}</p>}
    <label>Reference file<input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setConsent(false); attempt.current = null; setError('') }} /></label>
    <label>Classification<select value={classification} disabled={busy || Boolean(attempt.current)} onChange={e => setClassification(e.target.value)}><option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential</option></select></label>
    <label><input type="checkbox" checked={consent} disabled={busy || Boolean(attempt.current)} onChange={e => setConsent(e.target.checked)} />I confirm private upload (and saving this Chat if new), and allow extracted text from this file to be sent to the selected AI provider when I select it and press Send.</label>
    <button type="button" disabled={busy || !file || !mime || !consent} onClick={upload}>{attempt.current ? 'Retry same upload' : 'Upload reference'}</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <ul>{rows.filter(a => a.status !== 'revoked').map(row => <li key={row.id}>
      <label><input type="checkbox" checked={selectedIds.includes(row.id)} disabled={busy || row.status !== 'ready'} onChange={e => select(row, e.target.checked)} />{row.original_name}</label>
      <AttachmentUseStatus status={row.status} selected={selectedIds.includes(row.id)} referenceOnly={row.reference_only}/>
      <span>{row.status === 'ready' ? row.reference_only ? 'Reference only; image pixels are not sent to AI.' : `${row.text_characters} extracted characters` : 'Upload unfinished—choose the same file and retry.'}</span>
      {row.status === 'ready' && <button type="button" disabled={busy} onClick={() => download(row)}>Download original</button>}
      <button type="button" disabled={busy} onClick={() => remove(row)}>Remove reference</button>
    </li>)}</ul>
  </div>
}
