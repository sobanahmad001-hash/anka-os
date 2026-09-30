import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DepartmentChat from './DepartmentChat.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { contentStudio } from '../data/contentStudioRepository.js'
import './contentChatWriter.css'
import { contentArtifactChatTargets } from '../data/contentArtifactChat.js'
const ContentChatWriterPane = lazy(() => import('./ContentChatWriterPane.jsx'))
export default function ContentArtifactChat({ engagement, projectId, onCreated, sideEditor = false, onNavigationBusyChange, ...conversationProps }) {
  const { activeOrganizationId, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const key = JSON.stringify([activeOrganizationId, scopeRevision, projectId, engagement?.id, engagement?.brand_id])
  const current = useRef(key); current.current = key
  const generation = useRef(0)
  const [state, setState] = useState(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [editorState, setEditorState] = useState({ dirty: false, saving: false })
  const editorBusy = editorOpen && (editorState.dirty || editorState.saving)
  const studio = useMemo(() => activeOrganizationId ? contentStudio.forOrganization(activeOrganizationId, { signal: requestSignal }) : null, [activeOrganizationId, requestSignal])
  useEffect(() => {
    onNavigationBusyChange?.(chatBusy || editorBusy)
    return () => onNavigationBusyChange?.(false)
  }, [chatBusy, editorBusy, onNavigationBusyChange])
  const load = useCallback(async () => {
    const identity = ++generation.current
    const valid = () => current.current === key && generation.current === identity && !requestSignal?.aborted
    if (!studio || engagement?.organization_id !== activeOrganizationId || engagement?.project_id !== projectId || requestSignal?.aborted) return false
    setState(previous => previous?.key === key && previous.workspace ? { ...previous, refreshing: true } : { key, status: 'loading' })
    try {
      const workspace = await studio.load(engagement.id)
      const targets = contentArtifactChatTargets(workspace, { organizationId: activeOrganizationId, projectId, engagementId: engagement.id, brandId: engagement.brand_id })
      if (!valid()) return false
      setState({ key, status: targets ? 'ready' : 'unavailable', targets, workspace: targets ? workspace : null, refreshing: false })
      return Boolean(targets)
    } catch (error) {
      if (valid()) {
        handleOrganizationAccessError?.(error)
        setState(previous => ({ key, status: 'unavailable', refreshing: false, workspace: error.status === 403 || error.status === 401 ? null : previous?.key === key ? previous.workspace : null }))
      }
      return false
    }
  }, [activeOrganizationId, engagement?.id, engagement?.brand_id, engagement?.organization_id, engagement?.project_id, projectId, key, studio, requestSignal, handleOrganizationAccessError])
  useEffect(() => {
    const abort = () => { if (current.current === key) { generation.current += 1; setState({ key, status: 'unavailable' }) } }
    requestSignal?.addEventListener('abort', abort, { once: true })
    load()
    return () => { generation.current += 1; requestSignal?.removeEventListener('abort', abort) }
  }, [load, key, requestSignal])
  const targets = state?.key === key && state.status === 'ready' && !requestSignal?.aborted ? state.targets : null
  const workspace = state?.key === key && !requestSignal?.aborted ? state.workspace : null
  const closeEditor = () => {
    if (editorState.saving) return
    if (editorState.dirty && !globalThis.confirm('Discard unsaved Content writer edits and close the side editor?')) return
    setEditorOpen(false); setEditorState({ dirty: false, saving: false })
  }
  return <section aria-label="Content artifact chat" className="space-y-3">
    {!targets && <p role="status" className="text-sm text-[var(--anka-warning)]">{state?.key !== key || state.status === 'loading' ? 'Loading Content artifact tools. Ordinary chat remains available.' : 'Content artifact tools are unavailable for this context. Ordinary chat remains available.'}</p>}
    {sideEditor && <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-[var(--anka-muted)]">Versioned Content writer outputs have their own editor. Conversation replies and legacy proposals are not transferred.</p>
      <button type="button" disabled={!workspace || chatBusy || editorState.saving} aria-expanded={editorOpen} aria-controls="content-chat-writer" onClick={() => editorOpen ? closeEditor() : setEditorOpen(true)} className="rounded-lg border border-[var(--anka-line)] px-3 py-2 text-sm disabled:opacity-50">{editorOpen ? 'Close Content writer' : 'Open Content writer beside chat'}</button>
    </div>}
    <div className={sideEditor && editorOpen ? 'content-chat-with-editor' : undefined}>
      <div className="min-w-0"><DepartmentChat {...conversationProps} engagement={engagement} departmentId="content" allowArtifactDraft={Boolean(targets)}
        externalNavigationBusy={Boolean(conversationProps.externalNavigationBusy || editorState.saving)} onNavigationBusyChange={setChatBusy}
        artifactDefinitions={targets?.definitions || {}} artifactForType={targets?.artifactForType} stageForType={targets?.stageForType}
        onCreated={async (...args) => { if (current.current !== key || requestSignal?.aborted) return; await load(); if (current.current === key && !requestSignal?.aborted) onCreated?.(...args) }} /></div>
      {sideEditor && editorOpen && workspace && <aside id="content-chat-writer" className="content-chat-writer" aria-label="Canonical Content side editor">
        <Suspense fallback={<p role="status">Loading Content writer…</p>}><ContentChatWriterPane key={key} workspace={workspace} studio={studio} refresh={load} refreshing={Boolean(state.refreshing)} stale={state.status !== 'ready'} onStateChange={setEditorState} /></Suspense>
      </aside>}
    </div>
  </section>
}
