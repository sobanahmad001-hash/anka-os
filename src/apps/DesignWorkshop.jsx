import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { OUTPUT_FAMILIES, latestByVersion } from '../data/designWorkshop.js'
import { canRequestDesignExperimentPromotion, designAllowedActions, designCapabilities, designSelectionParams, loadDesignEngagements, privateDesignParams, resolveDesignContext, resolveDesignNavigationScope, selectableDesignEngagements } from '../data/designWorkshopContext.js'
import { designWorkshop } from '../data/designWorkshopRepository.js'
import { productionHandoffs } from '../data/productionHandoffsRepository.js'
import { appendWorkshopNavigation, parseWorkshopNavigation, validateWorkshopNavigation, workspaceReturnTarget } from '../data/workshopNavigation.js'
import { composePageDesignPreview } from '../data/websitePageDesigns.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import WorkshopContextShell from '../components/WorkshopContextShell.jsx'
import VersionProofingPanel from '../components/VersionProofingPanel.jsx'
import ArtifactRelationsPanel from '../components/ArtifactRelationsPanel.jsx'
import ProductionHandoffPanel from '../components/ProductionHandoffPanel.jsx'
import DesignCreativeBriefWorkspace from '../components/DesignCreativeBriefWorkspace.jsx'
import DesignAssetLibrary from '../components/DesignAssetLibrary.jsx'
import DesignConnectionsPanel from '../components/DesignConnectionsPanel.jsx'
import _DesignDeniedState from '../components/DesignDeniedState.js'
import { creativeBriefVersionsForDirectionContext, validateCreativeBriefVersionSelection } from '../data/designCreativeBriefs.js'
import { designAssetLibraryContextKey, designAssetSourceFocus } from '../data/designAssetLibrary.js'
import { identityProvenanceForDirection } from '../data/designIdentityReferences.js'

const INPUT = 'w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-violet-500/60'
const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'
const VARIANT_FORMATS = [
  ['square_1x1', 'Square 1:1 · 1080×1080'], ['portrait_4x5', 'Portrait 4:5 · 1080×1350'],
  ['story_9x16', 'Story / Reel 9:16 · 1080×1920'], ['landscape_1_91x1', 'Landscape 1.91:1 · 1200×628'],
  ['banner_728x90', 'Leaderboard · 728×90'], ['banner_300x250', 'Medium rectangle · 300×250'],
]

