import { preferredApprovedModel, openAiModelLabel } from '../data/openaiModelPolicy.js'
import TextAiConsent, { useTextAiConsent } from './TextAiConsent.jsx'
import { textAiConsentKey } from '../data/textAiConsent.js'
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { departmentChat } from '../data/departmentChatRepository.js'
import { integrations } from '../data/integrationRepository.js'
import { contextChatRunner } from '../data/contextChatRunnerRepository.js'
import { contextChatTitleFromMessage } from '../data/contextChatTitle.js'
import DirectContextChat from './DirectContextChat.jsx'
const PrivateDesignVideoTools = lazy(() => import('./PrivateDesignVideoTools.jsx'))

const INPUT = 'w-full rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] px-3 py-2.5 text-sm text-[var(--anka-ink)] placeholder:text-[var(--anka-muted)] outline-none focus:border-[var(--anka-focus)]'
const BUTTON = 'rounded-xl bg-[var(--anka-violet)] px-4 py-2.5 text-sm font-semibold text-[var(--anka-on-violet)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
const PAGE_SIZE = 50
const MODEL_READINESS_MESSAGES = {
  model_not_selected: 'Select an approved organization model to use AI.',
  model_unavailable: 'The selected model is no longer approved. Refresh the conversation.',
  connection_unavailable: 'The selected organization connection is unavailable.',
  credential_unavailable: 'The selected connection credential is unavailable to the service.',
  price_unavailable: 'A fresh verified price for this exact model is unavailable.',
}

