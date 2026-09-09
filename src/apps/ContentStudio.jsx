import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useOrganization } from '../context/OrganizationContext.jsx'

import DepartmentChat from '../components/DepartmentChat.jsx'
import ContentRequestPanel from '../components/ContentRequestPanel.jsx'
import GeneralContentRequestsPanel from '../components/GeneralContentRequestsPanel.jsx'
import ContentQueuePanel from '../components/ContentQueuePanel.jsx'
import ArtifactRelationsPanel from '../components/ArtifactRelationsPanel.jsx'
import ArtifactApprovalPanel from '../components/ArtifactApprovalPanel.jsx'
import ContentCustomFieldsPanel from '../components/ContentCustomFieldsPanel.jsx'
import VersionProofingPanel from '../components/VersionProofingPanel.jsx'
import WorkshopContextShell from '../components/WorkshopContextShell.jsx'
import {
  BRAND_STATEMENT_SOURCE_TYPES,
  BRAND_STATEMENT_TYPE,
  brandBriefEditor,
  brandStatementEditor,
  serializeBrandBrief,
  serializeBrandStatement,
} from '../data/brandBrief.js'
import {
  CONTENT_ARTIFACT_FORMS,
  CONTENT_ARTIFACT_TYPES,
  CONTENT_FOUNDATION_TYPES,
  DEFAULT_DISCOVERY_TEMPLATE,
  approvalForVersion,
  approvedVisionLanguage,
  bestContentStage,
  buildContentPageTracking,
  contentArtifactEditor,
  latestVersion,
  newContentRecord,
  resolveContentLanguage,
  serializeContentArtifact,
  websitePageKey,
} from '../data/contentStudio.js'
import { contentStudio } from '../data/contentStudioRepository.js'
import { contentRequests } from '../data/contentRequestsRepository.js'
import { contentQueue } from '../data/contentQueueRepository.js'
import { contentCustomFields } from '../data/contentCustomFieldsRepository.js'
import { blogLinksForMonth, relatedRecord } from '../data/contentDesignEventLinking.js'
import { contentSelectionParams, resolveContentContext, resolveContentNavigationScope, selectableContentEngagements } from '../data/contentWorkshopContext.js'
import { parseWorkshopNavigation, validateWorkshopNavigation, workspaceReturnTarget } from '../data/workshopNavigation.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function ContentStudio() {
  const {
    activeOrganizationId, selectionRequired, loading: organizationLoading,
    handleOrganizationAccessError, scopeRevision, requestSignal,
  } = useOrganization()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigationContext = useMemo(() => parseWorkshopNavigation(searchParams), [searchParams])
  const originLinkId = navigationContext.output?.kind === 'event_link' ? navigationContext.output.id : ''
  const [engagements, setEngagements] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [type, setType] = useState('discovery')
  const requestedTab = navigationContext.workshopTab || ''
  const [tab, setTab] = useState(['general', 'queue', 'calendar'].includes(requestedTab) ? requestedTab : 'artifacts')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const currentOrganization = useRef({ organizationId: activeOrganizationId, revision: scopeRevision })
  currentOrganization.current = { organizationId: activeOrganizationId, revision: scopeRevision }
  const organizationReady = Boolean(activeOrganizationId) && !organizationLoading && !selectionRequired
  const repositories = useMemo(() => organizationReady ? {
    studio: contentStudio.forOrganization(activeOrganizationId, { signal: requestSignal }),
    requests: contentRequests.forOrganization(activeOrganizationId, { signal: requestSignal }),
    queue: contentQueue.forOrganization(activeOrganizationId, { signal: requestSignal }),
    customFields: contentCustomFields.forOrganization(activeOrganizationId, { signal: requestSignal }),
  } : null, [activeOrganizationId, organizationReady, requestSignal])
  const studio = repositories?.studio || null
  const loadGeneration = useRef(0)
  const context = useMemo(() => resolveContentContext(navigationContext, engagements, activeOrganizationId), [activeOrganizationId, engagements, navigationContext])
  const engagementId = context.engagement?.id || ''
  const selectableEngagements = useMemo(() => selectableContentEngagements(navigationContext, engagements), [engagements, navigationContext])
  const canonicalScope = useMemo(() => resolveContentNavigationScope(navigationContext, workspace, activeOrganizationId), [activeOrganizationId, navigationContext, workspace])
  const contextValidation = validateWorkshopNavigation(navigationContext, canonicalScope)
  const sameOrganization = !navigationContext.organizationId || navigationContext.organizationId === activeOrganizationId
  const returnTarget = workspaceReturnTarget(contextValidation.context ? contextValidation : {}, {
    fallbackProjectId: sameOrganization ? context.engagement?.project_id : '',
  })

  function currentScope(request) {
    return !request.signal?.aborted && currentOrganization.current.organizationId === request.organizationId
      && currentOrganization.current.revision === request.revision
  }

  async function loadWorkspace(id, inheritedRequest = null) {
    if (!id) { setWorkspace(null); setLoading(false); return }
    if (!studio || !organizationReady) return
    const generation = ++loadGeneration.current
    const request = inheritedRequest || {
      organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal,
    }
    setLoading(true); setError('')
    try {
      const next = await studio.load(id, navigationContext)
      if (next?.engagement?.organization_id !== request.organizationId) {
        throw Object.assign(new Error('Content workspace organization mismatch'), { status: 403, membershipMismatch: true })
      }
      if (currentScope(request) && generation === loadGeneration.current) setWorkspace(next)
    } catch (reason) {
      if (!currentScope(request) || reason?.name === 'AbortError') return
      handleOrganizationAccessError(reason, { membershipMismatch: reason?.membershipMismatch === true })
      setError(reason.message)
    } finally {
      if (currentScope(request) && generation === loadGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    loadGeneration.current += 1
    setEngagements([]); setWorkspace(null)
    setSaving(false); setError(''); setMessage(''); setLoading(organizationReady)
  }, [activeOrganizationId, organizationReady, scopeRevision])

  useEffect(() => {
    if (!studio || !organizationReady) return undefined
    let active = true
    const request = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    studio.listEngagements().then(rows => {
      if ((rows || []).some(row => row.organization_id !== request.organizationId)) {
        throw Object.assign(new Error('Content catalogue organization mismatch'), { status: 403, membershipMismatch: true })
      }
      if (!active || !currentScope(request)) return
      setEngagements(rows || [])
      setLoading(false)
    }).catch(reason => {
      if (active && currentScope(request) && reason?.name !== 'AbortError') {
        handleOrganizationAccessError(reason, { membershipMismatch: reason?.membershipMismatch === true })
        setError(reason.message); setLoading(false)
      }
    })
    return () => { active = false }
  }, [activeOrganizationId, handleOrganizationAccessError, organizationReady, requestSignal, scopeRevision, studio])

  useEffect(() => {
    if (engagementId) loadWorkspace(engagementId)
    else setWorkspace(null)
    // Exact record and output pointers must be re-resolved when navigation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId, navigationContext, studio])

  useEffect(() => {
    setTab(['general', 'queue', 'calendar'].includes(requestedTab) ? requestedTab : 'artifacts')
  }, [requestedTab])

  async function act(callback, success) {
    if (!studio || !organizationReady) return null
    const request = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await callback()
      if (!currentScope(request)) return null
      setMessage(typeof success === 'function' ? success(result) : success)
      await loadWorkspace(engagementId, request)
      return result
    } catch (reason) {
      if (!currentScope(request) || reason?.name === 'AbortError') return null
      handleOrganizationAccessError(reason, { membershipMismatch: reason?.membershipMismatch === true })
      setError(reason.message)
      return null
    } finally { if (currentScope(request)) setSaving(false) }
  }

  const artifactForType = artifactType => workspace?.artifacts.find(item => item.artifact_type === artifactType) || null

  useEffect(() => {
    const originLink = workspace?.blogEventLinks?.find(link => link.id === originLinkId)
    if (!originLink || originLink.status !== 'in_progress') return
    const contentArtifact = workspace.artifacts.find(item => item.artifact_type === 'content')
    const currentVersion = latestVersion(workspace.versions.filter(version => version.artifact_id === contentArtifact?.id))
    if (!approvalForVersion(workspace.approvals, currentVersion?.id)) return
    let active = true
    if (!studio) return
    studio.updateBlogEventLink(originLink, 'ready')
      .then(() => { if (active) setWorkspace(current => ({ ...current, blogEventLinks: current.blogEventLinks.map(link => link.id === originLink.id ? { ...link, status: 'ready' } : link) })) })
      .catch(reason => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [studio, workspace, originLinkId])

  async function updateBlogLink(link, status, success) {
    await act(() => studio.updateBlogEventLink(link, status), success)
  }

  async function openBlogDraft(link) {
    await updateBlogLink(link, 'in_progress', 'Blog draft started from the shared event plan.')
    setSearchParams(contentSelectionParams(navigationContext, context.engagement, activeOrganizationId, {
      output: { kind: 'event_link', id: link.id }, workshopTab: 'artifacts',
    }), { replace: true })
    setType('content')
    setTab('artifacts')
  }

  function selectTab(nextTab) {
    setTab(nextTab)
    if (context.engagement) setSearchParams(contentSelectionParams(navigationContext, context.engagement, activeOrganizationId, {
      workshopTab: nextTab === 'artifacts' ? '' : nextTab,
    }), { replace: true })
  }

  if (organizationReady && !loading && context.mode === 'choose') return <ContentEntryShell>
    <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Content Studio</p>
      <h1 className="mt-2 text-2xl font-semibold">Choose Content work</h1>
      <p className="mt-2 text-sm text-slate-400">Select an authorized engagement. Content Studio will not choose work silently.</p>
      <div className="mt-5 grid gap-3">{selectableEngagements.map(item => <button type="button" key={item.id} onClick={() => setSearchParams(contentSelectionParams(navigationContext, item, activeOrganizationId))} className="rounded-xl border border-slate-700 px-4 py-3 text-left text-sm font-semibold text-slate-200 hover:border-amber-500">{item.name} · {item.brands?.name || 'Brand'}</button>)}</div>
      {!selectableEngagements.length && <p className="mt-5 text-sm text-slate-500">No active Content engagement is available in this organization.</p>}
      <div className="mt-6 border-t border-slate-800 pt-5"><p className="text-sm text-slate-400">Exploring an idea before it belongs to official work?</p><Link to="/sphere/quick-tasks" className={`${BUTTON} mt-3 inline-flex`}>Start private Content exploration</Link></div>
    </section>
  </ContentEntryShell>

  if (organizationReady && !loading && context.mode === 'denied') {
    const rejected = navigationContext.organizationId && navigationContext.organizationId !== activeOrganizationId
      ? validateWorkshopNavigation(navigationContext, { status: 'ready', activeOrganizationId, organizationId: activeOrganizationId })
      : validateWorkshopNavigation(navigationContext, { status: 'denied' })
    return <ContentEntryShell><WorkshopContextShell navigation={navigationContext} validation={rejected} returnTarget={workspaceReturnTarget(rejected)}>
      <div />
    </WorkshopContextShell><div className="mt-5 text-center"><button type="button" onClick={() => setSearchParams({})} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200">Choose permitted work</button></div></ContentEntryShell>
  }

  return <div className="h-full overflow-y-auto bg-slate-950 text-white">
    <header className="border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_36%)] px-6 py-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-5">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400">Content department</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Content Studio</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Build the approved context and structured content system that Design, Development, and Marketing consume.</p></div>
        <div className="flex flex-wrap gap-3"><button type="button" onClick={() => selectTab('general')} className={PRIMARY}>Make a post / reel</button><Link to="/sphere/content" className={BUTTON}>Open Content work queue</Link></div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      <WorkshopContextShell navigation={navigationContext} validation={contextValidation} returnTarget={returnTarget} projectName={context.engagement?.name}>
      {(error || message) && <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'}`}>{error || message}</div>}
      {!['general', 'queue'].includes(tab) && <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <label className="min-w-72 flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Content engagement
          <select value={engagementId} onChange={event => { const item = engagements.find(candidate => candidate.id === event.target.value); setSearchParams(item ? contentSelectionParams(navigationContext, item, activeOrganizationId) : {}) }} className={`${INPUT} mt-2 normal-case tracking-normal`}>
            <option value="">Choose work</option>
            {engagements.map(item => <option key={item.id} value={item.id}>{item.name} · {item.brands?.name || 'Brand'}</option>)}
          </select>
        </label>
        {workspace?.engagement && <div className="rounded-xl bg-slate-950 px-4 py-3 text-sm text-slate-400"><span className="font-semibold text-white">{workspace.engagement.brands?.name}</span><span className="mx-2 text-slate-700">/</span>{workspace.engagement.agency_clients?.name}</div>}
      </section>}
      <nav className="flex gap-2 overflow-x-auto border-b border-slate-800">
        {[['general', 'General requests'], ['queue', 'Content queue'], ['artifacts', 'Artifact workspace'], ['requests', 'Content requests'], ['calendar', 'Blog calendar'], ['brand', 'Brief & brand statement'], ['chat', 'Shared Department Chat']].map(([id, label]) => <button type="button" key={id} onClick={() => selectTab(id)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === id ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-500 hover:text-white'}`}>{label}</button>)}
      </nav>
      {!repositories ? <div className="py-20 text-center text-sm text-slate-500">Select an active organization to open Content Studio.</div> : tab === 'general' ? <GeneralContentRequestsPanel key={`${activeOrganizationId}:${scopeRevision}`} repository={repositories.requests} /> : loading ? <div className="py-20 text-center text-sm text-slate-500">Loading Content Studio…</div> : tab === 'queue' ? <ContentQueuePanel key={`${activeOrganizationId}:${scopeRevision}`} repository={repositories.queue} /> : !workspace ? <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Activate a Content service on an engagement to begin, or use General requests without an engagement.</div> : tab === 'artifacts' ? (
        <ArtifactWorkspace key={`${activeOrganizationId}:${scopeRevision}:${workspace.engagement.id}`} studio={studio} customFields={repositories.customFields} workspace={workspace} type={type} setType={setType} saving={saving} act={act} onRefresh={() => loadWorkspace(engagementId)} originLinkId={originLinkId} />
      ) : tab === 'calendar' ? (
        <BlogCalendarPanel workspace={workspace} saving={saving} originLinkId={originLinkId} onStart={openBlogDraft} onPublish={link => updateBlogLink(link, 'published', 'Approved blog content marked as published.')} />
      ) : tab === 'requests' ? (
        <ContentRequestPanel key={`${activeOrganizationId}:${scopeRevision}:${workspace.engagement.id}`} engagement={workspace.engagement} repository={repositories.requests} />
      ) : tab === 'brand' ? (
        <BrandBriefWorkspace studio={studio} workspace={workspace} saving={saving} act={act} onRefresh={() => loadWorkspace(engagementId)} />
      ) : <DepartmentChat departmentId="content" engagement={workspace.engagement} artifactTypes={CONTENT_ARTIFACT_TYPES} artifactDefinitions={CONTENT_ARTIFACT_FORMS} artifactForType={artifactForType} stageForType={artifactType => bestContentStage(workspace.stages, artifactType)} onPropose={studio.proposeArtifact} onProposeWorkItem={studio.proposeWorkItem} onCreated={() => loadWorkspace(engagementId)} />}
      </WorkshopContextShell>
    </main>
  </div>
}

function ContentEntryShell({ children }) {
  return <div className="h-full overflow-y-auto bg-slate-950 px-6 py-12 text-white">{children}</div>
}

function BrandBriefWorkspace({ studio, workspace, saving, act, onRefresh }) {
  const [brief, setBrief] = useState(brandBriefEditor(workspace.brandBrief))
  const artifact = workspace.artifacts.find(item => item.artifact_type === BRAND_STATEMENT_TYPE)
  const versions = workspace.versions.filter(item => item.artifact_id === artifact?.id)
  const latest = latestVersion(versions)
  const approval = approvalForVersion(workspace.approvals, latest?.id)

  async function saveBrief(event) {
    event.preventDefault()
    const effect = workspace.brandBrief ? 'update the mutable brand brief in place' : 'create the first mutable brand brief'
    if (!globalThis.confirm(`Confirm: ${effect}. This does not create an artifact version.`)) return
    await act(() => studio.saveBrandBrief({
      engagement_id: workspace.engagement.id,
      expected_updated_at: workspace.brandBrief?.updated_at || null,
      ...serializeBrandBrief(brief),
    }), workspace.brandBrief ? 'Brand brief updated in place.' : 'Brand brief created.')
  }

  async function generateStatement() {
    if (!globalThis.confirm('Confirm: compile a separate immutable brand-statement artifact version from the saved brief and exact approved sources.')) return
    await act(() => studio.generateBrandStatement({
      engagement_id: workspace.engagement.id,
      engagement_stage_instance_id: bestContentStage(workspace.stages, BRAND_STATEMENT_TYPE)?.id || null,
    }), 'Brand statement compiled as a new immutable version.')
  }

  const approvedSources = Object.fromEntries(BRAND_STATEMENT_SOURCE_TYPES.map(sourceType => {
    const sourceIds = workspace.brandSourceArtifacts.filter(item => item.artifact_type === sourceType).map(item => item.id)
    return [sourceType, workspace.brandSourceApprovals.find(item => sourceIds.includes(item.artifact_id)) || null]
  }))
  const ready = Boolean(workspace.brandBrief) && BRAND_STATEMENT_SOURCE_TYPES.every(sourceType => approvedSources[sourceType])

  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <form onSubmit={saveBrief} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Mutable brand record</p><h2 className="mt-1 text-2xl font-semibold">Brand brief</h2><p className="mt-2 text-sm leading-6 text-slate-400">Maintain the current commercial and operating context for this brand. Saving updates this one record in place.</p></div>
      <div className="mt-6 space-y-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Target market<textarea rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={brief.target_market} onChange={event => setBrief(current => ({ ...current, target_market: event.target.value }))} /></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Price tier<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={brief.price_tier} onChange={event => setBrief(current => ({ ...current, price_tier: event.target.value }))}><option value="">Not specified</option><option value="value">Value</option><option value="mid">Mid-market</option><option value="premium">Premium</option></select></label>
        <ListField label="Operating principles" value={brief.operating_principles} onChange={value => setBrief(current => ({ ...current, operating_principles: value }))} />
        <ListField label="Competitor references" value={brief.competitor_references} onChange={value => setBrief(current => ({ ...current, competitor_references: value }))} />
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Raw brief<textarea required rows="10" className={`${INPUT} mt-2 normal-case tracking-normal`} value={brief.raw_brief} onChange={event => setBrief(current => ({ ...current, raw_brief: event.target.value }))} /></label>
      </div>
      <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-800 pt-5"><p className="text-xs text-slate-500">{workspace.brandBrief ? `Last updated ${new Date(workspace.brandBrief.updated_at).toLocaleString()}` : 'No brand brief saved yet'}</p><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : workspace.brandBrief ? 'Update brief' : 'Save brief'}</button></div>
    </form>
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Approved source context</p><h2 className="mt-1 text-2xl font-semibold">Compile brand statement</h2><p className="mt-2 text-sm leading-6 text-slate-400">Compilation uses the current saved brief and the latest approved Discovery, Vision, and Audience versions for this brand.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">{BRAND_STATEMENT_SOURCE_TYPES.map(sourceType => <div key={sourceType} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs font-semibold capitalize text-white">{sourceType}</p><p className={`mt-1 text-[11px] ${approvedSources[sourceType] ? 'text-emerald-400' : 'text-amber-400'}`}>{approvedSources[sourceType] ? 'Approved version ready' : 'Approval required'}</p></div>)}</div>
        <button type="button" disabled={saving || !ready} onClick={generateStatement} className={`${PRIMARY} mt-5 w-full`}>{saving ? 'Compiling…' : latest ? 'Compile new statement version' : 'Compile brand statement'}</button>
        {!workspace.brandBrief && <p className="mt-3 text-xs text-amber-300">Save the brand brief first.</p>}
      </div>
      {latest ? <BrandStatementReview key={latest.id} studio={studio} workspace={workspace} artifact={artifact} versions={versions} latest={latest} approval={approval} saving={saving} act={act} onRefresh={onRefresh} /> : <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No compiled brand statement yet.</div>}
    </section>
  </div>
}

function BrandStatementReview({ studio, workspace, artifact, versions, latest, approval, saving, act, onRefresh }) {
  const [form, setForm] = useState(brandStatementEditor(latest.content))
  const [summary, setSummary] = useState(`Reviewed from version ${latest.version_number}`)

  async function save(event) {
    event.preventDefault()
    if (!globalThis.confirm(`Confirm: create immutable brand-statement version ${latest.version_number + 1}.`)) return
    await act(() => studio.saveArtifact({
      engagement_id: workspace.engagement.id, artifact_id: artifact.id,
      engagement_stage_instance_id: bestContentStage(workspace.stages, BRAND_STATEMENT_TYPE)?.id || null,
      artifact_type: BRAND_STATEMENT_TYPE, title: artifact.title || 'Brand statement',
      content: serializeBrandStatement(form, latest.content.source_manifest), change_summary: summary,
      data_classification: latest.data_classification || 'internal', ai_use_allowed: latest.ai_use_allowed === true,
    }), 'Brand statement review saved as a new immutable version.')
  }

  return <div><form onSubmit={save} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Canonical immutable artifact</p><h3 className="mt-1 text-xl font-semibold">Brand statement review</h3></div><div className="text-right text-xs text-slate-500"><p>Version {latest.version_number}</p><p className={approval ? 'mt-1 text-emerald-400' : 'mt-1 text-amber-400'}>{approval ? 'Exact version approved' : 'Approval pending'}</p></div></div>
    <div className="mt-6 space-y-5">
      <TextField label="Brand statement" value={form.statement} onChange={value => setForm(current => ({ ...current, statement: value }))} />
      <TextField label="Target market" value={form.target_market} onChange={value => setForm(current => ({ ...current, target_market: value }))} />
      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Price tier<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.price_tier} onChange={event => setForm(current => ({ ...current, price_tier: event.target.value }))}><option value="">Not specified</option><option value="value">Value</option><option value="mid">Mid-market</option><option value="premium">Premium</option></select></label>
      <TextField label="Positioning" value={form.positioning} onChange={value => setForm(current => ({ ...current, positioning: value }))} />
      <TextField label="Value proposition" value={form.value_proposition} onChange={value => setForm(current => ({ ...current, value_proposition: value }))} />
      <TextField label="Audience summary" value={form.audience_summary} onChange={value => setForm(current => ({ ...current, audience_summary: value }))} />
      <ListField label="Operating principles" value={form.operating_principles} onChange={value => setForm(current => ({ ...current, operating_principles: value }))} />
      <ListField label="Proof points" value={form.proof_points} onChange={value => setForm(current => ({ ...current, proof_points: value }))} />
      <ListField label="Competitor references" value={form.competitor_references} onChange={value => setForm(current => ({ ...current, competitor_references: value }))} />
      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Change summary<input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={summary} onChange={event => setSummary(event.target.value)} /></label>
    </div>
    <div className="mt-6 flex justify-end border-t border-slate-800 pt-5"><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : 'Save reviewed version'}</button></div>
  </form><ArtifactApprovalPanel version={latest} approval={approval} theme="amber" singleApprovalLabel={`Use single-manager route for version ${latest.version_number}`} onSingleApprove={() => act(() => studio.approveArtifact(latest.id), 'Brand statement exact version approved.')} onChanged={onRefresh} /><ArtifactRelationsPanel artifact={artifact} /><VersionProofingPanel targetKind="artifact" versions={versions} initialVersionId={latest.id} department="content" theme="amber" /></div>
}

function TextField({ label, value, onChange }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}<textarea required rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} /></label>
}

function ListField({ label, value, onChange }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}<span className="ml-2 font-normal normal-case tracking-normal text-slate-600">One item per line</span><textarea rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} /></label>
}

