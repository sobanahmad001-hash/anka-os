import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useSearchParams } from 'react-router-dom'
import { useOrganization } from '../context/OrganizationContext.jsx'

import {
  AD_CAMPAIGN_TYPES,
  AD_MATCH_TYPES,
  AD_STRUCTURE_STATUSES,
  CAMPAIGN_STATUSES,
  MARKETING_ARTIFACT_FORMS,
  blankMarketingArtifact,
  campaignAfterDeletion,
  defaultReportingPeriod,
  latestVersion,
  lines,
  resolveMarketingArtifactDestination,
} from '../data/marketingStudio.js'
import {
  BACKLINK_COST_TYPES,
  BACKLINK_LINK_TYPES,
  BACKLINK_STATUSES,
  backlinkTargetEditor,
  blankBacklinkTarget,
  filterBacklinkTargets,
} from '../data/backlinkOutreach.js'
import { marketingStudio } from '../data/marketingStudioRepository.js'
import { canEditCampaignPlan } from '../data/marketingCampaignPlan.js'
import { createMarketingCampaignPlanRepository } from '../data/marketingCampaignPlanRepository.js'
import { shouldApplyDashboardResponse } from '../data/performanceDashboard.js'
import { loadPerformanceDashboard } from '../data/performanceDashboardRepository.js'
import { shouldApplyKeywordResearchResponse } from '../data/marketingKeywordResearch.js'
import { loadMarketingKeywordResearch } from '../data/marketingKeywordResearchRepository.js'
import { technicalSeo } from '../data/technicalSeoRepository.js'
import { canManageMarketingConnections } from '../data/marketingConnectionReadiness.js'
import {
  marketingSelectionParams,
  privateMarketingParams,
  reportAuthorizedMarketingAction,
  resolveMarketingContext,
  resolveMarketingNavigationScope,
  runAuthorizedMarketingAction,
  selectableMarketingEngagements,
} from '../data/marketingWorkshopContext.js'
import { appendWorkshopNavigation, parseWorkshopNavigation, validateWorkshopNavigation, workspaceReturnTarget } from '../data/workshopNavigation.js'
import DepartmentChat from '../components/DepartmentChat.jsx' // eslint-disable-line no-unused-vars
import MarketingConnectionReadinessPanel from '../components/MarketingConnectionReadinessPanel.jsx'
import MarketingOverview from '../components/MarketingOverview.jsx'
import MarketingCampaignBrief from '../components/MarketingCampaignBrief.jsx'
import MarketingCampaignPlan from '../components/MarketingCampaignPlan.jsx'
import QuickTasks from './QuickTasks.jsx'
import WorkshopContextShell from '../components/WorkshopContextShell.jsx'
import VersionProofingPanel from '../components/VersionProofingPanel.jsx'
import ArtifactRelationsPanel from '../components/ArtifactRelationsPanel.jsx'
import ArtifactApprovalPanel from '../components/ArtifactApprovalPanel.jsx'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'
const MARKETING_TABS = Object.freeze([
  ['overview', 'Overview'],
  ['brief', 'Campaign brief'],
  ['campaigns', 'Campaigns'],
  ['ad-tracking', 'Ad campaign tracking'],
  ['seo-keywords', 'SEO keyword history'],
  ['backlinks', 'Backlink outreach'],
  ['artifacts', 'Artifacts'],
  ['chat', 'Shared Department Chat'],
  ['analytics', 'Performance dashboard'],
  ['connections', 'Connections'],
])

function blankCampaign() {
  return { name: '', objective: '', planned_channels: '', starts_on: '', ends_on: '', planned_budget: '', currency_code: 'USD', status: 'draft' }
}

function campaignEditor(campaign) {
  if (!campaign) return blankCampaign()
  return { ...campaign, planned_channels: (campaign.planned_channels || []).join('\n'), planned_budget: campaign.planned_budget ?? '' }
}

function artifactEditor(type, content = null) {
  const blank = blankMarketingArtifact(type)
  return Object.fromEntries(Object.entries(content || blank).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : value || '']))
}

function titleize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function Notice({ error, message }) {
  if (error) return <div className="rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>
  if (message) return <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{message}</div>
  return null
}

