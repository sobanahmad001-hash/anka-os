import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { departmentChat } from '../data/departmentChatRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500'
const BUTTON = 'rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50'
const PAGE_SIZE = 50

export default function ContextConversationPanel({ contextKind, departmentId = '', projectId = '', label = 'Conversation' }) {
  const { user } = useAuth()
  const { activeOrganizationId, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  if (!user?.id || !activeOrganizationId || requestSignal.aborted) return null
  const identity = [user.id, activeOrganizationId, scopeRevision, contextKind, departmentId, projectId].join(':')
  return <ScopedContextConversation key={identity} contextKind={contextKind} departmentId={departmentId}
    projectId={projectId} label={label} organizationId={activeOrganizationId} signal={requestSignal}
    onAccessError={handleOrganizationAccessError} />
}

function ScopedContextConversation({ contextKind, departmentId, projectId, label, organizationId, signal, onAccessError }) {
  const scope = useMemo(() => ({ context_kind: contextKind, ...(departmentId ? { department_id: departmentId } : {}),
    ...(projectId ? { project_id: projectId } : {}) }), [contextKind, departmentId, projectId])
  const requestScope = useMemo(() => ({ organizationId, signal }), [organizationId, signal])
  const [conversations, setConversations] = useState([])
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [listBusy, setListBusy] = useState(false)
  const [conversationId, setConversationId] = useState('')
  const [messages, setMessages] = useState([])
  const [hasOlder, setHasOlder] = useState(false)
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [olderBusy, setOlderBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingRequests = useRef(new Map())
  const drafts = useRef(new Map())
  const activeConversation = useRef(conversationId)
  const listRevision = useRef(0)
  activeConversation.current = conversationId

  const showError = useCallback((reason) => {
    if (signal.aborted) return
    onAccessError(reason)
    setError(reason.message || 'Conversation request failed')
  }, [onAccessError, signal])

  const refresh = useCallback(async (preferredId = '') => {
    const revision = ++listRevision.current
    const rows = await departmentChat.listContextConversations(scope, requestScope)
    if (signal.aborted || revision !== listRevision.current) return
    const page = (rows || []).slice(0, PAGE_SIZE)
    setConversations(page)
    setHasMoreConversations((rows || []).length > PAGE_SIZE)
    setNextOffset(page.length)
    setConversationId(current => {
      if (preferredId) return preferredId
      return page.some(row => row.id === current) ? current : page[0]?.id || ''
    })
  }, [scope, requestScope, signal])

  useEffect(() => {
    let current = true
    const revision = ++listRevision.current
    setLoading(true)
    setError('')
    departmentChat.listContextConversations(scope, requestScope)
      .then(rows => {
        if (!current || signal.aborted || revision !== listRevision.current) return
        const page = (rows || []).slice(0, PAGE_SIZE)
        setConversations(page)
        setHasMoreConversations((rows || []).length > PAGE_SIZE)
        setNextOffset(page.length)
        setConversationId(page[0]?.id || '')
      })
      .catch(reason => { if (current) showError(reason) })
      .finally(() => { if (current && !signal.aborted) setLoading(false) })
    return () => { current = false }
  }, [scope, requestScope, signal, showError])

  useEffect(() => {
    setDraft(drafts.current.get(conversationId) || '')
    if (!conversationId) { setMessages([]); setHasOlder(false); return }
    let current = true
    setMessages([])
    setHasOlder(false)
    departmentChat.getContextConversation({ conversation_id: conversationId }, requestScope)
      .then(result => {
        if (!current || signal.aborted) return
        setMessages(result.messages || [])
        setHasOlder(Boolean(result.has_older))
      })
      .catch(reason => { if (current) showError(reason) })
    return () => { current = false }
  }, [conversationId, requestScope, signal, showError])

  async function loadMoreConversations() {
    if (!hasMoreConversations || listBusy) return
    const revision = listRevision.current
    const offset = nextOffset
    setListBusy(true); setError('')
    try {
      const rows = await departmentChat.listContextConversations({ ...scope, offset }, requestScope)
      if (signal.aborted || revision !== listRevision.current) return
      const page = (rows || []).slice(0, PAGE_SIZE)
      setConversations(current => [...current, ...page.filter(row => !current.some(item => item.id === row.id))])
      setHasMoreConversations((rows || []).length > PAGE_SIZE)
      setNextOffset(offset + page.length)
    } catch (reason) { if (revision === listRevision.current) showError(reason) }
    finally { if (!signal.aborted) setListBusy(false) }
  }

  async function createConversation(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const created = await departmentChat.createContextConversation({
        ...scope, title: title.trim() || `New ${label.toLowerCase()}`,
      }, requestScope)
      if (signal.aborted) return
      setTitle('')
      await refresh(created.id)
    } catch (reason) { showError(reason) } finally { if (!signal.aborted) setBusy(false) }
  }

  async function sendMessage(event) {
    event.preventDefault()
    const content = draft.trim()
    if (!conversationId || !content || busy) return
    const targetId = conversationId
    const existing = pendingRequests.current.get(targetId)
    const requestId = existing?.content === content ? existing.id : crypto.randomUUID()
    pendingRequests.current.set(targetId, { id: requestId, content })
    setBusy(true); setError('')
    try {
      const saved = await departmentChat.appendContextHumanMessage({
        conversation_id: targetId, client_request_id: requestId, message: content,
      }, requestScope)
      if (signal.aborted) return
      pendingRequests.current.delete(targetId)
      drafts.current.delete(targetId)
      if (activeConversation.current !== targetId) return
      setMessages(current => current.some(message => message.id === saved.id) ? current : [...current, saved])
      setDraft('')
      await refresh(targetId)
    } catch (reason) { showError(reason) } finally { if (!signal.aborted) setBusy(false) }
  }

  async function loadOlder() {
    if (!messages.length || olderBusy) return
    const targetId = conversationId
    setOlderBusy(true); setError('')
    try {
      const result = await departmentChat.getContextConversation({
        conversation_id: targetId, before_sequence: messages[0].sequence,
      }, requestScope)
      if (signal.aborted || activeConversation.current !== targetId) return
      setMessages(current => [...(result.messages || []).filter(row => !current.some(item => item.id === row.id)), ...current])
      setHasOlder(Boolean(result.has_older))
    } catch (reason) { showError(reason) } finally { if (!signal.aborted) setOlderBusy(false) }
  }

  const selected = conversations.find(row => row.id === conversationId)
  const description = contextKind === 'department_private'
    ? 'Only you can see these conversations. Save ideas without choosing a client engagement.'
    : contextKind === 'organization'
      ? 'Only you can see these conversations for the selected organization.'
      : 'Only you can see these conversations for this project.'
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5" aria-label={label}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-white">{label}</h2>
        <p className="mt-1 text-sm text-slate-400">{description}</p></div>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}
    <form onSubmit={createConversation} className="mt-5 flex flex-wrap gap-2">
      <input className={`${INPUT} min-w-52 flex-1`} aria-label="New conversation title" placeholder="New conversation title"
        maxLength={160} value={title} onChange={event => setTitle(event.target.value)} />
      <button className={BUTTON} disabled={busy || loading}>New conversation</button>
    </form>
    <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
      <div className="space-y-2" aria-label="Saved conversations">
        {loading && <p className="text-sm text-slate-500">Loading conversations…</p>}
        {!loading && !conversations.length && <p className="text-sm text-slate-500">No conversations yet.</p>}
        {conversations.map(row => <button key={row.id} type="button" onClick={() => { drafts.current.set(conversationId, draft); setConversationId(row.id) }}
          className={`w-full rounded-xl border p-3 text-left text-sm ${row.id === conversationId ? 'border-violet-500 bg-violet-950/30 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
          {row.title}</button>)}
        {hasMoreConversations && <button type="button" onClick={loadMoreConversations} disabled={listBusy || busy}
          className="w-full rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-violet-300 disabled:opacity-50">
          {listBusy ? 'Loading…' : 'Load older conversations'}
        </button>}
      </div>
      <div className="min-h-64 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
        {!selected ? <p className="text-sm text-slate-500">Choose or create a conversation.</p> : <>
          <h3 className="font-semibold text-white">{selected.title}</h3>
          {hasOlder && <button type="button" disabled={olderBusy} onClick={loadOlder}
            className="mt-3 text-xs font-semibold text-violet-300 disabled:opacity-50">Load older messages</button>}
          <div className="mt-4 space-y-3" aria-live="polite">
            {!messages.length && <p className="text-sm text-slate-500">No messages yet.</p>}
            {messages.map(message => <div key={message.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">{message.role === 'assistant' ? 'Anka AI' : 'You'}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{message.body}</p>
            </div>)}
          </div>
          <form onSubmit={sendMessage} className="mt-5 space-y-2 border-t border-slate-800 pt-4">
            <label htmlFor="private-conversation-message" className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your message</label>
            <textarea id="private-conversation-message" className={INPUT} rows={3} maxLength={8000}
              value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); drafts.current.set(conversationId, event.target.value); pendingRequests.current.delete(conversationId) }}
              placeholder="Capture an idea, question, or direction for this private conversation." />
            <button className={BUTTON} disabled={busy || !draft.trim()}>Save message</button>
          </form>
        </>}
      </div>
    </div>
  </section>
}