export default function DesignWorkshop() {
  const { user } = useAuth()
  const { activeOrganizationId, activeOrganization, activeMembership, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigationContext = useMemo(() => parseWorkshopNavigation(searchParams), [searchParams])
  const requestedPrivate = searchParams.get('mode') === 'private'
  const studio = useMemo(() => activeOrganizationId ? designWorkshop.forOrganization(activeOrganizationId, { signal: requestSignal }) : null, [activeOrganizationId, requestSignal])
  const capabilities = useMemo(() => designCapabilities(activeMembership), [activeMembership])
  const allowedActions = useMemo(() => designAllowedActions(capabilities), [capabilities])
  const requestGeneration = useRef(0)
  const deferredContext = useRef(null)
  const [engagements, setEngagements] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const requestedTab = ['artifacts', 'workshop'].includes(navigationContext.workshopTab) ? navigationContext.workshopTab : 'artifacts'
  const [tab, setTab] = useState(requestedTab)
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [engagementLoadState, setEngagementLoadState] = useState('loading')
  const [workspaceLoadState, setWorkspaceLoadState] = useState('idle')
  const [engagementRetry, setEngagementRetry] = useState(0)
  const [pendingSelection, setPendingSelection] = useState(null)
  const context = useMemo(() => resolveDesignContext(navigationContext, engagements, activeOrganizationId, requestedPrivate), [activeOrganizationId, engagements, navigationContext, requestedPrivate])
  const selectableEngagements = useMemo(() => selectableDesignEngagements(navigationContext, engagements), [engagements, navigationContext])
  const engagementId = context.engagement?.id || ''
  const canonicalScope = useMemo(() => resolveDesignNavigationScope(
    navigationContext, workspace, activeOrganizationId, capabilities, allowedActions,
  ), [activeOrganizationId, allowedActions, capabilities, navigationContext, workspace])
  const navigationValidation = validateWorkshopNavigation(navigationContext,
    workspaceLoadState === 'error' && !workspace
      ? { status: 'error', error: new Error(error || 'Design context load failed') }
      : canonicalScope)
  const officialReady = context.officialReady && navigationValidation.status === 'ready'
  const sameOrganization = !navigationContext.organizationId || navigationContext.organizationId === activeOrganizationId
  const returnTarget = workspaceReturnTarget(
    navigationValidation.context ? navigationValidation : {},
    { fallbackProjectId: sameOrganization ? context.projectId : '' },
  )
  const parentWorkshopPath = appendWorkshopNavigation('/sphere/design', {
    ...(navigationValidation.context || {}),
    workshopTab: '',
  })

  useEffect(() => {
    const generation = ++requestGeneration.current
    deferredContext.current = null
    setEngagements([]); setWorkspace(null); setModal(null); setPendingSelection(null); setEngagementLoadState(studio ? 'loading' : 'error'); setWorkspaceLoadState('idle'); setBusy(studio ? 'load' : ''); setError('')
    if (!studio) return undefined
    loadDesignEngagements(studio, { signal: requestSignal, isCurrent: () => generation === requestGeneration.current }).then(result => {
      if (result.status === 'stale') return
      if (result.status === 'ready') { setEngagements(result.items); setEngagementLoadState('ready'); return }
      handleOrganizationAccessError(result.error, { membershipMismatch: result.error?.membershipMismatch })
      setEngagementLoadState('error'); setError('Design work could not be loaded for the active organization.')
    }).finally(() => {
      if (!requestSignal.aborted && generation === requestGeneration.current) setBusy('')
    })
    return () => { requestGeneration.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeRevision, studio, engagementRetry])
  useEffect(() => { setTab(requestedTab) }, [requestedTab])
  useEffect(() => { if (engagementId) refresh(); else { setWorkspace(null); setWorkspaceLoadState('idle') } }, [engagementId, navigationContext]) // eslint-disable-line react-hooks/exhaustive-deps

  function capture(reason, generation = requestGeneration.current) {
    if (requestSignal.aborted || generation !== requestGeneration.current) return
    handleOrganizationAccessError(reason, { membershipMismatch: reason?.membershipMismatch })
    setError(reason instanceof Error ? reason.message : String(reason)); setBusy('')
  }
  async function refresh() {
    const generation = ++requestGeneration.current
    const mediaUrlsRequestedAt = Date.now()
    setError(''); setBusy('load'); setWorkspaceLoadState('loading')
    try {
      const result = await studio.load(engagementId, navigationContext)
      if (!requestSignal.aborted && generation === requestGeneration.current) {
        let mediaUrlOrigin = ''
        try { mediaUrlOrigin = new URL(import.meta.env.VITE_SUPABASE_URL).origin } catch { /* invalid configuration fails signed links closed */ }
        setWorkspace({ ...result, mediaUrlsRequestedAt, mediaUrlOrigin }); setWorkspaceLoadState('ready')
      }
    } catch (reason) { if (!requestSignal.aborted && generation === requestGeneration.current) setWorkspaceLoadState('error'); capture(reason, generation) }
    finally { if (!requestSignal.aborted && generation === requestGeneration.current) setBusy('') }
  }
  async function act(key, action, capability = 'createDraft') {
    if (!officialReady) { setError(`Official save is blocked. Missing: ${context.missing.join(', ') || 'an authorized exact work context'}.`); return false }
    if (!capabilities[capability]) { setError('Your existing server role does not permit this action in Design.'); return false }
    setBusy(key); setError('')
    let completed = false
    try {
      const result = await action(); setModal(null)
      if (deferredContext.current) {
        const next = deferredContext.current
        deferredContext.current = null
        setPendingSelection(null); setWorkspace(null); setSearchParams(next)
      } else await refresh()
      completed = result || true
    } catch (reason) { deferredContext.current = null; capture(reason) } finally { setBusy('') }
    return completed
  }
  function requestSelection(params) {
    if (modal) setPendingSelection({ params })
    else { setWorkspace(null); setSearchParams(params) }
  }
  function saveCurrentAndSwitch() {
    if (!context.accessValid || !officialReady || !capabilities.createDraft) return
    deferredContext.current = pendingSelection?.params || new URLSearchParams()
    setPendingSelection(null)
    document.querySelector('.fixed.inset-0 form')?.requestSubmit()
  }
  function discardAndSwitch() {
    const next = pendingSelection?.params || new URLSearchParams()
    deferredContext.current = null; setPendingSelection(null); setModal(null); setWorkspace(null); setSearchParams(next)
  }
  async function prepareHandoff(release) {
    if (!officialReady || !capabilities.createDraft) { setError('An authorized official Design context is required before saving a handoff.'); return }
    setBusy(`handoff-${release.id}`); setError('')
    try { await productionHandoffs.create(release.id, engagementId); await refresh() }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      try { setWorkspace(await studio.load(engagementId, navigationContext)) } catch { /* Keep the packaging failure primary. */ }
      setError(message)
    } finally { setBusy('') }
  }
  async function downloadHandoff(packageId) {
    setBusy(`download-${packageId}`); setError('')
    try {
      const signed = await productionHandoffs.signDownload(packageId)
      window.location.assign(signed.signed_url)
    } catch (reason) { capture(reason) } finally { setBusy('') }
  }

  if (engagementLoadState === 'error') return <Shell><div role="alert" className="mx-auto max-w-xl rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center"><h1 className="text-xl font-semibold text-red-100">Design work could not be loaded</h1><p className="mt-2 text-sm text-red-200">The active organization could not be checked. No work has been selected.</p><button type="button" onClick={() => setEngagementRetry(value => value + 1)} className={`${BUTTON} mt-5`}>Retry</button></div></Shell>
  if (busy === 'load' && !engagements.length) return <Shell><Empty title="Loading Design work" text="Checking authorized engagements in the active organization." /></Shell>
  if (context.mode === 'choose') return <Shell parentPath={parentWorkshopPath}><ChooseWork engagements={selectableEngagements} filter={filter} setFilter={setFilter} onSelect={item => setSearchParams(designSelectionParams(navigationContext, item, activeOrganizationId))} onPrivate={() => setSearchParams(privateDesignParams(navigationContext, activeOrganizationId))} /></Shell>
  if (context.mode === 'private') return <Shell><PrivateDesk draft={navigationContext.draft} returnTarget={workspaceReturnTarget(navigationContext)} onChoose={() => setSearchParams({})} /></Shell>
  if (context.mode === 'denied') {
    return <_DesignDeniedState activeOrganizationId={activeOrganizationId} onChoose={() => setSearchParams({})} />
  }
  if (!engagements.length && !error) return <Shell><Empty title="No Design engagement yet" text="Activate at least one Design service on an engagement before opening the Workshop." /></Shell>
  if (workspaceLoadState === 'loading' && !workspace) return <Shell><Empty title="Loading exact Design context" text="Resolving the selected work record, output, version, and draft." /></Shell>
  return <Shell>
    <WorkshopContextShell navigation={navigationContext} validation={navigationValidation} returnTarget={returnTarget} projectName={context.engagement?.name}>
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[.24em] text-violet-400">Designer-controlled environment</p><h1 className="mt-2 text-3xl font-semibold">Design Workshop</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Approved human context becomes traceable design directions or an ordered storyboard sequence. Nothing is approved or released automatically.</p></div>
        <div className="flex flex-wrap items-end gap-3"><Link to={parentWorkshopPath} className={BUTTON}>Back to Design Workshop</Link><Field label="Authorized work"><select className={`${INPUT} min-w-72`} value={engagementId} onChange={event => { const item = engagements.find(candidate => candidate.id === event.target.value); requestSelection(item ? designSelectionParams(navigationContext, item, activeOrganizationId) : new URLSearchParams()) }}><option value="">Choose work</option>{engagements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
    </div>
    <ContextStrip context={context} navigation={navigationContext} organizationName={activeOrganization?.name} unsaved={Boolean(modal)} capabilities={capabilities} officialReady={officialReady} />
    {error && <div role="alert" className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
    {!officialReady && <div role="alert" className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">Official save is blocked. Complete: {context.missing.join(', ') || 'the exact shared work context'}. Browsing remains available.</div>}
    <div className="mt-5 flex gap-2 overflow-x-auto">{[['artifacts', 'References'], ['workshop', 'Design desk']].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-white text-slate-950' : 'bg-white/5 text-slate-300'}`}>{label}</button>)}</div>
    {busy === 'load' || !workspace ? <div className="py-20 text-center text-sm text-slate-500">Loading exact versions…</div>
      : tab === 'artifacts' ? <><ArtifactWorkspace workspace={workspace} /><DesignConnectionsPanel key={`${activeOrganizationId}:${scopeRevision}`} organizationId={activeOrganizationId} scopeRevision={scopeRevision} requestSignal={requestSignal} handleOrganizationAccessError={handleOrganizationAccessError} canManage={capabilities.manageConnections} /></>
        : <><div className="mt-6"><DesignCreativeBriefWorkspace workspace={workspace} activeServiceId={context.service?.id || workspace.designServices[0]?.id || ''} workRecord={workspace.navigationWorkRecord} busy={busy} canSave={officialReady && capabilities.createDraft} onSave={input => act('save-brief', () => studio.saveCreativeBrief(input))} onFreeze={input => act('freeze-brief', () => studio.freezeCreativeBrief(input))} /></div><WorkshopWorkspace workspace={workspace} assetLibraryContextKey={designAssetLibraryContextKey({ ...canonicalScope, contextKey: context.contextKey })} focusedSessionId={navigationContext.output?.kind === 'design_session' ? navigationContext.output.id : ''} focusedVersionId={navigationContext.output?.versionId || ''} focusedDraftId={navigationContext.draft?.kind === 'private_experiment' ? navigationContext.draft.id : ''} canUploadAsset={officialReady && capabilities.createDraft} onUploadAsset={input => act('asset-upload', () => studio.uploadAssetVersion(input))} canArchiveAsset={officialReady && capabilities.archiveDraftAsset} onArchiveAsset={(row, operationKey) => act(`asset-archive-${row.assetId}`, () => studio.archiveAsset({ asset_id: row.assetId, expected_latest_version_id: row.assetVersionId, operation_key: operationKey, reason: 'Archived from the Design asset library after explicit human confirmation.' }), 'archiveDraftAsset')} canPromoteExperiment={version => canRequestDesignExperimentPromotion(activeMembership, version, user?.id)} onCreateFlow={() => setModal({ kind: 'flow' })} onCreate={() => setModal({ kind: 'session' })} onGenerate={session => act(`generate-${session.id}`, () => studio.generateDirections(session.id), 'executeGeneration')} onGenerateImage={(version, modelId, prompt, requestKey) => act(`image-${version.id}`, () => studio.generateImage(version.id, modelId, prompt, requestKey), 'executeGeneration')} onRefreshImageJob={jobId => act(`image-job-${jobId}`, () => studio.getImageGenerationJob(jobId), 'executeGeneration')} onRetryImageJob={(jobId, requestKey) => act(`retry-image-${jobId}`, () => studio.retryImageGeneration(jobId, requestKey), 'executeGeneration')} onGenerateVariants={(versionId, modelId, formats) => act(`variants-${versionId}`, () => studio.generateVariants(versionId, modelId, formats), 'executeGeneration')} onGenerateVideo={(version, prompt) => act(`video-${version.id}`, () => studio.createVideoPlaceholder(version.id, prompt), 'executeGeneration')} onGeneratePage={(versionId, slug, modelId) => act('generate-page', () => studio.generatePageDesign(versionId, slug, modelId), 'executeGeneration')} onSubmitPage={designId => act(`submit-page-${designId}`, () => studio.submitPageDesignReview(designId))} onApprovePage={designId => act(`approve-page-${designId}`, () => studio.approvePageDesign(designId), 'release')} onExportPage={designId => act(`export-page-${designId}`, () => studio.exportPageDesign(designId), 'release')} onDownloadExport={jobId => act(`download-export-${jobId}`, async () => { const result = await studio.getWordPressExportDownload(jobId); window.location.assign(result.download_url) })} onPrepareHandoff={prepareHandoff} onDownloadHandoff={downloadHandoff} onRefine={(direction, version) => setModal({ kind: 'refine', direction, version })} onPromote={version => act(`promote-${version.id}`, () => studio.promoteDirectionExperiment(version.id), 'promoteExperiment')} onSetWorking={(session, version) => { const preference = workspace.workingDirectionPreferences?.find(item => item.session_id === session.id); return act(`working-${version.id}`, () => studio.setWorkingDirection({ engagement_id: session.engagement_id, session_id: session.id, direction_version_id: version.id, expected_revision: preference?.revision || 0, operation_key: crypto.randomUUID() }), 'selectDirection') }} onSelect={(session, version) => act(`select-${version.id}`, () => studio.selectDirection(session.id, version.id), 'selectDirection')} onRelease={session => act(`release-${session.id}`, () => studio.releaseDirection(session.id, 'Released by the accountable human reviewer.'), 'release')} busy={busy} /></>}
    {modal?.kind === 'flow' && <FlowModal workspace={workspace} busy={busy} onClose={() => setModal(null)} onSave={input => act('create-flow', () => studio.createPageFlow(input))} />}
    {modal?.kind === 'session' && <SessionModal workspace={workspace} workRecord={workspace.navigationWorkRecord} busy={busy} onClose={() => setModal(null)} onSave={input => act('create-session', () => studio.createSession(input))} />}
    {modal?.kind === 'refine' && <RefineModal {...modal} sessions={workspace.sessions || []} briefVersions={workspace.creativeBriefVersions || []} briefs={workspace.creativeBriefs || []} reviewers={workspace.experimentReviewers || []} currentUserId={user?.id} busy={busy} onClose={() => setModal(null)} onSave={(content, experiment, briefVersionId) => act('refine', () => studio.createDirectionRevision(modal.direction.id, modal.version.id, content, experiment, briefVersionId))} />}
    {modal && !pendingSelection && <button type="button" onClick={() => requestSelection(new URLSearchParams())} className="fixed right-24 top-4 z-[55] rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm font-semibold text-violet-200 shadow-xl">Change work</button>}
    {pendingSelection && <ContextSwitchDialog canSave={context.accessValid && officialReady && capabilities.createDraft} onStay={() => setPendingSelection(null)} onSave={saveCurrentAndSwitch} onDiscard={discardAndSwitch} />}
    </WorkshopContextShell>
  </Shell>
}

function ChooseWork({ engagements, filter, setFilter, onSelect, onPrivate }) {
  const term = filter.trim().toLowerCase()
  const visible = engagements.filter(item => !term || [item.name, item.agency_clients?.name, item.brands?.name].filter(Boolean).some(value => value.toLowerCase().includes(term)))
  return <div className="mx-auto max-w-5xl"><p className="text-xs font-semibold uppercase tracking-[.24em] text-violet-400">Design S01</p><h1 className="mt-2 text-3xl font-semibold">Choose work</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Select an authorized project engagement or deliberately enter a Private experiment. Design never opens the last client automatically.</p><div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_.8fr]"><Panel><Field label="Search authorized work"><input className={INPUT} value={filter} onChange={event => setFilter(event.target.value)} placeholder="Project, client, brand, or engagement" /></Field><div className="mt-4 space-y-3">{visible.map(item => <button type="button" key={item.id} onClick={() => onSelect(item)} className="w-full rounded-xl border border-white/10 bg-white/[0.025] p-4 text-left hover:border-violet-500/40"><span className="font-semibold text-white">{item.name}</span><span className="mt-1 block text-xs text-slate-400">{[item.agency_clients?.name, item.brands?.name].filter(Boolean).join(' · ') || 'Authorized Design engagement'}</span></button>)}{!visible.length && <Empty compact title="No authorized work matches" text="Clear the search or ask an administrator to verify the project and active Design service." />}</div></Panel><div className="space-y-5"><Panel><h2 className="font-semibold">Private experiment</h2><p className="mt-2 text-sm leading-6 text-slate-400">Explore without creating an official deliverable. Promotion remains a separate authorized action.</p><button type="button" onClick={onPrivate} className={`${BUTTON} mt-4 w-full`}>Enter Private experiment</button></Panel><Panel><h2 className="font-semibold">Available without a target</h2><div className="mt-3 flex flex-col gap-2"><Link to="/sphere/design/systems" className="text-sm font-semibold text-violet-300">Browse Design systems</Link><span className="text-sm text-slate-400">Video not configured</span><span className="text-xs text-slate-500">Official save and submission remain blocked until valid work is selected.</span></div></Panel></div></div></div>
}

function PrivateDesk({ draft, returnTarget, onChoose }) {
  return <div className="mx-auto max-w-5xl"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.24em] text-amber-300">Private experiment</p><h1 className="mt-2 text-3xl font-semibold">Design desk</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">This isolated space is not an official client, brand, engagement, task, or work item.</p></div><div className="flex gap-2"><Link to={returnTarget} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold">Back to work</Link><button type="button" onClick={onChoose} className={BUTTON}>Choose work</button></div></div><div className="mt-6 grid gap-5 md:grid-cols-3"><Panel><h2 className="font-semibold">Brief</h2><p className="mt-2 text-sm text-slate-400">{draft ? `Durable P9 draft pointer ${draft.id} is preserved; unsaved text is never inferred.` : 'A durable draft is restored only from an explicit P9 pointer.'}</p></Panel><Panel><h2 className="font-semibold">Chat and tools</h2><p className="mt-2 text-sm text-slate-400">Browse permitted references without creating official output.</p></Panel><Panel><h2 className="font-semibold">Outputs</h2><p className="mt-2 text-sm text-slate-400">Nothing has been generated or promoted.</p></Panel></div><p className="mt-5 text-sm font-semibold text-slate-400">Video not configured</p></div>
}

function ContextStrip({ context, navigation, organizationName, unsaved, capabilities, officialReady }) {
  const serviceNames = (context.services || []).map(item => serviceCatalog(item)?.name || item.id).filter(Boolean)
  const serviceLabel = serviceNames.length > 1 ? `${serviceNames.length} active Design services` : serviceNames[0]
  return <section aria-label="Current Design context" className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:grid-cols-2 xl:grid-cols-6"><ContextValue label="Organization" value={organizationName || navigation.organizationId} /><ContextValue label="Project" value={context.projectId} /><ContextValue label="Engagement" value={context.engagement?.name} /><ContextValue label="Brand" value={context.engagement?.brands?.name || context.brandId} /><ContextValue label="Service" value={serviceLabel} title={serviceNames.join(', ')} /><ContextValue label="State" value={unsaved ? 'Unsaved changes' : officialReady ? 'Official context ready' : 'Official save blocked'} tone={unsaved ? 'amber' : officialReady ? 'green' : 'red'} /><p className="text-xs text-slate-500 sm:col-span-2 xl:col-span-6">Actions use existing server permissions: {capabilities.createDraft ? 'draft enabled' : 'read only'} · {capabilities.executeGeneration ? 'configured generation permitted' : 'generation denied'} · {capabilities.release ? 'release permitted' : 'release denied'}.</p></section>
}

function ContextValue({ label, value, tone = 'slate', title = '' }) {
  const colors = tone === 'amber' ? 'text-amber-300' : tone === 'green' ? 'text-emerald-300' : tone === 'red' ? 'text-red-300' : 'text-slate-200'
  return <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p><p title={title || value || ''} className={`mt-1 truncate text-sm font-semibold ${colors}`}>{value || 'Not selected'}</p></div>
}

function ContextSwitchDialog({ canSave, onStay, onSave, onDiscard }) {
  return <div role="dialog" aria-modal="true" aria-labelledby="design-context-switch-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"><section className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"><h2 id="design-context-switch-title" className="text-xl font-semibold">You have unsaved changes</h2><p className="mt-2 text-sm leading-6 text-slate-400">Choose what happens before Design changes organization, project, engagement, brand, service, or work identity. Attachments and pending confirmations never carry into the next context.</p><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onStay} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold">Stay</button><button type="button" disabled={!canSave} title={canSave ? '' : 'Save is unavailable because current access or official context is no longer valid.'} onClick={onSave} className={`${BUTTON} bg-slate-700`}>Save to current context</button><button type="button" onClick={onDiscard} className="rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-200">Discard</button></div></section></div>
}

function ArtifactWorkspace({ workspace }) {
  const types = [['discovery', 'Discovery'], ['vision', 'Vision'], ['audience', 'Audience']]
  return <div className="mt-6"><Panel><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Read-only upstream context</p><h2 className="mt-2 text-xl font-semibold">Content Studio owns these artifacts</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Design compiles the exact approved versions below. Creation, revision, and approval now happen in Content Studio.</p></div><Link to="/sphere/content/studio" className={BUTTON}>Open Content Studio</Link></div></Panel><div className="mt-5 grid gap-5 xl:grid-cols-3">{types.map(([type, label]) => {
    const artifact = workspace.artifacts.find(item => item.artifact_type === type)
    const versions = workspace.versions.filter(item => item.artifact_id === artifact?.id)
    const approval = [...workspace.approvals].filter(item => item.artifact_id === artifact?.id).sort((a, b) => new Date(b.approved_at) - new Date(a.approved_at))[0]
    const approvedVersion = versions.find(item => item.id === approval?.artifact_version_id)
    return <Panel key={type}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">{label}</p><h2 className="mt-2 text-lg font-semibold">{artifact?.title || `${label} artifact`}</h2></div><Badge tone={approvedVersion ? 'green' : 'amber'}>{approvedVersion ? 'Approved' : 'Missing'}</Badge></div>
      {approvedVersion ? <><div className="mt-5 space-y-2 rounded-xl bg-white/[0.03] p-3 text-xs text-slate-400"><p>Exact approved version {approvedVersion.version_number} · {new Date(approval.approved_at).toLocaleString()}</p><p>{approvedVersion.ai_use_allowed ? 'Authorised for Design AI context' : 'Not authorised for Design AI context'} · {approvedVersion.data_classification}</p></div><ArtifactRelationsPanel artifact={artifact} /></> : <Empty title="No approved version" text="Complete and approve this artifact in Content Studio." compact />}
    </Panel>
  })}</div></div>
}

function WorkshopWorkspace({ workspace, assetLibraryContextKey, focusedSessionId, focusedVersionId: navigationFocusedVersionId, focusedDraftId, canUploadAsset, onUploadAsset, canArchiveAsset, onArchiveAsset, canPromoteExperiment, onCreateFlow, onCreate, onGenerate, onGenerateImage, onRefreshImageJob, onRetryImageJob, onGenerateVariants, onGenerateVideo, onGeneratePage, onSubmitPage, onApprovePage, onExportPage, onDownloadExport, onPrepareHandoff, onDownloadHandoff, onRefine, onPromote, onSetWorking, onSelect, onRelease, busy }) {
  const approvedTypes = new Set(workspace.approvals.map(approval => workspace.artifacts.find(item => item.id === approval.artifact_id)?.artifact_type).filter(Boolean))
  const ready = ['discovery', 'vision', 'audience'].every(type => approvedTypes.has(type))
  const [flowSessionId, updateFlowSessionId] = useState('')
  const [focusedVersionId, setFocusedVersionId] = useState(navigationFocusedVersionId)
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false)
  const [assetSourceFocus, setAssetSourceFocus] = useState(null)
  const contextKey = assetLibraryContextKey
  function setFlowSessionId(nextSessionId) {
    updateFlowSessionId(nextSessionId)
    setAssetSourceFocus(null)
    setFocusedVersionId('')
  }
  useEffect(() => {
    setAssetLibraryOpen(false)
    setAssetSourceFocus(null)
    updateFlowSessionId('')
    setFocusedVersionId(navigationFocusedVersionId)
  }, [contextKey, navigationFocusedVersionId])
  const session = workspace.sessions.find(item => item.id === flowSessionId) || workspace.sessions.find(item => item.id === focusedSessionId) || workspace.sessions[0]
  const experimentVersions = [...workspace.experimentalDirectionVersions].sort((left, right) => Number(right.id === focusedDraftId) - Number(left.id === focusedDraftId))
  const directions = session ? workspace.directions.filter(item => item.session_id === session.id).sort((left, right) => left.direction_slot - right.direction_slot) : []
  const selection = session && workspace.selections.find(item => item.session_id === session.id)
  const workingPreference = session && workspace.workingDirectionPreferences?.find(item => item.session_id === session.id)
  const release = session && workspace.releases.find(item => item.session_id === session.id)
  const activeService = session && workspace.designServices.find(item => item.id === session.engagement_service_id)
  const storyboard = serviceCatalog(activeService)?.slug === 'video_concepts_storyboards' || session?.output_family === 'video_motion'
  const variantEligible = ['social_assets', 'advertising_assets'].includes(serviceCatalog(activeService)?.slug)
  const createSessionAction = <div className="mt-4 flex items-center gap-3"><Badge tone={ready ? 'green' : 'amber'}>{approvedTypes.size}/3 approved</Badge><button disabled={!ready} className={BUTTON} onClick={onCreate}>Create Design Workshop session</button></div>
  function focusAssetSource(row) {
    const source = designAssetSourceFocus(row)
    if (!source) return
    setFlowSessionId(source.sessionId)
    setFocusedVersionId(source.directionVersionId)
    setAssetSourceFocus(source)
    setAssetLibraryOpen(false)
  }
  return <div className="mt-6 space-y-6">
    <Panel><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Design S05</p><h2 className="mt-2 text-xl font-semibold">Versioned asset library</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Browse generated and uploaded assets in this authorized work context. PNG uploads create immutable draft versions; comparison, approval, release, and generation remain separate actions.</p></div><button type="button" aria-expanded={assetLibraryOpen} onClick={() => setAssetLibraryOpen(value => !value)} className={BUTTON}>{assetLibraryOpen ? 'Hide assets' : 'Browse assets'}</button></div></Panel>
    {assetLibraryOpen && <DesignAssetLibrary key={contextKey} contextKey={contextKey} workspace={workspace} canUpload={canUploadAsset} canArchive={canArchiveAsset} busy={busy === 'asset-upload' || busy.startsWith('asset-archive-')} onUpload={onUploadAsset} onArchive={onArchiveAsset} onClose={() => setAssetLibraryOpen(false)} onFocusSource={focusAssetSource} />}
    {assetSourceFocus && <div role="status" className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-3 text-sm text-violet-100">Opened immutable direction version <code>{assetSourceFocus.directionVersionId}</code>{assetSourceFocus.jobId ? <> and generation request <code>{assetSourceFocus.jobId}</code></> : null} from the asset library. The existing source is shown below; no generation was started.</div>}
    <Panel><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Multi-page flows</p><h2 className="mt-2 text-xl font-semibold">Website page flow</h2><p className="mt-2 text-sm text-slate-400">Group independent direction sessions by their real sitemap page.</p></div><button className={BUTTON} onClick={onCreateFlow}>Create page flow</button></div>{(workspace.pageFlows || []).length ? <div className="mt-4 grid gap-3 lg:grid-cols-2">{workspace.pageFlows.map(flow => { const members = workspace.sessions.filter(item => item.page_flow_id === flow.id); return <section key={flow.id} className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3"><p className="font-semibold">{flow.flow_name}</p><div className="mt-2 flex flex-wrap gap-2">{members.length ? members.map(item => <button key={item.id} onClick={() => setFlowSessionId(item.id)} className={`rounded-lg px-2.5 py-1.5 text-xs ${session?.id === item.id ? 'bg-violet-500 text-white' : 'bg-white/5 text-slate-300'}`}>{item.page_slug} · {sessionServiceLabel(item, workspace.designServices)}</button>) : <span className="text-xs text-slate-500">No page sessions yet.</span>}</div></section> })}</div> : null}</Panel>
    {!session ? <Panel><h2 className="text-xl font-semibold">Compile approved context</h2><p className="mt-2 text-sm text-slate-400">The session snapshots exact approved Discovery, Vision and Audience versions, then adds an output brief and designer-safe instructions.</p>{createSessionAction}</Panel>
      : <Panel><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Compiled session</p><h2 className="mt-2 text-xl font-semibold">{sessionServiceLabel(session, workspace.designServices)}</h2><p className="mt-2 text-sm text-slate-400">Context {session.context_checksum.slice(0, 12)}… · {Object.keys(session.context_manifest?.artifacts || {}).length} exact approved inputs</p></div><Badge tone={release ? 'green' : session.status === 'generation_failed' ? 'red' : 'violet'}>{release ? 'Released' : session.status.replaceAll('_', ' ')}</Badge></div><p className="mt-4 rounded-xl bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">{session.designer_instructions}</p>{!directions.length && <button disabled={busy === `generate-${session.id}` || !['ready', 'generation_failed'].includes(session.status)} onClick={() => onGenerate(session)} className={`${BUTTON} mt-4`}>{busy === `generate-${session.id}` ? (storyboard ? 'Generating connected storyboard frames…' : 'Generating three distinct directions…') : (storyboard ? 'Generate storyboard sequence' : 'Generate three directions')}</button>}</Panel>}
    {session && <Panel><h2 className="text-xl font-semibold">Compile approved context</h2><p className="mt-2 text-sm text-slate-400">The session snapshots exact approved Discovery, Vision and Audience versions, then adds an output brief and designer-safe instructions.</p>{createSessionAction}</Panel>}
    {session && <IdentityProvenanceLedger workspace={workspace} session={session} />}
    {!!directions.length && <section aria-label={storyboard ? 'Storyboard sequence' : 'Design direction comparison'}>{storyboard && <div className="mb-4"><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Ordered storyboard sequence</p><h2 className="mt-2 text-xl font-semibold">Static frames in narrative order</h2><p className="mt-2 text-sm text-slate-400">Direction slots are frame order for this service. Scroll through the filmstrip from frame 1 onward; each frame keeps its own proofing comments.</p></div>}<div className={storyboard ? 'grid auto-cols-[min(82vw,26rem)] grid-flow-col gap-5 overflow-x-auto pb-3' : 'grid gap-5 xl:grid-cols-3'}>{directions.map(direction => { const versions = workspace.directionVersions.filter(item => item.direction_id === direction.id); const version = versions.find(item => item.id === focusedVersionId) || latestByVersion(versions); const selected = selection?.direction_version_id === version?.id; const working = workingPreference?.direction_version_id === version?.id; return <DirectionCard key={direction.id} direction={direction} versions={versions} version={version} models={workspace.models} mediaAssets={workspace.mediaAssets} generationJobs={workspace.imageGenerationJobs || []} storyboard={storyboard} working={working} selected={selected} released={release?.direction_version_id === version?.id} onGenerateImage={(modelId, prompt, requestKey) => onGenerateImage(version, modelId, prompt, requestKey)} onRefreshImageJob={onRefreshImageJob} onRetryImageJob={onRetryImageJob} onGenerateVideo={prompt => onGenerateVideo(version, prompt)} onRefine={() => onRefine(direction, version)} onSetWorking={() => onSetWorking(session, version)} onSelect={() => onSelect(session, version)} canSelect={!selection} busy={busy} /> })}</div></section>}
    {release && variantEligible && <VariantWorkspace key={release.direction_version_id} workspace={workspace} release={release} onGenerate={onGenerateVariants} busy={busy} />}
    {release && <ProductionHandoffPanel release={release} packages={workspace.handoffPackages} busy={busy} onPrepare={onPrepareHandoff} onDownload={onDownloadHandoff} />}
    {!!experimentVersions.length && <Panel><div><p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Private experiments</p><h2 className="mt-2 text-xl font-semibold">Experimental versions</h2><p className="mt-2 text-sm text-slate-400">Visible only to each creator and invited reviewers. Experiments stay outside the main history until promoted.</p></div><div className="mt-5 grid gap-4 lg:grid-cols-2">{experimentVersions.map(version => { const direction = directions.find(item => item.id === version.direction_id); const canPromote = canPromoteExperiment(version); return <ExperimentCard key={version.id} direction={direction} version={version} models={workspace.models} mediaAssets={workspace.mediaAssets} generationJobs={workspace.imageGenerationJobs || []} storyboard={storyboard} focused={version.id === focusedDraftId} canPromote={canPromote} onGenerateImage={(modelId, prompt, requestKey) => onGenerateImage(version, modelId, prompt, requestKey)} onRefreshImageJob={onRefreshImageJob} onRetryImageJob={onRetryImageJob} onGenerateVideo={prompt => onGenerateVideo(version, prompt)} onPromote={() => onPromote(version)} busy={busy} /> })}</div></Panel>}
    {!!directions.length && <PageDesignWorkspace workspace={workspace} onGenerate={onGeneratePage} onSubmit={onSubmitPage} onApprove={onApprovePage} onExport={onExportPage} onDownload={onDownloadExport} busy={busy} />}
    {selection && !release && <Panel><h3 className="font-semibold">{storyboard ? 'Storyboard sequence ready for release' : 'Human selection recorded'}</h3><p className="mt-2 text-sm text-slate-400">{storyboard ? 'The selected exact frame version anchors the existing session-level release record; release applies to the whole ordered sequence.' : 'Selection does not equal release. The accountable Design manager must perform the separate release action.'}</p><button disabled={busy === `release-${session.id}`} onClick={() => onRelease(session)} className={`${BUTTON} mt-4`}>{storyboard ? 'Release whole storyboard sequence' : 'Release selected exact version'}</button></Panel>}
  </div>
}

function IdentityProvenanceLedger({ workspace, session }) {
  const directionIds = new Set(workspace.directions.filter(item => item.session_id === session.id).map(item => item.id))
  const rows = workspace.directionVersions.filter(version => directionIds.has(version.direction_id)).map(version => {
    const provenance = identityProvenanceForDirection(workspace, version)
    const jobs = (workspace.imageGenerationJobs || []).filter(job => job.direction_version_id === version.id)
    const outputs = (workspace.mediaAssets || []).filter(asset => asset.design_direction_version_id === version.id)
    return { version, ...provenance, jobs, outputs }
  }).filter(row => row.briefVersion || row.references.length)
  if (!rows.length) return <Panel><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">B05 · Identity provenance</p><p className="mt-2 text-sm text-slate-400">No direction in this session is linked to a saved brief version yet. New generation requires the exact frozen brief chain.</p></Panel>
  return <Panel><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">B05 · Identity provenance</p><h2 className="mt-2 text-xl font-semibold">Pinned references stay exact through outputs</h2><p className="mt-2 text-sm leading-6 text-slate-400">Each row follows immutable foreign keys from an approved DS5 version to the saved brief, direction, request, and output. Later Design System releases do not rewrite this chain.</p><div className="mt-4 space-y-3">{rows.map(row => <div key={row.version.id} className="rounded-xl border border-white/10 bg-slate-950/50 p-3 text-xs text-slate-400"><p className="font-semibold text-slate-200">Brief {row.briefVersion ? `v${row.briefVersion.version_number} · ${row.briefVersion.id.slice(0, 8)}` : 'not linked'} → direction v{row.version.version_number} · {row.version.id.slice(0, 8)} → {row.jobs.length} request(s) → {row.outputs.length} output(s)</p><p className="mt-2">Identity: {row.references.length ? row.references.map(item => `${item.artifact.title} v${item.version.version_number} · ${item.version.id.slice(0, 8)}`).join('; ') : 'No identity system pinned to this brief version'}</p></div>)}</div></Panel>
}

function VariantWorkspace({ workspace, release, onGenerate, busy }) {
  const imageModels = workspace.models.filter(model => model.supported_output_types?.includes('image'))
  const sourceVersion = workspace.directionVersions.find(item => item.id === release.direction_version_id)
  const variants = (workspace.variants || []).filter(item => item.source_direction_version_id === sourceVersion?.id)
  const [modelId, setModelId] = useState(imageModels[0]?.id || '')
  const [formats, setFormats] = useState([])
  function toggle(format) { setFormats(current => current.includes(format) ? current.filter(item => item !== format) : [...current, format]) }
  if (!sourceVersion) return null
  return <Panel><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">DS2 · Released-format variants</p><h2 className="mt-2 text-xl font-semibold">Adapt the approved concept</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Create user-selected social and advertising formats from released version {sourceVersion.id.slice(0, 8)}. Each format is tracked independently and remains separate from direction comparison.</p></div><Badge tone="green">Released source</Badge></div>
    <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{VARIANT_FORMATS.map(([format, label]) => <label key={format} className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-sm"><input type="checkbox" checked={formats.includes(format)} onChange={() => toggle(format)} /><span>{label}</span></label>)}</div>
    {imageModels.length ? <Field label="Image model"><select className={`${INPUT} mt-4`} value={modelId} onChange={event => setModelId(event.target.value)}>{imageModels.map(model => <option key={model.id} value={model.id}>{model.display_name}</option>)}</select></Field> : <p className="mt-4 text-sm text-amber-300">No active image-capable Design model is available.</p>}
    <button className={`${BUTTON} mt-4`} disabled={!formats.length || !modelId || busy === `variants-${sourceVersion.id}`} onClick={() => onGenerate(sourceVersion.id, modelId, formats)}>{busy === `variants-${sourceVersion.id}` ? 'Generating selected variants…' : `Generate ${formats.length || ''} selected variant${formats.length === 1 ? '' : 's'}`}</button>
    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{variants.map(variant => { const asset = workspace.mediaAssets.find(item => item.id === variant.design_media_asset_id); const label = VARIANT_FORMATS.find(([format]) => format === variant.variant_format)?.[1] || variant.variant_format; return <section key={variant.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-3"><div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{label}</p><p className="mt-1 text-[11px] text-slate-500">Derived from {sourceVersion.id.slice(0, 8)}</p></div><Badge tone={variant.status === 'ready' ? 'green' : variant.status === 'failed' ? 'red' : 'violet'}>{variant.status}</Badge></div>{asset ? <MediaAsset asset={asset} /> : <p className="rounded-xl bg-white/[0.03] p-3 text-xs text-slate-400">{variant.status === 'failed' ? 'This format failed before a media asset completed; sibling formats remain unaffected.' : 'Generation is queued or in progress.'}</p>}</section> })}</div>
    {!variants.length && <Empty title="No released variants yet" text="Choose only the formats needed for this approved Social or Advertising direction." compact />}
  </Panel>
}

function PageDesignWorkspace({ workspace, onGenerate, onSubmit, onApprove, onExport, onDownload, busy }) {
  const versions = [...workspace.directionVersions, ...workspace.experimentalDirectionVersions]
  const models = workspace.models.filter(model => model.supported_output_types?.includes('html_css'))
  const [versionId, setVersionId] = useState(versions[0]?.id || '')
  const [slug, setSlug] = useState(workspace.architecturePages[0]?.slug || '')
  const [modelId, setModelId] = useState(models[0]?.id || '')
  const attempts = workspace.pageDesigns.filter(item => item.design_direction_version_id === versionId && item.slug === slug)
  return <Panel><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">RP4 · HTML/CSS page design</p><h2 className="mt-2 text-xl font-semibold">Generate and review a real webpage</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Each generation creates a new immutable attempt from one exact direction version and one architecture <code>slug</code>. The preview is sandboxed; CMS export remains a separate phase.</p></div><Badge tone="violet">{workspace.pageDesigns.length} attempts</Badge></div>
    <div className="mt-5 grid gap-3 lg:grid-cols-3"><Field label="Exact direction version"><select className={INPUT} value={versionId} onChange={event => setVersionId(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>Direction {workspace.directions.find(item => item.id === version.direction_id)?.direction_slot || '?'} · v{version.version_number}{version.is_experimental ? ' · private experiment' : ''}</option>)}</select></Field><Field label="Architecture slug"><select className={INPUT} value={slug} onChange={event => setSlug(event.target.value)}>{workspace.architecturePages.map(page => <option key={page.slug} value={page.slug}>{page.title} · {page.slug}</option>)}</select></Field><Field label="HTML/CSS model"><select className={INPUT} value={modelId} onChange={event => setModelId(event.target.value)}>{models.map(model => <option key={model.id} value={model.id}>{model.display_name}</option>)}</select></Field></div>
    {!workspace.architecturePages.length && <p className="mt-3 text-sm text-amber-300">No website architecture pages are visible. Create a Content Studio architecture using the canonical <code>slug</code> field first.</p>}
    {!models.length && <p className="mt-3 text-sm text-amber-300">No active model currently supports HTML/CSS output. The RP4 migration registers this capability on the existing text model.</p>}
    <button className={`${BUTTON} mt-4`} disabled={!versionId || !slug || !modelId || busy === 'generate-page'} onClick={() => onGenerate(versionId, slug, modelId)}>{busy === 'generate-page' ? 'Generating page attempt…' : 'Generate new page attempt'}</button>
    <div className="mt-6 space-y-5">{attempts.map((attempt, index) => <PageDesignAttempt key={attempt.id} attempt={attempt} number={attempts.length - index} jobs={workspace.wordpressExportJobs || []} onSubmit={onSubmit} onApprove={onApprove} onExport={onExport} onDownload={onDownload} busy={busy} />)}{!attempts.length && <Empty title="No attempt for this page yet" text="Generate the first standalone design; later attempts will remain alongside it for comparison." compact />}</div>
  </Panel>
}

function PageDesignAttempt({ attempt, number, jobs, onSubmit, onApprove, onExport, onDownload, busy }) {
  const job = latestWordPressExportJob(jobs, attempt.id)
  const exported = attempt.status === 'exported' && job?.status === 'complete'
  return <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4"><div><p className="text-sm font-semibold">Attempt {number} · <code>{attempt.slug}</code></p><p className="mt-1 text-xs text-slate-500">{new Date(attempt.created_at).toLocaleString()} · exact version {attempt.design_direction_version_id.slice(0, 8)}</p></div><div className="flex flex-wrap items-center gap-2"><Badge tone={['approved', 'exported'].includes(attempt.status) ? 'green' : attempt.status === 'in_review' ? 'amber' : 'slate'}>{attempt.status.replaceAll('_', ' ')}</Badge>{attempt.status === 'draft' && <button disabled={busy === `submit-page-${attempt.id}`} onClick={() => onSubmit(attempt.id)} className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold">Submit for review</button>}{attempt.status === 'in_review' && <button disabled={busy === `approve-page-${attempt.id}`} onClick={() => onApprove(attempt.id)} className={BUTTON}>Approve exact attempt</button>}{attempt.status === 'approved' && <button disabled={busy === `export-page-${attempt.id}`} onClick={() => onExport(attempt.id)} className={BUTTON}>{busy === `export-page-${attempt.id}` ? 'Building theme…' : 'Export free WordPress theme'}</button>}{exported && <button disabled={busy === `download-export-${job.id}`} onClick={() => onDownload(job.id)} className={BUTTON}>Download theme ZIP</button>}</div></div>{job && <WordPressExportStatus job={job} />}<iframe title={`Preview of ${attempt.slug} attempt ${attempt.id}`} sandbox="" srcDoc={composePageDesignPreview(attempt.html_content, attempt.css_content)} className="h-[640px] w-full bg-white" /><details className="border-t border-white/10 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-300">Inspect generated HTML and CSS</summary><div className="mt-3 grid gap-3 xl:grid-cols-2"><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-xs text-slate-400">{attempt.html_content}</pre><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-xs text-slate-400">{attempt.css_content}</pre></div></details></section>
}

function WordPressExportStatus({ job }) {
  const complete = job.status === 'complete'
  return <div className={`border-b p-4 text-sm ${job.status === 'failed' ? 'border-red-500/20 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-slate-100">Native WordPress export · {job.status}</p><p className="mt-1 text-xs text-slate-400">Private theme artifact · signed download links expire after 10 minutes</p></div><Badge tone={complete ? 'green' : job.status === 'failed' ? 'red' : 'amber'}>{job.provider}</Badge></div>{job.failure_reason && <p className="mt-3 text-red-200">{job.failure_reason}</p>}{complete && <div className="mt-3 grid gap-2 sm:grid-cols-2">{wordpressSeoRows(job.seo_verification).map(check => <p key={check.id} className={check.passed ? 'text-emerald-300' : 'text-red-300'}>{check.passed ? '✓' : '×'} {check.label}</p>)}</div>}{complete && <p className="mt-3 text-xs leading-5 text-slate-400">Before publishing, install the theme on a test WordPress site and visually re-check the title, meta description, heading order, and image alt text.</p>}</div>
}

function ExperimentCard({ direction, version, models, mediaAssets, generationJobs, storyboard, focused, canPromote, onGenerateImage, onRefreshImageJob, onRetryImageJob, onGenerateVideo, onPromote, busy }) {
  const content = version.content || {}
  return <section className={`rounded-2xl border bg-amber-400/[0.04] p-4 ${focused ? 'border-violet-400 ring-2 ring-violet-400/30' : 'border-amber-400/20'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-amber-300">{storyboard ? 'Frame' : 'Direction'} {direction?.direction_slot} · experimental v{version.version_number}</p><h3 className="mt-2 text-lg font-semibold">{content.title}</h3></div><Badge tone={focused ? 'violet' : 'amber'}>{focused ? 'Restored draft' : 'Experiment'}</Badge></div><p className="mt-3 text-sm leading-6 text-slate-400">{content.rationale}</p><p className="mt-3 text-xs text-slate-500">Immutable version {version.id.slice(0, 8)} · {version.experiment_visibility?.length || 0} invited reviewer(s)</p><DesignMediaPanel key={version.id} version={version} models={models} assets={mediaAssets} jobs={generationJobs} onGenerateImage={onGenerateImage} onRefreshImageJob={onRefreshImageJob} onRetryImageJob={onRetryImageJob} onGenerateVideo={onGenerateVideo} allowVideo={!storyboard} busy={busy} />{canPromote && <button disabled={busy === `promote-${version.id}`} onClick={onPromote} className={`${BUTTON} mt-4`}>{busy === `promote-${version.id}` ? 'Promoting…' : 'Promote to main version'}</button>}<VersionProofingPanel targetKind="design_direction" versions={[version]} initialVersionId={version.id} department="design" theme="violet" /></section>
}

function DirectionCard({ direction, versions, version, models, mediaAssets, generationJobs, storyboard, working, selected, released, onGenerateImage, onRefreshImageJob, onRetryImageJob, onGenerateVideo, onRefine, onSetWorking, onSelect, canSelect, busy }) {
  const content = version?.content || {}; const palette = Array.isArray(content.palette) ? content.palette : []
  const [anchor, setAnchor] = useState(null)
  function anchorAt(event) { const bounds = event.currentTarget.getBoundingClientRect(); setAnchor({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }) }
  return <Panel><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-slate-500">{storyboard ? 'Frame' : 'Direction'} {direction.direction_slot} · v{version?.version_number}</p><h3 className="mt-2 text-xl font-semibold">{content.title}</h3></div><div className="flex flex-wrap gap-2">{working && <Badge tone="violet">Working</Badge>}{(selected || released) && <Badge tone="green">{storyboard ? (released ? 'Sequence released' : 'Release anchor') : (released ? 'Released' : 'Selected')}</Badge>}</div></div><div role="button" tabIndex="0" aria-label={`Click to anchor a proofing comment on ${storyboard ? 'this frame' : 'this direction'}`} onClick={anchorAt} onKeyDown={event => { if (event.key === 'Enter') setAnchor({ x: 0.5, y: 0.5 }) }} className="relative mt-4 cursor-crosshair overflow-hidden rounded-2xl border border-white/10" style={{ background: content.preview_spec?.background || '#111827' }}><div className="p-5"><div className="h-2 w-16 rounded-full" style={{ background: content.preview_spec?.accent || '#8b5cf6' }} /><p className="mt-10 text-2xl font-bold text-white">{content.creative_thesis}</p><p className="mt-3 text-sm text-white/70">{content.preview_spec?.composition}</p></div><div className="flex">{palette.map((color, index) => <div key={index} title={`${color.name}: ${color.hex}`} className="h-10 flex-1" style={{ background: color.hex }} />)}</div>{anchor && <span className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-violet-500 shadow-lg" style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} />}</div><p className="mt-2 text-[11px] text-violet-300">Click the {storyboard ? 'frame' : 'direction'} preview to anchor a positional comment.</p><DesignMediaPanel key={version.id} version={version} models={models} assets={mediaAssets} jobs={generationJobs} onGenerateImage={onGenerateImage} onRefreshImageJob={onRefreshImageJob} onRetryImageJob={onRetryImageJob} onGenerateVideo={onGenerateVideo} allowVideo={!storyboard} busy={busy} /><p className="mt-4 text-sm leading-6 text-slate-400">{content.rationale}</p><div className="mt-4 flex flex-wrap gap-2">{(content.visual_principles || []).map(item => <Badge key={item}>{item}</Badge>)}</div><p className="mt-4 text-xs text-slate-500">Model run {version?.generation_run_id?.slice(0, 8) || 'human refinement'} · immutable version {version?.id?.slice(0, 8)}</p><div className="mt-5 flex flex-wrap gap-2"><button onClick={onRefine} className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold">Refine as new version</button><button disabled={working || busy === `working-${version.id}`} onClick={onSetWorking} className="rounded-xl border border-violet-400/30 px-3 py-2 text-sm font-semibold text-violet-200 disabled:opacity-40">{working ? 'Current Working direction' : 'Set as Working direction'}</button>{canSelect && <button disabled={busy === `select-${version.id}`} onClick={onSelect} className={BUTTON}>{storyboard ? 'Use as sequence release anchor' : 'Record final selection'}</button>}</div><p className="mt-2 text-xs text-slate-500">Working direction is reversible. Final selection and release remain separate immutable decisions.</p><VersionProofingPanel targetKind="design_direction" versions={versions} initialVersionId={version?.id} department="design" theme="violet" visualAnchor={anchor} visualAnchorVersionId={version?.id} onClearVisualAnchor={() => setAnchor(null)} /></Panel>
}

function DesignMediaPanel({ version, models, assets, jobs, onGenerateImage, onRefreshImageJob, onRetryImageJob,
  allowVideo = true, busy }) {
  const imageModels = models.filter(model => model.supported_output_types?.includes('image'))
  const versionAssets = assets.filter(asset => asset.design_direction_version_id === version.id)
  const versionJobs = (jobs || []).filter(job => job.direction_version_id === version.id)
  const activeJob = versionJobs.find(job => ['queued', 'running', 'outcome_unknown'].includes(job.status))
  const retryChildren = new Set(versionJobs.map(job => job.retry_of_job_id).filter(Boolean))
  const [prompt, setPrompt] = useState([version.content?.imagery_direction, version.content?.creative_thesis].filter(Boolean).join('\n\n'))
  const [modelId, setModelId] = useState(imageModels[0]?.id || '')
  const [pendingOperationKey, setPendingOperationKey] = useState('')
  const submissionInFlight = useRef(false)

  async function submitImage(request = null) {
    if (submissionInFlight.current) return
    submissionInFlight.current = true
    const requestKey = request?.operation_key || pendingOperationKey || crypto.randomUUID()
    setPendingOperationKey(requestKey)
    try {
      const completed = await onGenerateImage(
        request?.model_registry_id || modelId,
        request?.prompt || prompt,
        requestKey,
      )
      if (completed) setPendingOperationKey('')
    } finally {
      submissionInFlight.current = false
    }
  }

  return <section className="mt-4 rounded-2xl border border-violet-400/15 bg-slate-950/50 p-3">
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Generated media</p><p className="mt-1 text-[11px] text-slate-500">Attached only to immutable version {version.id.slice(0, 8)}</p></div><Badge tone="violet">{versionAssets.length} outputs</Badge></div>
    <textarea rows="3" className={`${INPUT} mt-3`} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Static image generation prompt" />
    {imageModels.length ? <select className={`${INPUT} mt-2`} value={modelId} onChange={event => setModelId(event.target.value)}>{imageModels.map(model => <option key={model.id} value={model.id}>{model.display_name}</option>)}</select> : <p className="mt-2 text-xs text-amber-300">No active image model is registered yet.</p>}
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button disabled={!prompt.trim() || !modelId || Boolean(activeJob) || busy === `image-${version.id}`}
        onClick={() => submitImage()} className={BUTTON}>
        {busy === `image-${version.id}` ? 'Submitting request…' : pendingOperationKey ? 'Reconcile request' : 'Generate image'}
      </button>
      {allowVideo && <span className="text-sm font-semibold text-slate-500">Video not configured</span>}
    </div>
    {pendingOperationKey && !activeJob && <p className="mt-2 text-xs text-amber-200">The last response was interrupted. “Reconcile request” reuses the same request identity and cannot create a second paid call.</p>}
    {!!versionJobs.length && <div className="mt-3 space-y-2">{versionJobs.map(job => {
      const retryable = job.status === 'failed' && job.failure_phase === 'provider' && !retryChildren.has(job.id)
      const tone = job.status === 'succeeded' ? 'green' : ['failed', 'outcome_unknown'].includes(job.status) ? 'red' : 'violet'
      return <article key={job.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Request {job.id.slice(0, 8)}</p><Badge tone={tone}>{job.status.replaceAll('_', ' ')}</Badge></div>
        <p className="mt-1 text-slate-500">{new Date(job.created_at).toLocaleString()} · exact model {job.model_registry_id.slice(0, 8)}</p>
        {job.failure_reason && <p className="mt-2 leading-5 text-red-200">{job.failure_reason}</p>}
        {job.status === 'outcome_unknown' && <p className="mt-2 leading-5 text-amber-200">The provider outcome cannot be proven. Paid retry is blocked; reconcile externally before any new request.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {job.status === 'queued' && <button disabled={busy === `image-${version.id}`} onClick={() => submitImage(job)} className="rounded-lg border border-violet-400/30 px-2.5 py-1.5 font-semibold text-violet-200">Resume queued request</button>}
          {['running', 'outcome_unknown'].includes(job.status) && <button disabled={busy === `image-job-${job.id}`} onClick={() => onRefreshImageJob(job.id)} className="rounded-lg border border-white/10 px-2.5 py-1.5 font-semibold">Check status</button>}
          {retryable && <button disabled={busy === `retry-image-${job.id}`} onClick={() => onRetryImageJob(job.id, crypto.randomUUID())} className="rounded-lg border border-red-400/30 px-2.5 py-1.5 font-semibold text-red-200">Retry confirmed provider failure</button>}
        </div>
      </article>
    })}</div>}
    <p className="mt-3 text-[11px] leading-5 text-slate-500">Cancellation is not supported after submission. Requests remain reopenable here, and unresolved outcomes block replacement generation.</p>
    <div className="mt-3 grid gap-3">{versionAssets.map(asset => <MediaAsset key={asset.id} asset={asset} />)}</div>
  </section>
}

function MediaAsset({ asset }) {
  if (asset.media_type === 'image' && asset.status === 'ready') return <figure className="overflow-hidden rounded-xl border border-white/10 bg-black/30">{asset.signed_url ? <img src={asset.signed_url} alt={asset.prompt} className="w-full object-cover" /> : <div className="p-4 text-xs text-amber-300">The private image link expired. Refresh the Workshop to renew it.</div>}<figcaption className="p-3 text-xs text-slate-400">{asset.prompt}</figcaption></figure>
  const failed = asset.status === 'failed'
  return <div className={`rounded-xl border p-3 text-xs ${failed ? 'border-red-500/20 bg-red-500/5 text-red-200' : asset.status === 'unavailable' ? 'border-amber-500/20 bg-amber-500/5 text-amber-200' : 'border-violet-500/20 bg-violet-500/5 text-violet-200'}`}><p className="font-semibold capitalize">{asset.media_type} · {asset.status}</p><p className="mt-1 leading-5">{asset.failure_reason || (asset.status === 'generating' ? 'Generation is in progress. Refresh to check again.' : asset.prompt)}</p>{failed && <p className="mt-1 text-slate-400">Adjust the prompt or connector, then generate a new attempt. This failed record stays in the audit trail.</p>}</div>
}

function FlowModal({ workspace, onClose, onSave, busy }) {
  const options = approvedArchitectureOptions(workspace)
  const [flowName, setFlowName] = useState(''); const [artifactId, setArtifactId] = useState('')
  return <Modal title="Create website page flow" onClose={onClose}><form onSubmit={event => { event.preventDefault(); onSave({ engagement_id: workspace.engagement.id, flow_name: flowName, website_architecture_artifact_id: artifactId || null }) }} className="space-y-5"><Field label="Flow name"><input required maxLength="200" className={INPUT} value={flowName} onChange={event => setFlowName(event.target.value)} /></Field><Field label="Released website architecture (optional)"><select className={INPUT} value={artifactId} onChange={event => setArtifactId(event.target.value)}><option value="">No sitemap link</option>{options.map(option => <option key={option.artifact.id} value={option.artifact.id}>{option.artifact.title} · approved v{option.version.version_number}</option>)}</select></Field><button disabled={busy === 'create-flow'} className={`${BUTTON} w-full`}>Create page flow</button></form></Modal>
}

function SessionModal({ workspace, workRecord, onClose, onSave, busy }) {
  const directionModels = workspace.models.filter(model => model.supported_output_types?.includes('design_direction'))
  const [serviceId, setServiceId] = useState(workspace.designServices[0]?.id || ''); const [instructions, setInstructions] = useState('')
  const [goal, setGoal] = useState(''); const [format, setFormat] = useState('Concept direction and design system recommendation')
  const [modelIds, setModelIds] = useState(directionModels.slice(0, 2).map(item => item.id)); const [safe, setSafe] = useState(false)
  const [externalEventId, setExternalEventId] = useState(''); const [flowId, setFlowId] = useState(''); const [pageSlug, setPageSlug] = useState('')
  const pageOptions = flowPageOptions(workspace, flowId)
  function toggle(id) { setModelIds(current => current.includes(id) ? current.filter(item => item !== id) : current.length < 3 ? [...current, id] : current) }
  function submit(event) { event.preventDefault(); onSave({ engagement_id: workspace.engagement.id, brand_id: workspace.engagement.brand_id, engagement_stage_instance_id: bestStage(workspace.stages, 'design')?.id || null, engagement_service_id: serviceId, project_task_id: workRecord?.kind === 'project_task' ? workRecord.id : null, engagement_work_item_id: workRecord?.kind === 'engagement_work_item' ? workRecord.id : null, external_event_id: externalEventId || null, flow_id: flowId || null, page_slug: flowId ? pageSlug : null, output_brief: { goal, required_format: format }, designer_instructions: instructions, instructions_safe_for_ai: safe, model_registry_ids: modelIds }) }
  return <Modal title="Create Design Workshop session" onClose={onClose}><form onSubmit={submit} className="space-y-5"><Field label="Active Design service"><select required className={INPUT} value={serviceId} onChange={event => setServiceId(event.target.value)}>{workspace.designServices.map(service => <option key={service.id} value={service.id}>{serviceCatalog(service)?.name || 'Design service'}</option>)}</select></Field><Field label="Page flow (optional)"><select className={INPUT} value={flowId} onChange={event => { setFlowId(event.target.value); setPageSlug('') }}><option value="">Independent session</option>{(workspace.pageFlows || []).map(flow => <option key={flow.id} value={flow.id}>{flow.flow_name}</option>)}</select></Field>{flowId && (pageOptions.length ? <Field label="Sitemap page"><select required className={INPUT} value={pageSlug} onChange={event => setPageSlug(event.target.value)}><option value="">Choose a page</option>{pageOptions.map(slug => <option key={slug} value={slug}>{slug}</option>)}</select></Field> : <Field label="Page slug"><input required className={INPUT} value={pageSlug} onChange={event => setPageSlug(event.target.value)} /></Field>)}<Field label="External event (optional)"><select className={INPUT} value={externalEventId} onChange={event => setExternalEventId(event.target.value)}><option value="">No external event</option>{(workspace.externalEvents || []).map(item => <option key={item.id} value={item.id}>{item.start_date} · {item.event_name}</option>)}</select></Field><Field label="Output goal"><textarea required rows="3" className={INPUT} value={goal} onChange={event => setGoal(event.target.value)} /></Field><Field label="Required format"><input required className={INPUT} value={format} onChange={event => setFormat(event.target.value)} /></Field><Field label="Designer instructions"><textarea required rows="5" className={INPUT} value={instructions} onChange={event => setInstructions(event.target.value)} /></Field><div className="grid gap-2 sm:grid-cols-2">{directionModels.map(model => <label key={model.id} className="flex items-start gap-3 rounded-xl border border-white/10 p-3"><input type="checkbox" checked={modelIds.includes(model.id)} onChange={() => toggle(model.id)} /><span className="text-sm">{model.display_name}</span></label>)}</div><label className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm"><input required type="checkbox" checked={safe} onChange={event => setSafe(event.target.checked)} /><span>I confirm these designer instructions are safe for the selected models.</span></label><button disabled={busy === 'create-session' || !serviceId || !modelIds.length || !safe} className={`${BUTTON} w-full`}>Compile exact approved context</button></form></Modal>
}
function RefineModal({ direction, version, sessions, briefVersions: allBriefVersions, briefs, reviewers, currentUserId, onClose, onSave: submitRefinement, busy }) {
  const [content, setContent] = useState(version.content)
  const [isExperimental, setIsExperimental] = useState(false)
  const [reviewerIds, setReviewerIds] = useState([])
  const briefVersions = creativeBriefVersionsForDirectionContext(direction, sessions, briefs, allBriefVersions)
  const compatibleIds = new Set(briefVersions.map(item => item.id))
  const compatibleBrief = briefs.find(brief => brief.id === briefVersions[0]?.creative_brief_id)
  const frozenVersionId = compatibleIds.has(compatibleBrief?.frozen_version_id) ? compatibleBrief.frozen_version_id : ''
  const linkedVersionId = compatibleIds.has(version.creative_brief_version_id) ? version.creative_brief_version_id : ''
  const [briefVersionId, setBriefVersionId] = useState(linkedVersionId || frozenVersionId || briefVersions.at(-1)?.id || '')
  const onSave = (nextContent, experiment, selectedVersionId) => {
    const validation = validateCreativeBriefVersionSelection(selectedVersionId, briefVersions)
    if (!validation.valid) throw new Error(validation.error)
    return submitRefinement(nextContent, experiment, selectedVersionId)
  }
  const set = (key, value) => setContent(current => ({ ...current, [key]: value }))
  function toggleReviewer(id) { setReviewerIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]) }
  return <Modal title={`Refine “${version.content.title}” as a new version`} onClose={onClose}><form onSubmit={event => { event.preventDefault(); onSave(content, { isExperimental, reviewerIds }, briefVersionId) }} className="space-y-4"><Field label="Exact source brief version"><select required className={INPUT} value={briefVersionId} onChange={event => setBriefVersionId(event.target.value)}><option value="">Choose a saved brief version</option>{briefVersions.map(item => <option key={item.id} value={item.id}>Brief v{item.version_number} · {item.id.slice(0, 8)}</option>)}</select></Field><Field label="Concept title"><input required className={INPUT} value={content.title || ''} onChange={event => set('title', event.target.value)} /></Field><Field label="Rationale"><textarea required rows="4" className={INPUT} value={content.rationale || ''} onChange={event => set('rationale', event.target.value)} /></Field><Field label="Creative thesis"><textarea required rows="3" className={INPUT} value={content.creative_thesis || ''} onChange={event => set('creative_thesis', event.target.value)} /></Field><Field label="Imagery direction"><textarea rows="3" className={INPUT} value={content.imagery_direction || ''} onChange={event => set('imagery_direction', event.target.value)} /></Field><Field label="Layout direction"><textarea rows="3" className={INPUT} value={content.layout_direction || ''} onChange={event => set('layout_direction', event.target.value)} /></Field><label className="flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3"><input type="checkbox" checked={isExperimental} onChange={event => setIsExperimental(event.target.checked)} /><span><span className="block text-sm font-semibold text-amber-200">Mark as experimental</span><span className="mt-1 block text-xs text-slate-400">Keep this version outside main comparison and history until someone promotes it.</span></span></label>{isExperimental && <div><p className="text-sm font-medium">Invite reviewers</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{reviewers.filter(reviewer => reviewer.user_id !== currentUserId).map(reviewer => <label key={reviewer.user_id} className="flex gap-3 rounded-xl border border-white/10 p-3"><input type="checkbox" checked={reviewerIds.includes(reviewer.user_id)} onChange={() => toggleReviewer(reviewer.user_id)} /><span><span className="block text-sm font-semibold">{reviewer.full_name}</span><span className="text-xs capitalize text-slate-500">{reviewer.department_id || 'cross-functional'} · {reviewer.role.replaceAll('_', ' ')}</span></span></label>)}</div></div>}<button disabled={busy === 'refine' || !briefVersionId} className={`${BUTTON} w-full`}>{isExperimental ? 'Create private experiment' : 'Create linked version'}</button></form></Modal>
}

function approvedArchitectureOptions(workspace) {
  return workspace.artifacts.filter(artifact => artifact.artifact_type === 'website_architecture').map(artifact => {
    const approval = workspace.approvals.filter(item => item.artifact_id === artifact.id).sort((a, b) => new Date(b.approved_at) - new Date(a.approved_at))[0]
    const version = workspace.versions.find(item => item.id === approval?.artifact_version_id)
    return version ? { artifact, version } : null
  }).filter(Boolean)
}
function flowPageOptions(workspace, flowId) {
  const flow = (workspace.pageFlows || []).find(item => item.id === flowId)
  if (!flow?.website_architecture_artifact_id) return []
  const selected = approvedArchitectureOptions(workspace).find(item => item.artifact.id === flow.website_architecture_artifact_id)
  return (Array.isArray(selected?.version?.content?.pages) ? selected.version.content.pages : []).map(page => typeof page?.slug === 'string' ? page.slug.trim() : '').filter(Boolean)
}

function bestStage(stages, type) { const terms = type === 'discovery' ? ['discovery'] : type === 'vision' ? ['vision', 'identity'] : type === 'audience' ? ['audience'] : ['design']; return stages.find(stage => terms.some(term => stage.name.toLowerCase().includes(term))) }
function serviceCatalog(service) { return Array.isArray(service?.service_catalog) ? service.service_catalog[0] : service?.service_catalog }
function sessionServiceLabel(session, services) { const service = services.find(item => item.id === session.engagement_service_id); return serviceCatalog(service)?.name || familyLabel(session.output_family) }
function familyLabel(value) { return OUTPUT_FAMILIES.find(([id]) => id === value)?.[1] || value }
function Shell({ children, parentPath }) { return <main className="min-h-full bg-slate-950 px-5 py-6 text-slate-100 lg:px-8">{parentPath && <div className="mx-auto mb-5 max-w-3xl"><Link to={parentPath} className={BUTTON}>Back to Design Workshop</Link></div>}{children}</main> }
function Panel({ children }) { return <section className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 shadow-xl shadow-black/10">{children}</section> }
function Badge({ children, tone = 'slate' }) { const colors = { slate: 'bg-white/5 text-slate-300', green: 'bg-emerald-500/10 text-emerald-300', amber: 'bg-amber-500/10 text-amber-300', violet: 'bg-violet-500/10 text-violet-300', red: 'bg-red-500/10 text-red-300' }; return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${colors[tone]}`}>{children}</span> }
function Field({ label, children }) { return <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>{children}</label> }
function Empty({ title, text, compact = false }) { return <div className={`${compact ? 'mt-5 py-3' : 'py-24'} text-center`}><p className="font-semibold text-slate-300">{title}</p><p className="mt-1 text-sm text-slate-500">{text}</p></div> }



function Modal({ title, onClose, children }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5">Close</button></div>{children}</div></div> }
