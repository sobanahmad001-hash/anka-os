import { restrictArtifactTypes } from '../data/departmentChatArtifactTypes.js'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { createChatCompletionGuard, handleCurrentChatFailure, runCurrentChatOperation } from '../data/departmentChatIdentity.js'
import { selectPendingDepartmentChatAttachments, validateDepartmentChatAttachmentFile } from '../data/departmentChatAttachmentSelection.js'
import { selectDepartmentChatModelConfiguration } from '../data/departmentChatModelSelection.js'
import { createAnswerObservationController, reduceAnswerStreamState } from '../data/departmentChatAnswerController.js'
import { departmentChatVersionHistoryPath, linkedDepartmentChatVersions } from '../data/departmentChatVersionHistory.js'

import { departmentChatProfile } from '../data/departmentChatProfiles.js'
import { departmentChat } from '../data/departmentChatRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20'
const PRIMARY = 'rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50'
const MODEL_PROVIDER_LABELS = { openai: 'OpenAI', anthropic: 'Claude', google_gemini: 'Gemini' }

export default function DepartmentChat(props) {
  const { user } = useAuth()
  const { activeOrganizationId, scopeRevision, requestSignal, handleOrganizationAccessError, selectOrganization } = useOrganization()
  const [composerDirty, setComposerDirty] = useState(false)
  const navigationBlocker = useBlocker(composerDirty || Boolean(props.externalNavigationBusy))
  const identity = JSON.stringify([user?.id, activeOrganizationId, scopeRevision, props.engagement?.id, props.departmentId, props.initialConversation?.id || ''])
  if (!user?.id || !activeOrganizationId || requestSignal?.aborted
    || props.engagement?.organization_id !== activeOrganizationId) return null
  return <ScopedDepartmentChat key={identity} {...props} userId={user.id} organizationId={activeOrganizationId} requestSignal={requestSignal} handleOrganizationAccessError={handleOrganizationAccessError} navigationBlocker={navigationBlocker} onComposerDirtyChange={setComposerDirty} selectOrganization={selectOrganization} />
}

