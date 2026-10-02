import { preferredApprovedModel, openAiModelLabel } from '../data/openaiModelPolicy.js'
import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import TextAiConsent, { useTextAiConsent } from './TextAiConsent.jsx'
import { textAiConsentKey } from '../data/textAiConsent.js'
import { departmentChat } from '../data/departmentChatRepository.js'
import { integrations } from '../data/integrationRepository.js'
import { contextChatRunner } from '../data/contextChatRunnerRepository.js'
import { clearDirectChatRecovery, directChatRecoveryKey, readDirectChatRecovery, writeDirectChatRecovery } from '../data/directChatRecovery.js'
import { clearDirectChatDraft, readDirectChatDraft, writeDirectChatDraft } from '../data/directChatDraft.js'
import { WorkshopChatHistoryContext } from '../context/WorkshopChatHistoryContext.jsx'
import './directContextChat.css'
const PrivateDesignVideoTools = lazy(() => import('./PrivateDesignVideoTools.jsx'))
function VideoWorkbenchReady({ onReady }) { useEffect(onReady, [onReady]); return null }

export default function DirectContextChat({ contextKind, departmentId, projectId, label, organizationId, user, signal, onAccessError, initialConversation, onConversationListChange, onNavigationBusyChange, onDraftDirtyChange }) {
  const workshopHistory = useContext(WorkshopChatHistoryContext)
  const hasExternalHistory = Boolean(workshopHistory)
  const actorId = user.id
  const scope = useMemo(() => ({ context_kind: contextKind, ...(departmentId ? { department_id: departmentId } : {}), ...(projectId ? { project_id: projectId } : {}) }), [contextKind, departmentId, projectId])
  const requestScope = useMemo(() => ({ organizationId, signal }), [organizationId, signal])
  const recoveryKey = directChatRecoveryKey(actorId, organizationId, contextKind, projectId, departmentId)
  const initial = useRef({ conversation: initialConversation, recovery: readDirectChatRecovery(recoveryKey), draft: readDirectChatDraft(recoveryKey) }).current
  const restoredDraft = !initial.conversation || initial.conversation.id === initial.draft?.conversation_id ? initial.draft : null
  const [newId, setNewId] = useState(() => initial.recovery?.conversation_id || restoredDraft?.new_conversation_id || crypto.randomUUID())
  const [selected, setSelected] = useState(null)
  const [rows, setRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState(restoredDraft?.text || '')
  const [models, setModels] = useState([])
  const [modelId, setModelId] = useState('')
  const [readiness, setReadiness] = useState(null)
  const [canonical, setCanonical] = useState(false)
  const [pending, setPending] = useState(initial.recovery)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(initial.recovery ? 'Checking the previous send. Your draft stays in this browser tab during recovery.' : '')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [historyOpen, setHistoryOpen] = useState(() => globalThis.matchMedia?.('(min-width: 901px)').matches ?? true)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [outputId, setOutputId] = useState('')
  const [rename, setRename] = useState('')
  const [sharing, setSharing] = useState(null)
  const [recipients, setRecipients] = useState([])
  const [shareOpen, setShareOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [videoOpened, setVideoOpened] = useState(false)
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoDirty, setVideoDirty] = useState(false)
  const videoLock = useRef(false), videoPane = useRef(null), videoButton = useRef(null), activePrivateConversation = useRef(null), videoVisible = useRef(false)
  activePrivateConversation.current = selected
  videoVisible.current = videoOpen
  const privateDesign = contextKind === 'department_private' && departmentId === 'design'
  const [hasOlder, setHasOlder] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const rootRef = useRef(null)
  const drawerRef = useRef(null), historyButtonRef = useRef(null), replyButtonRef = useRef(null)
  const [mobileDrawer, setMobileDrawer] = useState(() => globalThis.matchMedia?.('(max-width: 900px)').matches ?? false)
  const drawerOpen = mobileDrawer && Boolean(historyOpen || outputId)
  const alive = useRef(true)
  const lock = useRef(false)
  const revision = useRef(0)
  const pendingRef = useRef(initial.recovery)
  const attempt = useRef(restoredDraft?.attempt && restoredDraft.attempt.client_request_id === initial.recovery?.client_request_id && restoredDraft.attempt.conversation_id === initial.recovery?.conversation_id ? restoredDraft.attempt : null)
  const drafts = useRef(new Map())
  const historyClose = useRef(null)
  const outputClose = useRef(null)
  const current = () => alive.current && !signal.aborted
  const owner = !selected || selected.owner_id === actorId
  const reportVideoBusy = useCallback(value => { videoLock.current = Boolean(value); setVideoBusy(Boolean(value)) }, [])
  const checkPrivateVideoContext = useCallback(async exactId => {
    if (!alive.current || signal.aborted || contextKind !== 'department_private' || departmentId !== 'design' || activePrivateConversation.current?.id !== exactId || lock.current || pendingRef.current) throw new Error('Private video context changed')
    const result = await departmentChat.getContextConversation({ conversation_id: exactId }, { organizationId, signal })
    const row = result.conversation
    if (!alive.current || signal.aborted || activePrivateConversation.current?.id !== exactId || lock.current || pendingRef.current || row?.id !== exactId || row.owner_id !== actorId || row.organization_id !== organizationId || row.context_kind !== 'department_private' || row.department_id !== 'design' || row.project_id || row.engagement_id || row.state !== 'active') throw new Error('Private video context is unavailable')
  }, [signal, contextKind, departmentId, organizationId, actorId])
  const focusVideoPane = useCallback(() => {
    if (!videoOpen) return
    videoPane.current?.querySelector?.('button')?.focus?.({ preventScroll: true })
    videoPane.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
  }, [videoOpen])

  const model = models.find(row => row.id === modelId)
  const ready = readiness?.model_configuration_id === modelId && readiness?.paid_execution_enabled === true
    && readiness?.spend_tracking_configured === true && readiness?.model_status === 'configured'
  const canCanonical = model?.provider === 'openai' && contextKind === 'project_team'
  const consent = useTextAiConsent(textAiConsentKey({ userId: actorId, organizationId, contextKind, departmentId, projectId,
    conversationId: selected?.id || newId, connectionId: model?.connectionId, provider: model?.provider,
    canonical: canonical && canCanonical, recipients: sharing?.recipients.map(row => row.recipient_id) || [] }))

  const validConversation = useCallback(row => Boolean(row && row.context_kind === contextKind
    && (!row.organization_id || row.organization_id === organizationId)
    && (row.project_id || '') === (projectId || '') && (row.department_id || '') === (departmentId || '')
    && !row.engagement_id && (contextKind === 'project_team' || row.owner_id === actorId)), [contextKind, organizationId, projectId, departmentId, actorId])
  const read = useCallback(async (id, requestId) => {
    let result = await departmentChat.getContextConversation({ conversation_id: id }, requestScope)
    if (!validConversation(result.conversation) || result.conversation.id !== id) throw new Error('Conversation context changed')
    // Recovery must find the exact request even if a shared conversation grew while away.
    let all = result.messages || []
    while (requestId && !all.some(row => row.client_request_id === requestId) && result.has_older && all.length) {
      const cursor = all[0].sequence
      result = await departmentChat.getContextConversation({ conversation_id: id, before_sequence: cursor }, requestScope)
      if (!validConversation(result.conversation) || result.conversation.id !== id) throw new Error('Conversation context changed')
      if (!result.messages?.length || result.messages[0].sequence >= cursor) throw new Error('History recovery cursor did not advance')
      all = [...result.messages, ...all]
    }
    const sharing = contextKind === 'project_team' && result.conversation.owner_id === actorId
      ? await departmentChat.getProjectContextSharing({ conversation_id: id }, requestScope) : null
    return { ...result, messages: all, sharing }
  }, [requestScope, validConversation, contextKind, actorId])
  const apply = useCallback(result => {
    setSelected(result.conversation); setRename(result.conversation.title)
    setMessages(result.messages || []); setHasOlder(Boolean(result.has_older))
    setSharing(result.sharing || null)
    setRows(previous => [result.conversation, ...previous.filter(row => row.id !== result.conversation.id)])
  }, [])
  function remember(value) {
    writeDirectChatRecovery(recoveryKey, value)
    pendingRef.current = value; setPending(value)
  }
  function clearPending() {
    clearDirectChatRecovery(recoveryKey); clearDirectChatDraft(recoveryKey)
    pendingRef.current = null; setPending(null); attempt.current = null
  }
  function report(reason) {
    if (!current()) return
    onAccessError?.(reason)
    setError(reason.message || 'Chat request failed')
  }
  async function exclusive(action) {
    if (lock.current || videoLock.current || !current()) return
    lock.current = true; setBusy(true); setError('')
    try { await action() } catch (reason) { report(reason) }
    finally { lock.current = false; if (current()) setBusy(false) }
  }
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!historyOpen) return
    const previous = document.activeElement
    historyClose.current?.focus()
    return () => previous?.focus?.()
  }, [historyOpen])
  useEffect(() => {
    if (!outputId) return
    const previous = document.activeElement
    outputClose.current?.focus()
    return () => previous?.focus?.()
  }, [outputId])
  useEffect(() => { onDraftDirtyChange?.(Boolean(draft.trim()) || videoDirty); return () => onDraftDirtyChange?.(false) }, [draft,videoDirty,onDraftDirtyChange])
  useEffect(() => {
    onNavigationBusyChange?.(busy || Boolean(pending) || videoBusy)
    return () => onNavigationBusyChange?.(false)
  }, [busy, pending, videoBusy, onNavigationBusyChange])
  useEffect(() => {
    let active = true
    if (!hasExternalHistory) departmentChat.listContextConversations(scope, requestScope).then(result => {
      if (!active || signal.aborted) return
      setRows(result.slice(0, 50).filter(validConversation)); setOffset(Math.min(result.length, 50)); setHasMore(result.length > 50)
    }).catch(reason => { if (active && !signal.aborted) setError(reason.message) })
      .finally(() => { if (active && !signal.aborted) setHistoryLoading(false) })
    else setHistoryLoading(false)
    integrations.listModelAllowlist(organizationId, { signal }).then(result => {
      if (!active || signal.aborted) return
      const options = (result.connections || []).filter(connection => connection.organization_level && connection.status === 'verified')
        .flatMap(connection => (connection.context_model_configurations || []).map(item => ({ id: item.id, model_id: item.model_id, label: openAiModelLabel(item.model_id),
          provider: connection.provider, connectionId: connection.id, connectionName: connection.display_name || connection.provider })))
      setModels(options); setModelId(previous => options.some(row => row.id === previous) ? previous
        : preferredApprovedModel(options, contextKind === 'department_private' ? 'substantive' : 'routine')?.id || '')
    }).catch(reason => { if (active && !signal.aborted) setError(reason.message) })
    return () => { active = false }
  }, [scope, requestScope, organizationId, signal, validConversation, hasExternalHistory, contextKind])
  useEffect(() => {
    let active = true
    setReadiness(null)
    departmentChat.getContextChatReadiness({ model_configuration_id: modelId }, requestScope).then(result => {
      if (active && !signal.aborted) setReadiness({ ...result, model_configuration_id: modelId })
    }).catch(reason => { if (active && !signal.aborted) setError(reason.message) })
    return () => { active = false }
  }, [modelId, requestScope, signal])
  useEffect(() => {
    let active = true
    const target = initial.recovery?.conversation_id || initial.conversation?.id || restoredDraft?.conversation_id
    if (!target) return
    lock.current = true; setBusy(true)
    ;(async () => {
      const result = await read(target, initial.recovery?.client_request_id)
      if (!active || signal.aborted) return
      apply(result)
      const human = result.messages.find(row => row.client_request_id === initial.recovery?.client_request_id && row.author_id === actorId)
      if (!initial.recovery || !human) return
      if (initial.recovery.dispatch_request_id) {
        const recovered = await contextChatRunner.recover(human.id, requestScope)
        if (!active || signal.aborted) return
        if (recovered.status !== 'completed') throw new Error('Reply outcome is uncertain. Check recovery again; no new AI request was sent.')
        const latest = await read(target)
        if (!active || signal.aborted) return
        apply(latest)
      }
      clearDirectChatRecovery(recoveryKey); pendingRef.current = null; setPending(null); attempt.current = null; setDraft(''); clearDirectChatDraft(recoveryKey)
      setNotice('Previous send recovered from saved messages. No new AI request was sent.')
    })().catch(reason => {
      if (active && !signal.aborted) { onAccessError?.(reason); setError(reason.message); setNotice('Check recovery before sending again. Your scoped draft remains available in this browser tab for one hour.') }
    }).finally(() => { if (active && !signal.aborted) { lock.current = false; setBusy(false) } })
    return () => { active = false }
  }, [initial, read, apply, actorId, requestScope, signal, recoveryKey, onAccessError, restoredDraft?.conversation_id])

  useEffect(() => {
    const root = rootRef.current
    if (!globalThis.innerHeight || !root?.getBoundingClientRect) return
    const fit = () => { if (videoVisible.current) return; root.style.setProperty('--direct-chat-height', `${Math.max(360, Math.min(760, innerHeight - root.getBoundingClientRect().top - 16))}px`) }
    fit(); globalThis.addEventListener('resize', fit)
    const observer = globalThis.ResizeObserver ? new ResizeObserver(fit) : null
    observer?.observe(root.parentElement)
    return () => { globalThis.removeEventListener('resize', fit); observer?.disconnect() }
  }, [])
  useEffect(() => {
    const media = globalThis.matchMedia?.('(max-width: 900px)')
    if (!media) return
    const update = () => setMobileDrawer(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!drawerOpen) return
    const trigger = outputId ? replyButtonRef.current : historyButtonRef.current
    drawerRef.current?.querySelector('button')?.focus()
    return () => { if (trigger?.isConnected) trigger.focus() }
  }, [drawerOpen, outputId])
  function drawerKeyDown(event) {
    if (!mobileDrawer) return
    if (event.key === 'Escape') { event.preventDefault(); setHistoryOpen(false); setOutputId(''); return }
    if (event.key !== 'Tab') return
    const nodes = [...drawerRef.current.querySelectorAll('button:not(:disabled), input, select, textarea, [tabindex="0"]')]
    const first = nodes[0], last = nodes.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  async function openConversation(row) {
    if (lock.current || videoLock.current || pendingRef.current) return
    if (videoDirty) { setError('Clear the unsent video prompt before opening another chat.'); return }
    await exclusive(async () => {
      const token = ++revision.current
      drafts.current.set(selected?.id || newId, draft)
      setVideoOpen(false); setVideoOpened(false)
      setMessages([]); setSelected(null); setDraft(''); setNewId(crypto.randomUUID()); setOutputId(''); setSharing(null); setShareOpen(false); setCanonical(false)
      const result = await read(row.id)
      if (!current() || token !== revision.current) return
      apply(result); const text = drafts.current.get(row.id) || ''; setDraft(text); writeDirectChatDraft(recoveryKey, { new_conversation_id: newId, conversation_id: row.id, text, attempt: null }); if (globalThis.matchMedia?.('(max-width: 900px)').matches) setHistoryOpen(false)
    })
  }
  function newChat() {
    if (lock.current || videoLock.current || pendingRef.current) return
    if (videoDirty) { setError('Clear the unsent video prompt before starting a new chat.'); return }
    clearDirectChatDraft(recoveryKey)
    drafts.current.set(selected?.id || newId, draft)
    setVideoOpen(false); setVideoOpened(false)
    revision.current++; setNewId(crypto.randomUUID()); setSelected(null); setMessages([]); setDraft('')
    setOutputId(''); setCanonical(false); setSharing(null); setShareOpen(false); setHistoryOpen(false); setNotice(''); setError('')
  }
  async function send(event) {
    event.preventDefault()
    if (!draft.trim() || draft.trim().length > 8000 || pendingRef.current || selected?.state && selected.state !== 'active') return
    await exclusive(async () => {
      const text = draft.trim(), target = selected?.id || newId, token = revision.current
      const ai = owner && ready
      // Recheck current access and sharing before opening the unchanged disclosure.
      if (selected) {
        const latest = await read(target)
        if (!current() || token !== revision.current) return
        if (latest.conversation.state !== 'active' || latest.conversation.owner_id !== selected.owner_id) throw new Error('Conversation access changed')
        if (owner && contextKind === 'project_team') {
          const latestSharing = latest.sharing
          const ids = value => (value?.recipients || []).map(row => row.recipient_id).sort().join(',')
          setSharing(latestSharing)
          if (ids(latestSharing) !== ids(sharing)) throw new Error('Sharing has changed. Review Share, then send again to confirm the new scope.')
        }
      }
      if (ai && !await consent.confirm()) return
      if (!current() || token !== revision.current) return
      const metadata = { conversation_id: target, client_request_id: crypto.randomUUID(), ...(ai ? { dispatch_request_id: crypto.randomUUID() } : {}) }
      remember({ conversation_id: target, client_request_id: metadata.client_request_id })
      attempt.current = { text, isNew: !selected, conversation_id: target, client_request_id: metadata.client_request_id }
      writeDirectChatDraft(recoveryKey, { new_conversation_id: newId, conversation_id: selected?.id || null, text: draft, attempt: attempt.current })
      let saved
      if (!selected) {
        const result = await departmentChat.startContextConversation({ ...scope, ...metadata, message: text }, requestScope)
        if (!current() || token !== revision.current) return
        if (!validConversation(result.conversation) || result.conversation.id !== target || result.conversation.owner_id !== actorId) throw new Error('Conversation identity mismatch')
        apply({ conversation: result.conversation, messages: [result.message] }); saved = result.message
      } else saved = await departmentChat.appendContextHumanMessage({ conversation_id: target, client_request_id: metadata.client_request_id, message: text }, requestScope)
      if (!current() || token !== revision.current) return
      remember({ ...metadata, message_id: saved.id })
      setMessages(previous => previous.some(row => row.id === saved.id) ? previous : [...previous, saved])
      onConversationListChange?.()
      if (ai) {
        const include = canonical && canCanonical
        setCanonical(false)
        const result = await contextChatRunner.run({ message_id: saved.id, model_configuration_id: modelId,
          dispatch_request_id: metadata.dispatch_request_id, include_canonical_context: include }, requestScope)
        if (!current() || token !== revision.current) return
        if (result.status !== 'completed') throw new Error('Reply outcome is uncertain. Check recovery; a second AI request will not be sent.')
      }
      const latest = await read(target)
      if (!current() || token !== revision.current) return
      apply(latest); clearPending(); setDraft(''); drafts.current.delete(target)
      setNotice(ai ? 'Reply saved.' : 'Message saved. No AI request was sent.')
    })
  }
  async function recover() {
    await exclusive(async () => {
      const record = pendingRef.current
      if (!record) return
      const token = revision.current
      let latest
      try { latest = await read(record.conversation_id, record.client_request_id) }
      catch (reason) { if (reason.status !== 404) throw reason }
      if (!current() || token !== revision.current) return
      let human = latest?.messages.find(row => row.client_request_id === record.client_request_id && row.author_id === actorId)
      if (!human && attempt.current) {
        // Only retry persistence, with the identical in-memory body and UUIDs.
        const input = { conversation_id: record.conversation_id, client_request_id: record.client_request_id, message: attempt.current.text }
        const saved = attempt.current.isNew
          ? await departmentChat.startContextConversation({ ...scope, ...input }, requestScope)
          : { message: await departmentChat.appendContextHumanMessage(input, requestScope) }
        human = saved.message
        if (!current() || token !== revision.current) return
        latest = await read(record.conversation_id, record.client_request_id)
      }
      if (!current() || token !== revision.current) return
      if (!human) throw new Error('The original message is not visible yet. Check again. The original draft is kept in this tab when available; no replacement AI request was sent.')
      apply(latest)
      if (record.dispatch_request_id) {
        const result = await contextChatRunner.recover(human.id, requestScope)
        if (!current() || token !== revision.current) return
        if (result.status !== 'completed') throw new Error('Reply not settled. No second AI request was sent. Check again later.')
        latest = await read(record.conversation_id)
        if (!current() || token !== revision.current) return
        apply(latest)
      }
      clearPending(); setDraft(''); setNotice('Send recovered. No new AI request was sent.'); onConversationListChange?.()
    })
  }
  async function loadSharing() {
    await exclusive(async () => {
      const result = await departmentChat.getProjectContextSharing({ conversation_id: selected.id }, requestScope)
      if (!current()) return
      setSharing(result); setRecipients(result.recipients.map(row => row.recipient_id)); setShareOpen(true)
    })
  }
  const output = messages.find(row => row.id === outputId && row.role === 'assistant' && row.status === 'completed')
  return <><section ref={rootRef} className={`direct-chat ${historyOpen ? 'history-open' : ''} ${output ? 'output-open' : ''}`} aria-label={label} onKeyDown={event => {
    if (event.key === 'Escape' && !consent.dialog) { setHistoryOpen(false); setOutputId(''); setShareOpen(false); setDetailsOpen(false) }
  }}>
    <header className="direct-chat-header" inert={drawerOpen ? true : undefined}><div><h2>{label}</h2><p>{selected?.title || 'New chat'} · {contextKind === 'department_private' ? 'Only you' : sharing?.recipients.length ? 'Shared with selected teammates' : 'Private unless explicitly shared'}</p></div>
      <div className="direct-chat-actions">{privateDesign && <button ref={videoButton} type="button" disabled={busy || videoBusy || Boolean(pending) || !selected || !owner || selected.state !== 'active'} title={!selected ? "Send a message to save this private chat before opening video tools." : undefined} aria-expanded={videoOpen} onClick={() => { if (lock.current || videoLock.current || pendingRef.current) return; setVideoOpen(!videoOpen); setVideoOpened(true) }}>Video tools</button>}<button type="button" ref={historyButtonRef} aria-expanded={historyOpen} onClick={() => { setOutputId(''); setHistoryOpen(!historyOpen) }}>History</button>{!historyOpen && <button type="button" disabled={busy || videoBusy || Boolean(pending)} onClick={newChat}>New chat</button>}<button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>Details</button>
        {selected && owner && contextKind === 'project_team' && <button type="button" disabled={busy || videoBusy} onClick={loadSharing}>Share</button>}</div>
    </header>
    {consent.dialog && <TextAiConsent {...consent.dialog} provider={model?.provider} model={`${model?.connectionName} · ${model?.label}`} scope={`${contextKind} conversation`} canonical={canonical && canCanonical} />}
    {error && <p role="alert" className="direct-chat-error">{error}</p>}
    {notice && !pending && <p role="status" className="direct-chat-notice">{notice}</p>}
    {pending && <div className="direct-chat-notice direct-chat-recovery"><p>Check this send before sending again. Recovery never requests another AI reply.</p><button type="button" disabled={busy || videoBusy} onClick={recover}>Check recovery</button></div>}
    {detailsOpen && <aside className="direct-chat-details" aria-label="Chat details">
      <p>Attachments are unavailable in this chat. Drafts stay only in this browser tab for up to one hour, including refresh; successful Send clears the draft. Closing this tab ends local draft recovery.</p>
      <p>AI replies are organization-billed. The service rechecks model approval, exact pricing, spend tracking and access before dispatch.</p>
      <p>{!readiness ? 'Checking AI availability…' : ready ? 'AI configuration ready.' : `AI unavailable (${readiness.model_status || 'configuration unavailable'}). You can save a human message.`}</p>
      {readiness?.paid_execution_enabled === false && <p>AI execution is currently off.</p>}
      {readiness?.spend_tracking_configured === false && <p>Organization spend tracking is not configured.</p>}
      {readiness?.spend_guard_mode === 'provider_managed' && <p>Your provider-side spend limit is managed externally. Anka cannot verify or enforce it; each request is still priced and recorded.</p>}
      {contextKind === 'project_team' && <p>Shared collaborators can reply as humans. Only the owner can request AI. Teammate-authored messages are not sent to a provider; a request that would include one is blocked.</p>}
      {owner && canCanonical && <label><input type="checkbox" checked={canonical} disabled={busy || videoBusy || !ready} onChange={event => setCanonical(event.target.checked)} />For this reply, also send OpenAI the current organization name and this project’s name, description, status, health, scope, and exclusions, plus a bounded sample of accessible project names, status and health, task and work-item titles, status, deadlines and assignee display names, sampled progress counts, and review-state counts. Record IDs, emails, contact details, descriptions of tasks or work items, files, transcripts, private memory, and teammate messages are excluded. The sample may be incomplete.</label>}
      {selected && owner && <form onSubmit={event => { event.preventDefault(); exclusive(async () => {
        const updated = await departmentChat.renameContextConversation({ conversation_id: selected.id, title: rename.trim() }, requestScope)
        if (!current()) return
        setSelected(updated); setRows(previous => previous.map(row => row.id === updated.id ? updated : row)); onConversationListChange?.()
      }) }}><label>Rename chat<input aria-label="Rename chat" maxLength={160} value={rename} onChange={event => setRename(event.target.value)} /></label><button disabled={busy || videoBusy || !rename.trim()}>Save name</button></form>}
    </aside>}
    {shareOpen && sharing && <aside className="direct-chat-details" aria-label="Share chat"><h3>Share this project conversation</h3><p>Only selected active internal teammates can see all current and future messages and reply. Sharing does not grant AI use, approval, or project record changes. Revoking stops later reads and replies; it cannot recall copies already seen.</p>
      {sharing.candidates.map(row => <label key={row.id}><input type="checkbox" disabled={busy || videoBusy} checked={recipients.includes(row.id)} onChange={event => setRecipients(previous => event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id))} />{row.full_name || row.id}</label>)}
      <button type="button" disabled={busy || videoBusy} onClick={() => exclusive(async () => {
        await departmentChat.setProjectContextSharing({ conversation_id: selected.id, recipient_ids: recipients }, requestScope)
        if (!current()) return
        const result = await departmentChat.getProjectContextSharing({ conversation_id: selected.id }, requestScope)
        if (current()) { setSharing(result); setShareOpen(false) }
      })}>Save sharing</button><button type="button" onClick={() => setShareOpen(false)}>Close sharing</button></aside>}
    <div className="direct-chat-layout">
      {historyOpen && <aside ref={historyOpen && mobileDrawer ? drawerRef : undefined} className="direct-chat-history" role={mobileDrawer ? 'dialog' : undefined} aria-modal={mobileDrawer ? true : undefined} aria-label="Chat history" onKeyDown={drawerKeyDown}>{mobileDrawer && <button ref={historyClose} type="button" onClick={() => setHistoryOpen(false)}>Close history</button>}<button type="button" disabled={busy || videoBusy || Boolean(pending)} onClick={newChat}>New chat</button>{workshopHistory ? workshopHistory.render(item => { if (!lock.current && !videoLock.current && !pendingRef.current) workshopHistory.onOpen(item); if (mobileDrawer) setHistoryOpen(false) }) : <><label>Search loaded chats<input aria-label="Search loaded chats" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {rows.filter(row => row.title.toLowerCase().includes(search.toLowerCase())).map(row => <button type="button" key={row.id} disabled={busy || videoBusy || Boolean(pending)} aria-pressed={selected?.id === row.id} onClick={() => openConversation(row)}>{row.title}</button>)}
        {historyLoading ? <p role="status">Loading history…</p> : !rows.length && <p>No saved chats yet.</p>}{hasMore && <button type="button" disabled={busy || videoBusy} onClick={() => exclusive(async () => {
          const result = await departmentChat.listContextConversations({ ...scope, offset }, requestScope)
          if (!current()) return
          setRows(previous => [...previous, ...result.slice(0, 50).filter(validConversation).filter(row => !previous.some(item => item.id === row.id))]); setOffset(offset + Math.min(result.length, 50)); setHasMore(result.length > 50)
        })}>Load older chats</button>}</>}</aside>}
      <div className="direct-chat-main" inert={drawerOpen ? true : undefined}><div className="direct-chat-messages" aria-label="Chat messages" aria-busy={busy}><div className="direct-chat-message-stream">
        {!messages.length && <div className="direct-chat-empty"><h3>What would you like to work on?</h3><p>Start with a message. This chat is saved when you send.</p></div>}
        {hasOlder && <button type="button" disabled={busy || videoBusy} onClick={() => exclusive(async () => {
          const result = await departmentChat.getContextConversation({ conversation_id: selected.id, before_sequence: messages[0].sequence }, requestScope)
          if (!current()) return
          if (!validConversation(result.conversation) || result.conversation.id !== selected.id) throw new Error('Conversation context changed')
          setMessages(previous => [...result.messages, ...previous]); setHasOlder(result.has_older)
        })}>Load older messages</button>}
        {messages.map(message => <article key={message.id} className={`direct-chat-message ${message.role}`}><strong>{message.role === 'assistant' ? 'Anka AI' : message.author_id === actorId ? 'You' : 'Teammate'}</strong><p>{message.body}</p>{message.role === 'assistant' && message.status === 'completed' && <button type="button" onClick={event => { replyButtonRef.current = event.currentTarget; if (mobileDrawer) setHistoryOpen(false); setOutputId(message.id) }}>Open reply</button>}</article>)}
      </div></div><form className="direct-chat-composer" onSubmit={send} aria-label="Chat composer"><label className="direct-chat-draft-label"><span className="sr-only">Message</span><textarea aria-label="Message" placeholder="Ask or explore an idea…" value={draft} maxLength={8000} disabled={busy || videoBusy || Boolean(pending)} onChange={event => { if (pendingRef.current) return; const text = event.target.value; setDraft(text); try { writeDirectChatDraft(recoveryKey, { new_conversation_id: newId, conversation_id: selected?.id || null, text, attempt: attempt.current }) } catch { setError('Draft recovery is unavailable in this tab. Keep this page open until your message is saved.') } }} /></label>
        <div className="direct-chat-toolbar"><label>Work type<select aria-label="Work type" value="text" disabled><option value="text">Text</option></select></label>
          {owner && <label>Model<select aria-label="Approved model" value={modelId} disabled={busy || videoBusy || !models.length} onChange={event => { setModelId(event.target.value); setCanonical(false) }}>{!modelId && <option value="">{models.length ? 'Choose a model' : 'Unavailable'}</option>}{models.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>}
          <button type="submit" className="direct-chat-send" disabled={busy || videoBusy || Boolean(pending) || !draft.trim() || Boolean(selected && selected.state !== 'active')}>{busy ? 'Working…' : owner && ready ? 'Send' : 'Save message'}</button></div>
        <p>{owner ? !readiness ? 'Checking AI availability. Human messages can still be saved.' : ready ? `${model?.provider} · Organization-billed replies` : 'AI unavailable. Sending saves a human message only.' : 'Shared chat · Human replies only'} · Attachments unavailable</p>
      </form></div>
      {output && <aside ref={outputId && mobileDrawer ? drawerRef : undefined} className="direct-chat-output" role={mobileDrawer ? 'dialog' : undefined} aria-modal={mobileDrawer ? true : undefined} onKeyDown={drawerKeyDown} aria-label="Saved reply output" data-source-message-id={output.id}><div><h3>Saved reply</h3><button ref={outputClose} type="button" onClick={() => setOutputId('')}>Close output</button></div><p>{output.body}</p><small>Saved conversation reply · Read-only preview</small></aside>}
    </div>
  </section>
    {privateDesign && videoOpened && selected && owner && <section ref={videoPane} hidden={!videoOpen} className="direct-chat-video workspace-card p-4 mt-3" aria-label="Private video workbench">
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Private video · {selected.title}</h3><button type="button" disabled={videoBusy} onClick={() => { if (videoLock.current) return; setVideoOpen(false); videoButton.current?.focus() }}>Back to chat</button></div>
      <p className="mt-2 text-xs text-[var(--anka-muted)]">Generate is a separate explicit action. Eligibility, verified pricing, spend, consent and private job recovery still apply. A project copy remains a separate authorized draft.</p>
      <Suspense fallback={<p role="status">Loading private video tools…</p>}><VideoWorkbenchReady onReady={focusVideoPane} /><PrivateDesignVideoTools key={selected.id} conversationId={selected.id} beforeGenerate={checkPrivateVideoContext} onNavigationBusyChange={reportVideoBusy} onDraftDirtyChange={setVideoDirty} /></Suspense>
    </section>}
  </>
}
