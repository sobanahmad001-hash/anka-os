import { useCallback, useEffect, useRef, useState } from 'react'
import DepartmentChat from './DepartmentChat.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { contentStudio } from '../data/contentStudioRepository.js'
import { contentArtifactChatTargets } from '../data/contentArtifactChat.js'
export default function ContentArtifactChat({ engagement, projectId, onCreated, ...conversationProps }) {
  const { activeOrganizationId, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const key = JSON.stringify([activeOrganizationId, scopeRevision, projectId, engagement?.id, engagement?.brand_id])
  const current = useRef(key); current.current = key
  const generation = useRef(0)
  const [state, setState] = useState(null)
  const load = useCallback(async () => {
    const identity = ++generation.current
    const valid = () => current.current === key && generation.current === identity && !requestSignal?.aborted
    if (engagement?.organization_id !== activeOrganizationId || engagement?.project_id !== projectId || requestSignal?.aborted) return
    setState({ key, status: 'loading' })
    try {
      const workspace = await contentStudio.forOrganization(activeOrganizationId, { signal: requestSignal }).load(engagement.id)
      const targets = contentArtifactChatTargets(workspace, { organizationId: activeOrganizationId, projectId, engagementId: engagement.id, brandId: engagement.brand_id })
      if (valid()) setState({ key, status: targets ? 'ready' : 'unavailable', targets })
    } catch (error) {
      if (valid()) { handleOrganizationAccessError?.(error); setState({ key, status: 'unavailable' }) }
    }
  }, [activeOrganizationId, engagement?.id, engagement?.organization_id, engagement?.project_id, projectId, key, requestSignal, handleOrganizationAccessError])
  useEffect(() => {
    const abort = () => { if (current.current === key) { generation.current += 1; setState({ key, status: 'unavailable' }) } }
    requestSignal?.addEventListener('abort', abort, { once: true })
    load()
    return () => { generation.current += 1; requestSignal?.removeEventListener('abort', abort) }
  }, [load, key, requestSignal])
  const targets = state?.key === key && state.status === 'ready' && !requestSignal?.aborted ? state.targets : null
  return <section aria-label="Content artifact chat" className="space-y-3">
    {!targets && <p role="status" className="text-sm text-amber-200">{state?.key !== key || state.status === 'loading' ? 'Loading Content artifact tools. Ordinary chat remains available.' : 'Content artifact tools are unavailable for this context. Ordinary chat remains available.'}</p>}
    <DepartmentChat {...conversationProps} engagement={engagement} departmentId="content" allowArtifactDraft={Boolean(targets)}
      artifactDefinitions={targets?.definitions || {}} artifactForType={targets?.artifactForType} stageForType={targets?.stageForType}
      onCreated={async (...args) => { if (current.current !== key || requestSignal?.aborted) return; await load(); if (current.current === key && !requestSignal?.aborted) onCreated?.(...args) }} />
  </section>
}