export function ScopedDepartmentChat({
  departmentId,
  departmentLabel,
  presentationLabel = 'Shared Department Chat',
  presentation,
  initialConversation = null,
  hideConversationList = false,
  onConversationListChange,
  onNavigationBusyChange,
  engagement,
  artifactDefinitions = {},
  allowedArtifactTypes = null,
  allowArtifactDraft = true,
  artifactForType = () => null,
  stageForType = () => null,
  onCreated,
  userId,
  organizationId,
  requestSignal,
  handleOrganizationAccessError,
  navigationBlocker,
  externalNavigationBusy = false,
  onComposerDirtyChange,
  selectOrganization,
}) {
  const completion = useRef(null)
  const requestedConversation = useRef(initialConversation).current
  const answerObservation = useRef(null)
  const attachmentCompletion = useRef(null)
  const draftSwitchGeneration = useRef(0)
  const dialogRef = useRef(null)
  const dialogOriginRef = useRef(null)
  const dialogOpenedRef = useRef(false)
  const composerRef = useRef(null)
  const stayButtonRef = useRef(null)
  const discardButtonRef = useRef(null)
  const saveButtonRef = useRef(null)
  const outputHeadingRef = useRef(null)
  const panelToggleRef = useRef(null)
  const panelBodyRef = useRef(null)
  const focusPreviewOnOpen = useRef(false)
  const sourceGeneration = useRef(0)
  const mounted = useRef(true)
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; draftSwitchGeneration.current += 1; sourceGeneration.current += 1 }
  }, [])
  const requestScope = useMemo(
    () => ({ organizationId, signal: requestSignal }),
    [organizationId, requestSignal],
  )
  useLayoutEffect(() => {
    const guard = createChatCompletionGuard(requestSignal)
    completion.current = guard
    return () => {
      answerObservation.current?.dispose()
      answerObservation.current = null
      guard.dispose()
    }
  }, [requestSignal])
  const contextPanelId = useId()
  const profile = departmentChatProfile(departmentId)
  const artifactTypes = useMemo(() => restrictArtifactTypes(profile.artifactTypes, allowedArtifactTypes), [profile, allowedArtifactTypes])
  const resolvedDepartmentLabel = departmentLabel || profile.label
  const [artifactType, setArtifactType] = useState(artifactTypes[0] || '')
  const [proposalMode, setProposalMode] = useState(['content', 'design', 'marketing'].includes(departmentId) ? 'answer' : 'artifact')
  const [prompt, setPrompt] = useState('')
  const [safe, setSafe] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [official, setOfficial] = useState(null)
  const [answerState, setAnswerState] = useState({ status: 'idle', text: '', durable: false })
  const [observationNotice, setObservationNotice] = useState('')
  const [title, setTitle] = useState('')
  const [workItemType, setWorkItemType] = useState('task')
  const [priority, setPriority] = useState('medium')
  const [language, setLanguage] = useState('')
  const supportsSavedConversations = ['content', 'design', 'marketing'].includes(departmentId)
  const projectId = engagement.project_id
  const [conversations, setConversations] = useState([])
  const [conversationId, setConversationId] = useState('')
  const [messages, setMessages] = useState([])
  const [capabilities, setCapabilities] = useState(null)
  const [modelConfigurationId, setModelConfigurationId] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [conversationSearchDraft, setConversationSearchDraft] = useState('')
  const [conversationSearchQuery, setConversationSearchQuery] = useState('')
  const [nextConversationCursor, setNextConversationCursor] = useState(null)
  const [conversationTitle, setConversationTitle] = useState('')
  const [historyBusy, setHistoryBusy] = useState(false)
  const [sharing, setSharing] = useState({ can_manage: false, recipients: [] })
  const [shareCandidates, setShareCandidates] = useState([])
  const [recipientIds, setRecipientIds] = useState([])
  const [attachments, setAttachments] = useState([])
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState([])
  const [pendingFiles, setPendingFiles] = useState([])
  const [attachmentClassification, setAttachmentClassification] = useState('internal')
  const [attachmentAiUse, setAttachmentAiUse] = useState(false)
  const [attachmentShare, setAttachmentShare] = useState(false)
  const [attachmentBusy, setAttachmentBusy] = useState(false)
  const [sourceVersions, setSourceVersions] = useState([])
  const [sourceConversationId, setSourceConversationId] = useState('')
  const [selectedSourceVersionIds, setSelectedSourceVersionIds] = useState([])
  const [sourcePreview, setSourcePreview] = useState(null)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [sourceRefresh, setSourceRefresh] = useState(0)
  const [contextExpanded, setContextExpanded] = useState(() => presentation !== 'workbench' && (!globalThis.window?.matchMedia || globalThis.window.matchMedia('(min-width: 1280px)').matches))

  const [pendingDraftSwitch, setPendingDraftSwitch] = useState(null)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  useEffect(() => {
    if (presentation === 'workbench') return undefined
    const media = window.matchMedia?.('(min-width: 1280px)')
    if (!media) return undefined
    const resize = () => {
      if (!media.matches && panelBodyRef.current?.contains(document.activeElement)) panelToggleRef.current?.focus()
      setContextExpanded(media.matches)
    }
    resize()
    media.addEventListener?.('change', resize)
    return () => media.removeEventListener?.('change', resize)
  }, [presentation])
  useEffect(() => {
    if (result) { focusPreviewOnOpen.current = true; setContextExpanded(true) }
  }, [result])
  useEffect(() => {
    if (result && contextExpanded && focusPreviewOnOpen.current) {
      outputHeadingRef.current?.focus()
      focusPreviewOnOpen.current = false
    }
  }, [result, contextExpanded])
  useEffect(() => {
    if (!pendingDraftSwitch) {
      dialogOpenedRef.current = false
      dialogOriginRef.current = null
      return
    }
    if (!dialogOpenedRef.current) {
      dialogOriginRef.current = document.activeElement
      dialogOpenedRef.current = true
    }
    ;(draftSaving ? dialogRef.current : stayButtonRef.current)?.focus()
  }, [pendingDraftSwitch, draftSaving])
  function closeDraftSwitch() {
    const origin = dialogOriginRef.current
    draftSwitchGeneration.current += 1
    setPendingDraftSwitch(null)
    if (navigationBlocker?.state === 'blocked') navigationBlocker.reset()
    if (!mounted.current || requestSignal?.aborted) return
    const currentOrigin = origin && origin !== document.body
      && origin.ownerDocument === document && (origin.isConnected ?? Boolean(origin.parentNode))
    ;(currentOrigin ? origin : composerRef.current)?.focus()
  }
  function handleDraftDialogKey(event) {
    if (event.key === 'Escape' && !draftSaving) {
      event.preventDefault()
      closeDraftSwitch()
      return
    }
    if (event.key !== 'Tab') return
    const choices = [stayButtonRef.current, discardButtonRef.current, saveButtonRef.current]
      .filter(button => button && !button.disabled)
    if (!choices.length) { event.preventDefault(); return }
    if (event.shiftKey && document.activeElement === choices[0]) {
      event.preventDefault()
      choices.at(-1).focus()
    } else if (!event.shiftKey && document.activeElement === choices.at(-1)) {
      event.preventDefault()
      choices[0].focus()
    }
  }

  function clearComposer() {
    setPrompt('')
    setSafe(false)
    setProposalMode(supportsSavedConversations ? 'answer' : 'artifact')
    setArtifactType(artifactTypes[0] || '')
    setTitle('')
    setWorkItemType(profile.workItemTypes[0] || 'task')
    setPriority('medium')
    setLanguage('')
    setSelectedAttachmentIds([])
    setSelectedSourceVersionIds([])
    setSourcePreview(null)
    setPendingFiles([])
    setAttachmentAiUse(false)
    setAttachmentShare(false)
    setAttachmentClassification('internal')
    setModelConfigurationId(selectDepartmentChatModelConfiguration(capabilities, ''))
    setDraftNotice('')
  }

  async function restoreUnsentDraft(id, isCurrent = () => true) {
    if (!supportsSavedConversations || !id) return
    const saved = await departmentChat.getUnsentDraft(departmentId, {
      conversation_id: id, engagement_id: engagement.id, project_id: projectId,
    }, requestScope)
    if (!isCurrent()) return
    clearComposer()
    if (!saved) return
    setPrompt(saved.prompt || '')
    setProposalMode((!allowArtifactDraft || !artifactTypes.includes(saved.artifact_type)) && saved.proposal_mode === 'artifact' ? 'answer' : saved.proposal_mode || 'answer')
    if (artifactTypes.includes(saved.artifact_type)) setArtifactType(saved.artifact_type)
    if (profile.workItemTypes.includes(saved.work_item_type)) setWorkItemType(saved.work_item_type)
    setTitle(saved.work_item_title || '')
    setPriority(['low', 'medium', 'high', 'urgent'].includes(saved.priority) ? saved.priority : 'medium')
    setLanguage(saved.language || '')
    setDraftNotice('Unsent text restored from this conversation. Recheck exact sources, files, model, and AI-use consent before sending.')
  }

  const hasUnsentComposer = Boolean(prompt.trim() || title.trim() || language.trim()
    || pendingFiles.length || selectedAttachmentIds.length || selectedSourceVersionIds.length)
  useEffect(() => {
    onNavigationBusyChange?.(!requestSignal?.aborted && Boolean(busy || historyBusy || attachmentBusy || sourceBusy || draftSaving))
    const clear = () => onNavigationBusyChange?.(false)
    requestSignal?.addEventListener?.('abort', clear, { once: true })
    return () => { requestSignal?.removeEventListener?.('abort', clear); clear() }
  }, [busy, historyBusy, attachmentBusy, sourceBusy, draftSaving, onNavigationBusyChange, requestSignal])
  useEffect(() => { onComposerDirtyChange?.(hasUnsentComposer) }, [hasUnsentComposer, onComposerDirtyChange])
  useEffect(() => {
    if (navigationBlocker?.state !== 'blocked' || externalNavigationBusy || busy || historyBusy || attachmentBusy || sourceBusy || draftSaving) return
    setPendingDraftSwitch(current => current || { label: 'leave this page', proceed: () => navigationBlocker.proceed() })
  }, [navigationBlocker?.state, navigationBlocker?.proceed, externalNavigationBusy, busy, historyBusy, attachmentBusy, sourceBusy, draftSaving])
  useEffect(() => {
    if (!hasUnsentComposer) return undefined
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsentComposer])
  useEffect(() => {
    if (!selectOrganization) return undefined
    const guard = event => {
      if (!hasUnsentComposer || event.detail?.organizationId === organizationId) return
      event.preventDefault()
      if (!busy && !historyBusy && !attachmentBusy && !sourceBusy && !draftSaving) {
        setPendingDraftSwitch({ label: 'switch organization', proceed: () => selectOrganization(event.detail.organizationId) })
      }
    }
    window.addEventListener('anka:organization-change', guard)
    return () => window.removeEventListener('anka:organization-change', guard)
  }, [hasUnsentComposer, selectOrganization, organizationId, busy, historyBusy, attachmentBusy, sourceBusy, draftSaving])
  function requestDraftSwitch(label, proceed) {
    if (busy || historyBusy || attachmentBusy || sourceBusy || draftSaving) return
    if (hasUnsentComposer) { setPendingDraftSwitch({ label, proceed }); return }
    clearComposer()
    proceed()
  }

  async function saveUnsentDraft() {
    if (!conversationId || !prompt.trim() || busy || historyBusy || attachmentBusy || draftSaving) return false
    setDraftSaving(true)
    setError('')
    try {
      await departmentChat.saveUnsentDraft(departmentId, {
        conversation_id: conversationId, engagement_id: engagement.id, project_id: projectId,
        draft: {
          prompt, proposal_mode: proposalMode, artifact_type: artifactType,
          work_item_title: title, work_item_type: workItemType, priority, language,
        },
      }, requestScope)
      if (requestSignal?.aborted || !mounted.current) return false
      setDraftNotice('Draft saved to this original conversation. Exact sources, files, model, and AI-use consent are not saved.')
      return true
    } catch (reason) {
      handleCurrentChatFailure(() => !requestSignal?.aborted && mounted.current, reason, handleOrganizationAccessError,
        failure => setError(failure.message || 'Draft could not be saved. Stay in this conversation.'))
      return false
    } finally { if (!requestSignal?.aborted && mounted.current) setDraftSaving(false) }
  }

  async function finishDraftSwitch(save) {
    if (!pendingDraftSwitch || draftSaving || externalNavigationBusy) return
    const generation = ++draftSwitchGeneration.current
    const pending = pendingDraftSwitch
    if (save) {
      if (!await saveUnsentDraft()) return
    } else if (conversationId) {
      setDraftSaving(true)
      try {
        await departmentChat.discardUnsentDraft(departmentId, {
          conversation_id: conversationId, engagement_id: engagement.id, project_id: projectId,
        }, requestScope)
      } catch (reason) {
        handleCurrentChatFailure(() => !requestSignal?.aborted && mounted.current && draftSwitchGeneration.current === generation, reason, handleOrganizationAccessError,
          failure => setError(failure.message || 'Draft could not be discarded. Stay in this conversation.'))
        if (mounted.current && !requestSignal?.aborted) setDraftSaving(false)
        return
      }
      if (mounted.current && !requestSignal?.aborted) setDraftSaving(false)
    }
    if (!mounted.current || requestSignal?.aborted || draftSwitchGeneration.current !== generation) return
    const proceed = pending.proceed
    setPendingDraftSwitch(null)
    clearComposer()
    onComposerDirtyChange?.(false)
    proceed()
  }
  useLayoutEffect(() => {
    const guard = createChatCompletionGuard(requestSignal)
    attachmentCompletion.current = guard
    return () => guard.dispose()
  }, [requestSignal, conversationId])

  useEffect(() => {
    setModelConfigurationId(current => selectDepartmentChatModelConfiguration(capabilities, current))
  }, [capabilities])

  async function loadAttachments(id = conversationId, isCurrent = () => true) {
    if (!id || !projectId) { setAttachments([]); setSelectedAttachmentIds([]); return [] }
    const rows = await departmentChat.listAttachments(departmentId, {
      conversation_id: id, engagement_id: engagement.id, project_id: projectId,
    }, requestScope)
    if (!isCurrent()) return []
    setAttachments(rows || [])
    setSelectedAttachmentIds(current => current.filter(value => (rows || []).some(item => item.id === value)))
    return rows || []
  }

  async function loadConversationList(selectId = conversationId, archived = includeArchived, isCurrent = () => true, query = conversationSearchQuery) {
    if (!supportsSavedConversations || !projectId) return
    const page = await departmentChat.searchConversations(departmentId, {
      engagement_id: engagement.id,
      project_id: projectId,
      include_archived: archived,
      query,
      limit: 25,
    }, requestScope)
    if (!isCurrent()) return null
    const rows = page.items || []
    setConversations(rows)
    setNextConversationCursor(page.next_cursor || null)
    const selected = rows.find(item => item.id === selectId) || rows[0] || null
    if ((selected?.id || '') !== conversationId) {
      setAttachmentBusy(false)
      setResult(null)
      setOfficial(null)
      setAnswerState({ status: 'idle', text: '', durable: false })
      setObservationNotice('')
      setMessages([])
      setAttachments([])
      setSelectedAttachmentIds([])
      setSelectedSourceVersionIds([])
      setSourcePreview(null)
      setSharing({ can_manage: false, recipients: [] })
      setShareCandidates([])
      setRecipientIds([])
      setPendingFiles([])
    }
    setConversationId(selected?.id || '')
    setConversationTitle(selected?.title || '')
    return selected
  }

  useEffect(() => {
    const generation = ++sourceGeneration.current
    setSourceVersions([])
    setSourceConversationId('')
    setSelectedSourceVersionIds([])
    setSourcePreview(null)
    setSourceError('')
    setSourceBusy(false)
    if (!supportsSavedConversations || !conversationId || !projectId) return
    let active = true
    departmentChat.listSourceVersions(departmentId, {
      conversation_id: conversationId, engagement_id: engagement.id, project_id: projectId,
    }, requestScope).then(rows => {
      if (!active || !mounted.current || requestSignal?.aborted || sourceGeneration.current !== generation) return
      setSourceVersions(rows || [])
      setSourceConversationId(conversationId)
    }).catch(reason => {
      if (!active || !mounted.current || requestSignal?.aborted || sourceGeneration.current !== generation) return
      setSourceConversationId(conversationId)
      handleCurrentChatFailure(() => true, reason, handleOrganizationAccessError,
        failure => setSourceError(failure.message || 'Exact sources are unavailable.'))
    })
    return () => { active = false; sourceGeneration.current += 1 }
  }, [conversationId, departmentId, engagement.id, projectId, requestScope, requestSignal, supportsSavedConversations, handleOrganizationAccessError, sourceRefresh])

  async function previewExactSource(id) {
    if (sourceBusy || busy || historyBusy || sourceConversationId !== conversationId) return
    const generation = sourceGeneration.current
    const targetConversationId = conversationId
    setSourceBusy(true)
    setSourceError('')
    setSourcePreview(null)
    try {
      const preview = await departmentChat.previewSourceVersion(departmentId, {
        conversation_id: targetConversationId, engagement_id: engagement.id, project_id: projectId,
        artifact_version_id: id,
      }, requestScope)
      if (!mounted.current || requestSignal?.aborted || sourceGeneration.current !== generation) return
      setSourcePreview(preview)
    } catch (reason) {
      if (!mounted.current || requestSignal?.aborted || sourceGeneration.current !== generation) return
      handleCurrentChatFailure(() => true, reason, handleOrganizationAccessError,
        failure => setSourceError(failure.message || 'Exact source preview failed.'))
    } finally {
      if (mounted.current && !requestSignal?.aborted && sourceGeneration.current === generation) setSourceBusy(false)
    }
  }

  async function loadConversation(id = conversationId, isCurrent = () => true, restoreDraft = false) {
    if (!id || !projectId) {
      setMessages([])
      setAttachments([])
      setSelectedAttachmentIds([])
      setSharing({ can_manage: false, recipients: [] })
      setShareCandidates([])
      setRecipientIds([])
      setConversationTitle('')
      return
    }
    const data = await departmentChat.getConversation(departmentId, {
      conversation_id: id,
      engagement_id: engagement.id,
      project_id: projectId,
    }, requestScope)
    if (!isCurrent()) return null
    setMessages(data.messages || [])
    await loadAttachments(id, isCurrent)
    if (!isCurrent()) return null
    setSharing(data.sharing || { can_manage: false, recipients: [] })
    setRecipientIds((data.sharing?.recipients || []).map(item => item.recipient_id))
    setShareCandidates([])
    if (data.sharing?.can_manage) {
      const candidates = await departmentChat.listConversationShareCandidates(departmentId, {
        conversation_id: id,
        engagement_id: engagement.id,
        project_id: projectId,
      }, requestScope)
      if (!isCurrent()) return null
      setShareCandidates(candidates)
    } else {
      setShareCandidates([])
    }
    setConversationTitle(data.conversation?.title || '')
    setConversations(current => current.map(item => item.id === id ? data.conversation : item))
    if (restoreDraft && isCurrent()) await restoreUnsentDraft(id, isCurrent)
    return data
  }

  useEffect(() => {
    if (!supportsSavedConversations || !projectId) return
    const isCurrent = completion.current.begin()
    setHistoryBusy(true)
    setError('')
    Promise.allSettled([
      departmentChat.searchConversations(departmentId, {
        engagement_id: engagement.id,
        project_id: projectId,
        include_archived: false,
        query: '',
        limit: 25,
      }, requestScope),
      departmentChat.getCapabilities(departmentId, {
        engagement_id: engagement.id,
        project_id: projectId,
      }, requestScope),
    ]).then(async ([conversationResult, capabilityResult]) => {
      if (!isCurrent()) return
      if (conversationResult.status === 'rejected') throw conversationResult.reason
      const listedRows = conversationResult.value.items || []
      const rows = requestedConversation && !listedRows.some(row => row.id === requestedConversation.id) ? [...listedRows, requestedConversation] : listedRows
      setConversations(rows)
      setNextConversationCursor(conversationResult.value.next_cursor || null)
      setCapabilities(capabilityResult.status === 'fulfilled' ? capabilityResult.value : null)
      if (capabilityResult.status === 'rejected') setError(capabilityResult.reason?.message || 'Configured AI is unavailable.')
      const selected = requestedConversation || rows[0] || null
      setConversationId(selected?.id || '')
      setConversationTitle(selected?.title || '')
      if (selected) {
        const data = await departmentChat.getConversation(departmentId, {
          conversation_id: selected.id,
          engagement_id: engagement.id,
          project_id: projectId,
        }, requestScope)
        if (!isCurrent()) return
        if (requestedConversation && data.conversation?.id !== selected.id) throw new Error('Selected conversation is unavailable')
        setMessages(data.messages || [])
        const attachmentRows = await departmentChat.listAttachments(departmentId, {
          conversation_id: selected.id, engagement_id: engagement.id, project_id: projectId,
        }, requestScope)
        if (isCurrent()) {
          setAttachments(attachmentRows || [])
          setSelectedAttachmentIds([])
        }
        if (isCurrent()) {
          setSharing(data.sharing || { can_manage: false, recipients: [] })
          setRecipientIds((data.sharing?.recipients || []).map(item => item.recipient_id))
        }
        if (data.sharing?.can_manage) {
          const candidates = await departmentChat.listConversationShareCandidates(departmentId, {
            conversation_id: selected.id,
            engagement_id: engagement.id,
            project_id: projectId,
          }, requestScope)
          if (isCurrent()) setShareCandidates(candidates)
        }
        if (isCurrent()) await restoreUnsentDraft(selected.id, isCurrent)
      }
    }).catch(reason => {
      if (isCurrent() && requestedConversation) { setConversationId(''); setMessages([]); setConversationTitle('') }
      handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message))
    }).finally(() => {
      if (isCurrent()) setHistoryBusy(false)
    })
  }, [departmentId, engagement.id, handleOrganizationAccessError, organizationId, projectId, requestScope, supportsSavedConversations, requestedConversation])

  async function createConversation() {
    const isCurrent = completion.current.begin()
    if (!isCurrent()) return
    setHistoryBusy(true)
    setError('')
    try {
      const created = await departmentChat.createConversation(departmentId, {
        engagement_id: engagement.id,
        project_id: projectId,
        title: `${resolvedDepartmentLabel} conversation`,
      }, requestScope)
      if (!isCurrent()) return
      setConversations(current => [created, ...current])
      onConversationListChange?.()
      setConversationSearchDraft('')
      setConversationSearchQuery('')
      setNextConversationCursor(null)
      setConversationId(created.id)
      setAttachmentBusy(false)
      setConversationTitle(created.title)
      setMessages([])
      setAttachments([])
      setSelectedAttachmentIds([])
      setPendingFiles([])
      setResult(null)
      setAnswerState({ status: 'idle', text: '', durable: false })
      setObservationNotice('')
      setSharing({ can_manage: true, recipients: [] })
      setRecipientIds([])
      try {
        const page = await departmentChat.searchConversations(departmentId, {
          engagement_id: engagement.id, project_id: projectId,
          include_archived: includeArchived, query: '', limit: 25,
        }, requestScope)
        if (isCurrent()) {
          setConversations(page.items || [created])
          setNextConversationCursor(page.next_cursor || null)
        }
      } catch {
        if (isCurrent()) setError('Conversation created, but the conversation list could not be refreshed.')
      }
      try {
        const candidates = await departmentChat.listConversationShareCandidates(departmentId, {
          conversation_id: created.id,
          engagement_id: engagement.id,
          project_id: projectId,
        }, requestScope)
        if (isCurrent()) setShareCandidates(candidates)
      } catch {
        if (isCurrent()) setError('Conversation created, but eligible recipients could not be loaded.')
      }
    } catch (reason) {
      handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message))
    } finally {
      if (isCurrent()) setHistoryBusy(false)
    }
  }

  async function selectConversation(id) {
    if (id === conversationId && attachmentBusy) return
    const isCurrent = completion.current.begin()
    if (!isCurrent()) return
    setConversationId(id)
    setAttachmentBusy(false)
    setConversationTitle(conversations.find(item => item.id === id)?.title || '')
    setHistoryBusy(true)
    setError('')
    setResult(null)
    setOfficial(null)
    setAnswerState({ status: 'idle', text: '', durable: false })
    setObservationNotice('')
    setMessages([])
    setSharing({ can_manage: false, recipients: [] })
    setShareCandidates([])
    setRecipientIds([])
    setAttachments([])
    setSelectedAttachmentIds([])
    setSelectedSourceVersionIds([])
    setSourcePreview(null)
    setPendingFiles([])
    try {
      const data = await departmentChat.getConversation(departmentId, {
        conversation_id: id,
        engagement_id: engagement.id,
        project_id: projectId,
      }, requestScope)
      if (!isCurrent()) return
      setMessages(data.messages || [])
      await loadAttachments(id, isCurrent)
      if (!isCurrent()) return
      setConversationTitle(data.conversation?.title || '')
      setSharing(data.sharing || { can_manage: false, recipients: [] })
      setRecipientIds((data.sharing?.recipients || []).map(item => item.recipient_id))
      if (data.sharing?.can_manage) {
        const candidates = await departmentChat.listConversationShareCandidates(departmentId, {
          conversation_id: id,
          engagement_id: engagement.id,
          project_id: projectId,
        }, requestScope)
        if (isCurrent()) setShareCandidates(candidates)
      } else setShareCandidates([])
      if (isCurrent()) await restoreUnsentDraft(id, isCurrent)
    } catch (reason) {
      handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message))
    } finally {
      if (isCurrent()) setHistoryBusy(false)
    }
  }

  async function renameConversation() {
    if (!conversationId || !conversationTitle.trim()) return
    const targetConversationId = conversationId
    const targetTitle = conversationTitle
    return runCurrentChatOperation(completion.current, {
      start: () => { setHistoryBusy(true); setError('') },
      operation: () => departmentChat.renameConversation(departmentId, {
        conversation_id: targetConversationId,
        engagement_id: engagement.id,
        project_id: projectId,
        title: targetTitle,
      }, requestScope),
      success: updated => {
        setConversations(current => current.map(item => item.id === updated.id ? updated : item))
        setConversationTitle(updated.title)
        onConversationListChange?.()
      },
      failure: (reason, isCurrent) => handleCurrentChatFailure(
        isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message),
      ),
      settle: () => setHistoryBusy(false),
    })
  }

  async function setConversationState(state) {
    if (!conversationId) return
    const targetConversationId = conversationId
    return runCurrentChatOperation(completion.current, {
      start: () => { setHistoryBusy(true); setError('') },
      operation: () => departmentChat.setConversationState(departmentId, {
        conversation_id: targetConversationId,
        engagement_id: engagement.id,
        project_id: projectId,
        state,
      }, requestScope),
      success: async (updated, isCurrent) => {
        onConversationListChange?.()
        const selected = await loadConversationList(state === 'active' ? updated.id : '', includeArchived, isCurrent)
        if (!isCurrent()) return
        if (selected) await loadConversation(selected.id, isCurrent, true)
        else { setMessages([]); setAttachments([]); setSelectedAttachmentIds([]) }
      },
      failure: (reason, isCurrent) => handleCurrentChatFailure(
        isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message),
      ),
      settle: () => setHistoryBusy(false),
    })
  }

  async function toggleArchived(checked) {
    const targetConversationId = conversationId
    return runCurrentChatOperation(completion.current, {
      start: () => { setIncludeArchived(checked); setHistoryBusy(true); setError('') },
      operation: isCurrent => loadConversationList(targetConversationId, checked, isCurrent),
      success: async (selected, isCurrent) => loadConversation(selected?.id || '', isCurrent, true),
      failure: (reason, isCurrent) => handleCurrentChatFailure(
        isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message),
      ),
      settle: () => setHistoryBusy(false),
    })
  }

  async function searchSavedConversations(event) {
    event.preventDefault()
    const query = conversationSearchDraft.trim()
    return runCurrentChatOperation(completion.current, {
      start: () => { setHistoryBusy(true); setError('') },
      operation: isCurrent => loadConversationList(conversationId, includeArchived, isCurrent, query),
      success: async (selected, isCurrent) => { setConversationSearchQuery(query); await loadConversation(selected?.id || '', isCurrent, true) },
      failure: (reason, isCurrent) => handleCurrentChatFailure(
        isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message),
      ),
      settle: () => setHistoryBusy(false),
    })
  }

  async function clearConversationSearch() {
    setConversationSearchDraft('')
    return runCurrentChatOperation(completion.current, {
      start: () => { setHistoryBusy(true); setError('') },
      operation: isCurrent => loadConversationList(conversationId, includeArchived, isCurrent, ''),
      success: async (selected, isCurrent) => { setConversationSearchQuery(''); await loadConversation(selected?.id || '', isCurrent, true) },
      failure: (reason, isCurrent) => handleCurrentChatFailure(
        isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message),
      ),
      settle: () => setHistoryBusy(false),
    })
  }

  async function loadMoreConversations() {
    if (!nextConversationCursor) return
    const cursor = nextConversationCursor
    return runCurrentChatOperation(completion.current, {
      start: () => { setHistoryBusy(true); setError('') },
      operation: () => departmentChat.searchConversations(departmentId, {
        engagement_id: engagement.id,
        project_id: projectId,
        include_archived: includeArchived,
        query: conversationSearchQuery,
        limit: 25,
        before_last_activity_at: cursor.last_activity_at,
        before_id: cursor.id,
      }, requestScope),
      success: page => {
        setConversations(current => {
          const merged = new Map(current.map(item => [item.id, item]))
          for (const item of page.items || []) merged.set(item.id, item)
          return [...merged.values()]
        })
        setNextConversationCursor(page.next_cursor || null)
      },
      failure: (reason, isCurrent) => handleCurrentChatFailure(
        isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message),
      ),
      settle: () => setHistoryBusy(false),
    })
  }

  async function saveSharing() {
    if (!conversationId || !sharing.can_manage) return
    const targetConversationId = conversationId
    const selected = [...recipientIds]
    return runCurrentChatOperation(completion.current, {
      start: () => { setHistoryBusy(true); setError('') },
      operation: () => departmentChat.setConversationShares(departmentId, {
        conversation_id: targetConversationId,
        engagement_id: engagement.id,
        project_id: projectId,
        recipient_ids: selected,
      }, requestScope),
      success: result => setSharing({ can_manage: true, recipients: result.recipients || [] }),
      failure: (reason, isCurrent) => handleCurrentChatFailure(
        isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message),
      ),
      settle: () => setHistoryBusy(false),
    })
  }

  async function uploadPendingAttachments() {
    if (!conversationId || !pendingFiles.length || attachmentBusy || busy || historyBusy || draftSaving) return
    const isCurrent = attachmentCompletion.current.begin()
    if (!isCurrent()) return
    const targetConversationId = conversationId
    setAttachmentBusy(true)
    setError('')
    try {
      if ((!isConversationOwner || (sharing.recipients || []).length > 0) && !attachmentShare) {
        throw new Error('This conversation is shared. Explicitly share each uploaded source before using it here.')
      }
      const uploaded = []
      if (pendingFiles.length > 3) throw new Error('Choose no more than three files. No files were uploaded.')
      for (const file of pendingFiles) {
        if (!isCurrent()) return
        const claimedMime = validateDepartmentChatAttachmentFile(file)
        const isImage = claimedMime === 'image/png' || claimedMime === 'image/jpeg'
        if (!isImage && !attachmentAiUse) throw new Error('Approve AI use before uploading text-bearing files.')
        uploaded.push(await departmentChat.uploadAttachment(departmentId, {
          file, conversation_id: targetConversationId, engagement_id: engagement.id, project_id: projectId,
          claimed_mime: claimedMime, original_name: file.name,
          data_classification: attachmentClassification,
          ai_use_allowed: isImage ? false : attachmentAiUse,
          share_with_recipients: attachmentShare,
        }, requestScope))
      }
      if (!isCurrent()) return
      setPendingFiles([])
      await loadAttachments(targetConversationId, isCurrent)
      if (!isCurrent()) return
      setSelectedAttachmentIds(uploaded.map(item => item.id))
    } catch (reason) {
      handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError,
        failure => setError(failure.message || 'Attachment upload failed'))
    } finally {
      if (isCurrent()) setAttachmentBusy(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || historyBusy || attachmentBusy || sourceBusy || draftSaving || !prompt.trim()) return
    if (proposalMode === 'artifact' && !artifactTypes.includes(artifactType)) { setError('This artifact tool is unavailable in this chat.'); return }
    if (!allowArtifactDraft && proposalMode === 'artifact') { setError('Open the specialist Studio to draft an artifact.'); return }
    if (supportsSavedConversations && proposalMode !== 'answer' && selectedProvider !== 'openai') {
      setError('Artifact and work-item previews currently require an approved OpenAI model. Choose one or switch to a conversational answer.')
      return
    }
    const isCurrent = completion.current.begin()
    if (!isCurrent()) return
    const targetConversationId = conversationId
    const clientRequestId = supportsSavedConversations ? crypto.randomUUID() : undefined
    const common = {
      conversation_id: supportsSavedConversations ? targetConversationId : undefined,
      client_request_id: clientRequestId,
      attachment_ids: supportsSavedConversations ? selectedAttachmentIds : undefined,
      selected_artifact_version_ids: supportsSavedConversations ? selectedSourceVersionIds : undefined,
      project_id: supportsSavedConversations ? projectId : undefined,
      engagement_id: engagement.id,
      model_configuration_id: modelConfigurationId,
      prompt,
      prompt_safe_for_ai: safe,
    }
    setBusy(true)
    setError('')
    setObservationNotice('')
    setResult(null)
    setOfficial(null)
    setAnswerState({ status: 'idle', text: '', durable: false })
    let observation = null
    try {
      if (proposalMode === 'answer') {
        observation = createAnswerObservationController(requestSignal)
        answerObservation.current = observation
        await departmentChat.answer(departmentId, common, {
          organizationId, signal: observation.signal,
        }, {
          onEvent: event => {
            if (isCurrent()) setAnswerState(current => reduceAnswerStreamState(current, event))
          },
        })
      } else {
        const proposed = proposalMode === 'artifact'
          ? await departmentChat.proposeArtifact(departmentId, {
            ...common,
            artifact_id: (artifactForType(artifactType) || {}).id || null,
            engagement_stage_instance_id: (stageForType(artifactType) || {}).id || null,
            artifact_type: artifactType,
            language,
            title: (artifactForType(artifactType)?.title) || `${artifactDefinitions[artifactType]?.label || resolvedDepartmentLabel} artifact`,
            change_summary: 'Draft proposed via Shared Department Chat',
          }, requestScope)
          : await departmentChat.proposeWorkItem(departmentId, {
            ...common,
            title: title || `${artifactDefinitions[artifactType]?.label || 'Work item'} request`,
            work_item_type: workItemType,
            priority,
          }, requestScope)
        if (!isCurrent()) return
        setResult({
          ...proposed,
          proposal_kind: proposalMode === 'artifact' ? 'artifact_version' : 'work_item',
          target_key: proposalMode === 'artifact' ? artifactType : workItemType,
        })
      }
      if (!isCurrent()) return
      setPrompt('')
      setTitle('')
      setLanguage('')
      setSafe(false)
      setSelectedAttachmentIds([])
      setSelectedSourceVersionIds([])
      setSourcePreview(null)
      setDraftNotice('')
      if (supportsSavedConversations && targetConversationId) {
        try {
          await departmentChat.discardUnsentDraft(departmentId, {
            conversation_id: targetConversationId, engagement_id: engagement.id, project_id: projectId,
          }, requestScope)
        } catch {
          if (isCurrent()) setDraftNotice('Sent successfully, but the earlier saved draft could not be cleared. Discard it before sending another request.')
        }
      }
      if (supportsSavedConversations) await loadConversation(targetConversationId, isCurrent)
    } catch (reason) {
      if (observation?.stoppedLocally()) {
        if (isCurrent()) {
          setObservationNotice('Stopped watching locally. The provider may still be running or incur cost; reload this conversation for its durable status. Do not submit the same request again.')
          try { await loadConversation(targetConversationId, isCurrent) } catch { /* Keep the truthful local-stop notice. */ }
        }
      } else {
        handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message))
        if (supportsSavedConversations && isCurrent()) {
          try { await loadConversation(targetConversationId, isCurrent) } catch { /* Preserve the original request error. */ }
        }
      }
    } finally {
      observation?.dispose()
      if (answerObservation.current === observation) answerObservation.current = null
      if (isCurrent()) setBusy(false)
    }
  }
  async function decide(action, target = result) {
    if (!target?.proposal_id) return
    if (action === 'confirm' && allowedArtifactTypes !== null && target.proposal_kind === 'artifact_version' && !artifactTypes.includes(target.target_key)) { setError('This artifact tool is unavailable in this chat.'); return }
    const isCurrent = completion.current.begin()
    if (!isCurrent()) return
    setBusy(true)
    setError('')
    try {
      const decision = action === 'confirm'
        ? await departmentChat.confirmProposal(target.proposal_id, requestScope)
        : await departmentChat.rejectProposal(target.proposal_id, requestScope)
      if (!isCurrent()) return
      setResult(current => current?.proposal_id === target.proposal_id
        ? ({ ...current, status: decision.outcome, decision }) : current)
      if (decision.outcome === 'accepted' && isCurrent()) await onCreated?.(decision)
      if (supportsSavedConversations && isCurrent()) await loadConversation(conversationId, isCurrent)
    } catch (reason) {
      handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError, failure => {
        if (['stale', 'expired', 'rejected'].includes(failure.outcome)) {
          setResult(current => current?.proposal_id === target.proposal_id
            ? ({ ...current, status: failure.outcome }) : current)
        }
        setError(failure.message)
      })
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  const isAnswerMode = proposalMode === 'answer'
  const isWorkItemMode = proposalMode === 'work_item'
  const selectedModel = (capabilities?.approved_models || []).find(model => model.configuration_id === modelConfigurationId)
  const selectedProvider = selectedModel?.provider || capabilities?.provider
  const answerReadiness = capabilities?.answer_readiness
  const selectedPriceReady = answerReadiness?.model_price_available?.find(
    item => item.configuration_id === modelConfigurationId)?.fresh_price_available === true
  const answerLocalChecksPass = answerReadiness?.paid_execution_enabled === true
    && answerReadiness?.spend_tracking_configured === true && selectedPriceReady
  const proposalModelUnavailable = supportsSavedConversations && !isAnswerMode && selectedProvider !== 'openai'
  const requiresContentLanguage = departmentId === 'content' && ['discovery', 'vision', 'audience'].includes(artifactType)
  const currentConversation = conversations.find(item => item.id === conversationId) || null
  const isConversationOwner = currentConversation?.owner_id === userId
  const conversationHasRecipients = Boolean(currentConversation && (!isConversationOwner || (sharing.recipients || []).length > 0))

  async function openOfficial(event) {
    event.preventDefault()
    const isCurrent = completion.current.begin()
    if (!isCurrent() || result?.status !== 'accepted') return
    setBusy(true)
    setError('')
    try {
      const record = await departmentChat.getOfficialRecord(organizationId, result.decision, requestScope)
      if (isCurrent()) setOfficial(record)
    } catch (reason) {
      handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message))
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  const SourcePanel = presentation === 'workbench' ? 'details' : 'section'
  return <><div className={presentation === 'workbench' ? 'design-chat-composer grid min-w-0 gap-4' : `grid gap-6 ${supportsSavedConversations ? hideConversationList ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : 'xl:grid-cols-[260px_minmax(0,1fr)_320px]' : 'xl:grid-cols-[minmax(0,1fr)_360px]'}`}>
    {supportsSavedConversations && !hideConversationList && <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Conversations</p><p className="mt-1 text-xs text-emerald-300">Private to you or deliberately shared</p></div>
        <button type="button" disabled={busy || historyBusy || !projectId} onClick={() => requestDraftSwitch('start a new conversation', createConversation)} className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">New</button>
      </div>
      <form className="mt-4 space-y-2" role="search" onSubmit={event => { event.preventDefault(); requestDraftSwitch('search conversations', () => searchSavedConversations(event)) }}>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Search permitted conversations
          <input type="search" maxLength="160" value={conversationSearchDraft} disabled={busy || historyBusy} onInput={event => setConversationSearchDraft(event.currentTarget.value)} placeholder="Titles and messages" className={`${INPUT} mt-2 normal-case tracking-normal`} />
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy || historyBusy} className="rounded-lg border border-sky-800 px-3 py-2 text-xs font-semibold text-sky-200 disabled:opacity-50">Search</button>
          {conversationSearchQuery && <button type="button" disabled={busy || historyBusy} onClick={() => requestDraftSwitch('clear conversation search', () => clearConversationSearch().catch(reason => setError(reason.message)))} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50">Clear</button>}
        </div>
      </form>
      <label className="mt-4 flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={includeArchived} disabled={busy || historyBusy} onChange={event => requestDraftSwitch('change archived view', () => toggleArchived(event.target.checked).catch(reason => setError(reason.message)))} />Show archived</label>
      <div className="mt-4 space-y-2">
        {conversations.map(conversation => <button type="button" key={conversation.id} disabled={busy || historyBusy} onClick={() => conversation.id !== conversationId && requestDraftSwitch('open another conversation', () => selectConversation(conversation.id))} className={`w-full rounded-xl border px-3 py-3 text-left text-sm disabled:opacity-50 ${conversation.id === conversationId ? 'border-sky-600 bg-sky-950/40 text-white' : 'border-slate-800 text-slate-300 hover:border-slate-700'}`}>
          <span className="block truncate font-medium">{conversation.title}</span>
          <span className="mt-1 block text-xs capitalize text-slate-500">{conversation.access_role === 'recipient' ? 'Shared with you' : 'Yours'} · {conversation.state} · {new Date(conversation.last_activity_at).toLocaleString()}</span>
          {(conversation.has_pending_run || conversation.has_failed_run) && <span className="mt-2 flex flex-wrap gap-1 text-[11px]">
            {conversation.has_pending_run && <span className="rounded-full bg-amber-950 px-2 py-0.5 text-amber-300">Run pending</span>}
            {conversation.has_failed_run && <span className="rounded-full bg-red-950 px-2 py-0.5 text-red-300">Run needs attention</span>}
          </span>}
        </button>)}
        {!conversations.length && <p className="rounded-xl border border-dashed border-slate-800 p-4 text-xs leading-5 text-slate-500">{conversationSearchQuery ? 'No permitted conversations match this search.' : `No ${includeArchived ? '' : 'active '}saved conversations yet.`}</p>}
        {nextConversationCursor && <button type="button" disabled={busy || historyBusy} onClick={() => loadMoreConversations().catch(reason => setError(reason.message))} className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 disabled:opacity-50">Load more</button>}
      </div>
    </aside>}
    <form onSubmit={submit} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-6">
      {supportsSavedConversations && hideConversationList && <button type="button" disabled={busy || historyBusy || !projectId} onClick={() => requestDraftSwitch('start a new conversation', createConversation)} className="mb-4 rounded-lg bg-sky-700 px-3 py-2 text-sm">New engagement conversation</button>}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-400">{presentationLabel} · {departmentId}</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">{presentation === 'workbench' ? 'Discuss the direction' : 'Ask, explore, or prepare a governed proposal'}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Ordinary answers stay conversational and create no official record. Artifact and work-item modes remain explicit governed proposals requiring separate confirmation.</p>
        {supportsSavedConversations && <p className="mt-2 text-xs leading-5 text-slate-500">Work context: canonical client engagement. Saved conversations are creator-private until explicitly shared with eligible internal contributors. Standalone private-project and internal-project chat modes are unavailable here.</p>}
      </div>
      {error && <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
      {draftNotice && <div className="mt-5 rounded-xl border border-sky-900/60 bg-sky-950/30 p-3 text-sm text-sky-200">{draftNotice}</div>}
      {observationNotice && <div className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">{observationNotice}</div>}
      {answerState.text && <div className="mt-5 rounded-xl border border-sky-900/60 bg-sky-950/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-300">{answerState.durable ? 'Saved answer' : 'Live partial · not yet durable'}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{answerState.text}</p></div>}
      {supportsSavedConversations && !projectId && <div className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">Saved chat requires a canonical project-owned engagement.</div>}
      {supportsSavedConversations && currentConversation && <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Conversation title
            <input maxLength="160" readOnly={!isConversationOwner} disabled={busy || historyBusy} className={`${INPUT} mt-2 normal-case tracking-normal`} value={conversationTitle} onChange={event => setConversationTitle(event.target.value)} />
          </label>
          {isConversationOwner && <button type="button" disabled={busy || historyBusy || !conversationTitle.trim()} onClick={() => renameConversation().catch(reason => setError(reason.message))} className="rounded-lg border border-slate-700 px-3 py-2.5 text-xs text-slate-200 disabled:opacity-50">Rename</button>}
          {isConversationOwner && <button type="button" disabled={busy || historyBusy} onClick={() => requestDraftSwitch('change conversation state', () => setConversationState(currentConversation.state === 'active' ? 'archived' : 'active').catch(reason => setError(reason.message)))} className="rounded-lg border border-slate-700 px-3 py-2.5 text-xs text-slate-200 disabled:opacity-50">{currentConversation.state === 'active' ? 'Archive' : 'Reopen'}</button>}
        </div>
        <p className="mt-3 text-xs text-slate-500">{isConversationOwner ? 'History stays private unless you explicitly share it with eligible internal contributors.' : 'The creator shared read and reply access with you. This adds no approval, tool, release, publishing, or paid-action authority.'}</p>
        {sharing.can_manage && <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Share conversation and linked previews</p>
          <div className="mt-3 max-h-40 space-y-2 overflow-auto">
            {shareCandidates.map(candidate => <label key={candidate.id} className="flex items-start gap-3 text-sm text-slate-300">
              <input type="checkbox" checked={recipientIds.includes(candidate.id)} disabled={busy || historyBusy} onChange={() => setRecipientIds(current => current.includes(candidate.id) ? current.filter(id => id !== candidate.id) : [...current, candidate.id])} />
              <span>{candidate.full_name || candidate.email || 'Internal contributor'}<span className="block text-xs text-slate-500">{candidate.role} · {candidate.department_id || 'organization leadership'}</span></span>
            </label>)}
            {!shareCandidates.length && <p className="text-xs text-slate-500">No other currently eligible internal contributors.</p>}
          </div>
          <button type="button" disabled={busy || historyBusy} onClick={() => saveSharing().catch(reason => setError(reason.message))} className="mt-3 rounded-lg border border-sky-700 px-3 py-2 text-xs font-semibold text-sky-200 disabled:opacity-50">Save sharing</button>
          <p className="mt-2 text-xs text-slate-500">Removing a person revokes later reads and replies immediately. Sharing never grants approval or execution power.</p>
        </div>}
      </div>}
      {supportsSavedConversations && <ConversationHistory messages={messages} userId={userId} busy={busy} onConfirm={proposal => decide('confirm', proposal)} onReject={proposal => decide('reject', proposal)} />}
      <div className="mt-6 space-y-5">
        {supportsSavedConversations && capabilities && <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Approved model
          <select
            className={`${INPUT} mt-2 normal-case tracking-normal`}
            value={modelConfigurationId}
            disabled={busy || historyBusy || !(capabilities.approved_models || []).length}
            onChange={event => {
              setModelConfigurationId(event.target.value)
              setResult(null)
              setOfficial(null)
              setAnswerState({ status: 'idle', text: '', durable: false })
              setObservationNotice('')
            }}
          >
            {(capabilities.approved_models || []).map(model => <option key={model.configuration_id} value={model.configuration_id}>{MODEL_PROVIDER_LABELS[model.provider || capabilities.provider] || 'Provider unavailable'} · {model.display_name || model.model_id}{model.is_default ? ' · default' : ''}</option>)}
          </select>
          <span className="mt-2 block font-normal normal-case leading-5 tracking-normal text-slate-500">Only administrator-approved models verified through this engagement's connector are available. A revoked or stale choice is rejected before dispatch without fallback.</span>
          {isAnswerMode && answerReadiness && <span className="mt-2 block font-normal normal-case leading-5 tracking-normal text-amber-300">{!answerReadiness.paid_execution_enabled ? 'Workshop AI answers are currently off.' : !answerReadiness.spend_tracking_configured ? 'Organization spend tracking is not configured.' : !selectedPriceReady ? 'A fresh verified price for this exact model is unavailable.' : answerReadiness.spend_guard_mode === 'provider_managed' ? 'Provider-side spend limits are managed externally and cannot be verified or enforced by Anka. Each request is still priced and recorded.' : 'Local checks passed; the service will recheck before dispatch.'}</span>}
          {isAnswerMode && !answerReadiness && <span className="mt-2 block font-normal normal-case leading-5 tracking-normal text-amber-300">Workshop answer readiness is unavailable.</span>}
        </label>}
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Task mode
          <select disabled={busy || historyBusy} className={`${INPUT} mt-2 normal-case tracking-normal`} value={proposalMode} onChange={event => setProposalMode(event.target.value)}>
            {supportsSavedConversations && <option value="answer">Conversational answer</option>}
            {allowArtifactDraft && artifactTypes.length > 0 && <option value="artifact">Artifact draft</option>}
            <option value="work_item">Work item draft</option>
          </select>
        </label>
        {proposalModelUnavailable && <p className="text-xs text-amber-300">Artifact and work-item previews currently require an approved OpenAI model. Choose one above or switch to a conversational answer.</p>}

        {isAnswerMode ? null : isWorkItemMode ? (
          <>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Work item title
              <input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={title} onChange={event => setTitle(event.target.value)} placeholder="Short title for the proposed work item" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Work item type
                <select className={`${INPUT} mt-2 normal-case tracking-normal`} value={workItemType} onChange={event => setWorkItemType(event.target.value)}>
                  {profile.workItemTypes.map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Priority
                <select className={`${INPUT} mt-2 normal-case tracking-normal`} value={priority} onChange={event => setPriority(event.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>
          </>
        ) : (
          <>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Artifact type
              <select className={`${INPUT} mt-2 normal-case tracking-normal`} value={artifactType} onChange={event => setArtifactType(event.target.value)}>
                {artifactTypes.map(type => <option key={type} value={type}>{artifactDefinitions[type]?.label || type}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Artifact title
              <input className={`${INPUT} mt-2 normal-case tracking-normal`} value={artifactForType(artifactType)?.title || `${artifactDefinitions[artifactType]?.label || resolvedDepartmentLabel} artifact`} readOnly />
            </label>
            {requiresContentLanguage && <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Language
              <input maxLength="120" className={`${INPUT} mt-2 normal-case tracking-normal`} value={language} onChange={event => setLanguage(event.target.value)} placeholder="Optional only when approved Vision or organization default supplies it" />
              <span className="mt-2 block font-normal normal-case tracking-normal text-slate-500">Explicit choice wins; otherwise the server uses the approved brand value, then the organization default. If none exists, selection is required.</span>
            </label>}
          </>
        )}

        {supportsSavedConversations && <SourcePanel className="rounded-xl border border-slate-800 bg-slate-950/40 p-4" aria-label="Exact artifact sources">
          {presentation === 'workbench' && <summary>References · {selectedSourceVersionIds.length} selected</summary>}
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Exact approved artifact versions</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">Only versions approved for this engagement and eligible for AI use appear. Preview the full content, then include up to five exact versions for this turn. No artifact is included automatically.</p>
          <button type="button" disabled={sourceBusy || busy || historyBusy} onClick={() => setSourceRefresh(value => value + 1)} className="mt-2 text-xs text-sky-300 disabled:opacity-50">Refresh permitted versions</button>
          {sourceError && <p role="alert" className="mt-2 text-xs text-red-300">{sourceError}</p>}
          {sourceConversationId !== conversationId ? <p className="mt-2 text-xs text-slate-500">Checking permitted versions…</p>
            : sourceVersions.length === 0 ? <p className="mt-2 text-xs text-slate-500">No permitted approved versions available.</p>
              : <ul className="mt-3 space-y-2">{sourceVersions.map(item => {
                const selected = selectedSourceVersionIds.includes(item.artifact_version_id)
                return <li key={item.artifact_version_id} className="rounded-lg border border-slate-800 p-3 text-xs text-slate-300">
                  <span className="block font-medium">{item.title} · {item.artifact_type} · version {item.version_number}</span>
                  <span className="mt-1 block text-slate-500">Approved {new Date(item.approved_at).toLocaleString()} · AI eligible</span>
                  <div className="mt-2 flex gap-3">
                    <button type="button" disabled={sourceBusy || busy || historyBusy} onClick={() => previewExactSource(item.artifact_version_id)} aria-label={`Preview ${item.title} version ${item.version_number}`} className="text-sky-300 disabled:opacity-50">Preview exact version</button>
                    {selected && <button type="button" disabled={busy || historyBusy} onClick={() => { setSelectedSourceVersionIds(ids => ids.filter(id => id !== item.artifact_version_id)); setSafe(false) }} className="text-amber-300">Remove</button>}
                  </div>
                </li>
              })}</ul>}
          {sourcePreview && sourceConversationId === conversationId && <div className="mt-3 rounded-lg border border-sky-800 p-3 text-xs text-slate-300">
            <p className="font-semibold">{sourcePreview.title} · {sourcePreview.artifact_type} · version {sourcePreview.version_number}</p>
            <p className="mt-1 text-slate-500">Exact content size: {new TextEncoder().encode(JSON.stringify(sourcePreview.content)).length.toLocaleString()} bytes · AI eligible</p>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-2">{JSON.stringify(sourcePreview.content, null, 2)}</pre>
            <button type="button" disabled={busy || historyBusy || (selectedSourceVersionIds.length >= 5 && !selectedSourceVersionIds.includes(sourcePreview.artifact_version_id))} onClick={() => {
              setSelectedSourceVersionIds(ids => ids.includes(sourcePreview.artifact_version_id) ? ids : [...ids, sourcePreview.artifact_version_id])
              setSafe(false)
            }} className="mt-2 rounded border border-sky-700 px-3 py-1.5 text-sky-200 disabled:opacity-50">
              {selectedSourceVersionIds.includes(sourcePreview.artifact_version_id) ? 'Included for this turn' : 'Include this exact version'}
            </button>
          </div>}
          <p className="mt-2 text-xs text-slate-500">{selectedSourceVersionIds.length} of 5 exact versions selected. Permission and approval are rechecked at send.</p>
        </SourcePanel>}

        {supportsSavedConversations && capabilities?.attachments?.supported && <SourcePanel className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          {presentation === 'workbench' && <summary>Source files · {selectedAttachmentIds.length} selected</summary>}
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Explicit source files</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">TXT, Markdown, and DOCX contribute validated text. PNG/JPEG are reference-only and are never sent to the model. PDF and scanned/OCR documents are unavailable. Choose up to 3 files: 5 MiB per file; DOCX 4 MiB. Extracted text is limited to 16,000 characters per file and 24,000 per turn; rejected limits never truncate content.</p>
          <input
            key={conversationId}
            type="file" multiple
            accept=".txt,.md,.docx,.png,.jpg,.jpeg,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg"
            disabled={busy || historyBusy || attachmentBusy || !currentConversation || currentConversation.state !== 'active'}
            className="mt-3 block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200"
            onChange={event => {
              const selection = selectPendingDepartmentChatAttachments(event.target.files)
              setPendingFiles(selection.files)
              setError(selection.error)
              if (selection.error) event.target.value = ''
            }}
          />
          {pendingFiles.length > 0 && <div className="mt-3 space-y-3">
            <p className="text-xs text-slate-300">{pendingFiles.map(file => file.name).join(', ')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-400">Classification
                <select className={`${INPUT} mt-1 normal-case tracking-normal`} value={attachmentClassification} onChange={event => {
                  setAttachmentClassification(event.target.value)
                  if (event.target.value === 'restricted') { setAttachmentAiUse(false); setAttachmentShare(false) }
                }}>
                  <option value="public">Public</option><option value="internal">Internal</option>
                  <option value="confidential">Confidential</option><option value="restricted">Restricted</option>
                </select>
              </label>
              <label className="flex items-start gap-2 pt-6 text-xs text-slate-300"><input type="checkbox" checked={attachmentShare} disabled={attachmentClassification === 'restricted'} onChange={event => setAttachmentShare(event.target.checked)} />Share this source with current and future conversation recipients</label>
            </div>
            <label className="flex items-start gap-2 text-xs text-amber-200"><input type="checkbox" checked={attachmentAiUse} disabled={attachmentClassification === 'restricted'} onChange={event => setAttachmentAiUse(event.target.checked)} />I approve sending validated text from text-bearing files to the configured AI. Images remain reference-only.</label>
            <button type="button" disabled={attachmentBusy || draftSaving} onClick={uploadPendingAttachments} className="rounded-lg border border-sky-700 px-3 py-2 text-xs font-semibold text-sky-200 disabled:opacity-50">{attachmentBusy ? 'Validating privately…' : 'Upload and validate'}</button>
          </div>}
          {attachments.length > 0 && <div className="mt-4 space-y-2">
            {attachments.map(item => {
              const ready = ['extracted', 'reference_only'].includes(item.status) && item.data_classification !== 'restricted'
                && (!conversationHasRecipients || item.share_with_recipients)
              const selected = selectedAttachmentIds.includes(item.id)
              return <label key={item.id} className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${ready ? 'border-slate-800 text-slate-300' : 'border-slate-900 text-slate-500'}`}>
                <input type="checkbox" disabled={!ready || busy || attachmentBusy} checked={selected} onChange={() => setSelectedAttachmentIds(current => selected ? current.filter(id => id !== item.id) : current.length < 3 ? [...current, item.id] : current)} />
                <span className="min-w-0"><span className="block truncate font-medium">{item.original_name}</span><span className="mt-1 block text-slate-500">{item.verified_mime || item.claimed_mime} · {Number.isFinite(item.byte_size) ? `${item.byte_size.toLocaleString()} bytes` : 'Size pending validation'}</span><span className="mt-1 block capitalize text-slate-500">{item.status.replaceAll('_', ' ')} · {item.data_classification} · {item.share_with_recipients ? 'source shared' : 'uploader only'} · {item.extraction_notice}</span></span>
              </label>
            })}
          </div>}
          <p className="mt-3 text-xs text-slate-500">Choose up to three files for this turn. Only checked files are linked to the request; rejected limits never truncate content. Revocation blocks later server reads and replies, but cannot recall copies someone already saved.</p>
        </SourcePanel>}

        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{isAnswerMode ? 'Message' : 'Draft request'}
          <textarea ref={composerRef} required rows="10" className={`${INPUT} mt-2 normal-case tracking-normal`} value={prompt} onInput={event => setPrompt(event.currentTarget.value)} placeholder={isAnswerMode ? 'Ask a question or explore the work context. This will not create an official output.' : 'Describe the draft you need, the evidence to prioritize, known constraints, tone, and gaps the team should keep visible.'} />
        </label>

        <label className="flex items-start gap-3 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm leading-6 text-amber-200">
          <input required type="checkbox" className="mt-1" checked={safe} onChange={event => setSafe(event.target.checked)} />
          <span>I confirm this message, the previewed exact artifact versions, and the validated text from explicitly selected files are safe to send to the engagement-mapped {resolvedDepartmentLabel} model. Restricted sources are never included.</span>
        </label>

        {supportsSavedConversations && currentConversation && <button type="button" disabled={busy || historyBusy || attachmentBusy || draftSaving || !prompt.trim()} onClick={saveUnsentDraft} className="w-full rounded-xl border border-sky-700 px-4 py-2.5 text-sm font-semibold text-sky-200 disabled:opacity-50">{draftSaving ? 'Saving draft…' : 'Save draft to this conversation'}</button>}
        <button
          disabled={busy || historyBusy || attachmentBusy || sourceBusy || draftSaving || !prompt.trim() || !safe || proposalModelUnavailable || (isAnswerMode && !answerLocalChecksPass) || (supportsSavedConversations && (!currentConversation || currentConversation.state !== 'active' || !modelConfigurationId)) || (isWorkItemMode && !title.trim()) || (!isAnswerMode && !isWorkItemMode && !artifactTypes.includes(artifactType))}
          className={`${PRIMARY} w-full`}
        >
          {busy ? (isAnswerMode ? 'Processing answer…' : 'Generating safe preview…') : isAnswerMode ? 'Ask configured AI' : isWorkItemMode ? 'Preview draft work item' : 'Preview draft artifact'}
        </button>
        {busy && isAnswerMode && <button type="button" onClick={() => answerObservation.current?.stop()} className="w-full rounded-xl border border-amber-700 px-4 py-2.5 text-sm font-semibold text-amber-200">Stop watching locally</button>}
      </div>
    </form>
    <aside className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-4" aria-label="Context and output panel">
      <button ref={panelToggleRef} type="button" aria-expanded={contextExpanded} aria-controls={contextPanelId}
        onClick={() => {
          if (contextExpanded && panelBodyRef.current?.contains(document.activeElement)) panelToggleRef.current?.focus()
          setContextExpanded(value => !value)
        }}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-sky-500">
        <span>Context and output</span><span className="text-xs text-sky-300">{contextExpanded ? 'Collapse' : 'Expand'}</span>
      </button>
      <div ref={panelBodyRef} id={contextPanelId} hidden={!contextExpanded} className="mt-3 space-y-4">
      {result && <div><h3 ref={outputHeadingRef} tabIndex={-1} className="sr-only">Generated proposal preview</h3><ProposalPreview result={result} official={official} onOpenOfficial={openOfficial} busy={busy} onConfirm={() => decide('confirm')} onReject={() => decide('reject')} /></div>}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Current context</p>
        <p className="mt-2 font-semibold text-white">{engagement.brands?.name || engagement.name}</p>
        <p className="mt-1 text-sm text-slate-400">{engagement.agency_clients?.name}</p>
      </div>
      {supportsSavedConversations && <VersionHistoryPanel messages={messages} engagement={engagement} />}
      {supportsSavedConversations && <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm leading-6 text-slate-400">
        <p className="font-semibold text-white">Configured AI</p>
        {capabilities ? <><p className="mt-2">{MODEL_PROVIDER_LABELS[selectedProvider] || 'Provider unavailable'} · <span className="text-slate-200">{selectedModel?.model_id || capabilities.model_id}</span></p><p className="mt-1 text-xs text-slate-500">Selection is limited to verified, administrator-approved configurations for this engagement.</p></> : <p className="mt-2">{historyBusy ? 'Checking configuration…' : 'Configuration unavailable.'}</p>}
        <p className="mt-3 text-xs text-amber-300">Private files: TXT/Markdown/DOCX validated text; PNG/JPEG reference-only. PDF, OCR, and vision input remain unavailable.</p><p className="mt-2 text-xs text-slate-500">Answers appear after the provider response is saved. “Stop watching” closes this view; the request may continue and incur cost. Reopen the conversation to check the saved result.</p>
      </div>}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm leading-6 text-slate-400">
        <p className="font-semibold text-white">Human control remains intact</p>
        <p className="mt-2">The human user is recorded as the timeline actor. The model run is separately traceable. Approval remains available only through the normal exact-version manager action.</p>
      </div>
      </div>
    </aside>
  </div>
  {externalNavigationBusy && navigationBlocker?.state === 'blocked' && <div role="status" className="rounded-xl border border-amber-600 p-4">Keep this page open while the media request is pending or unconfirmed. <button type="button" onClick={() => navigationBlocker.reset()}>Stay on this page</button></div>}
  {pendingDraftSwitch && <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Unsent chat draft" onKeyDown={handleDraftDialogKey} className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-5"><section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"><h2 className="text-xl font-semibold text-white">Keep this unsent work?</h2><p className="mt-2 text-sm text-slate-300">Before you {pendingDraftSwitch.label}, stay here, save text to the original conversation, or discard it. Exact source and file selections, model choice, and AI-use consent are never saved.</p>{error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}<div className="mt-6 flex flex-wrap justify-end gap-2"><button ref={stayButtonRef} type="button" disabled={draftSaving} onClick={closeDraftSwitch}>Stay</button><button ref={discardButtonRef} type="button" disabled={draftSaving || externalNavigationBusy} onClick={() => finishDraftSwitch(false)}>Discard and continue</button><button ref={saveButtonRef} type="button" disabled={draftSaving || externalNavigationBusy || !conversationId || !prompt.trim()} onClick={() => finishDraftSwitch(true)} className={PRIMARY}>{draftSaving ? 'Saving…' : 'Save to original and continue'}</button></div>{!prompt.trim() && <p className="mt-3 text-xs text-amber-300">Add a message to save a draft; source selections alone cannot be saved.</p>}</section></div>}
  </>
}

function ConversationHistory({ messages, userId, busy, onConfirm, onReject }) {
  if (!messages.length) return <div className="mt-5 rounded-xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">This conversation has no messages yet.</div>
  return <section className="mt-5 space-y-3" aria-label="Saved conversation history">
    {messages.map(message => {
      const proposal = message.proposal ? {
        proposal_id: message.proposal.id,
        proposal_kind: message.proposal.proposal_kind,
        target_key: message.proposal.target_key,
        preview: message.proposal.preview_payload,
        status: message.proposal.status,
        expires_at: message.proposal.expires_at,
        model: message.proposal.model_id,
        connector_connection_id: message.proposal.connector_connection_id,
        proposer_id: message.proposal.proposer_id,
        decision: message.proposal.status === 'accepted' ? {
          outcome: 'accepted',
          artifact_id: message.proposal.accepted_artifact_id,
          artifact_version_id: message.proposal.accepted_artifact_version_id,
          work_item_id: message.proposal.accepted_work_item_id,
        } : null,
      } : null
      return <article key={message.id} className={`rounded-xl border p-4 ${message.role === 'user' ? 'ml-8 border-sky-900/60 bg-sky-950/20' : 'mr-8 border-slate-800 bg-slate-950/40'}`}>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">{message.role === 'user' ? (message.author_id === userId ? 'You' : message.author?.full_name || message.author?.email || 'Internal contributor') : 'Configured assistant'}</span>
          <span className="text-right text-slate-500"><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time><span className={`ml-2 ${message.status === 'failed' ? 'text-red-300' : ['pending', 'unknown'].includes(message.status) ? 'text-amber-300' : 'text-slate-500'}`}>{message.status}</span></span>
        </div>
        {message.run && <RunMetadata run={message.run} />}
        {message.role === 'user' && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{message.body}</p>}
        {message.role === 'assistant' && !proposal && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{message.body}</p>}
        {message.role === 'user' && message.attachments?.length > 0 && <div className="mt-3 space-y-2">
          {message.attachments.map(source => <div key={source.attachment_id} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
            <span className="font-medium text-slate-200">{source.original_name}</span>
            <span className="ml-2">{source.extraction_kind === 'reference_only' ? 'reference only · not sent to AI' : source.provider_dispatched_at ? 'validated text · dispatch recorded' : 'validated text · not dispatched'}</span>
            <span className="mt-1 block">{source.data_classification} · SHA-256 {String(source.attachment_sha256_hex).slice(0, 12)}… · {source.extraction_notice}</span>
          </div>)}
        </div>}
        {message.status === 'failed' && <p className="mt-2 text-xs text-red-300">This request failed safely. Start a new request to retry with the current configured model.</p>}
        {message.status === 'unknown' && <p className="mt-2 text-xs text-amber-300">The provider outcome is unknown. Do not retry this request; a retry could duplicate work or cost.</p>}
        {proposal && <ProposalPreview result={proposal} official={null} busy={busy} canDecide={proposal.proposer_id === userId} onConfirm={() => onConfirm(proposal)} onReject={() => onReject(proposal)} />}
      </article>
    })}
  </section>
}

function metadataValue(value, emptyLabel) {
  if (value === null || value === undefined) return 'Not recorded for this historical run'
  if (Array.isArray(value)) return value.length ? value.join(', ') : emptyLabel
  return String(value)
}

function RunMetadata({ run }) {
  const selected = run.selected_model
    ? `${run.selected_model.display_name || run.selected_model.model_id} / ${run.selected_model.model_id}`
    : null
  return <dl aria-label={`Run metadata ${run.id}`} className="mt-3 grid gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400 sm:grid-cols-2">
    <MetaDatum label="Run ID" value={run.id} />
    <MetaDatum label="Run recorded" value={run.created_at ? <time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time> : 'Not recorded'} />
    <MetaDatum label="Selected model" value={metadataValue(selected)} />
    <MetaDatum label="Actual model used" value={metadataValue(run.actual_model_id)} />
    <MetaDatum label="Provider" value={run.provider || 'Not recorded'} />
    <MetaDatum label="Run mode" value={run.capability || 'Not recorded'} />
    <MetaDatum label="Run status" value={run.status || 'Not recorded'} />
    <MetaDatum label="Requested tools" value={metadataValue(run.requested_tools, 'None requested')} />
    <MetaDatum label="Executed tools" value={metadataValue(run.executed_tools, 'None executed')} />
  </dl>
}

function MetaDatum({ label, value }) {
  return <div className="min-w-0"><dt className="font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-300">{value}</dd></div>
}

function VersionHistoryPanel({ messages, engagement }) {
  const linkedVersions = linkedDepartmentChatVersions(messages)
    .map(version => ({ version, href: departmentChatVersionHistoryPath(engagement, version) }))
    .filter(item => item.href)
  return <section aria-labelledby="department-chat-version-history-title" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm leading-6 text-slate-400">
    <h3 id="department-chat-version-history-title" className="font-semibold text-white">Linked exact versions</h3>
    {linkedVersions.length ? <ul className="mt-3 space-y-3">{linkedVersions.map(({ version, href }) => {
      const label = `${version.title || version.artifact_type} / ${version.version_number ? `version ${version.version_number}` : 'exact version'} / ${version.artifact_version_id}`
      return <li key={version.artifact_version_id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
        <p className="break-words text-xs text-slate-300">{label}</p>
        <a href={href} aria-label={`View version history for ${label}`} className="mt-2 inline-block text-xs font-semibold text-sky-300 underline">View version history</a>
      </li>
    })}</ul> : <p className="mt-2 text-xs text-slate-500">No currently authorized exact version is linked to this conversation.</p>}
    <p className="mt-3 text-xs text-slate-500">Links open the existing specialist history surface. Access and exact version identity are checked again there.</p>
  </section>
}

function ProposalPreview({ result, official, onOpenOfficial, busy, canDecide = true, onConfirm, onReject }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, new Date(result.expires_at).getTime() - Date.now()) + 1)
    return () => clearTimeout(timer)
  }, [result.proposal_id, result.expires_at])
  const pending = result.status === 'pending' && new Date(result.expires_at).getTime() > now
  const accepted = result.status === 'accepted'
  const suggestionsOnly = result.proposal_kind === 'artifact_version' && result.target_key === 'campaign_brief'
  return <div className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/25 p-4 text-sm text-amber-100">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-semibold">{accepted ? 'Official unapproved record created' : 'Preview only'}</p><p className="mt-1 text-xs text-amber-300/80">{pending ? 'Expires ' + new Date(result.expires_at).toLocaleString() : 'Status: ' + result.status}</p></div>
      {pending && canDecide && <div className="flex gap-2">{!suggestionsOnly && <button type="button" disabled={busy} onClick={onConfirm} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Confirm official draft</button>}<button type="button" disabled={busy} onClick={onReject} className="rounded-lg border border-amber-700 px-3 py-2 text-xs disabled:opacity-50">Reject</button></div>}
    </div>
    {pending && suggestionsOnly && <p className="mt-3 text-xs text-amber-200">Campaign brief suggestions can only be applied selectively in the governed campaign brief editor.</p>}
    {pending && !canDecide && <p className="mt-3 text-xs text-amber-200">Preview shared for review. Only its author can use the existing confirmation or rejection action.</p>}
    {result.preview && <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs leading-5 text-slate-200">{JSON.stringify(result.preview, null, 2)}</pre>}
    {result.decision?.replayed && <p className="mt-3 text-xs text-slate-400">This confirmation was already completed; the existing official record was returned.</p>}
    {accepted && <p className="mt-3 text-xs text-emerald-300">Confirmation is not approval, release, publication, deployment, launch, or stage completion.</p>}
    {accepted && onOpenOfficial && result.decision && <a className="mt-3 block underline" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); else onOpenOfficial(event) }} href={'#wch-official-' + (result.decision.artifact_version_id || result.decision.work_item_id)}>Open official {result.decision.artifact_version_id ? 'artifact version' : 'work item'} · {result.decision.artifact_version_id || result.decision.work_item_id}</a>}
    {official && <section id={'wch-official-' + official.id} className="mt-4 rounded-lg border border-emerald-700 p-3"><p className="font-semibold">Saved official record · {official.id}</p><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(official.content || { title: official.title, description: official.description, status: official.status, work_item_type: official.work_item_type }, null, 2)}</pre></section>}
  </div>
}