export default function ContextConversationPanel({ contextKind, departmentId = '', projectId = '', label = 'Conversation', workshopLayout = false, initialConversation = null, hideConversationList = false, onConversationListChange, onNavigationBusyChange, onDraftDirtyChange, directSend = false }) {
  const { user } = useAuth()
  const { activeOrganizationId, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  if (!user?.id || !activeOrganizationId || requestSignal.aborted) return null
  const identity = [user.id, activeOrganizationId, scopeRevision, contextKind, departmentId, projectId, initialConversation?.id || ''].join(':')
  if (directSend) return <DirectContextChat key={identity} contextKind={contextKind} departmentId={departmentId}
    projectId={projectId} label={label} organizationId={activeOrganizationId} user={user} signal={requestSignal}
    onAccessError={handleOrganizationAccessError} initialConversation={initialConversation}
    onConversationListChange={onConversationListChange} onNavigationBusyChange={onNavigationBusyChange} onDraftDirtyChange={onDraftDirtyChange} />
  return <ScopedContextConversation key={identity} contextKind={contextKind} departmentId={departmentId}
    projectId={projectId} label={label} organizationId={activeOrganizationId} user={user} signal={requestSignal}
    onAccessError={handleOrganizationAccessError} workshopLayout={workshopLayout} initialConversation={initialConversation} hideConversationList={hideConversationList} onConversationListChange={onConversationListChange} onNavigationBusyChange={onNavigationBusyChange} />
}

function ScopedContextConversation({ contextKind, departmentId, projectId, label, organizationId, user, signal, onAccessError, workshopLayout, initialConversation, hideConversationList, onConversationListChange, onNavigationBusyChange }) {
  const requestedConversation = useRef(initialConversation).current
  const scope = useMemo(() => ({ context_kind: contextKind, ...(departmentId ? { department_id: departmentId } : {}),
    ...(projectId ? { project_id: projectId } : {}) }), [contextKind, departmentId, projectId])
  const requestScope = useMemo(() => ({ organizationId, signal }), [organizationId, signal])
  const [conversations, setConversations] = useState([])
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [listBusy, setListBusy] = useState(false)
  const [conversationId, setConversationId] = useState('')
  const [assetType, setAssetType] = useState('text')
  const [videoOpened, setVideoOpened] = useState(false)
  const [videoActivity, setVideoActivity] = useState(null)
  const videoBusy = videoActivity?.conversationId === conversationId && videoActivity.busy
  const [messages, setMessages] = useState([])
  const [hasOlder, setHasOlder] = useState(false)
  const [title, setTitle] = useState('')
  const [renameTitle, setRenameTitle] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [conversationSearch, setConversationSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [olderBusy, setOlderBusy] = useState(false)
  const [modelOptions, setModelOptions] = useState([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [readiness, setReadiness] = useState(null)
  const [includeCanonicalContext, setIncludeCanonicalContext] = useState(false)
  const [aiBusyMessageId, setAiBusyMessageId] = useState('')
  const [aiNotice, setAiNotice] = useState('')
  const [error, setError] = useState('')
  const [sharing, setSharing] = useState({ candidates: [], recipients: [], loaded: false })
  const [shareSelection, setShareSelection] = useState([])
  const [shareBusy, setShareBusy] = useState(false)
  const pendingRequests = useRef(new Map())
  const dispatchRequests = useRef(new Map())
  const drafts = useRef(new Map())
  const activeConversation = useRef(conversationId)
  const listRevision = useRef(0)
  activeConversation.current = conversationId
  const reportVideoBusy = useCallback(value => {
    if (activeConversation.current === conversationId) setVideoActivity({ conversationId, busy: value })
  }, [conversationId])
  const checkPrivateVideoContext = useCallback(async exactId => {
    if (signal.aborted || activeConversation.current !== exactId || contextKind !== 'department_private' || departmentId !== 'design') throw new Error('Private video context changed')
    const result = await departmentChat.getContextConversation({ conversation_id: exactId }, { organizationId, signal })
    const row = result.conversation
    if (signal.aborted || activeConversation.current !== exactId || row?.id !== exactId || row.owner_id !== user.id || (row.organization_id && row.organization_id !== organizationId) || row.context_kind !== 'department_private' || row.department_id !== 'design' || row.project_id || row.state !== 'active') throw new Error('Private video context is unavailable')
  }, [signal, contextKind, departmentId, organizationId, user.id])
  const selectedOwnerId = conversations.find(row => row.id === conversationId)?.owner_id
  useEffect(() => {
    onNavigationBusyChange?.(!signal?.aborted && Boolean(busy || loading || historyBusy || olderBusy || listBusy || shareBusy || aiBusyMessageId || videoBusy))
    const clear = () => onNavigationBusyChange?.(false)
    signal?.addEventListener?.('abort', clear, { once: true })
    return () => { signal?.removeEventListener?.('abort', clear); clear() }
  }, [busy, loading, historyBusy, olderBusy, listBusy, shareBusy, aiBusyMessageId, videoBusy, onNavigationBusyChange, signal])

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
    setReadiness(null)
    departmentChat.getContextChatReadiness({ model_configuration_id: selectedModelId }, requestScope)
      .then(result => { if (current && !signal.aborted) setReadiness({ ...result, model_configuration_id: selectedModelId }) })
      .catch(reason => { if (current) showError(reason) })
    return () => { current = false }
  }, [requestScope, selectedModelId, signal, showError])

  useEffect(() => {
    let current = true
    const revision = ++listRevision.current
    setLoading(true)
    setError('')
    departmentChat.listContextConversations(scope, requestScope)
      .then(rows => {
        if (!current || signal.aborted || revision !== listRevision.current) return
        const page = (rows || []).slice(0, PAGE_SIZE)
        setConversations(requestedConversation && !page.some(row => row.id === requestedConversation.id) ? [...page, requestedConversation] : page)
        setHasMoreConversations((rows || []).length > PAGE_SIZE)
        setNextOffset(page.length)
        setConversationId(requestedConversation?.id || page[0]?.id || '')
      })
      .catch(reason => { if (current) showError(reason) })
      .finally(() => { if (current && !signal.aborted) setLoading(false) })
    return () => { current = false }
  }, [scope, requestScope, signal, showError, requestedConversation])

  useEffect(() => {
    setDraft(drafts.current.get(conversationId) || '')
    setAssetType('text'); setVideoOpened(false); setVideoActivity(null)
    setIncludeCanonicalContext(false)
    setSharing({ candidates: [], recipients: [], loaded: false })
    setShareSelection([])
    if (!conversationId) { setMessages([]); setHasOlder(false); setHistoryBusy(false); return }
    let current = true
    setHistoryBusy(true)
    setMessages([])
    setHasOlder(false)
    departmentChat.getContextConversation({ conversation_id: conversationId }, requestScope)
      .then(result => {
        if (!current || signal.aborted) return
        if (requestedConversation && result.conversation?.id !== conversationId) throw new Error('Selected conversation is unavailable')
        setMessages(result.messages || [])
        setHasOlder(Boolean(result.has_older))
      })
      .catch(reason => { if (current) { setMessages([]); if (requestedConversation) setConversationId(''); showError(reason) } })
      .finally(() => { if (current && !signal.aborted) setHistoryBusy(false) })
    return () => { current = false }
  }, [conversationId, requestScope, signal, showError, requestedConversation])

  useEffect(() => {
    if (contextKind !== 'project_team' || selectedOwnerId !== user.id) return
    let current = true
    departmentChat.getProjectContextSharing({ conversation_id: conversationId }, requestScope)
      .then(result => {
        if (!current || signal.aborted || activeConversation.current !== conversationId) return
        const candidates = result.candidates || []
        const eligible = new Set(candidates.map(candidate => candidate.id))
        setSharing({ candidates, recipients: result.recipients || [], loaded: true })
        setShareSelection((result.recipients || [])
          .map(recipient => recipient.recipient_id).filter(id => eligible.has(id)))
      })
      .catch(reason => { if (current) showError(reason) })
    return () => { current = false }
  }, [contextKind, conversationId, selectedOwnerId, requestScope, signal, showError, user.id])

  useEffect(() => {
    if (contextKind === 'project_team' && selectedOwnerId !== user.id) {
      setModelOptions([])
      setSelectedModelId('')
      return undefined
    }
    let current = true
    integrations.listModelAllowlist(organizationId, { signal })
      .then(result => {
        if (!current || signal.aborted) return
        const options = (result.connections || [])
          .filter(connection => connection.organization_level && connection.status === 'verified')
          .flatMap(connection => (connection.context_model_configurations || []).map(model => ({
            id: model.id, model_id: model.model_id, provider: connection.provider, connectionId: connection.id,
            label: `${connection.display_name || connection.provider} · ${openAiModelLabel(model.model_id)}`,
          })))
        setModelOptions(options)
        setIncludeCanonicalContext(false)
        setSelectedModelId(previous => options.some(option => option.id === previous)
          ? previous : preferredApprovedModel(options, contextKind === 'department_private' ? 'substantive' : 'routine')?.id || '')
      })
      .catch(reason => { if (current) showError(reason) })
    return () => { current = false }
  }, [contextKind, organizationId, selectedOwnerId, signal, showError, user.id])
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
    if (videoBusy) return
    setBusy(true); setError('')
    try {
      const created = await departmentChat.createContextConversation({
        ...scope, title: title.trim() || 'New conversation',
      }, requestScope)
      if (signal.aborted) return
      setTitle('')
      await refresh(created.id)
      onConversationListChange?.()
    } catch (reason) { showError(reason) } finally { if (!signal.aborted) setBusy(false) }
  }

  async function renameCurrentConversation(nextTitle = renameTitle) {
    const normalized = nextTitle.trim()
    if (!conversationId || !isOwner || !normalized || normalized.length > 160 || renameBusy) return
    const targetId = conversationId
    setRenameBusy(true); setError('')
    try {
      const updated = await departmentChat.renameContextConversation({
        conversation_id: targetId, title: normalized,
      }, requestScope)
      if (signal.aborted || activeConversation.current !== targetId) return
      setConversations(current => current.map(row => row.id === targetId ? { ...row, ...updated } : row))
      setRenameTitle(updated.title)
    } catch (reason) { showError(reason) }
    finally { if (!signal.aborted) setRenameBusy(false) }
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
      const firstSavedMessage = messages.length === 0
        && selected?.owner_id === user.id
        && selected.title === 'New conversation'
      if (firstSavedMessage) await renameCurrentConversation(contextChatTitleFromMessage(content))
      setDraft('')
      await refresh(targetId)
    } catch (reason) { showError(reason) } finally { if (!signal.aborted) setBusy(false) }
  }

  async function askAi(message, recoverOnly = false) {
    if (aiBusyMessageId || busy) return
    if (!recoverOnly && (!localAiChecksPass || !selectedModelId || !isOwner || selected?.state !== 'active' || message.author_id !== user.id)) return
    if (!recoverOnly && !await consent.confirm()) return
    if (signal.aborted || activeConversation.current !== conversationId) return
    const targetId = conversationId
    const savedRequest = dispatchRequests.current.get(message.id)
    const approvedGrounding = includeCanonicalContext
      && modelOptions.some(model => model.id === selectedModelId && model.provider === 'openai')
      && (contextKind === 'organization' || contextKind === 'project_team')
    const request = savedRequest?.modelId === selectedModelId
      && savedRequest?.includeCanonicalContext === approvedGrounding
      ? savedRequest : { id: crypto.randomUUID(), modelId: selectedModelId,
        includeCanonicalContext: approvedGrounding }
    if (!recoverOnly) {
      dispatchRequests.current.set(message.id, request)
      setIncludeCanonicalContext(false)
    }
    setAiBusyMessageId(message.id); setAiNotice(''); setError('')
    try {
      const result = recoverOnly
        ? await contextChatRunner.recover(message.id, requestScope)
        : await contextChatRunner.run({ message_id: message.id,
          model_configuration_id: request.modelId, dispatch_request_id: request.id,
          include_canonical_context: request.includeCanonicalContext }, requestScope)
      if (signal.aborted || activeConversation.current !== targetId) return
      if (result.status !== 'completed') {
        setAiNotice('No completed reply is available yet. A claimed request will not be submitted again.')
        return
      }
      const latest = await departmentChat.getContextConversation({ conversation_id: targetId }, requestScope)
      if (signal.aborted || activeConversation.current !== targetId) return
      setMessages(latest.messages || [])
      setHasOlder(Boolean(latest.has_older))
      dispatchRequests.current.delete(message.id)
      setAiNotice('Audited reply saved in this private conversation.')
    } catch (reason) {
      if (signal.aborted || activeConversation.current !== targetId) return
      if (reason.outcome === 'charged_without_reply') {
        setAiNotice('Provider billing was confirmed but no reply was saved. Start a new message for another attempt.')
      } else if (reason.outcome === 'not_settled') {
        setAiNotice('No saved AI reply is available for this message yet.')
      } else if (reason.mustNotSubmit) {
        setAiNotice('No second provider request will be sent. Check again later or ask an operator to review the uncertain outcome.')
      } else showError(reason)
    } finally { if (!signal.aborted) setAiBusyMessageId('') }
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

  async function saveSharing() {
    if (shareBusy || !sharing.loaded || !conversationId) return
    const targetId = conversationId
    setShareBusy(true); setError('')
    try {
      await departmentChat.setProjectContextSharing({
        conversation_id: targetId, recipient_ids: shareSelection,
      }, requestScope)
      if (signal.aborted || activeConversation.current !== targetId) return
      const result = await departmentChat.getProjectContextSharing({
        conversation_id: targetId,
      }, requestScope)
      if (signal.aborted || activeConversation.current !== targetId) return
      const candidates = result.candidates || []
      const eligible = new Set(candidates.map(candidate => candidate.id))
      setSharing({ candidates, recipients: result.recipients || [], loaded: true })
      setShareSelection((result.recipients || [])
        .map(recipient => recipient.recipient_id).filter(id => eligible.has(id)))
    } catch (reason) { if (activeConversation.current === targetId) showError(reason) }
    finally { if (!signal.aborted) setShareBusy(false) }
  }

  const selected = conversations.find(row => row.id === conversationId)
  useEffect(() => { setRenameTitle(selected?.title || '') }, [selected?.id, selected?.title])
  const selectedModel = modelOptions.find(model => model.id === selectedModelId)
  const paidExecutionEnabled = readiness?.paid_execution_enabled === true
  const localAiChecksPass = paidExecutionEnabled && readiness?.model_configuration_id === selectedModelId
    && readiness?.spend_tracking_configured === true
    && readiness?.model_status === 'configured'
  const canIncludeCanonicalContext = selectedModel?.provider === 'openai'
    && (contextKind === 'organization' || contextKind === 'project_team')
  const consent = useTextAiConsent(textAiConsentKey({ userId: user.id, organizationId, departmentId, projectId, contextKind, conversationId, connectionId: selectedModel?.connectionId, provider: selectedModel?.provider, canonical: includeCanonicalContext, recipients: sharing.recipients.map(row => row.recipient_id || row.user_id || row.id) }))
  const isOwner = selected?.owner_id === user.id
  const description = contextKind === 'department_private'
    ? 'Only you can see these conversations. AI replies require an approved model, configured spend tracking, and enabled paid execution.'
    : contextKind === 'organization'
      ? 'Only you can see this organization conversation. AI replies require an approved model, configured spend tracking, and enabled paid execution.'
      : 'Project conversations start private. You can choose active internal teammates to read and reply; AI replies remain creator-controlled.'
  const compact = workshopLayout && contextKind === 'department_private' && ['design', 'content', 'marketing'].includes(departmentId)
  const Navigation = compact ? 'details' : Fragment
  const modelControls = isOwner && <div className={compact ? "private-composer-toolbar" : "mt-3 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-3"}>
            <label htmlFor="organization-conversation-model" className="block text-xs font-semibold uppercase tracking-wide text-[var(--anka-muted)]">Approved private conversation AI model</label>
            <select id="organization-conversation-model" className={`${INPUT} mt-2`} value={selectedModelId}
              onChange={event => { if (consent.dialog) return; setSelectedModelId(event.target.value); setIncludeCanonicalContext(false) }} disabled={Boolean(consent.dialog) || Boolean(aiBusyMessageId) || !modelOptions.length}>
              {!modelOptions.length && <option value="">No approved model available</option>}
              {modelOptions.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
            {workshopLayout && <p role="status" className="mt-2 text-xs text-[var(--anka-ink)]">{!readiness ? 'Checking AI availability…' : localAiChecksPass ? 'AI configuration ready; sharing confirmation is requested when the scope changes.' : 'AI unavailable; you can still save messages.'}</p>}
            <details open={!workshopLayout} className="mt-2 text-xs text-[var(--anka-muted)]"><summary>AI availability details</summary>
            <p className="mt-2 text-xs text-[var(--anka-muted)]">AI replies use the approved organization-level provider connection and are priced and recorded for the organization. {paidExecutionEnabled ? 'The service still rechecks approval, exact pricing, spend tracking and the original request before dispatch.' : 'AI execution is currently off; saved human messages remain available.'}</p>
            {!readiness && <p className="mt-2 text-xs text-[var(--anka-muted)]">Checking AI configuration…</p>}
            {readiness?.spend_tracking_configured === false && <p className="mt-2 text-xs text-[var(--anka-warning)]">Organization spend tracking is not configured.</p>}
            {readiness?.spend_guard_mode === 'provider_managed' && <p className="mt-2 text-xs text-[var(--anka-warning)]">Your provider-side spend limit is managed externally. Anka cannot verify or enforce it; each request is still priced and recorded.</p>}
            {readiness?.model_status && readiness.model_status !== 'configured' && <p className="mt-2 text-xs text-[var(--anka-warning)]">{MODEL_READINESS_MESSAGES[readiness.model_status] || 'Model readiness is unavailable.'}</p>}
            {contextKind === 'project_team' && <p className="mt-2 text-xs text-[var(--anka-muted)]">Teammate-authored messages are not sent to a provider. If a requested reply would include one, the request is blocked before reserving a spend record.</p>}
            </details>
            <p className="mt-3 text-xs">Provider: {selectedModel?.provider || 'Unavailable'} · {selectedModel?.label || 'No model selected'}. Organization-billed text replies; sharing confirmation is requested when needed.</p>
            {canIncludeCanonicalContext && <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--anka-ink)]">
              <input type="checkbox" className="mt-1" checked={includeCanonicalContext}
                onChange={event => setIncludeCanonicalContext(event.target.checked)}
                disabled={!localAiChecksPass || Boolean(aiBusyMessageId)} />
              <span>For this Ask AI reply, also send OpenAI the current organization name{contextKind === 'project_team'
                ? ' and this project’s name, description, status, health, scope, and exclusions' : ''}, plus a bounded sample of accessible project names, status and health, task and work-item titles, status, deadlines and assignee display names, sampled progress counts, and review-state counts. Record IDs, emails, contact details, descriptions of tasks or work items, files, transcripts, private memory, and teammate messages are excluded. The sample may be incomplete.</span>
            </label>}
          </div>
  return <section className={compact ? "design-private-conversation" : "rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5"} aria-label={label}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-[var(--anka-ink)]">{label}</h2>
        <p className="mt-1 text-sm text-[var(--anka-muted)]">{description}</p></div>
    </div>
    {consent.dialog && <TextAiConsent {...consent.dialog} provider={selectedModel?.provider} model={selectedModel?.label} scope={`${contextKind} conversation`} canonical={includeCanonicalContext && canIncludeCanonicalContext} />}
    {error && <p role="alert" className="mt-4 rounded-xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] px-3 py-2 text-sm text-[var(--anka-danger)]">{error}</p>}
    {aiNotice && <p role="status" className="mt-4 rounded-xl border border-[var(--anka-warning)] bg-[var(--anka-warning-soft)] px-3 py-2 text-sm text-[var(--anka-warning)]">{aiNotice}</p>}
    <div className={`mt-5 grid gap-4 ${hideConversationList ? '' : 'lg:grid-cols-[220px_minmax(0,1fr)]'}`}>
      <div className="space-y-3" aria-label="Conversation navigation">
    <Navigation {...(compact ? { className: 'private-new-conversation' } : {})}>
      {compact && <summary>New conversation</summary>}
    <form onSubmit={createConversation} className="flex flex-wrap gap-2">
      <input className={`${INPUT} min-w-52 flex-1`} aria-label="Optional conversation title" placeholder="Optional title; first message can title it"
        maxLength={160} value={title} onChange={event => setTitle(event.target.value)} />
      <button className={BUTTON} disabled={busy || loading || videoBusy}>New conversation</button>
      <span className="self-center text-xs text-[var(--anka-muted)]">Leave the title blank to use your first saved message.</span>
    </form>
    </Navigation>
      {!hideConversationList && <div className="space-y-2" aria-label="Saved conversations">
        <h3 className="text-sm font-semibold text-[var(--anka-ink)]">Recent conversations</h3>
        <input className={INPUT} aria-label="Search loaded conversations" placeholder="Search loaded conversations" value={conversationSearch} onChange={event => setConversationSearch(event.target.value)} />
        {loading && <p className="text-sm text-[var(--anka-muted)]">Loading conversations…</p>}
        {!loading && !conversations.length && <p className="text-sm text-[var(--anka-muted)]">No conversations yet.</p>}
        {conversationSearch && !conversations.some(row => row.title.toLowerCase().includes(conversationSearch.toLowerCase())) && <p className="text-xs text-[var(--anka-muted)]">No matching loaded conversations. Load older conversations to search more.</p>}
        {conversations.filter(row => row.title.toLowerCase().includes(conversationSearch.toLowerCase())).map(row => <button key={row.id} type="button" disabled={videoBusy} aria-pressed={row.id === conversationId} onClick={() => { if (videoBusy) return; drafts.current.set(conversationId, draft); setConversationId(row.id) }}
          className={`w-full rounded-xl border p-3 text-left text-sm ${row.id === conversationId ? 'border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] text-[var(--anka-ink)]' : 'border-[var(--anka-line)] text-[var(--anka-ink)] hover:border-[var(--anka-muted)]'}`}>
          {row.title}</button>)}
        {hasMoreConversations && <button type="button" onClick={loadMoreConversations} disabled={listBusy || busy}
          className="w-full rounded-xl border border-[var(--anka-line)] px-3 py-2 text-xs font-semibold text-[var(--anka-violet)] disabled:opacity-50">
          {listBusy ? 'Loading…' : 'Load older conversations'}
        </button>}
      </div>}
      </div>
      <div className={compact ? 'private-conversation-body min-w-0' : 'min-h-64 min-w-0 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4'}>
        {!selected ? <p className="text-sm text-[var(--anka-muted)]">Choose or create a conversation.</p> : <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="font-semibold text-[var(--anka-ink)]">{selected.title}</h3>
            {isOwner && <details className="text-xs text-[var(--anka-ink)]">
              <summary className="cursor-pointer">Rename conversation</summary>
              <form className="mt-2 flex gap-2" onSubmit={event => { event.preventDefault(); renameCurrentConversation() }}>
                <input className={`${INPUT} min-w-40`} aria-label="Rename conversation" maxLength={160}
                  value={renameTitle} onChange={event => setRenameTitle(event.target.value)} />
                <button type="submit" className={BUTTON} disabled={renameBusy || busy || !renameTitle.trim() || renameTitle.length > 160}>
                  {renameBusy ? 'Saving…' : 'Save'}
                </button>
              </form>
            </details>}
          </div>
          {contextKind === 'project_team' && isOwner && <div className="mt-3 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-3">
            <h4 className="text-sm font-semibold text-[var(--anka-ink)]">Share this project conversation</h4>
            <p className="mt-1 text-xs text-[var(--anka-muted)]">Only selected active internal teammates can see all current and future messages and reply. Sharing does not grant AI use, approval, or project record changes. Revoking stops later reads and replies; it cannot recall copies already seen.</p>
            <div className="mt-3 max-h-40 space-y-2 overflow-auto">
              {sharing.candidates.map(candidate => <label key={candidate.id} className="flex items-start gap-2 text-xs text-[var(--anka-ink)]">
                <input type="checkbox" checked={shareSelection.includes(candidate.id)}
                  onChange={event => setShareSelection(current => event.target.checked
                    ? [...current, candidate.id] : current.filter(id => id !== candidate.id))} />
                <span>{candidate.full_name || candidate.email || candidate.id}</span>
              </label>)}
              {!sharing.loaded && <p className="text-xs text-[var(--anka-muted)]">Loading eligible teammates…</p>}
              {sharing.loaded && !sharing.candidates.length && <p className="text-xs text-[var(--anka-muted)]">No eligible teammates available.</p>}
            </div>
            <p className="mt-3 text-xs text-[var(--anka-muted)]">Currently shared with {sharing.recipients.length} teammate{sharing.recipients.length === 1 ? '' : 's'}. New selection: {shareSelection.length
              ? sharing.candidates.filter(candidate => shareSelection.includes(candidate.id))
                .map(candidate => candidate.full_name || candidate.email || candidate.id).join(', ')
              : 'Only you'}</p>
            <button type="button" className={BUTTON} disabled={shareBusy || !sharing.loaded}
              onClick={saveSharing}>{shareBusy ? 'Saving…' : 'Save sharing'}</button>
          </div>}
          {!compact && modelControls}
          {hasOlder && <button type="button" disabled={olderBusy} onClick={loadOlder}
            className="mt-3 text-xs font-semibold text-[var(--anka-violet)] disabled:opacity-50">Load older messages</button>}
          <div className="mt-4 space-y-3" aria-live="polite">
            {!messages.length && <p className="text-sm text-[var(--anka-muted)]">No messages yet.</p>}
            {messages.map(message => <div key={message.id} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--anka-violet)]">{message.role === 'assistant' ? 'Anka AI' : message.author_id === user.id ? 'You' : 'Teammate'}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--anka-ink)]">{message.body}</p>
              {isOwner && message.role === 'user' && message.author_id === user.id
                && !messages.some(reply => reply.in_reply_to_message_id === message.id) && <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" className="text-xs font-semibold text-[var(--anka-violet)] disabled:opacity-40"
                    disabled={!localAiChecksPass || !selectedModelId || Boolean(aiBusyMessageId) || busy}
                    onClick={() => askAi(message)}>{aiBusyMessageId === message.id ? 'Checking…' : 'Ask Anka AI'}</button>
                  <button type="button" className="text-xs text-[var(--anka-muted)] hover:text-[var(--anka-ink)] disabled:opacity-40"
                    disabled={Boolean(aiBusyMessageId) || busy} onClick={() => askAi(message, true)}>Check for saved reply</button>
                </div>}
            </div>)}
          </div>
          {compact && departmentId === 'design' && isOwner && <label className="mt-4 grid gap-2 text-sm">Create
            <select className={`${INPUT} max-w-sm`} aria-label="Private Design asset type" value={assetType} disabled={Boolean(videoBusy || busy || aiBusyMessageId || historyBusy)}
              onChange={event => { if (videoBusy || busy || aiBusyMessageId || historyBusy) return; setAssetType(event.target.value); if (event.target.value === 'video') setVideoOpened(true) }}>
              <option value="text">Text conversation</option><option value="video" disabled={selected.state !== 'active'}>Video · Higgsfield</option>
            </select>
          </label>}
          {videoOpened && departmentId === 'design' && contextKind === 'department_private' && isOwner && <div hidden={assetType !== 'video'}>
            <Suspense fallback={<p role="status">Loading private video tools…</p>}><PrivateDesignVideoTools key={conversationId} conversationId={conversationId} beforeGenerate={checkPrivateVideoContext} onNavigationBusyChange={reportVideoBusy} /></Suspense>
          </div>}
          <div hidden={assetType !== 'text'}>
          {compact && modelControls}
          <form onSubmit={sendMessage} className="mt-5 space-y-2 border-t border-[var(--anka-line)] pt-4">
            <label htmlFor="private-conversation-message" className="text-xs font-semibold uppercase tracking-wide text-[var(--anka-muted)]">Your message</label>
            <textarea id="private-conversation-message" className={INPUT} rows={3} maxLength={8000}
              value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); drafts.current.set(conversationId, event.target.value); pendingRequests.current.delete(conversationId) }}
              placeholder="Capture an idea, question, or direction for this private conversation." />
            <button className={BUTTON} disabled={busy || !draft.trim()}>Save message</button>
          </form>
          </div>
        </>}
      </div>
    </div>
  </section>
}
