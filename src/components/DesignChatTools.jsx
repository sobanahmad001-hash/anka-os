import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { designWorkshop } from '../data/designWorkshopRepository.js'
import { designCapabilities } from '../data/designWorkshopContext.js'
import { eligibleDesignVersions, requireDesignVersion } from '../data/designChatTools.js'
import DesignMediaPanel from './DesignMediaPanel.jsx'
import DesignVideoCapabilities from './DesignVideoCapabilities.jsx'

export default function DesignChatTools({ engagement, onNavigationBusyChange, presentation }) {
  const { activeOrganizationId, scopeRevision } = useOrganization()
  return <ScopedDesignChatTools key={`${activeOrganizationId}:${scopeRevision}:${engagement?.project_id}:${engagement?.id}`}
    engagement={engagement} onNavigationBusyChange={onNavigationBusyChange} presentation={presentation} />
}

function ScopedDesignChatTools({ engagement, onNavigationBusyChange, presentation }) {
  const { activeOrganizationId, activeMembership, requestSignal } = useOrganization()
  const studio = useMemo(() => activeOrganizationId ? designWorkshop.forOrganization(activeOrganizationId, { signal: requestSignal }) : null, [activeOrganizationId, requestSignal])
  const scope = useMemo(() => ({ organizationId: activeOrganizationId, projectId: engagement?.project_id, engagementId: engagement?.id }), [activeOrganizationId, engagement?.project_id, engagement?.id])
  const allowed = designCapabilities(activeMembership).executeGeneration
  const [workspace, setWorkspace] = useState(null)
  const [versionId, setVersionId] = useState('')
  const [tool, setTool] = useState('')
  const [opened, setOpened] = useState({ image: false, video: false })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [videoBusy, setVideoBusy] = useState(false)
  const alive = useRef(true)
  const inFlight = useRef(false)
  const retries = useRef(new Map())
  const allowedRef = useRef(allowed)
  allowedRef.current = allowed
  const current = useCallback(() => alive.current && !requestSignal?.aborted, [requestSignal])
  const navigationBusy = Boolean(busy || imageBusy || videoBusy || retries.current.size)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => { onNavigationBusyChange?.(navigationBusy) }, [navigationBusy, onNavigationBusyChange])
  useEffect(() => {
    if (!navigationBusy) return
    const guard = event => { event.preventDefault(); if (event.type === 'beforeunload') event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    window.addEventListener('anka:organization-change', guard)
    return () => { window.removeEventListener('beforeunload', guard); window.removeEventListener('anka:organization-change', guard) }
  }, [navigationBusy])
  useEffect(() => {
    let active = true
    if (!studio || !scope.engagementId || !scope.projectId || !allowed || requestSignal?.aborted) return
    studio.load(scope.engagementId).then(data => {
      if (active && current()) { setWorkspace(data); setNotice('') }
    }).catch(() => { if (active && current()) setNotice('Design context could not be loaded. No generation is available.') })
    return () => { active = false }
  }, [studio, scope, allowed, requestSignal, current])
  const versions = eligibleDesignVersions(workspace, scope)
  const version = versions.find(item => item.id === versionId)
  const revalidate = useCallback(async exactVersionId => {
    if (!current() || !allowedRef.current) throw new Error('Design context changed. Nothing was submitted.')
    const fresh = await studio.load(scope.engagementId)
    if (!current() || !allowedRef.current) throw new Error('Design context changed. Nothing was submitted.')
    requireDesignVersion(fresh, scope, exactVersionId)
    return fresh
  }, [current, studio, scope])
  async function imageAction(kind, args) {
    if (inFlight.current || !version || !current() || !allowedRef.current) return false
    inFlight.current = true
    const id = version.id
    let dispatched = false
    setBusy(kind === 'generate' ? `image-${id}` : kind === 'retry' ? `retry-image-${args[0]}` : `image-job-${args[0]}`)
    setNotice('')
    try {
      const fresh = await revalidate(id)
      if (kind === 'generate') {
        const model = fresh.models.find(model => model.id === args[0] && model.is_active === true && model.supported_output_types?.includes('image'))
        if (!model) throw new Error('The selected image model is unavailable.')
        dispatched = true
        await studio.generateImage(id, ...args)
      } else {
        const job = fresh.imageGenerationJobs.find(job => job.id === args[0] && job.direction_version_id === id && job.organization_id === scope.organizationId)
        if (!job) throw new Error('The original image request is unavailable in this context.')
        if (kind === 'retry') {
          if (job.status !== 'failed' || job.failure_phase !== 'provider') throw new Error('Only confirmed provider failures can be retried.')
          const operationKey = retries.current.get(job.id) || args[1]
          retries.current.set(job.id, operationKey)
          dispatched = true
          await studio.retryImageGeneration(job.id, operationKey)
          retries.current.delete(job.id)
        } else await studio.getImageGenerationJob(job.id)
      }
      // A successful API response establishes the durable original identity even if refresh fails.
      try { const fresh = await studio.load(scope.engagementId); if (current()) setWorkspace(fresh) }
      catch { if (current()) setNotice('Request recorded. Reopen this exact direction in the Workshop to refresh its history.') }
      return true
    } catch (error) {
      if (current()) setNotice(error.message || 'Request outcome is unconfirmed. Reconcile the same request.')
      // Pre-dispatch validation failures have no uncertain provider identity to retain.
      return !dispatched
    }
    finally { inFlight.current = false; if (current()) setBusy('') }
  }
  if (!engagement || !scope.projectId) return <p className="text-sm text-slate-400">Select a project engagement to use Design tools. Private chat is not copied into project context.</p>
  if (!allowed) return <p className="text-sm text-slate-400">Design generation is unavailable for your current membership.</p>
  return <section aria-label="Design chat tools" className={presentation === 'workbench' ? 'design-tools-workbench' : 'rounded-xl border border-white/10 p-3'}>
    <p className="font-semibold">Design tools</p>
    <p className="mt-1 text-xs text-slate-400">Work from an exact saved direction. Video stays private until you explicitly copy an unapproved draft to a project.</p>
    <label className="mt-3 block text-sm">Exact direction version
      <select aria-label="Exact direction version" value={versionId} disabled={navigationBusy} className="ml-2 max-w-full rounded bg-slate-900 p-2"
        onChange={event => { if (navigationBusy) return; setVersionId(event.target.value); setTool(''); setOpened({ image: false, video: false }) }}>
        <option value="">Choose exact version</option>
        {versions.map(item => <option key={item.id} value={item.id}>{item.content?.title || 'Direction'} · v{item.version_number} · {presentation === 'workbench' ? item.id.slice(0, 8) : item.id}</option>)}
      </select>
    </label>
    {presentation === 'workbench' && version && <details className="design-direction-reference"><summary>Selected reference & version</summary><p>{version.content?.creative_thesis || version.content?.imagery_direction || 'Saved direction'}</p><p>Project: {scope.projectId} · Engagement: {scope.engagementId}</p><p>Exact immutable version: {version.id}</p><p>This reference is not a release or approval. Review remains in the existing project workflow.</p></details>}
    {!versions.length && <p className="mt-2 text-sm text-amber-200">No eligible direction version is loaded. An active Design service and an existing project direction are required; create one in the Design Workshop.</p>}
    <div className="mt-3 flex gap-2">{['image', 'video'].map(name => <button key={name} type="button" disabled={!version} aria-pressed={tool === name} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40" onClick={() => { setTool(name); setOpened(current => ({ ...current, [name]: true })) }}>{name === 'image' ? 'Image' : 'Video'}</button>)}</div>
    {notice && <p role="status" className="mt-2 text-sm text-amber-200">{notice}</p>}
    {navigationBusy && <p className="mt-2 text-xs text-amber-200">Keep this context open while a request is pending or its outcome is unconfirmed.</p>}
    {presentation === 'workbench' && !tool && <div className="design-output-empty">Choose an exact direction, then Image or Video to open controls and existing outputs. No request runs on selection.</div>}
    {version && <div key={version.id}>
      {opened.image && <div hidden={tool !== 'image'}><DesignMediaPanel presentation={presentation} version={version} models={workspace.models} assets={workspace.mediaAssets} jobs={workspace.imageGenerationJobs} allowVideo={false} busy={busy}
        onNavigationBusyChange={setImageBusy} onGenerateImage={(...args) => imageAction('generate', args)} onRefreshImageJob={(...args) => imageAction('status', args)} onRetryImageJob={(...args) => imageAction('retry', args)} /></div>}
      {opened.video && <div hidden={tool !== 'video'}><DesignVideoCapabilities presentation={presentation} directionVersionId={version.id} beforeGenerate={revalidate} onNavigationBusyChange={setVideoBusy} /></div>}
    </div>}
  </section>
}