function BlogCalendarPanel({ workspace, saving, originLinkId, onStart, onPublish }) {
  const originLink = workspace.blogEventLinks?.find(link => link.id === originLinkId)
  const initialMonth = relatedRecord(originLink?.external_events)?.start_date?.slice(0, 7) || new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(initialMonth)
  const links = useMemo(() => blogLinksForMonth(workspace.blogEventLinks, month), [workspace.blogEventLinks, month])
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Shared MK1 event infrastructure</p><h2 className="mt-1 text-2xl font-semibold">Blog calendar</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">This is a filtered Content view over existing event links. It does not maintain a separate blog-calendar table.</p></div><input aria-label="Blog calendar month" type="month" className={`${INPUT} max-w-52`} value={month} onChange={event => setMonth(event.target.value)} /></div><div className="mt-6 grid gap-4 lg:grid-cols-2">{links.map(link => { const externalEvent = relatedRecord(link.external_events); const active = link.id === originLinkId; return <article key={link.id} className={`rounded-2xl border p-4 ${active ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800 bg-slate-950/50'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">{externalEvent?.start_date || 'Date unavailable'}</p><h3 className="mt-1 font-semibold text-white">{externalEvent?.event_name || 'External event'}</h3></div><span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-300">{link.status.replaceAll('_', ' ')}</span></div><p className="mt-3 text-xs text-slate-500">Lead time {link.lead_time_days} days · {externalEvent?.event_category?.replaceAll('_', ' ') || 'event'}</p><div className="mt-4 flex flex-wrap gap-2">{link.status !== 'published' && <button type="button" disabled={saving} onClick={() => onStart(link)} className={PRIMARY}>{link.status === 'planned' ? 'Start blog draft' : 'Open blog draft'}</button>}{link.status === 'ready' && <button type="button" disabled={saving} onClick={() => onPublish(link)} className={BUTTON}>Mark released / published</button>}</div>{active && <p className="mt-3 text-xs text-amber-300">This event is the active origin for the Content artifact workflow.</p>}</article> })}{!links.length && <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500 lg:col-span-2">No blog event links in this month. Add one from Sphere Events.</div>}</div></section>
}

