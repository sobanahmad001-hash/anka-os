import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { createChatCompletionGuard, handleCurrentChatFailure, runCurrentChatOperation } from '../data/departmentChatIdentity.js'

import { departmentChatProfile } from '../data/departmentChatProfiles.js'
import { departmentChat } from '../data/departmentChatRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20'
const PRIMARY = 'rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function DepartmentChat(props) {
  const { user } = useAuth()
  const { activeOrganizationId, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const identity = JSON.stringify([user?.id, activeOrganizationId, scopeRevision, props.engagement?.id, props.departmentId])
  if (!user?.id || !activeOrganizationId || requestSignal?.aborted
    || props.engagement?.organization_id !== activeOrganizationId) return null
  return <ScopedDepartmentChat key={identity} {...props} userId={user.id} organizationId={activeOrganizationId} requestSignal={requestSignal} handleOrganizationAccessError={handleOrganizationAccessError} />
}

function ScopedDepartmentChat({
  departmentId,
  departmentLabel,
  engagement,
  artifactDefinitions = {},
  artifactForType = () => null,
  stageForType = () => null,
  onCreated,
  userId,
  organizationId,
  requestSignal,
  handleOrganizationAccessError,
}) {
  const completion = useRef(null)
  const requestScope = useMemo(
    () => ({ organizationId, signal: requestSignal }),
    [organizationId, requestSignal],
  )
  useLayoutEffect(() => {
    const guard = createChatCompletionGuard(requestSignal)
    completion.current = guard
    return () => guard.dispose()
  }, [requestSignal])
  const profile = departmentChatProfile(departmentId)
  const resolvedDepartmentLabel = departmentLabel || profile.label
  const [artifactType, setArtifactType] = useState(profile.artifactTypes[0] || '')
  const [proposalMode, setProposalMode] = useState('artifact')
  const [prompt, setPrompt] = useState('')
  const [safe, setSafe] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [official, setOfficial] = useState(null)
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
  const [includeArchived, setIncludeArchived] = useState(false)
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

  async function loadConversationList(selectId = conversationId, archived = includeArchived, isCurrent = () => true) {
    if (!supportsSavedConversations || !projectId) return
    const rows = await departmentChat.listConversations(departmentId, {
      engagement_id: engagement.id,
      project_id: projectId,
      include_archived: archived,
    }, requestScope)
    if (!isCurrent()) return null
    setConversations(rows)
    const selected = rows.find(item => item.id === selectId) || rows[0] || null
    setConversationId(selected?.id || '')
    setConversationTitle(selected?.title || '')
    return selected
  }

  async function loadConversation(id = conversationId, isCurrent = () => true) {
    if (!id || !projectId) {
      setMessages([])
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
    return data
  }

  useEffect(() => {
    if (!supportsSavedConversations || !projectId) return
    const isCurrent = completion.current.begin()
    setHistoryBusy(true)
    setError('')
    Promise.allSettled([
      departmentChat.listConversations(departmentId, {
        engagement_id: engagement.id,
        project_id: projectId,
        include_archived: false,
      }, requestScope),
      departmentChat.getCapabilities(departmentId, {
        engagement_id: engagement.id,
        project_id: projectId,
      }, requestScope),
    ]).then(async ([conversationResult, capabilityResult]) => {
      if (!isCurrent()) return
      if (conversationResult.status === 'rejected') throw conversationResult.reason
      const rows = conversationResult.value
      setConversations(rows)
      setCapabilities(capabilityResult.status === 'fulfilled' ? capabilityResult.value : null)
      if (capabilityResult.status === 'rejected') setError(capabilityResult.reason?.message || 'Configured AI is unavailable.')
      const selected = rows[0] || null
      setConversationId(selected?.id || '')
      setConversationTitle(selected?.title || '')
      if (selected) {
        const data = await departmentChat.getConversation(departmentId, {
          conversation_id: selected.id,
          engagement_id: engagement.id,
          project_id: projectId,
        }, requestScope)
        if (isCurrent()) setMessages(data.messages || [])
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
      }
    }).catch(reason => {
      handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message))
    }).finally(() => {
      if (isCurrent()) setHistoryBusy(false)
    })
  }, [departmentId, engagement.id, handleOrganizationAccessError, organizationId, projectId, requestScope, supportsSavedConversations])

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
      setConversationId(created.id)
      setConversationTitle(created.title)
      setMessages([])
      setAttachments([])
      setSelectedAttachmentIds([])
      setPendingFiles([])
      setResult(null)
      setSharing({ can_manage: true, recipients: [] })
      setRecipientIds([])
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
    const isCurrent = completion.current.begin()
    if (!isCurrent()) return
    setConversationId(id)
    setHistoryBusy(true)
    setError('')
    setResult(null)
    setSharing({ can_manage: false, recipients: [] })
    setShareCandidates([])
    setRecipientIds([])
    setAttachments([])
    setSelectedAttachmentIds([])
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
        const selected = await loadConversationList(state === 'active' ? updated.id : '', includeArchived, isCurrent)
        if (!isCurrent()) return
        if (selected) await loadConversation(selected.id, isCurrent)
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
      success: async (selected, isCurrent) => loadConversation(selected?.id || '', isCurrent),
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

  function mimeForFile(file) {
    if (file.type) return file.type.toLowerCase()
    const extension = file.name.toLowerCase().split('.').pop()
    return extension === 'md' ? 'text/markdown' : extension === 'txt' ? 'text/plain' : ''
  }

  async function uploadPendingAttachments() {
    if (!conversationId || !pendingFiles.length) return
    setAttachmentBusy(true)
    setError('')
    try {
      if ((!isConversationOwner || (sharing.recipients || []).length > 0) && !attachmentShare) {
        throw new Error('This conversation is shared. Explicitly share each uploaded source before using it here.')
      }
      const uploaded = []
      for (const file of pendingFiles.slice(0, 3)) {
        const claimedMime = mimeForFile(file)
        if (!claimedMime) throw new Error(`${file.name}: file type could not be verified.`)
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name}: file exceeds 5 MiB.`)
        const isImage = claimedMime === 'image/png' || claimedMime === 'image/jpeg'
        if (!isImage && !attachmentAiUse) throw new Error('Approve AI use before uploading text-bearing files.')
        uploaded.push(await departmentChat.uploadAttachment(departmentId, {
          file, conversation_id: conversationId, engagement_id: engagement.id, project_id: projectId,
          claimed_mime: claimedMime, original_name: file.name,
          data_classification: attachmentClassification,
          ai_use_allowed: isImage ? false : attachmentAiUse,
          share_with_recipients: attachmentShare,
        }, requestScope))
      }
      setPendingFiles([])
      await loadAttachments(conversationId)
      setSelectedAttachmentIds(uploaded.map(item => item.id))
    } catch (reason) {
      handleOrganizationAccessError?.(reason)
      setError(reason.message || 'Attachment upload failed')
    } finally {
      setAttachmentBusy(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    const isCurrent = completion.current.begin()
    if (!isCurrent()) return
    setBusy(true)
    setError('')
    setResult(null)
    setOfficial(null)
    try {
      const proposed = proposalMode === 'artifact'
        ? await departmentChat.proposeArtifact(departmentId, {
          conversation_id: supportsSavedConversations ? conversationId : undefined,
          client_request_id: supportsSavedConversations ? crypto.randomUUID() : undefined,
          attachment_ids: supportsSavedConversations ? selectedAttachmentIds : undefined,
          project_id: supportsSavedConversations ? projectId : undefined,
          engagement_id: engagement.id,
          artifact_id: (artifactForType(artifactType) || {}).id || null,
          engagement_stage_instance_id: (stageForType(artifactType) || {}).id || null,
          artifact_type: artifactType,
          language,
          title: (artifactForType(artifactType)?.title) || `${artifactDefinitions[artifactType]?.label || resolvedDepartmentLabel} artifact`,
          prompt,
          prompt_safe_for_ai: safe,
          change_summary: 'Draft proposed via Shared Department Chat',
        }, requestScope)
        : await departmentChat.proposeWorkItem(departmentId, {
          conversation_id: supportsSavedConversations ? conversationId : undefined,
          client_request_id: supportsSavedConversations ? crypto.randomUUID() : undefined,
          attachment_ids: supportsSavedConversations ? selectedAttachmentIds : undefined,
          project_id: supportsSavedConversations ? projectId : undefined,
          engagement_id: engagement.id,
          title: title || `${artifactDefinitions[artifactType]?.label || 'Work item'} request`,
          work_item_type: workItemType,
          priority,
          prompt,
          prompt_safe_for_ai: safe,
        }, requestScope)
      if (!isCurrent()) return
      setResult({
        ...proposed,
        proposal_kind: proposalMode === 'artifact' ? 'artifact_version' : 'work_item',
        target_key: proposalMode === 'artifact' ? artifactType : workItemType,
      })
      setPrompt('')
      setSafe(false)
      setSelectedAttachmentIds([])
      if (supportsSavedConversations) await loadConversation(conversationId, isCurrent)
    } catch (reason) {
      handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError, failure => setError(failure.message))
      if (supportsSavedConversations && isCurrent()) {
        try { await loadConversation(conversationId, isCurrent) } catch { /* Preserve the original request error. */ }
      }
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  async function decide(action, target = result) {
    if (!target?.proposal_id) return
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

  const isWorkItemMode = proposalMode === 'work_item'
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

  return <div className={`grid gap-6 ${supportsSavedConversations ? 'xl:grid-cols-[260px_minmax(0,1fr)_320px]' : 'xl:grid-cols-[minmax(0,1fr)_360px]'}`}>
    {supportsSavedConversations && <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Conversations</p><p className="mt-1 text-xs text-emerald-300">Private to you or deliberately shared</p></div>
        <button type="button" disabled={busy || historyBusy || !projectId} onClick={createConversation} className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">New</button>
      </div>
      <label className="mt-4 flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={includeArchived} disabled={busy || historyBusy} onChange={event => toggleArchived(event.target.checked).catch(reason => setError(reason.message))} />Show archived</label>
      <div className="mt-4 space-y-2">
        {conversations.map(conversation => <button type="button" key={conversation.id} disabled={busy || historyBusy} onClick={() => selectConversation(conversation.id)} className={`w-full rounded-xl border px-3 py-3 text-left text-sm disabled:opacity-50 ${conversation.id === conversationId ? 'border-sky-600 bg-sky-950/40 text-white' : 'border-slate-800 text-slate-300 hover:border-slate-700'}`}>
          <span className="block truncate font-medium">{conversation.title}</span>
          <span className="mt-1 block text-xs capitalize text-slate-500">{conversation.access_role === 'recipient' ? 'Shared with you' : 'Yours'} · {conversation.state} · {new Date(conversation.last_activity_at).toLocaleString()}</span>
        </button>)}
        {!conversations.length && <p className="rounded-xl border border-dashed border-slate-800 p-4 text-xs leading-5 text-slate-500">No {includeArchived ? '' : 'active '}saved conversations yet.</p>}
      </div>
    </aside>}
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-400">Shared Department Chat · {departmentId}</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Propose a structured artifact or work item</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">The configured model prepares a preview using this engagement and approved AI-safe context. Review and confirm it to create an unapproved artifact version or a work item that has not started.</p>
      </div>
      {error && <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
      {supportsSavedConversations && !projectId && <div className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">Saved chat requires a canonical project-owned engagement.</div>}
      {supportsSavedConversations && currentConversation && <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Conversation title
            <input maxLength="160" readOnly={!isConversationOwner} disabled={busy || historyBusy} className={`${INPUT} mt-2 normal-case tracking-normal`} value={conversationTitle} onChange={event => setConversationTitle(event.target.value)} />
          </label>
          {isConversationOwner && <button type="button" disabled={busy || historyBusy || !conversationTitle.trim()} onClick={() => renameConversation().catch(reason => setError(reason.message))} className="rounded-lg border border-slate-700 px-3 py-2.5 text-xs text-slate-200 disabled:opacity-50">Rename</button>}
          {isConversationOwner && <button type="button" disabled={busy || historyBusy} onClick={() => setConversationState(currentConversation.state === 'active' ? 'archived' : 'active').catch(reason => setError(reason.message))} className="rounded-lg border border-slate-700 px-3 py-2.5 text-xs text-slate-200 disabled:opacity-50">{currentConversation.state === 'active' ? 'Archive' : 'Reopen'}</button>}
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
      {result && <ProposalPreview result={result} official={official} onOpenOfficial={openOfficial} busy={busy} onConfirm={() => decide('confirm')} onReject={() => decide('reject')} />}
      <div className="mt-6 space-y-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Proposal mode
          <select className={`${INPUT} mt-2 normal-case tracking-normal`} value={proposalMode} onChange={event => setProposalMode(event.target.value)}>
            <option value="artifact">Artifact draft</option>
            <option value="work_item">Work item draft</option>
          </select>
        </label>

        {isWorkItemMode ? (
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
                {profile.artifactTypes.map(type => <option key={type} value={type}>{artifactDefinitions[type]?.label || type}</option>)}
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

        {supportsSavedConversations && capabilities?.attachments?.supported && <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Explicit source files</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">TXT, Markdown, and DOCX contribute validated text. PNG/JPEG are reference-only and are never sent to the model. PDF and scanned/OCR documents are unavailable.</p>
          <input
            type="file" multiple
            accept=".txt,.md,.docx,.png,.jpg,.jpeg,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg"
            disabled={busy || historyBusy || attachmentBusy || !currentConversation || currentConversation.state !== 'active'}
            className="mt-3 block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200"
            onChange={event => setPendingFiles([...event.target.files].slice(0, 3))}
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
            <button type="button" disabled={attachmentBusy} onClick={uploadPendingAttachments} className="rounded-lg border border-sky-700 px-3 py-2 text-xs font-semibold text-sky-200 disabled:opacity-50">{attachmentBusy ? 'Validating privately…' : 'Upload and validate'}</button>
          </div>}
          {attachments.length > 0 && <div className="mt-4 space-y-2">
            {attachments.map(item => {
              const ready = ['extracted', 'reference_only'].includes(item.status) && item.data_classification !== 'restricted'
                && (!conversationHasRecipients || item.share_with_recipients)
              const selected = selectedAttachmentIds.includes(item.id)
              return <label key={item.id} className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${ready ? 'border-slate-800 text-slate-300' : 'border-slate-900 text-slate-500'}`}>
                <input type="checkbox" disabled={!ready || busy || attachmentBusy} checked={selected} onChange={() => setSelectedAttachmentIds(current => selected ? current.filter(id => id !== item.id) : current.length < 3 ? [...current, item.id] : current)} />
                <span className="min-w-0"><span className="block truncate font-medium">{item.original_name}</span><span className="mt-1 block capitalize text-slate-500">{item.status.replaceAll('_', ' ')} · {item.data_classification} · {item.share_with_recipients ? 'source shared' : 'uploader only'} · {item.extraction_notice}</span></span>
              </label>
            })}
          </div>}
          <p className="mt-3 text-xs text-slate-500">Choose up to three files for this turn. Only checked files are linked to the request; rejected limits never truncate content. Revocation blocks later server reads and replies, but cannot recall copies someone already saved.</p>
        </section>}

        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Draft request
          <textarea required rows="10" className={`${INPUT} mt-2 normal-case tracking-normal`} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe the draft you need, the evidence to prioritize, known constraints, tone, and gaps the team should keep visible." />
        </label>

        <label className="flex items-start gap-3 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm leading-6 text-amber-200">
          <input required type="checkbox" className="mt-1" checked={safe} onChange={event => setSafe(event.target.checked)} />
          <span>I confirm this prompt and the validated text from explicitly selected files are safe to send to the engagement-mapped {resolvedDepartmentLabel} model. Restricted sources are never included.</span>
        </label>

        <button
          disabled={busy || historyBusy || !safe || (supportsSavedConversations && (!currentConversation || currentConversation.state !== 'active' || !capabilities?.model_id)) || (isWorkItemMode && !title.trim()) || (!isWorkItemMode && !artifactType)}
          className={`${PRIMARY} w-full`}
        >
          {busy ? 'Generating safe preview…' : isWorkItemMode ? 'Preview draft work item' : 'Preview draft artifact'}
        </button>
      </div>
    </form>
    <aside className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Current context</p>
        <p className="mt-2 font-semibold text-white">{engagement.brands?.name || engagement.name}</p>
        <p className="mt-1 text-sm text-slate-400">{engagement.agency_clients?.name}</p>
      </div>
      {supportsSavedConversations && <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm leading-6 text-slate-400">
        <p className="font-semibold text-white">Configured AI</p>
        {capabilities ? <><p className="mt-2">OpenAI · <span className="text-slate-200">{capabilities.model_id}</span></p><p className="mt-1 text-xs text-slate-500">Administrator-approved default. Model switching is not enabled in this foundation.</p></> : <p className="mt-2">{historyBusy ? 'Checking configuration…' : 'Configuration unavailable.'}</p>}
        <p className="mt-3 text-xs text-amber-300">Private files: TXT/Markdown/DOCX validated text; PNG/JPEG reference-only. PDF, OCR, and vision input remain unavailable.</p>
      </div>}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm leading-6 text-slate-400">
        <p className="font-semibold text-white">Human control remains intact</p>
        <p className="mt-2">The human user is recorded as the timeline actor. The model run is separately traceable. Approval remains available only through the normal exact-version manager action.</p>
      </div>
    </aside>
  </div>
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
          <span className={message.status === 'failed' ? 'text-red-300' : ['pending', 'unknown'].includes(message.status) ? 'text-amber-300' : 'text-slate-500'}>{message.status}</span>
        </div>
        {message.role === 'user' && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{message.body}</p>}
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