export default function MarketingStudio() {
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    activeOrganizationId, selectionRequired, loading: organizationLoading,
    handleOrganizationAccessError, scopeRevision, requestSignal, activeMembership,
  } = useOrganization()
  const navigationContext = useMemo(() => parseWorkshopNavigation(searchParams), [searchParams])
  const requestedPrivate = searchParams.get('mode') === 'private'
  const requestedTab = MARKETING_TABS.some(([id]) => id === navigationContext.workshopTab)
    ? navigationContext.workshopTab : 'overview'
  const navigationLoadKey = useMemo(() => JSON.stringify({
    organizationId: navigationContext.organizationId,
    clientId: navigationContext.clientId,
    projectId: navigationContext.projectId,
    engagementId: navigationContext.engagementId,
    brandId: navigationContext.brandId,
    activeServiceId: navigationContext.activeServiceId,
    stageId: navigationContext.stageId,
    workRecord: navigationContext.workRecord,
    output: navigationContext.output,
    draft: navigationContext.draft,
  }), [navigationContext])
  const [engagements, setEngagements] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [campaignId, setCampaignId] = useState('')
  const [tab, setTab] = useState(requestedTab)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [briefDirty, setBriefDirty] = useState(false)
  const briefSaveRef = useRef(null)
  const navigationBlocker = useBlocker(briefDirty)
  const scope = useRef({ organizationId: activeOrganizationId, revision: scopeRevision })
  scope.current = { organizationId: activeOrganizationId, revision: scopeRevision }
  const organizationReady = Boolean(activeOrganizationId) && !organizationLoading && !selectionRequired
  const studio = useMemo(() => organizationReady
    ? marketingStudio.forOrganization(activeOrganizationId, { signal: requestSignal })
    : null, [activeOrganizationId, organizationReady, requestSignal])
  const campaignPlans = useMemo(() => organizationReady
    ? createMarketingCampaignPlanRepository(activeOrganizationId, { signal: requestSignal })
    : null, [activeOrganizationId, organizationReady, requestSignal])
  const workspaceGeneration = useRef(0)
  const context = useMemo(
    () => resolveMarketingContext(navigationContext, engagements, activeOrganizationId, requestedPrivate),
    [activeOrganizationId, engagements, navigationContext, requestedPrivate],
  )
  const engagementId = context.engagement?.id || ''
  const selectableEngagements = useMemo(
    () => selectableMarketingEngagements(navigationContext, engagements),
    [engagements, navigationContext],
  )
  const canonicalScope = useMemo(
    () => resolveMarketingNavigationScope(navigationContext, workspace, activeOrganizationId),
    [activeOrganizationId, navigationContext, workspace],
  )
  const contextValidation = validateWorkshopNavigation(navigationContext, canonicalScope)
  const sameOrganization = !navigationContext.organizationId || navigationContext.organizationId === activeOrganizationId
  const returnTarget = workspaceReturnTarget(contextValidation.context ? contextValidation : {}, {
    fallbackProjectId: sameOrganization ? context.engagement?.project_id : '',
  })
  const parentWorkshopPath = appendWorkshopNavigation('/sphere/marketing', {
    ...(contextValidation.context || {}),
    workshopTab: '',
  })

  function currentScope(request) {
    return !request.signal?.aborted &&
      scope.current.organizationId === request.organizationId &&
      scope.current.revision === request.revision
  }

  function organizationMismatch(rows) {
    return (rows || []).some(row => row.organization_id !== activeOrganizationId)
  }

  useLayoutEffect(() => {
    workspaceGeneration.current += 1
    setEngagements([])
    setWorkspace(null); setCampaignId(''); setTab('overview')
    setLoading(organizationReady); setSaving(false); setError(''); setMessage('')
  }, [activeOrganizationId, organizationReady, scopeRevision])

  async function loadWorkspace(id, preferredCampaignId = '', inheritedRequest = null) {
    if (!id) return setWorkspace(null)
    if (!studio || !organizationReady) return
    const generation = ++workspaceGeneration.current
    const request = inheritedRequest || {
      organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal,
    }
    setLoading(true)
    setError('')
    try {
      const result = await studio.load(id, navigationContext)
      const mismatch = result?.engagement?.organization_id !== request.organizationId
      if (mismatch) throw Object.assign(new Error('Marketing workspace organization mismatch'), { status: 403, membershipMismatch: true })
      if (!currentScope(request) || generation !== workspaceGeneration.current) return
      setWorkspace(result)
      const requestedCampaignId = preferredCampaignId || searchParams.get('campaign') || ''
      const nextCampaign = result.campaigns.find(item => item.id === requestedCampaignId)?.id || result.campaigns[0]?.id || ''
      setCampaignId(nextCampaign)
    } catch (loadError) {
      if (!currentScope(request) || loadError?.name === 'AbortError') return
      handleOrganizationAccessError(loadError, { membershipMismatch: loadError?.membershipMismatch === true })
      setError(loadError.message)
    } finally {
      if (currentScope(request) && generation === workspaceGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!studio || !organizationReady) return undefined
    let active = true
    const request = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    studio.listEngagements().then(rows => {
      const mismatch = organizationMismatch(rows)
      if (mismatch) throw Object.assign(new Error('Marketing catalogue organization mismatch'), { status: 403, membershipMismatch: true })
      if (!active || !currentScope(request)) return
      setEngagements(rows || [])
      setLoading(false)
    }).catch(loadError => {
      if (active && currentScope(request) && loadError?.name !== 'AbortError') {
        handleOrganizationAccessError(loadError, { membershipMismatch: loadError?.membershipMismatch === true })
        setError(loadError.message); setLoading(false)
      }
    })
    return () => { active = false }
  }, [activeOrganizationId, organizationReady, requestSignal, scopeRevision, studio])

  useEffect(() => {
    if (engagementId) loadWorkspace(engagementId)
    else setWorkspace(null)
    // Exact record and output pointers must be re-resolved when navigation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId, navigationLoadKey, studio])

  useEffect(() => { setTab(requestedTab) }, [requestedTab])

  const selectedCampaign = workspace?.campaigns.find(item => item.id === campaignId) || null

  async function act(callback, success, preferredCampaign = '', refreshWorkspace = true) {
    if (!studio || !organizationReady) return null
    if (contextValidation.status !== 'ready') {
      setError('Official Marketing changes require a current authorized work context.')
      return null
    }
    const request = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await runAuthorizedMarketingAction(contextValidation, () => currentScope(request), callback)
      if (!currentScope(request)) return null
      setMessage(success)
      if (refreshWorkspace) await loadWorkspace(engagementId, preferredCampaign || result?.id || campaignId, request)
      return result
    } catch (actionError) {
      if (!currentScope(request) || actionError?.name === 'AbortError') return null
      handleOrganizationAccessError(actionError, { membershipMismatch: actionError?.membershipMismatch === true })
      setError(actionError.message)
      return null
    } finally {
      if (currentScope(request)) setSaving(false)
    }
  }

  async function reportMarketingAccess(callback) {
    const request = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    return reportAuthorizedMarketingAction(contextValidation, () => currentScope(request), callback, actionError => {
      handleOrganizationAccessError(actionError, { membershipMismatch: actionError?.membershipMismatch === true })
    })
  }

  if (!organizationReady) {
    return <div className="flex h-full items-center justify-center bg-slate-950 p-6 text-sm text-slate-400">{organizationLoading ? 'Loading organization access…' : 'Choose an active organization before opening Marketing Studio.'}</div>
  }

  if (!loading && context.mode === 'choose') return <MarketingEntryShell parentPath={parentWorkshopPath}>
    <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Marketing Studio</p>
      <h1 className="mt-2 text-2xl font-semibold">Choose Marketing work</h1>
      <p className="mt-2 text-sm text-slate-400">Select an authorized engagement. Marketing Studio will not choose work silently.</p>
      <div className="mt-5 grid gap-3">{selectableEngagements.map(item => <button type="button" key={item.id} onClick={() => setSearchParams(marketingSelectionParams(navigationContext, item, activeOrganizationId))} className="rounded-xl border border-slate-700 px-4 py-3 text-left text-sm font-semibold text-slate-200 hover:border-emerald-500">{item.name} · {item.brands?.name || 'Brand'}</button>)}</div>
      {!selectableEngagements.length && <p className="mt-5 text-sm text-slate-500">No active Marketing engagement is available in this organization.</p>}
      <button type="button" onClick={() => setSearchParams(privateMarketingParams(navigationContext, activeOrganizationId))} className={BUTTON + ' mt-5'}>Open private experiment</button>
    </section>
  </MarketingEntryShell>

  if (!loading && context.mode === 'private') return <MarketingEntryShell parentPath={parentWorkshopPath}>
    <section className="mx-auto max-w-7xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Private experiment</p>
      <h1 className="mt-2 text-2xl font-semibold">Private Marketing workspace</h1>
      <p className="mt-2 text-sm leading-6 text-slate-400">Quick Tasks is the sole private Marketing mode. It receives no project, engagement, brand, provider account, or official save target.</p>
      <button type="button" onClick={() => setSearchParams({})} className={BUTTON + ' mt-5'}>Choose official work</button>
    </section>
    <QuickTasks organizationId={activeOrganizationId} defaultDepartment="marketing" />
  </MarketingEntryShell>

  if (!loading && context.mode === 'denied') {
    const rejected = navigationContext.organizationId && navigationContext.organizationId !== activeOrganizationId
      ? validateWorkshopNavigation(navigationContext, { status: 'ready', activeOrganizationId, organizationId: activeOrganizationId })
      : validateWorkshopNavigation(navigationContext, { status: 'denied' })
    return <MarketingEntryShell parentPath={parentWorkshopPath}><WorkshopContextShell navigation={navigationContext} validation={rejected} returnTarget={workspaceReturnTarget(rejected)}>
      <div />
    </WorkshopContextShell><div className="mt-5 text-center"><button type="button" onClick={() => setSearchParams({})} className={BUTTON}>Choose permitted work</button></div></MarketingEntryShell>
  }

  function selectTab(nextTab) {
    if (nextTab === tab) return
    if (context.engagement) setSearchParams(marketingSelectionParams(navigationContext, context.engagement, activeOrganizationId, {
      workshopTab: nextTab === 'overview' ? '' : nextTab,
    }), { replace: true })
  }

  function openMarketingBrief() {
    selectTab('brief')
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_36%)] px-6 py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">Marketing department</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Marketing Studio</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Plan campaigns, maintain backlink outreach research, version accountable marketing artifacts, and inspect live read-only performance.</p>
          </div>
          <Link to={parentWorkshopPath} className={BUTTON}>Back to Marketing Workshop</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <WorkshopContextShell navigation={navigationContext} validation={contextValidation} returnTarget={returnTarget} projectName={context.engagement?.name}>
        <Notice error={error} message={message} />
        <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <label className="min-w-72 flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Marketing engagement
            <select value={engagementId} onChange={event => { const item = engagements.find(candidate => candidate.id === event.target.value); setSearchParams(item ? marketingSelectionParams(navigationContext, item, activeOrganizationId) : {}) }} className={`${INPUT} mt-2 normal-case tracking-normal`}>
              <option value="">Choose work</option>
              {engagements.map(item => <option key={item.id} value={item.id}>{item.name} · {item.brands?.name || 'Brand'}</option>)}
            </select>
          </label>
          {workspace?.engagement && <div className="rounded-xl bg-slate-950 px-4 py-3 text-sm text-slate-400"><span className="font-semibold text-white">{workspace.engagement.brands?.name}</span><span className="mx-2 text-slate-700">/</span>{workspace.engagement.agency_clients?.name}</div>}
        </section>

        <nav className="flex gap-2 overflow-x-auto border-b border-slate-800">
          {MARKETING_TABS.map(([id, label]) => (
            <button key={id} onClick={() => selectTab(id)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === id ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-500 hover:text-white'}`}>{label}</button>
          ))}
        </nav>

        {loading ? <div className="py-20 text-center text-sm text-slate-500">Loading Marketing Studio…</div> : !workspace ? (
          <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Select an engagement with a Marketing service to begin.</div>
        ) : tab === 'overview' ? (
          <MarketingOverview
            key={`${activeOrganizationId}:${scopeRevision}:${engagementId}`}
            organizationId={activeOrganizationId}
            scopeRevision={scopeRevision}
            signal={requestSignal}
            onAccessError={handleOrganizationAccessError}
            engagement={workspace.engagement}
            serviceId={context.service?.id || ''}
            onOpenBrief={openMarketingBrief}
            onOpenPrivate={() => setSearchParams(privateMarketingParams(navigationContext, activeOrganizationId))}
            onOpenConnections={() => selectTab('connections')}
            onRefresh={() => loadWorkspace(engagementId, campaignId)}
          />
        ) : tab === 'backlinks' ? (
          <BacklinkOutreach key={`${activeOrganizationId}:${scopeRevision}:${workspace.engagement.brand_id}`} studio={studio} brand={{ id: workspace.engagement.brand_id, name: workspace.engagement.brands?.name || 'Brand' }} act={act} onAccessError={handleOrganizationAccessError} />
        ) : tab === 'seo-keywords' ? (
          <SeoKeywordHistory
            key={activeOrganizationId + ':' + scopeRevision + ':' + workspace.engagement.brand_id}
            organizationId={activeOrganizationId}
            scopeRevision={scopeRevision}
            signal={requestSignal}
            onAccessError={handleOrganizationAccessError}
            brand={{ id: workspace.engagement.brand_id, name: workspace.engagement.brands?.name || 'Brand', organization_id: workspace.engagement.organization_id }}
          />
        ) : tab === 'campaigns' ? (
          <Campaigns
            studio={studio}
            campaignPlans={campaignPlans}
            workspace={workspace}
            campaignId={campaignId}
            setCampaignId={setCampaignId}
            selected={selectedCampaign}
            saving={saving}
            act={act}
            canEditPlan={contextValidation.status === 'ready' && canEditCampaignPlan(activeMembership)}
            onAccessError={handleOrganizationAccessError}
          />
        ) : tab === 'brief' ? (
          <MarketingCampaignBrief studio={studio} workspace={workspace} campaign={selectedCampaign} saving={saving} act={act} onRefresh={() => loadWorkspace(engagementId, campaignId)} onDirtyChange={setBriefDirty} saveHandleRef={briefSaveRef} />
        ) : tab === 'ad-tracking' ? (
          <AdCampaignTracking studio={studio} workspace={workspace} saving={saving} act={act} />
        ) : tab === 'artifacts' ? (
          <Artifacts studio={studio} workspace={workspace} campaign={selectedCampaign} saving={saving} act={act} setTab={selectTab} initialType={searchParams.get('artifact')} requestedOutput={contextValidation.context?.output || null} requestedCampaignId={searchParams.get('campaign') || ''} onRefresh={() => loadWorkspace(engagementId, campaignId)} />
        ) : tab === 'chat' ? (
          <DepartmentChat departmentId="marketing" engagement={workspace.engagement} artifactTypes={['channel_strategy', 'campaign_brief', 'measurement_plan']} artifactDefinitions={MARKETING_ARTIFACT_FORMS} artifactForType={artifactType => workspace.artifacts.find(item => item.artifact_type === artifactType)} stageForType={() => null} onPropose={input => reportMarketingAccess(() => studio.proposeArtifact(input))} onProposeWorkItem={input => reportMarketingAccess(() => studio.proposeWorkItem(input))} onCreated={() => loadWorkspace(engagementId, campaignId)} />
        ) : tab === 'connections' ? (
          <MarketingConnectionReadinessPanel
            key={activeOrganizationId + ':' + scopeRevision + ':' + workspace.engagement.brand_id}
            organizationId={activeOrganizationId}
            scopeRevision={scopeRevision}
            signal={requestSignal}
            onAccessError={handleOrganizationAccessError}
            canManage={canManageMarketingConnections(activeMembership)}
            brand={{ id: workspace.engagement.brand_id, name: workspace.engagement.brands?.name || 'Brand', organization_id: workspace.engagement.organization_id }}
          />
        ) : (
          <Analytics key={`${activeOrganizationId}:${scopeRevision}:${engagementId}:${workspace.engagement.brand_id}`} organizationId={activeOrganizationId} scopeRevision={scopeRevision} signal={requestSignal} onAccessError={handleOrganizationAccessError} engagementId={engagementId} brand={{ id: workspace.engagement.brand_id, name: workspace.engagement.brands?.name || 'Brand', organization_id: workspace.engagement.organization_id }} />
        )}
        </WorkshopContextShell>
      </main>
      {navigationBlocker.state === 'blocked' && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5"><section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">Unsaved campaign brief</p><h2 className="mt-2 text-xl font-semibold">Keep, save, or discard your changes?</h2><p className="mt-2 text-sm text-slate-400">The current context will not change until you choose.</p><div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" className={BUTTON} onClick={() => navigationBlocker.reset()}>Stay</button><button type="button" className={BUTTON} onClick={() => { setBriefDirty(false); navigationBlocker.proceed() }}>Discard and continue</button><button type="button" className={PRIMARY} disabled={saving} onClick={async () => { const result = await briefSaveRef.current?.(); if (result) { setBriefDirty(false); navigationBlocker.proceed() } }}>{saving ? 'Saving…' : 'Save current and continue'}</button></div></section></div>}
    </div>
  )
}