function ArtifactWorkspace({ studio, customFields, workspace, type, setType, saving, act, onRefresh, originLinkId }) {
  const artifact = workspace.artifacts.find(item => item.artifact_type === type)
  const versions = workspace.versions.filter(item => item.artifact_id === artifact?.id)
  const latest = latestVersion(versions)
  const approval = approvalForVersion(workspace.approvals, latest?.id)
  return <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
    <section className="space-y-3">{Object.entries(CONTENT_ARTIFACT_FORMS).map(([id, definition]) => {
      const item = workspace.artifacts.find(candidate => candidate.artifact_type === id)
      const itemLatest = latestVersion(workspace.versions.filter(version => version.artifact_id === item?.id))
      const itemApproval = approvalForVersion(workspace.approvals, itemLatest?.id)
      return <button key={id} onClick={() => setType(id)} className={`w-full rounded-2xl border p-4 text-left ${type === id ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}><div className="flex items-start justify-between gap-3"><p className="font-semibold text-white">{definition.label}</p><span className={`rounded-full px-2.5 py-1 text-[10px] uppercase ${itemApproval ? 'bg-emerald-950 text-emerald-300' : itemLatest ? 'bg-amber-950 text-amber-300' : 'bg-slate-950 text-slate-500'}`}>{itemApproval ? 'Approved' : itemLatest ? 'Draft' : 'Missing'}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{definition.description}</p></button>
    })}</section>
      <ArtifactForm key={`${type}:${latest?.id || 'new'}`} studio={studio} customFields={customFields} workspace={workspace} type={type} artifact={artifact} versions={versions} latest={latest} approval={approval} saving={saving} act={act} onRefresh={onRefresh} originLinkId={originLinkId} />
  </div>
}

function ArtifactForm({ studio, customFields, workspace, type, artifact, versions, latest, approval, saving, act, onRefresh, originLinkId }) {
  const definition = CONTENT_ARTIFACT_FORMS[type]
  const foundation = CONTENT_FOUNDATION_TYPES.includes(type)
  const languageResolution = resolveContentLanguage({
    explicitLanguage: latest?.content?.language,
    approvedBrandLanguage: approvedVisionLanguage(workspace),
    organizationDefaultLanguage: workspace.organizationSettings?.content_language || workspace.organizationSettings?.default_language,
  })
  const [form, setForm] = useState(() => ({
    ...contentArtifactEditor(type, latest?.content),
    ...(foundation ? { language: latest?.content?.language || languageResolution.language } : {}),
  }))
  const [summary, setSummary] = useState(latest ? `Revision from version ${latest.version_number}` : 'Initial Content Studio version')
  const [classification, setClassification] = useState(latest?.data_classification || 'internal')
  const [aiSafe, setAiSafe] = useState(latest?.ai_use_allowed || false)
  const originLink = type === 'content' ? workspace.blogEventLinks?.find(link => link.id === originLinkId) : null

  async function save(event) {
    event.preventDefault()
    const versionNumber = latest ? latest.version_number + 1 : 1
    if (!globalThis.confirm(`Confirm: create immutable ${definition.label} version ${versionNumber}. The mutable brand brief is not changed.`)) return
    await act(async () => {
      const result = await studio.saveArtifact({
      engagement_id: workspace.engagement.id, artifact_id: artifact?.id || null,
      engagement_stage_instance_id: bestContentStage(workspace.stages, type)?.id || null,
      artifact_type: type, title: artifact?.title || `${definition.label} artifact`,
      content: serializeContentArtifact(type, form), change_summary: summary,
      data_classification: classification, ai_use_allowed: aiSafe,
      })
      if (originLink) await studio.updateBlogEventLink(originLink, 'in_progress')
      return result
    }, result => {
      const warning = result?.warnings?.[0]
      return warning ? `${definition.label} saved as a new immutable version. ${warning}` : `${definition.label} saved as a new immutable version.`
    })
  }

  const regionsByVersion = type === 'website_architecture' ? Object.fromEntries(versions.map(version => [
    version.id,
    (version.content?.pages || []).map(page => ({
      value: `page:${websitePageKey(page)}`,
      label: `${page.title}${page.slug ? ` (${page.slug})` : ''}`,
    })),
  ])) : {}

  return <div><form onSubmit={save} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Canonical immutable artifact</p><h2 className="mt-1 text-2xl font-semibold">{definition.label}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{definition.description}</p></div><div className="text-right text-xs text-slate-500"><p>{latest ? `Version ${latest.version_number}` : 'No version yet'}</p><p className={approval ? 'mt-1 text-emerald-400' : 'mt-1 text-amber-400'}>{approval ? 'Exact version approved' : 'Approval pending'}</p></div></div>
    {type === 'discovery' && <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 text-sm text-amber-100"><p className="font-semibold">{DEFAULT_DISCOVERY_TEMPLATE.label}</p><p className="mt-1 text-xs text-amber-200/70">All five canonical fields are required. “Unknown” is permitted only for Evidence and Constraints.</p></div>}
    {type === 'website_architecture' && <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 text-sm text-amber-100"><p className="font-semibold">Stable page identity</p><p className="mt-1 text-xs leading-5 text-amber-200/70">The page key is system managed and remains unchanged when a path is renamed. Paths are normalized on save; use the order controls to define deterministic sitemap order.</p></div>}
    {foundation && <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Working language<input required maxLength="120" placeholder="Select or enter a language" className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.language || ''} onChange={event => setForm(current => ({ ...current, language: event.target.value }))} /><span className="mt-2 block font-normal normal-case tracking-normal text-slate-500">Precedence: explicit selection, approved Vision value, then organization default. No language is assumed.</span></label>}
    <div className="mt-6 space-y-5">{definition.fields.map(field => <div key={field.key}><ArtifactField field={field} value={form[field.key]} pageSlugs={(workspace.versions.filter(version => version.artifact_id === workspace.artifacts.find(item => item.artifact_type === 'website_architecture')?.id).sort((left, right) => right.version_number - left.version_number)[0]?.content?.pages || []).map(page => page.slug)} onChange={value => setForm(current => ({ ...current, [field.key]: value }))} />{foundation && <SourceMetadataField field={field} value={form.source_metadata?.[field.key]} onChange={value => setForm(current => ({ ...current, source_metadata: { ...current.source_metadata, [field.key]: value } }))} />}</div>)}</div>
    <div className="mt-6 grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Change summary<input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={summary} onChange={event => setSummary(event.target.value)} /></label><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Data classification<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={classification} onChange={event => setClassification(event.target.value)}><option>internal</option><option>confidential</option><option>public</option><option>restricted</option></select></label></div>
    <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300"><input type="checkbox" className="mt-1" checked={aiSafe} onChange={event => setAiSafe(event.target.checked)} /><span>Explicitly allow this exact version to be included in approved AI context. Restricted versions remain excluded.</span></label>
    <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-800 pt-5"><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : latest ? 'Create new version' : 'Save first version'}</button></div>
  </form><ArtifactApprovalPanel version={latest} approval={approval} theme="amber" singleApprovalLabel={`Use single-manager route for version ${latest?.version_number}`} onSingleApprove={() => act(async () => { const result = await studio.approveArtifact(latest.id); if (originLink) await studio.updateBlogEventLink(originLink, 'ready'); return result }, `${definition.label} exact version approved.${originLink ? ' The originating blog event is ready.' : ''}`)} onChanged={onRefresh} />{['website_architecture', 'content'].includes(type) && <ContentPageTrackingPanel studio={studio} workspace={workspace} saving={saving} act={act} />}<ContentCustomFieldsPanel repository={customFields} artifactType={type} versions={versions} initialVersionId={latest?.id} /><ArtifactRelationsPanel artifact={artifact} /><VersionProofingPanel targetKind="artifact" versions={versions} initialVersionId={latest?.id} department="content" theme="amber" regionsByVersion={regionsByVersion} /></div>
}

function SourceMetadataField({ field, value = {}, onChange }) {
  const needsConfirmation = value.needs_confirmation === true
  const humanConfirmed = value.human_confirmed === true
  return <details className={`mt-2 rounded-xl border p-3 ${needsConfirmation ? 'border-amber-500/40 bg-amber-950/20' : 'border-slate-800 bg-slate-950/40'}`}>
    <summary className="cursor-pointer text-xs font-semibold text-slate-300">Source and confirmation {needsConfirmation ? '· confirmation needed' : humanConfirmed ? '· human confirmed' : ''}</summary>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-500">Source label<input maxLength="500" className={`${INPUT} mt-1`} value={value.source_label || ''} onChange={event => onChange({ ...value, source_label: event.target.value })} /></label>
      <label className="text-xs text-slate-500">Source date<input type="date" className={`${INPUT} mt-1`} value={value.source_date || ''} onChange={event => onChange({ ...value, source_date: event.target.value })} /></label>
      <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={needsConfirmation} onChange={event => onChange({ ...value, needs_confirmation: event.target.checked, human_confirmed: event.target.checked ? false : humanConfirmed })} />Needs confirmation</label>
      <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={humanConfirmed} onChange={event => onChange({ ...value, human_confirmed: event.target.checked, needs_confirmation: event.target.checked ? false : needsConfirmation })} />Human confirmed</label>
    </div>
    {field.unknownAllowed && <p className="mt-3 text-xs text-slate-500">This approved template field permits the literal value “Unknown”.</p>}
  </details>
}

function ContentPageTrackingPanel({ studio, workspace, saving, act }) {
  const tracking = buildContentPageTracking(workspace)
  const generated = workspace.contentTasks || []
  async function generate() {
    await act(
      () => studio.generateContentTasks(workspace.engagement.id),
      'Content tasks generated from the approved sitemap.',
    )
  }
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Content-per-page tracking</p><h3 className="mt-1 text-xl font-semibold">Website content status</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">One explicit task per page, linked to the canonical Content artifact and its stable page key. Later path changes retain identity; additions and removals are flagged for manual reconciliation.</p></div><div className="flex flex-wrap gap-2"><Link to="/sphere/engagements" className={BUTTON}>Open Work board</Link>{!generated.length && <button type="button" disabled={saving || !tracking.canGenerate} onClick={generate} className={PRIMARY}>{saving ? 'Generating…' : 'Generate content tasks from sitemap'}</button>}</div></div>
    {!tracking.approvedArchitecture && <p className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">Approve an exact Website architecture version before generating content tasks.</p>}
    {tracking.hasMismatch && generated.length > 0 && <p className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">The current page list and generated tasks no longer match. Reconcile the differences manually; Anka Sphere has not created or removed tasks automatically.</p>}
    {tracking.rows.length > 0 ? <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-950/70 text-[10px] uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Page</th><th className="px-4 py-3">Current path</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{tracking.rows.map(row => <tr key={row.pageKey || row.pagePath} className="border-t border-slate-800"><td className="px-4 py-3 font-medium text-white">{row.pageTitle}</td><td className="px-4 py-3 font-mono text-xs text-slate-400">{row.pagePath}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${row.task?.status === 'done' ? 'bg-emerald-950 text-emerald-300' : row.task?.status === 'blocked' ? 'bg-red-950 text-red-300' : row.task ? 'bg-blue-950 text-blue-300' : 'bg-amber-950 text-amber-300'}`}>{row.task?.status?.replaceAll('_', ' ') || 'Task missing'}</span></td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Add pages to the approved Website architecture to begin tracking.</p>}
    {tracking.staleTasks.length > 0 && <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">Tasks for removed or renamed pages</p><div className="mt-2 flex flex-wrap gap-2">{tracking.staleTasks.map(task => <span key={task.id} className="rounded-full bg-amber-950 px-3 py-1 text-xs text-amber-200">{task.linked_page_path} · {task.status.replaceAll('_', ' ')}</span>)}</div></div>}
    <p className="mt-4 text-xs text-slate-600">Page source: {tracking.source === 'content' ? 'latest Content draft' : 'approved Website architecture'} · {generated.length} generated task{generated.length === 1 ? '' : 's'}</p>
  </section>
}

function ArtifactField({ field, value, pageSlugs, onChange }) {
  if (field.kind === 'records') return <div><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{field.label}</p><button type="button" className={BUTTON} onClick={() => onChange([...(value || []), newContentRecord(field)])}>{field.addLabel}</button></div><div className="mt-3 space-y-4">{(value || []).map((record, index) => <RecordEditor key={record.page_key || index} index={index} field={field} records={value} pageSlugs={pageSlugs} record={record} onChange={next => onChange(value.map((item, itemIndex) => itemIndex === index ? next : item))} onMove={direction => { const destination = index + direction; if (destination < 0 || destination >= value.length) return; const next = [...value]; [next[index], next[destination]] = [next[destination], next[index]]; onChange(next) }} onRemove={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} />)}{!(value || []).length && <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Add at least one structured record.</div>}</div></div>
  const textarea = field.kind === 'textarea' || field.kind === 'list'
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{field.label}{field.kind === 'list' && <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">One item per line</span>}{field.unknownAllowed && <span className="ml-2 font-normal normal-case tracking-normal text-amber-400">Unknown allowed</span>}{textarea ? <textarea required rows={field.kind === 'list' ? 4 : 5} className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} /> : <input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} />}</label>
}

function RecordEditor({ index, field, records, pageSlugs, record, onChange, onMove, onRemove }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><div className="mb-4 flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">{field.label} {index + 1}</p><div className="flex items-center gap-2">{field.recordType === 'website_page' && <><button type="button" aria-label={`Move ${record.title || `page ${index + 1}`} earlier`} disabled={index === 0} onClick={() => onMove(-1)} className={BUTTON}>↑</button><button type="button" aria-label={`Move ${record.title || `page ${index + 1}`} later`} disabled={index === records.length - 1} onClick={() => onMove(1)} className={BUTTON}>↓</button></>}<button type="button" onClick={onRemove} className="text-xs font-semibold text-red-300">Remove</button></div></div><div className="grid gap-4 md:grid-cols-2">{field.recordFields.map(([key, label, kind, options]) => {
    const wide = kind === 'textarea' || kind === 'textarea_optional' || kind === 'list'
    const required = !['parent_slug', 'parent_page_key', 'textarea_optional'].includes(kind)
    const choices = kind === 'parent_page_key' ? records.map(item => ({ value: websitePageKey(item), label: `${item.title || item.slug || 'Untitled page'} · ${item.slug || websitePageKey(item)}` })).filter(choice => choice.value && choice.value !== websitePageKey(record)) : kind === 'target_page_slug' ? pageSlugs : options
    return <label key={key} className={`text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 ${wide ? 'md:col-span-2' : ''}`}>{label}{kind === 'list' && <span className="ml-2 font-normal normal-case tracking-normal">Comma separated</span>}{kind === 'textarea' || kind === 'textarea_optional' ? <textarea required={required} rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={record[key] || ''} onChange={event => onChange({ ...record, [key]: event.target.value })} /> : kind === 'readonly' ? <><input readOnly aria-readonly="true" className={`${INPUT} mt-2 cursor-not-allowed normal-case tracking-normal text-slate-500`} value={record[key] || ''} /><span className="mt-1 block font-normal normal-case tracking-normal text-slate-600">System managed; renaming the path does not change this key.</span></> : kind === 'select' || (choices || []).length ? <select required={required} className={`${INPUT} mt-2 normal-case tracking-normal`} value={record[key] || ''} onChange={event => onChange({ ...record, [key]: event.target.value })}><option value="">{required ? 'Select one' : 'No parent page'}</option>{(choices || []).map(choice => { const value = typeof choice === 'object' ? choice.value : choice; const choiceLabel = typeof choice === 'object' ? choice.label : choice; return <option key={value} value={value}>{choiceLabel}</option> })}</select> : <input required={required} type={kind === 'number' ? 'number' : 'text'} min={kind === 'number' ? '0' : undefined} step={kind === 'number' ? '1' : undefined} className={`${INPUT} mt-2 normal-case tracking-normal`} value={Array.isArray(record[key]) ? record[key].join(', ') : record[key] || ''} onChange={event => onChange({ ...record, [key]: event.target.value })} />}</label>
  })}</div></div>
}
