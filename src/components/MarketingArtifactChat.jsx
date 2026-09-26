import { useCallback, useEffect, useRef, useState } from 'react'
import DepartmentChat from './DepartmentChat.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { supabase } from '../lib/supabase.js'
import { loadMarketingArtifactChatWorkspace, marketingArtifactChatTargets, MARKETING_CHAT_ARTIFACT_TYPES } from '../data/marketingArtifactChat.js'

export default function MarketingArtifactChat({ engagement, projectId, activeServiceId, onCreated, ...conversationProps }) {
  const { activeOrganizationId, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const key = JSON.stringify([activeOrganizationId, scopeRevision, projectId, engagement?.id, engagement?.brand_id, activeServiceId])
  const current = useRef(key); current.current = key
  const generation = useRef(0)
  const [state, setState] = useState(null)
  const load = useCallback(async () => {
    const token = ++generation.current
    const valid = () => current.current === key && generation.current === token && !requestSignal?.aborted
    setState({ key, status: 'loading' })
    if (engagement?.organization_id !== activeOrganizationId || engagement?.project_id !== projectId || requestSignal?.aborted) {
      if (valid()) setState({ key, status: 'unavailable' })
      return
    }
    try {
      const workspace = await loadMarketingArtifactChatWorkspace(supabase, activeOrganizationId, engagement.id, { signal: requestSignal })
      const targets = marketingArtifactChatTargets(workspace, {
        organizationId: activeOrganizationId, projectId, engagementId: engagement.id, brandId: engagement.brand_id, activeServiceId,
      })
      if (valid()) setState({ key, status: targets ? 'ready' : 'unavailable', targets })
    } catch (error) {
      if (valid()) { handleOrganizationAccessError?.(error); setState({ key, status: 'unavailable' }) }
    }
  }, [activeOrganizationId, activeServiceId, engagement?.id, engagement?.brand_id, engagement?.organization_id, engagement?.project_id, projectId, key, requestSignal, handleOrganizationAccessError])
  useEffect(() => {
    const abort = () => { generation.current += 1; setState({ key, status: 'unavailable' }) }
    requestSignal?.addEventListener('abort', abort, { once: true })
    load()
    return () => { generation.current += 1; requestSignal?.removeEventListener('abort', abort) }
  }, [load, key, requestSignal])
  const targets = state?.key === key && state.status === 'ready' && !requestSignal?.aborted ? state.targets : null
  return <section aria-label="Marketing artifact chat" className="space-y-3">
    {!targets && <p role="status" className="text-sm text-amber-200">{state?.key !== key || state.status === 'loading' ? 'Loading Marketing draft tools. Ordinary chat remains available.' : 'Marketing draft tools are unavailable for this context. Ordinary chat remains available.'}</p>}
    <DepartmentChat {...conversationProps} key={key} engagement={engagement} departmentId="marketing"
      allowedArtifactTypes={MARKETING_CHAT_ARTIFACT_TYPES} allowArtifactDraft={Boolean(targets)}
      artifactDefinitions={targets?.definitions || {}} artifactForType={targets?.artifactForType} stageForType={targets?.stageForType}
      onCreated={async (...args) => { if (current.current !== key || requestSignal?.aborted) return; await load(); if (current.current === key && !requestSignal?.aborted) onCreated?.(...args) }} />
  </section>
}