function MarketingEntryShell({ children, parentPath }) {
  return <div className="h-full overflow-y-auto bg-slate-950 px-6 py-8 text-white"><div className="mx-auto mb-5 max-w-3xl"><Link to={parentPath} className={BUTTON}>Back to Marketing Workshop</Link></div>{children}</div>
}

function Campaigns({ studio, campaignPlans, workspace, campaignId, setCampaignId, selected, saving, act, canEditPlan, onAccessError }) {
  const [creating, setCreating] = useState(!selected)
  const [form, setForm] = useState(campaignEditor(selected))
  useEffect(() => { setCreating(!selected); setForm(campaignEditor(selected)) }, [selected])

  async function submit(event) {
    event.preventDefault()
    const payload = { ...form, planned_channels: lines(form.planned_channels) }
    const result = await act(
      () => creating ? studio.createCampaign(workspace.engagement.id, payload) : studio.updateCampaign(selected.id, payload),
      creating ? 'Campaign created and recorded in the engagement timeline.' : 'Campaign planning record updated.',
    )
    if (result) { setCampaignId(result.id); setCreating(false) }
  }

  return <div className="space-y-6"><div className="grid gap-6 lg:grid-cols-[340px_1fr]">
    <section className="space-y-3">
      <button onClick={() => { setCreating(true); setForm(blankCampaign()) }} className={`${PRIMARY} w-full`}>New campaign</button>
      {workspace.campaigns.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No campaigns yet.</div> : workspace.campaigns.map(campaign => (
        <button key={campaign.id} onClick={() => { setCampaignId(campaign.id); setCreating(false) }} className={`w-full rounded-2xl border p-4 text-left transition ${campaignId === campaign.id && !creating ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}>
          <div className="flex items-start justify-between gap-3"><p className="font-semibold text-white">{campaign.name}</p><span className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] uppercase text-slate-400">{campaign.status}</span></div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{campaign.objective || 'No objective recorded yet.'}</p>
          <p className="mt-3 text-[11px] text-slate-600">{(campaign.planned_channels || []).join(' · ')}</p>
        </button>
      ))}
    </section>

    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">{creating ? 'New planning record' : 'Campaign detail'}</p><h2 className="mt-1 text-xl font-semibold">{creating ? 'Create campaign' : selected?.name}</h2></div>{!creating && <button type="button" onClick={() => { setCreating(true); setForm(blankCampaign()) }} className={BUTTON}>Start another</button>}</div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Field label="Campaign name"><input required className={INPUT} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Status"><select className={INPUT} value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{CAMPAIGN_STATUSES.map(status => <option key={status}>{status}</option>)}</select></Field>
        <div className="md:col-span-2"><Field label="Objective"><textarea required className={`${INPUT} min-h-24`} value={form.objective} onChange={event => setForm({ ...form, objective: event.target.value })} /></Field></div>
        <div className="md:col-span-2"><Field label="Planned channels" hint="One channel per line"><textarea required className={`${INPUT} min-h-28`} value={form.planned_channels} onChange={event => setForm({ ...form, planned_channels: event.target.value })} /></Field></div>
        <Field label="Starts"><input type="date" className={INPUT} value={form.starts_on || ''} onChange={event => setForm({ ...form, starts_on: event.target.value })} /></Field>
        <Field label="Ends"><input type="date" className={INPUT} value={form.ends_on || ''} onChange={event => setForm({ ...form, ends_on: event.target.value })} /></Field>
        <Field label="Planned budget" hint="Planning only — cannot spend funds"><input type="number" min="0" step="0.01" className={INPUT} value={form.planned_budget} onChange={event => setForm({ ...form, planned_budget: event.target.value })} /></Field>
        <Field label="Currency"><input maxLength="3" className={`${INPUT} uppercase`} value={form.currency_code} onChange={event => setForm({ ...form, currency_code: event.target.value.toUpperCase() })} /></Field>
      </div>
      <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-800 pt-5"><p className="text-xs leading-5 text-slate-500">This record coordinates work only. No field or action can alter Google Ads spend.</p><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : creating ? 'Create campaign' : 'Save changes'}</button></div>
    </form>
  </div>
    {selected && !creating && campaignPlans ? <MarketingCampaignPlan
      organizationId={workspace.engagement.organization_id}
      engagement={workspace.engagement}
      campaign={selected}
      repository={campaignPlans}
      canEdit={canEditPlan}
      onAccessError={onAccessError}
    /> : <section className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
      Save or select a campaign to author its immutable plan versions.
    </section>}
  </div>
}

function BacklinkOutreach({ studio, brand, act, onAccessError }) { // eslint-disable-line no-unused-vars
  const [targets, setTargets] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [creating, setCreating] = useState(true)
  const [form, setForm] = useState(blankBacklinkTarget())
  const [filters, setFilters] = useState({ outreach_status: '', link_type: '', cost_type: '', minimum_relevance: '', minimum_authority: '' })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const visibleTargets = useMemo(() => filterBacklinkTargets(targets, filters), [targets, filters])

  useEffect(() => {
    setSelectedId(''); setCreating(true); setForm(blankBacklinkTarget()); setMessage('')
    if (!brand.id) { setTargets([]); return undefined }
    let active = true
    setLoading(true); setError('')
    studio.listBacklinkTargets(brand.id)
      .then(rows => {
        if (rows.some(row => row.organization_id !== studio.organizationId)) {
          throw Object.assign(new Error('Backlink catalogue organization mismatch'), { status: 403, membershipMismatch: true })
        }
        if (active) setTargets(rows)
      })
      .catch(loadError => {
        if (active) {
          onAccessError(loadError, { membershipMismatch: loadError?.membershipMismatch === true })
          setError(loadError.message)
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [brand.id, onAccessError, studio])

  function editTarget(target) {
    setSelectedId(target.id); setCreating(false); setForm(backlinkTargetEditor(target)); setMessage('')
  }

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      const result = await act(
        () => creating ? studio.createBacklinkTarget(brand.id, form) : studio.updateBacklinkTarget(selectedId, form),
        creating ? 'Backlink target added.' : 'Backlink target updated.', '', false,
      )
      if (!result) return
      setSelectedId(result.id); setCreating(false); setForm(backlinkTargetEditor(result))
      setMessage(creating ? 'Backlink target added.' : 'Backlink target updated.')
      setTargets(current => creating ? [result, ...current] : current.map(target => target.id === result.id ? result : target))
    } catch (saveError) {
      onAccessError(saveError, { membershipMismatch: saveError?.membershipMismatch === true })
      setError(saveError.message)
    }
    finally { setSaving(false) }
  }

  if (!brand.id) return <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">This engagement needs a brand before recording backlink opportunities.</div>

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Manual research log</p><h2 className="mt-1 text-xl font-semibold">Backlink outreach</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Qualify opportunities and track human outreach. This area does not scrape sites, send messages, or verify backlinks.</p></div><div className="rounded-xl bg-slate-950 px-4 py-3 text-sm text-slate-400">Engagement brand <span className="ml-2 font-semibold text-white">{brand.name}</span></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Status"><select className={INPUT} value={filters.outreach_status} onChange={event => setFilters({ ...filters, outreach_status: event.target.value })}><option value="">All statuses</option>{BACKLINK_STATUSES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
        <Field label="Link type"><select className={INPUT} value={filters.link_type} onChange={event => setFilters({ ...filters, link_type: event.target.value })}><option value="">All link types</option>{BACKLINK_LINK_TYPES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
        <Field label="Cost type"><select className={INPUT} value={filters.cost_type} onChange={event => setFilters({ ...filters, cost_type: event.target.value })}><option value="">All cost types</option>{BACKLINK_COST_TYPES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
        <Field label="Minimum relevance"><input type="number" min="0" max="100" step="0.01" className={INPUT} value={filters.minimum_relevance} onChange={event => setFilters({ ...filters, minimum_relevance: event.target.value })} /></Field>
        <Field label="Minimum authority"><input type="number" min="0" max="100" step="0.01" className={INPUT} value={filters.minimum_authority} onChange={event => setFilters({ ...filters, minimum_authority: event.target.value })} /></Field>
      </div>
    </section>

    <Notice error={error} message={message} />
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <section className="space-y-3">
        <button type="button" onClick={() => { setCreating(true); setSelectedId(''); setForm(blankBacklinkTarget()); setMessage('') }} className={`${PRIMARY} w-full`}>New backlink target</button>
        {loading ? <div className="rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-500">Loading targets…</div> : visibleTargets.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No targets match these filters.</div> : visibleTargets.map(target => <button type="button" key={target.id} onClick={() => editTarget(target)} className={`w-full rounded-2xl border p-4 text-left ${selectedId === target.id && !creating ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-white">{target.site_name}</p><p className="mt-1 truncate text-xs text-slate-500">{target.site_url || 'URL not recorded'} · {target.industry_category || 'Uncategorised'}</p></div><span className="shrink-0 rounded-full bg-slate-950 px-2.5 py-1 text-[10px] uppercase text-slate-400">{titleize(target.outreach_status)}</span></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs"><Metric label="Relevance" value={target.relevance_score} /><Metric label="Authority" value={target.domain_authority} /><Metric label="Traffic" value={target.estimated_traffic} /></div>
          <p className="mt-3 text-[11px] text-slate-600">{target.link_type ? titleize(target.link_type) : 'Link type unknown'} · {target.cost_type ? titleize(target.cost_type) : 'Cost unknown'}</p>
        </button>)}
      </section>

      <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">{creating ? 'Research opportunity' : 'Target detail'}</p><h2 className="mt-1 text-xl font-semibold">{creating ? 'Add backlink target' : form.site_name}</h2></div>{!creating && <span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs text-slate-400">Historical record retained</span>}</div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Field label="Site name"><input required maxLength="240" className={INPUT} value={form.site_name} onChange={event => setForm({ ...form, site_name: event.target.value })} /></Field>
          <Field label="Site URL" hint="Optional HTTP or HTTPS URL"><input type="url" maxLength="2048" className={INPUT} value={form.site_url} onChange={event => setForm({ ...form, site_url: event.target.value })} /></Field>
          <Field label="Industry category"><input maxLength="160" className={INPUT} value={form.industry_category} onChange={event => setForm({ ...form, industry_category: event.target.value })} /></Field>
          <Field label="Outreach status"><select className={INPUT} value={form.outreach_status} onChange={event => setForm({ ...form, outreach_status: event.target.value })}>{BACKLINK_STATUSES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
          <Field label="Domain authority" hint="0–100; blank means unknown"><input type="number" min="0" max="100" step="0.01" className={INPUT} value={form.domain_authority} onChange={event => setForm({ ...form, domain_authority: event.target.value })} /></Field>
          <Field label="Relevance score" hint="0–100; blank means unknown"><input type="number" min="0" max="100" step="0.01" className={INPUT} value={form.relevance_score} onChange={event => setForm({ ...form, relevance_score: event.target.value })} /></Field>
          <Field label="Estimated traffic" hint="Blank means unknown"><input type="number" min="0" step="0.01" className={INPUT} value={form.estimated_traffic} onChange={event => setForm({ ...form, estimated_traffic: event.target.value })} /></Field>
          <Field label="Link type"><select className={INPUT} value={form.link_type} onChange={event => setForm({ ...form, link_type: event.target.value })}><option value="">Unknown</option>{BACKLINK_LINK_TYPES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
          <Field label="Cost type"><select className={INPUT} value={form.cost_type} onChange={event => setForm({ ...form, cost_type: event.target.value })}><option value="">Unknown</option>{BACKLINK_COST_TYPES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
          <div className="md:col-span-2"><Field label="Notes" hint="Operational context only"><textarea maxLength="20000" className={`${INPUT} min-h-32`} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></Field></div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-5"><p className="text-xs leading-5 text-slate-500">Secured and declined targets stay in the log and remain filterable.</p><button disabled={saving || !brandId} className={PRIMARY}>{saving ? 'Saving…' : creating ? 'Add target' : 'Save changes'}</button></div>
      </form>
    </div>
  </div>
}

function blankAdCampaign() {
  return {
    campaign_name: '', campaign_type: 'search', status: 'draft', daily_budget: '', total_budget: '',
    start_date: '', end_date: '', goal: '', location_targeting: '', audience_segment: '',
    provider_connection_id: '', external_account_id: '', external_campaign_id: '',
  }
}

function editAdCampaign(campaign) {
  if (!campaign) return blankAdCampaign()
  return { ...campaign, location_targeting: (campaign.location_targeting || []).join('\n') }
}

function metric(value, kind = 'number') {
  if (value === null || value === undefined) return '—'
  if (kind === 'percent') return `${(Number(value) * 100).toFixed(2)}%`
  if (kind === 'money') return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function AdCampaignTracking({ studio, workspace, saving, act }) {
  const [selectedId, setSelectedId] = useState(workspace.adCampaigns[0]?.id || '')
  const [creating, setCreating] = useState(workspace.adCampaigns.length === 0)
  const selected = useMemo(() => workspace.adCampaigns.find(item => item.id === selectedId) || null, [workspace.adCampaigns, selectedId])
  const [form, setForm] = useState(editAdCampaign(selected))
  const [groupId, setGroupId] = useState('')
  const [groupForm, setGroupForm] = useState({ name: '', status: 'draft' })
  const [keywordId, setKeywordId] = useState('')
  const [keywordForm, setKeywordForm] = useState({ keyword: '', match_type: 'phrase', is_negative: false })
  const [snapshotDate, setSnapshotDate] = useState(new Date().toISOString().slice(0, 10))

  const groups = useMemo(() => workspace.adGroups.filter(item => item.ad_campaign_id === selected?.id), [workspace.adGroups, selected?.id])
  const selectedGroup = useMemo(() => groups.find(item => item.id === groupId) || null, [groups, groupId])
  const keywords = useMemo(() => workspace.adKeywords.filter(item => item.ad_group_id === selectedGroup?.id), [workspace.adKeywords, selectedGroup?.id])
  const snapshots = useMemo(() => workspace.adSnapshots.filter(item => item.ad_campaign_id === selected?.id), [workspace.adSnapshots, selected?.id])
  const latest = snapshots.at(-1)

  useEffect(() => {
    if (selectedId && !workspace.adCampaigns.some(item => item.id === selectedId)) {
      setSelectedId(workspace.adCampaigns[0]?.id || '')
    }
  }, [workspace.adCampaigns, selectedId])
  useEffect(() => { if (!creating) setForm(editAdCampaign(selected)) }, [selected, creating])
  useEffect(() => {
    const first = groups[0]
    if (!groups.some(item => item.id === groupId)) {
      setGroupId(first?.id || '')
      setGroupForm(first ? { name: first.name, status: first.status } : { name: '', status: 'draft' })
    }
  }, [groups, groupId])
  useEffect(() => {
    if (selectedGroup) setGroupForm({ name: selectedGroup.name, status: selectedGroup.status })
    setKeywordId(''); setKeywordForm({ keyword: '', match_type: 'phrase', is_negative: false })
  }, [selectedGroup])

  async function saveCampaign(event) {
    event.preventDefault()
    const payload = { ...form, location_targeting: lines(form.location_targeting) }
    const result = await act(
      () => creating
        ? studio.createAdCampaign(workspace.engagement.id, payload)
        : studio.updateAdCampaign(workspace.engagement.id, selected.id, payload),
      creating ? 'Google Ads planning campaign created.' : 'Google Ads planning campaign updated.',
    )
    if (result) { setSelectedId(result.id); setCreating(false) }
  }

  function selectConnection(connectionId) {
    const connection = workspace.googleAdsConnections.find(item => item.id === connectionId)
    setForm({ ...form, provider_connection_id: connectionId, external_account_id: connection?.customer_id || '', external_campaign_id: connectionId ? form.external_campaign_id : '' })
  }

  async function removeCampaign() {
    if (!selected || !window.confirm(`Delete the local planning record “${selected.campaign_name}” and its local descendants? Google Ads will not be changed.`)) return
    const nextCampaign = campaignAfterDeletion(workspace.adCampaigns, selected.id)
    const result = await act(() => studio.deleteAdCampaign(workspace.engagement.id, selected.id), 'Local ad campaign planning record deleted.')
    if (result) {
      setSelectedId(nextCampaign?.id || '')
      setCreating(!nextCampaign)
      setForm(editAdCampaign(nextCampaign))
    }
  }

  async function saveGroup(event) {
    event.preventDefault()
    const result = await act(
      () => studio.saveAdGroup(workspace.engagement.id, selected.id, groupId, groupForm),
      groupId ? 'Ad group planning record updated.' : 'Ad group planning record created.',
    )
    if (result) setGroupId(result.id)
  }

  async function removeGroup() {
    if (!selectedGroup || !window.confirm(`Delete local ad group “${selectedGroup.name}” and its keywords?`)) return
    const result = await act(() => studio.deleteAdGroup(workspace.engagement.id, selectedGroup.id), 'Local ad group deleted.')
    if (result) { setGroupId(''); setGroupForm({ name: '', status: 'draft' }) }
  }

  async function saveKeyword(event) {
    event.preventDefault()
    const result = await act(
      () => studio.saveAdKeyword(workspace.engagement.id, selectedGroup.id, keywordId, keywordForm),
      keywordId ? 'Keyword planning record updated.' : 'Keyword planning record added.',
    )
    if (result) { setKeywordId(''); setKeywordForm({ keyword: '', match_type: 'phrase', is_negative: false }) }
  }

  async function removeKeyword(id) {
    await act(() => studio.deleteAdKeyword(workspace.engagement.id, id), 'Keyword planning record deleted.')
  }

  async function importSnapshot() {
    const result = await act(
      () => studio.importAdPerformance(workspace.engagement.id, selected.id, snapshotDate),
      'Read-only Google Ads performance import completed.',
    )
    if (result && !result.imported) window.alert('That campaign/date snapshot already exists. The immutable original was kept.')
  }

  return <div className="space-y-6">
    <div className="rounded-2xl border border-amber-700/50 bg-amber-950/25 p-5 text-sm leading-6 text-amber-100">
      <p className="font-semibold">Planning mirror only</p>
      <p className="mt-1 text-amber-200/80">Campaign, budget, status, ad group, and keyword changes made here are local planning records. They must still be executed in Google Ads. The only provider action below is a read-only performance import.</p>
    </div>
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <section className="space-y-3">
        <button onClick={() => { setCreating(true); setSelectedId(''); setForm(blankAdCampaign()) }} className={`${PRIMARY} w-full`}>New Google Ads plan</button>
        {workspace.adCampaigns.map(campaign => {
          const campaignSnapshots = workspace.adSnapshots.filter(item => item.ad_campaign_id === campaign.id)
          const summary = campaignSnapshots.at(-1)
          return <button key={campaign.id} onClick={() => { setCreating(false); setSelectedId(campaign.id) }} className={`w-full rounded-2xl border p-4 text-left ${!creating && selectedId === campaign.id ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/70'}`}>
            <div className="flex justify-between gap-3"><span className="font-semibold">{campaign.campaign_name}</span><span className="text-[10px] uppercase text-slate-500">{campaign.status}</span></div>
            <p className="mt-2 text-xs text-slate-500">{titleize(campaign.campaign_type)} · Daily {campaign.daily_budget == null ? '—' : metric(campaign.daily_budget, 'money')} · Total {campaign.total_budget == null ? '—' : metric(campaign.total_budget, 'money')}</p>
            <p className="mt-1 text-[11px] text-slate-600">{campaign.start_date || 'No start'} → {campaign.end_date || 'No end'}</p>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{campaign.goal || 'No campaign goal recorded.'}</p>
            <p className="mt-2 text-[11px] leading-5 text-slate-600">{summary ? `${summary.snapshot_date} · ${metric(summary.impressions)} impressions · ${metric(summary.clicks)} clicks · ${metric(summary.cost, 'money')} cost · ${metric(summary.conversions)} conversions` : 'No imported performance'}</p>
          </button>
        })}
      </section>
      <section className="space-y-6">
        <form onSubmit={saveCampaign} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Google Ads planning</p><h2 className="mt-1 text-xl font-semibold">{creating ? 'Create campaign structure' : selected?.campaign_name}</h2></div>{selected && !creating && <button type="button" onClick={removeCampaign} className="text-xs font-semibold text-red-400 hover:text-red-300">Delete local plan</button>}</div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Field label="Campaign name"><input required className={INPUT} value={form.campaign_name} onChange={event => setForm({ ...form, campaign_name: event.target.value })} /></Field>
            <Field label="Campaign type"><select className={INPUT} value={form.campaign_type} onChange={event => setForm({ ...form, campaign_type: event.target.value })}>{AD_CAMPAIGN_TYPES.map(value => <option key={value}>{value}</option>)}</select></Field>
            <Field label="Status"><select className={INPUT} value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{AD_STRUCTURE_STATUSES.map(value => <option key={value}>{value}</option>)}</select></Field>
            <Field label="Audience segment"><input className={INPUT} value={form.audience_segment} onChange={event => setForm({ ...form, audience_segment: event.target.value })} /></Field>
            <Field label="Daily budget"><input type="number" min="0" step="0.01" className={INPUT} value={form.daily_budget ?? ''} onChange={event => setForm({ ...form, daily_budget: event.target.value })} /></Field>
            <Field label="Total budget"><input type="number" min="0" step="0.01" className={INPUT} value={form.total_budget ?? ''} onChange={event => setForm({ ...form, total_budget: event.target.value })} /></Field>
            <Field label="Start date"><input type="date" className={INPUT} value={form.start_date || ''} onChange={event => setForm({ ...form, start_date: event.target.value })} /></Field>
            <Field label="End date"><input type="date" className={INPUT} value={form.end_date || ''} onChange={event => setForm({ ...form, end_date: event.target.value })} /></Field>
            <div className="md:col-span-2"><Field label="Goal"><textarea className={`${INPUT} min-h-20`} value={form.goal} onChange={event => setForm({ ...form, goal: event.target.value })} /></Field></div>
            <div className="md:col-span-2"><Field label="Location targeting" hint="One location per line"><textarea className={`${INPUT} min-h-20`} value={form.location_targeting} onChange={event => setForm({ ...form, location_targeting: event.target.value })} /></Field></div>
            <Field label="Verified Google Ads connection"><select className={INPUT} value={form.provider_connection_id || ''} onChange={event => selectConnection(event.target.value)}><option value="">Planning only — not linked</option>{workspace.googleAdsConnections.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></Field>
            <Field label="External campaign ID"><input inputMode="numeric" disabled={!form.provider_connection_id} className={INPUT} value={form.external_campaign_id || ''} onChange={event => setForm({ ...form, external_campaign_id: event.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <div className="mt-6 flex justify-end border-t border-slate-800 pt-5"><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : creating ? 'Create local plan' : 'Save local changes'}</button></div>
        </form>

        {selected && !creating && <>
          <div className="grid gap-6 lg:grid-cols-2">
            <form onSubmit={saveGroup} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex justify-between"><h3 className="font-semibold">Ad groups</h3><button type="button" onClick={() => { setGroupId(''); setGroupForm({ name: '', status: 'draft' }) }} className="text-xs text-emerald-400">New group</button></div><div className="mt-4 flex flex-wrap gap-2">{groups.map(group => <button type="button" key={group.id} onClick={() => { setGroupId(group.id); setGroupForm({ name: group.name, status: group.status }) }} className={`rounded-full border px-3 py-1.5 text-xs ${groupId === group.id ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>{group.name}</button>)}</div><div className="mt-4 grid gap-3"><Field label="Group name"><input required className={INPUT} value={groupForm.name} onChange={event => setGroupForm({ ...groupForm, name: event.target.value })} /></Field><Field label="Status"><select className={INPUT} value={groupForm.status} onChange={event => setGroupForm({ ...groupForm, status: event.target.value })}>{AD_STRUCTURE_STATUSES.map(value => <option key={value}>{value}</option>)}</select></Field><div className="flex justify-end gap-3">{selectedGroup && <button type="button" onClick={removeGroup} className="text-xs text-red-400">Delete</button>}<button disabled={saving} className={BUTTON}>{groupId ? 'Update group' : 'Add group'}</button></div></div></form>
            <form onSubmit={saveKeyword} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h3 className="font-semibold">Keywords</h3>{!selectedGroup ? <p className="mt-4 text-sm text-slate-500">Select or create an ad group first.</p> : <><div className="mt-4 max-h-40 space-y-2 overflow-auto">{keywords.map(item => <div key={item.id} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs"><button type="button" onClick={() => { setKeywordId(item.id); setKeywordForm({ keyword: item.keyword, match_type: item.match_type, is_negative: item.is_negative }) }} className="min-w-0 flex-1 truncate text-left text-slate-300">{item.keyword}</button><span className={item.is_negative ? 'text-red-400' : 'text-emerald-400'}>{item.is_negative ? 'Negative' : 'Positive'}</span><span className="text-slate-600">{item.match_type}</span><button type="button" onClick={() => removeKeyword(item.id)} className="text-red-500">×</button></div>)}</div><div className="mt-4 grid gap-3"><Field label="Keyword"><input required className={INPUT} value={keywordForm.keyword} onChange={event => setKeywordForm({ ...keywordForm, keyword: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Match"><select className={INPUT} value={keywordForm.match_type} onChange={event => setKeywordForm({ ...keywordForm, match_type: event.target.value })}>{AD_MATCH_TYPES.map(value => <option key={value}>{value}</option>)}</select></Field><label className="flex items-end gap-2 pb-3 text-xs text-slate-400"><input type="checkbox" checked={keywordForm.is_negative} onChange={event => setKeywordForm({ ...keywordForm, is_negative: event.target.checked })} /> Negative keyword</label></div><div className="flex justify-end"><button disabled={saving} className={BUTTON}>{keywordId ? 'Update keyword' : 'Add keyword'}</button></div></div></>}</form>
          </div>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex flex-wrap items-end gap-4"><div className="mr-auto"><h3 className="font-semibold">Dated performance snapshots</h3><p className="mt-1 text-sm text-slate-500">Append-only reporting history from the linked Google Ads campaign.</p></div><Field label="Snapshot date"><input type="date" className={INPUT} value={snapshotDate} onChange={event => setSnapshotDate(event.target.value)} /></Field><button type="button" disabled={saving || !selected.provider_connection_id} onClick={importSnapshot} className={PRIMARY}>Import read-only metrics</button></div>{latest && <div className="mt-5 grid gap-3 sm:grid-cols-3"><MetricCard label="CTR" value={metric(latest.ctr, 'percent')} /><MetricCard label="CPC" value={metric(latest.cpc, 'money')} /><MetricCard label="Cost / conversion" value={metric(latest.cost_per_conversion, 'money')} /></div>}<div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="text-slate-500"><tr>{['Date', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'CTR', 'CPC', 'Cost / conversion'].map(label => <th key={label} className="border-b border-slate-800 px-3 py-2">{label}</th>)}</tr></thead><tbody>{snapshots.map(row => <tr key={row.id} className="text-slate-300"><td className="px-3 py-2">{row.snapshot_date}</td><td className="px-3 py-2">{metric(row.impressions)}</td><td className="px-3 py-2">{metric(row.clicks)}</td><td className="px-3 py-2">{metric(row.cost, 'money')}</td><td className="px-3 py-2">{metric(row.conversions)}</td><td className="px-3 py-2">{metric(row.ctr, 'percent')}</td><td className="px-3 py-2">{metric(row.cpc, 'money')}</td><td className="px-3 py-2">{metric(row.cost_per_conversion, 'money')}</td></tr>)}</tbody></table>{snapshots.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No snapshots imported yet.</p>}</div></section>
        </>}
      </section>
    </div>
  </div>
}

function Metric({ label, value }) { // eslint-disable-line no-unused-vars
  const known = value !== null && value !== undefined && value !== ''
  return <div className="rounded-lg bg-slate-950 px-2.5 py-2"><p className="text-[9px] uppercase tracking-[0.1em] text-slate-600">{label}</p><p className="mt-1 font-semibold text-slate-300">{known ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</p></div>
}

function MetricCard({ label, value }) {
  return <div className="rounded-xl bg-slate-950 p-4"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>
}

function Artifacts({ studio, workspace, campaign, saving, act, setTab, initialType, requestedOutput, requestedCampaignId, onRefresh }) {
  const destination = resolveMarketingArtifactDestination(workspace, requestedOutput, requestedCampaignId)
  const resolvedCampaign = destination?.status === 'ready' ? destination.campaign : campaign
  const [type, setType] = useState(destination?.artifact?.artifact_type || (MARKETING_ARTIFACT_FORMS[initialType] ? initialType : 'channel_strategy'))
  useEffect(() => { if (destination?.status === 'ready') setType(destination.artifact.artifact_type) }, [destination?.artifact?.artifact_type, destination?.status])
  const links = resolvedCampaign ? workspace.links.filter(item => item.campaign_id === resolvedCampaign.id) : []
  const artifact = destination?.status === 'ready' && destination.artifact.artifact_type === type
    ? destination.artifact : workspace.artifacts.find(item => links.some(link => link.artifact_id === item.id) && item.artifact_type === type)
  const versions = artifact ? workspace.versions.filter(item => item.artifact_id === artifact.id) : []
  const latest = latestVersion(versions)
  const openedVersion = destination?.status === 'ready' && destination.artifact.id === artifact?.id ? destination.version : latest
  const approval = openedVersion ? workspace.approvals.find(item => item.artifact_version_id === openedVersion.id) : null
  const [form, setForm] = useState(artifactEditor(type, openedVersion?.content))
  useEffect(() => { setForm(artifactEditor(type, openedVersion?.content)) }, [type, openedVersion?.content, openedVersion?.id])
  const definition = MARKETING_ARTIFACT_FORMS[type]

  if (requestedOutput && destination?.status !== 'ready') return <div role="alert" className="rounded-2xl border border-dashed border-amber-500/40 px-6 py-16 text-center"><p className="font-semibold text-amber-100">The requested artifact version is not visible in this Marketing context.</p><p className="mt-2 text-sm text-amber-200/80">Return to the originating work record or choose currently authorized work.</p></div>
  if (!resolvedCampaign) return <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center"><p className="text-sm text-slate-400">Create or select a campaign before linking its artifacts.</p><button onClick={() => setTab('campaigns')} className={`${PRIMARY} mt-4`}>Go to campaigns</button></div>

  async function save(event) {
    event.preventDefault()
    const content = Object.fromEntries(definition.fields.map(([key, , kind]) => [key, kind === 'list' ? lines(form[key]) : form[key]]))
    await act(() => studio.saveArtifact({
      engagement_id: workspace.engagement.id, campaign_id: resolvedCampaign.id, artifact_id: artifact?.id || null,
      artifact_type: type, title: `${resolvedCampaign.name} — ${definition.label}`,
      content, change_summary: latest ? 'Marketing Studio revision' : 'Initial Marketing Studio version', ai_use_allowed: false,
    }), `${definition.label} saved as a new immutable version.`, resolvedCampaign.id)
  }

  return <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
    <section className="space-y-3"><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.14em] text-slate-500">Campaign</p><p className="mt-1 font-semibold text-white">{resolvedCampaign.name}</p></div>{Object.entries(MARKETING_ARTIFACT_FORMS).filter(([id]) => id !== 'campaign_brief').map(([id, item]) => {
      const linkedArtifact = workspace.artifacts.find(candidate => links.some(link => link.artifact_id === candidate.id) && candidate.artifact_type === id)
      return <button key={id} onClick={() => setType(id)} className={`w-full rounded-2xl border p-4 text-left ${type === id ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/70'}`}><div className="flex justify-between gap-3"><span className="font-semibold text-white">{item.label}</span><span className="text-[10px] uppercase text-slate-500">{linkedArtifact ? 'Versioned' : 'Not started'}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{item.description}</p></button>
    })}</section>
    <div><form onSubmit={save} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><div className="flex flex-wrap justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Immutable artifact</p><h2 className="mt-1 text-xl font-semibold">{definition.label}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{definition.description}</p></div><div className="text-right text-xs text-slate-500"><p>{openedVersion ? `Version ${openedVersion.version_number}${openedVersion.id !== latest?.id ? ' · historical exact version' : ''}` : 'No version yet'}</p><p className={approval ? 'mt-1 text-emerald-400' : 'mt-1 text-amber-400'}>{approval ? 'Exact version approved' : 'Approval pending'}</p></div></div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">{definition.fields.map(([key, label, kind]) => <div key={key} className={kind === 'textarea' || kind === 'list' ? 'md:col-span-2' : ''}><Field label={label} hint={kind === 'list' ? 'One item per line' : ''}>{kind === 'textarea' || kind === 'list' ? <textarea required className={`${INPUT} min-h-28`} value={form[key] || ''} onChange={event => setForm({ ...form, [key]: event.target.value })} /> : <input required type={kind} className={INPUT} value={form[key] || ''} onChange={event => setForm({ ...form, [key]: event.target.value })} />}</Field></div>)}</div>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 pt-5"><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : latest ? 'Create new version' : 'Save first version'}</button></div>
    </form><ArtifactApprovalPanel version={openedVersion} approval={approval} theme="emerald" singleApprovalLabel={`Approve version ${openedVersion?.version_number}`} onSingleApprove={() => act(() => studio.approveArtifact(openedVersion.id), `${definition.label} exact version approved.`, resolvedCampaign.id)} onChanged={onRefresh} /><ArtifactRelationsPanel artifact={artifact} /><VersionProofingPanel targetKind="artifact" versions={versions} initialVersionId={openedVersion?.id} department="marketing" theme="emerald" /></div>
  </div>
}

function SeoKeywordHistory({ organizationId, scopeRevision, signal, onAccessError, brand }) {
  const [research, setResearch] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusBusyId, setStatusBusyId] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [statusError, setStatusError] = useState('')
  const generation = useRef(0)
  const current = useRef({ organizationId, brandId: brand.id, revision: scopeRevision })
  current.current = { organizationId, brandId: brand.id, revision: scopeRevision }

  useEffect(() => {
    const requestGeneration = ++generation.current
    const request = { organizationId, brandId: brand.id, revision: scopeRevision, signal }
    setResearch(null); setSelectedId(''); setLoading(true); setError('')
    loadMarketingKeywordResearch({ organizationId, brand, signal }).then(result => {
      if (!shouldApplyKeywordResearchResponse(request, current.current, requestGeneration, generation.current)) return
      setResearch(result)
      setSelectedId(result.trackedKeywords[0]?.id || '')
    }).catch(loadError => {
      if (!shouldApplyKeywordResearchResponse(request, current.current, requestGeneration, generation.current) || loadError?.name === 'AbortError') return
      onAccessError(loadError, { membershipMismatch: loadError?.membershipMismatch === true })
      setError(loadError.message)
    }).finally(() => {
      if (shouldApplyKeywordResearchResponse(request, current.current, requestGeneration, generation.current)) setLoading(false)
    })
    return () => { generation.current += 1 }
  }, [brand, organizationId, onAccessError, scopeRevision, signal])

  const selected = research?.trackedKeywords.find(item => item.id === selectedId) || null
  const rank = snapshot => snapshot?.position == null ? 'Rank unknown' : 'Position ' + snapshot.position
  const metric = value => value == null ? 'Unknown' : Number(value).toLocaleString()

  async function setActive(item) {
    const requestGeneration = generation.current
    const request = { organizationId, brandId: brand.id, revision: scopeRevision, signal }
    setStatusBusyId(item.id); setStatusMessage(''); setStatusError('')
    try {
      const updated = await technicalSeo.setKeywordActive(organizationId, item.id, !item.active)
      if (!shouldApplyKeywordResearchResponse(request, current.current, requestGeneration, generation.current)) return
      setResearch(existing => existing && Object.freeze({
        ...existing,
        trackedKeywords: Object.freeze(existing.trackedKeywords.map(keyword => keyword.id === item.id
          ? Object.freeze({ ...keyword, active: updated.active !== false })
          : keyword)),
      }))
      setStatusMessage(`${item.keyword} ${updated.active === false ? 'paused' : 'resumed'}. Existing rank history was retained.`)
    } catch (statusError) {
      if (!shouldApplyKeywordResearchResponse(request, current.current, requestGeneration, generation.current) || statusError?.name === 'AbortError') return
      onAccessError(statusError, { membershipMismatch: statusError?.membershipMismatch === true })
      setStatusError(statusError.message)
    } finally {
      if (shouldApplyKeywordResearchResponse(request, current.current, requestGeneration, generation.current)) setStatusBusyId('')
    }
  }

  if (loading) return <div className="py-20 text-center text-sm text-slate-500">Loading SEO keyword history…</div>
  if (error) return <Notice error={error} />

  return <div className="space-y-6">
    <section className="rounded-2xl border border-sky-900/60 bg-sky-950/30 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-300">Read-only SEO identity</p>
      <h2 className="mt-1 text-xl font-semibold">{brand.name} keyword history</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">Tracked SEO keywords retain their own identity, target page, Content keyword-strategy source, and dated rank observations. They are separate from Google Ads planning keywords.</p>
      <p className="mt-2 text-xs leading-5 text-sky-200">Source: Google Search Console final data. Each fetch covers the previous 28 days through yesterday and filters to the exact page and query. Market, language, and device detail is not stored; displayed values are provider aggregates.</p>
      <Link to={`/sphere/marketing/seo?brand=${encodeURIComponent(brand.id)}`} className={BUTTON + ' mt-4 inline-flex'}>Open Technical SEO tracking</Link>
    </section>

    {statusMessage && <div className="rounded-xl border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{statusMessage}</div>}
    {statusError && <div className="rounded-xl border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">{statusError}</div>}

    {!research?.trackedKeywords.length ? (
      <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-14 text-center text-sm text-slate-500">No tracked SEO keywords are recorded for this brand.</div>
    ) : (
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className="space-y-3">
          {research.trackedKeywords.map(item => (
            <button key={item.id} onClick={() => setSelectedId(item.id)} className={'w-full rounded-2xl border p-4 text-left transition ' + (selectedId === item.id ? 'border-sky-500 bg-sky-950/40' : 'border-slate-800 bg-slate-900/70 hover:border-slate-600')}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-white">{item.keyword}</p>
                <span className={'rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ' + (item.active ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400')}>{item.active ? 'Active' : 'Inactive'}</span>
              </div>
              <p className="mt-2 break-all text-xs text-slate-400">{item.pageTarget?.url || 'Tracked page unavailable'}</p>
              <p className="mt-2 text-xs text-slate-500">{rank(item.latestSnapshot)} · {item.history.length} dated observation{item.history.length === 1 ? '' : 's'}</p>
              {item.duplicateCount > 1 && <p className="mt-2 text-xs text-amber-300">Possible duplicate on this page · {item.duplicateCount} separate records retained</p>}
            </button>
          ))}
        </section>

        {selected && <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold">{selected.keyword}</h3>
              {!selected.active && <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-400">Inactive keyword retained</span>}
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-slate-950 p-3"><dt className="text-xs uppercase tracking-wide text-slate-500">Canonical page target</dt><dd className="mt-1 break-all text-slate-200">{selected.pageTarget?.url || 'Unavailable'}</dd></div>
              <div className="rounded-xl bg-slate-950 p-3"><dt className="text-xs uppercase tracking-wide text-slate-500">Page type</dt><dd className="mt-1 text-slate-200">{titleize(selected.pageTarget?.pageType || 'unknown')}</dd></div>
              <div className="rounded-xl bg-slate-950 p-3"><dt className="text-xs uppercase tracking-wide text-slate-500">Target tier</dt><dd className="mt-1 text-slate-200">{selected.targetRankTier ? titleize(selected.targetRankTier) : 'Not set'}</dd></div>
              <div className="rounded-xl bg-slate-950 p-3"><dt className="text-xs uppercase tracking-wide text-slate-500">Content source</dt><dd className="mt-1 text-slate-200">{selected.sourceArtifact?.title || 'No keyword-strategy artifact linked'}</dd></div>
            </dl>
            {selected.duplicateCount > 1 && <p className="mt-3 rounded-xl border border-amber-900/70 bg-amber-950/30 p-3 text-xs text-amber-200">Possible duplicate: {selected.duplicateCount} records use this keyword on the same tracked page. Records are not deleted, merged, or blocked.</p>}
            <button type="button" disabled={Boolean(statusBusyId)} onClick={() => setActive(selected)} className={BUTTON + ' mt-4'}>{statusBusyId === selected.id ? 'Saving…' : selected.active ? 'Pause tracking' : 'Resume tracking'}</button>
          </div>

          <div>
            <h4 className="font-semibold">Dated rank history</h4>
            {!selected.history.length ? <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">No rank observations have been recorded.</p> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Rank</th><th className="px-3 py-2">Clicks</th><th className="px-3 py-2">Impressions</th></tr></thead>
                  <tbody>{selected.history.map(snapshot => <tr key={snapshot.id} className="border-b border-slate-800"><td className="px-3 py-3">{snapshot.date}</td><td className="px-3 py-3 font-semibold text-white">{rank(snapshot)}</td><td className="px-3 py-3">{metric(snapshot.clicks)}</td><td className="px-3 py-3">{metric(snapshot.impressions)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </section>}
      </div>
    )}

    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h3 className="font-semibold">Recorded backlink evidence</h3>
      <p className="mt-1 text-sm text-slate-500">Existing research facts are shown separately. This view does not generate or save interpretations.</p>
      {!research?.backlinkEvidence.length ? <p className="mt-4 text-sm text-slate-500">No backlink evidence is recorded for this brand.</p> : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {research.backlinkEvidence.map(item => <article key={item.id} className="rounded-xl bg-slate-950 p-4 text-sm">
            <p className="font-semibold text-white">{item.siteName}</p>
            <p className="mt-1 break-all text-xs text-slate-500">{item.siteUrl || 'URL unknown'}</p>
            <p className="mt-3 text-slate-400">Status: {titleize(item.outreachStatus)} · Authority: {metric(item.domainAuthority)} · Relevance: {metric(item.relevanceScore)}</p>
          </article>)}
        </div>
      )}
    </section>
  </div>
}

function Analytics({ organizationId, scopeRevision, signal, onAccessError, engagementId, brand }) {
  const initial = useMemo(() => defaultReportingPeriod(), [])
  const [period, setPeriod] = useState(initial)
  const [dashboard, setDashboard] = useState(null)
  const [sourceId, setSourceId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestGeneration = useRef(0)
  useEffect(() => {
    requestGeneration.current += 1
    setDashboard(null); setSourceId(''); setError(''); setLoading(false)
    return () => { requestGeneration.current += 1 }
  }, [engagementId, brand.id, organizationId, period.start, period.end, scopeRevision])
  async function load() {
    if (!period.start || !period.end) {
      setError('Reporting timezone unavailable — choose exact dates')
      return
    }
    const request = {
      generation: ++requestGeneration.current, brandId: brand.id,
      organizationId, scopeRevision,
    }
    setLoading(true); setError('')
    try {
      const result = await loadPerformanceDashboard({ organizationId, engagementId, brand, period, signal })
      if (!signal.aborted && shouldApplyDashboardResponse(result, request, requestGeneration.current, scopeRevision)) {
        setDashboard(result)
        setSourceId(current => result.sources.some(source => source.id === current) ? current : '')
      }
    } catch (loadError) {
      if (!signal.aborted && request.generation === requestGeneration.current && request.scopeRevision === scopeRevision) {
        onAccessError(loadError, { membershipMismatch: loadError?.membershipMismatch === true })
        setError(loadError.message)
      }
    } finally {
      if (!signal.aborted && request.generation === requestGeneration.current && request.scopeRevision === scopeRevision) setLoading(false)
    }
  }
  return <section className="space-y-5"><div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="mr-auto"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">{brand.name}</p><h2 className="mt-1 font-semibold">Performance by source account</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">Choose exact dates, load approved read-only sources, then select one account. Accounts, currencies, and reporting timezones are never silently combined.</p><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Reporting timezone unavailable — choose exact dates. Comparison is off. Data may be momentarily incomplete during an active import.</p></div><Field label="From"><input required type="date" className={INPUT} value={period.start} onChange={event => setPeriod({ ...period, start: event.target.value, automatic: false })} /></Field><Field label="To"><input required type="date" className={INPUT} value={period.end} onChange={event => setPeriod({ ...period, end: event.target.value, automatic: false })} /></Field><button onClick={load} disabled={loading || !period.start || !period.end} className={PRIMARY}>{loading ? 'Loading sources…' : dashboard ? 'Refresh sources' : 'Load sources'}</button></div>
    {error && dashboard ? <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">Refresh failed: {error}. The last successful current-context result remains visible with its known collection age.</div> : error ? <Notice error={error} /> : null}
    {!dashboard ? <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Choose exact dates to read the brand's current source data. Missing connectors appear as unavailable, not fabricated metrics.</div> : <PerformanceSections dashboard={dashboard} sourceId={sourceId} setSourceId={setSourceId} />}
  </section>
}

function PerformanceSections({ dashboard, sourceId, setSourceId }) {
  const source = dashboard.sources.find(item => item.id === sourceId) || null
  return <div className="space-y-5">
    {dashboard.source_errors.map(item => <div key={`${item.provider}-${item.connection_name}`} className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">{item.connection_name || titleize(item.provider)} could not be read: {item.error}</div>)}
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <Field label="Source account"><select className={INPUT} value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">Choose a source account</option>{dashboard.sources.map(item => <option key={item.id} value={item.id}>{titleize(item.provider)} · {item.accountLabel}</option>)}</select></Field>
      {!source ? <p className="mt-5 rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">Select one source account. No cross-account total is shown.</p> : <SourcePerformance source={source} />}
    </section>
  </div>
}

function sourceMetric(item, currencyCode) {
  if (item.value === null || item.value === undefined) return 'Unavailable'
  if (item.unit === 'percent') return metric(item.value, 'percent')
  if (item.unit === 'currency') return currencyCode ? `${currencyCode} ${metric(item.value, 'money')}` : `${metric(item.value, 'money')} · currency unavailable`
  return metric(item.value)
}

function SourcePerformance({ source }) {
  const stale = source.freshness.status === 'stale'
  return <div className="mt-5 space-y-5 border-t border-slate-800 pt-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">{titleize(source.provider)}</p><h3 className="mt-1 text-lg font-semibold">{source.accountLabel}</h3><p className="mt-1 text-xs text-slate-500">Account {source.accountId || 'unavailable'} · {source.periodStart} to {source.periodEnd}</p></div><span className={`rounded-full px-3 py-1.5 text-xs ${stale ? 'bg-amber-950 text-amber-200' : source.freshness.status === 'current' ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-950 text-slate-400'}`}>{stale ? `Stale · over ${source.freshness.threshold_hours}h` : source.freshness.status === 'current' ? 'Collection current' : 'Collection age unknown'}</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{source.metrics.map(item => <div key={item.key} className="rounded-xl bg-slate-950 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{item.label}</p><p className="mt-1 text-lg font-semibold text-white">{sourceMetric(item, source.currencyCode)}</p></div>)}</div>
    {source.error && <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">{source.error}</div>}
    {!source.error && !source.metrics.length && <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">No dated data is available for this source account. Missing values are not treated as zero.</div>}
    {source.trend && <TrendChart points={source.trend.points} series={source.trend.series} />}
    <dl className="grid gap-3 rounded-xl border border-slate-800 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4"><Provenance label="Reporting timezone" value={source.reportingTimezone} /><Provenance label="Retrieved" value={source.retrievedAt} /><Provenance label="Data through" value={source.dataThrough} /><Provenance label="Currency" value={source.currencyCode} /></dl>
    {source.notes.map(note => <p key={note} className="text-xs leading-5 text-slate-500">{note}</p>)}
  </div>
}

function Provenance({ label, value }) {
  return <div><dt className="uppercase tracking-[0.1em] text-slate-600">{label}</dt><dd className="mt-1 break-words text-slate-300">{value || 'Unavailable'}</dd></div>
}

function TrendChart({ points, series }) {
  if (points.length < 2) return <div className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-xs text-slate-600">A simple time series appears after two dated snapshots.</div>
  const width = 520
  const height = 130
  const paths = series.map(([field, label, color]) => {
    const values = points.map(point => Number(point[field]) || 0)
    const max = Math.max(...values, 1)
    const coordinates = values.map((value, index) => `${(index / (values.length - 1)) * width},${height - (value / max) * (height - 12)}`).join(' ')
    return { field, label, color, coordinates }
  })
  return <div className="rounded-xl bg-slate-950 p-3"><div className="mb-2 flex flex-wrap gap-4">{paths.map(path => <span key={path.field} className="flex items-center gap-1.5 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: path.color }} />{path.label}</span>)}<span className="ml-auto text-[10px] text-slate-700">Each line uses its own scale</span></div><svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" role="img" aria-label={`${series.map(item => item[1]).join(' and ')} trend from ${points[0].date} to ${points.at(-1).date}`}><line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="#1e293b" />{paths.map(path => <polyline key={path.field} fill="none" stroke={path.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={path.coordinates} />)}</svg><div className="flex justify-between text-[10px] text-slate-700"><span>{points[0].date}</span><span>{points.at(-1).date}</span></div></div>
}

function Field({ label, hint, children }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}{hint && <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">{hint}</span>}<div className="mt-2 normal-case tracking-normal">{children}</div></label>
}
