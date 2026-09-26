import { useCallback, useEffect, useRef, useState } from 'react'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { projectEngagementWorkspace } from '../data/projectEngagementWorkspace'
import RetainerPlanningPanel from '../components/RetainerPlanningPanel'
import ProjectPlanningPanel from '../components/ProjectPlanningPanel.jsx'
import ProjectDraftActivation from './ProjectDraftActivation.jsx'
import ProjectServiceScopePanel from './ProjectServiceScopePanel.jsx'
import ProjectManagerAssignment from './ProjectManagerAssignment.jsx'
import ProjectDiscussionPanel from './ProjectDiscussionPanel.jsx'
import ContextConversationPanel from '../components/ContextConversationPanel.jsx'
import _ProjectReviewEvidencePanel from './ProjectReviewEvidencePanel.jsx'
import { appendWorkshopNavigation, parseWorkshopNavigation } from '../data/workshopNavigation.js'

const TABS = [
  ['overview', 'Setup & context'],
  ['services', 'Services & Scope'],
  ['journey', 'Journey'],
  ['work', 'Work'],
  ['discussion', 'Discussion'],
  ['project-tasks', 'Project Tasks'],
  ['engagement-work', 'Engagement Work Items'],
  ['planning', 'Planning'],
  ['outputs', 'Files & Outputs'],
  ['activity', 'Activity'],
]
const planningTabIndex = TABS.findIndex(([id]) => id === 'planning')

const label = (value) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown'
const date = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString() : 'Not set'
const loadFailureKind = (cause) => cause?.membershipMismatch || [401, 403].includes(Number(cause?.status))
  ? 'denied'
  : Number(cause?.status) === 404
    ? 'missing'
    : 'error'

export default function ProjectEngagementWorkspace() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const tab = [...TABS, ['retainer-planning']].some(([id]) => id === requestedTab) ? requestedTab : 'overview'
  const focusedRecord = parseWorkshopNavigation(searchParams).workRecord
  const selectTab = (id) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', id)
    setSearchParams(next, { replace: true })
  }
  const { activeOrganizationId, activeMembership, selectionRequired, loading: organizationLoading, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const currentRequest = useRef(null)
  currentRequest.current = { organizationId: activeOrganizationId, revision: scopeRevision, recordId: projectId }
  const requestGeneration = useRef(0)
  const [workspace, setWorkspace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [failureKind, setFailureKind] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)

  const load = useCallback(async () => {
    if (organizationLoading || selectionRequired || !activeOrganizationId || requestSignal?.aborted) return
    const scope = currentRequest.current
    const generation = ++requestGeneration.current
    const isCurrent = () => generation === requestGeneration.current && !requestSignal?.aborted
      && scope.organizationId === currentRequest.current.organizationId
      && scope.revision === currentRequest.current.revision
      && scope.recordId === currentRequest.current.recordId
    setLoading(true)
    setError('')
    setFailureKind('')
    try {
      const result = await projectEngagementWorkspace.get(projectId, activeOrganizationId, { signal: requestSignal })
      if (isCurrent()) {
        setWorkspace(result)
        setLoadedAt(new Date())
      }
    } catch (cause) {
      if (isCurrent() && cause.name !== 'AbortError' && cause.cause?.name !== 'AbortError') {
        handleOrganizationAccessError(cause, { membershipMismatch: cause.membershipMismatch })
        setError(cause.message || 'Unable to load this workspace.')
        setFailureKind(loadFailureKind(cause))
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [activeOrganizationId, handleOrganizationAccessError, organizationLoading, requestSignal, scopeRevision, selectionRequired, projectId])

  useEffect(() => {
    setWorkspace(null)
    setError('')
    setFailureKind('')
    setLoadedAt(null)
    setLoading(true)
    load()
    return () => { requestGeneration.current += 1 }
  }, [load])
  useEffect(() => {
    if (!workspace || !focusedRecord) return
    globalThis.document?.getElementById(`work-record-${focusedRecord.kind}-${focusedRecord.id}`)?.focus()
  }, [focusedRecord, tab, workspace])


  if (organizationLoading) return <StateMessage title="Loading organization">Confirming the active organization before loading this project.</StateMessage>

  if (selectionRequired || !activeOrganizationId) return <StateMessage title="Select an organization">Choose an active organization to open a project workspace.</StateMessage>

  if (loading && !workspace) return <StateMessage title="Loading project workspace">Loading canonical project and delivery records.</StateMessage>

  if (!workspace) {
    const title = failureKind === 'denied' ? 'Project access denied' : failureKind === 'missing' ? 'Project not found' : 'Project workspace unavailable'
    const message = failureKind === 'denied'
      ? 'This project is not available to your active organization membership.'
      : failureKind === 'missing'
        ? 'No canonical project was found in the active organization.'
        : error || 'The project workspace could not be loaded.'
    return <StateMessage title={title} error={failureKind !== 'missing'} action={() => navigate('/sphere/portfolio')}>{message}</StateMessage>
  }

  const { project, identity, summary } = workspace
  const showRetainerPlanning = identity.hasEngagement
    && (project.engagement_type === 'retainer' || workspace.engagement?.engagement_type === 'retainer')
  const tabs = showRetainerPlanning
    ? [...TABS.slice(0, planningTabIndex + 1), ['retainer-planning', 'Retainer Planning'], ...TABS.slice(planningTabIndex + 1)]
    : TABS
  const onTabKeyDown = (event, index) => {
    const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }
    if (!(event.key in keys)) return
    event.preventDefault()
    const nextIndex = (keys[event.key] + tabs.length) % tabs.length
    const nextTab = tabs[nextIndex][0]
    selectTab(nextTab)
    globalThis.requestAnimationFrame?.(() => globalThis.document?.getElementById(`project-tab-${nextTab}`)?.focus())
  }
  return (
    <main className="min-h-full bg-[#090c13] p-4 text-slate-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <button type="button" onClick={() => navigate('/sphere/portfolio')} className="text-sm font-medium text-slate-500 hover:text-white">← Portfolio Workspace</button>
        <header className="mt-5 flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2 text-xs"><Pill>{identity.workType}</Pill><Pill>{label(project.engagement_type)}</Pill>{identity.hasEngagement && <Pill>Engagement connected</Pill>}</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-2 text-sm text-slate-400">{[identity.clientName, identity.brandName].filter(Boolean).join(' · ') || (identity.workType === 'Internal Work' ? 'Internal project; no client identity is required.' : 'No client or brand identity is attached.')}</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">{project.description || project.scope_statement || 'No project description recorded.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">{identity.hasEngagement && workspace.engagement?.id && <Link to={`/sphere/engagements?engagement=${encodeURIComponent(workspace.engagement.id)}&tab=pipeline&project=${encodeURIComponent(projectId)}`} className="rounded-xl border border-violet-500/25 px-4 py-2 text-sm text-violet-200">Open Pipeline</Link>}<button type="button" onClick={load} disabled={loading} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm hover:bg-white/[0.08] disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button><Status value={project.status} /><ProjectDraftActivation project={project} organizationId={activeOrganizationId} membership={activeMembership} scopeRevision={scopeRevision} requestSignal={requestSignal} onActivated={load} onAccessError={handleOrganizationAccessError} /></div>
        </header>

        <ProjectManagerAssignment project={project} organizationId={activeOrganizationId} membership={activeMembership} scopeRevision={scopeRevision} requestSignal={requestSignal} onAssigned={load} onAccessError={handleOrganizationAccessError} />

        {error && <div role="alert" className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100"><p className="font-medium">Refresh failed; showing previously loaded data.</p><p className="mt-1 text-xs text-amber-200/80">{error}{loadedAt ? ` · Loaded ${loadedAt.toLocaleTimeString()}` : ''}</p></div>}
        <section aria-label="Workspace summary" className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Metric title="Project Tasks" value={summary.openProjectTasks} note="Open canonical tasks" />
          <Metric title="Engagement Work Items" value={summary.openEngagementWorkItems} note="Open delivery items" />
          <Metric title="Active engagement services" value={workspace.activeServices.length} note={workspace.deliveryShape.label} />
          <Metric title="Journey" value={`${summary.completedJourneyStages}/${summary.totalJourneyStages}`} note="Completed stages" />
          <Metric title="Milestones" value={summary.openMilestones} note="Open checkpoints" />
          <Metric title="Review queue" value={summary.reviewQueue} note="Versions in review/revision" />
          <Metric title="Progress" value={summary.progress === null ? 'Not set' : `${summary.progress}%`} note={`Due ${date(project.due_date)}`} />
        </section>

        <nav role="tablist" aria-label="Project workspace sections" className="mt-7 flex gap-1 overflow-x-auto border-b border-white/[0.08]">
          {tabs.map(([id, title], index) => <button type="button" role="tab" id={`project-tab-${id}`} aria-selected={tab === id} aria-controls="project-workspace-panel" tabIndex={tab === id ? 0 : -1} key={id} onClick={() => selectTab(id)} onKeyDown={(event) => onTabKeyDown(event, index)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${tab === id ? 'border-violet-400 text-white' : 'border-transparent text-slate-500 hover:text-slate-200'}`}>{title}</button>)}
        </nav>

        <div id="project-workspace-panel" role="tabpanel" aria-labelledby={`project-tab-${tab}`} className="mt-6" tabIndex={0}>
          {tab === 'overview' && <Overview workspace={workspace} />}
          {tab === 'services' && <ServicesAndScope workspace={workspace} organizationId={activeOrganizationId} membership={activeMembership} scopeRevision={scopeRevision} requestSignal={requestSignal} onChanged={load} onAccessError={handleOrganizationAccessError} />}
          {tab === 'journey' && <Journey workspace={workspace} navigate={navigate} />}
          {tab === 'work' && <WorkViews workspace={workspace} navigate={navigate} searchParams={searchParams} setSearchParams={setSearchParams} />}
          {tab === 'discussion' && <div className="space-y-6">
            <ProjectDiscussionPanel organizationId={activeOrganizationId} projectId={project.id} tasks={workspace.projectTasks} workstreams={workspace.workstreams} scopeRevision={scopeRevision} requestSignal={requestSignal} onAccessError={handleOrganizationAccessError} onApplied={load} />
            <ContextConversationPanel contextKind="project_team" projectId={project.id} label="Project conversations" />
          </div>}
          {tab === 'project-tasks' && <ProjectTasks rows={workspace.projectTasks} workshopLinks={workspace.workshopLinks} navigate={navigate} />}
          {tab === 'engagement-work' && <EngagementWork rows={workspace.engagementWorkItems} hasEngagement={identity.hasEngagement} workshopLinks={workspace.workshopLinks} navigate={navigate} />}
          {tab === 'planning' && <ProjectPlanningPanel workspace={workspace} organizationId={activeOrganizationId} membership={activeMembership} onRefresh={load} />}
          {tab === 'retainer-planning' && showRetainerPlanning && <RetainerPlanningPanel project={project} engagement={workspace.engagement} services={workspace.services} />}
          {tab === 'outputs' && <Outputs workspace={workspace} />}
          {tab === 'activity' && <Activity rows={workspace.activity} />}
        </div>
      </div>
    </main>
  )
}

function Overview({ workspace }) {
  const { project, context } = workspace
  return <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]"><div className="space-y-5"><Panel title="Project brief" description="The canonical project brief and optional engagement objective remain separate records."><TextBlock value={context.brief} empty="No project brief recorded." />{context.objective && <div className="mt-4 border-t border-white/[0.07] pt-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Engagement objective</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{context.objective}</p></div>}</Panel><Panel title="Scope and exclusions"><TextBlock value={context.scope} empty="No scope statement recorded." /><div className="mt-4 border-t border-white/[0.07] pt-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Explicit exclusions</p><TextBlock value={context.exclusions} empty="No exclusions recorded." /></div></Panel><Panel title="Existing assets" description="Supplied engagement context is shown as recorded; missing upstream artifacts are not inferred."><RecordList rows={workspace.existingAssets} empty={workspace.identity.hasEngagement ? 'No existing assets were supplied.' : 'No engagement extension; supplied engagement assets do not apply.'} render={(item) => <AssetRecord key={item.id} item={item} />} /></Panel><Panel title="Milestones"><RecordList rows={workspace.milestones} empty="No milestones recorded." render={(item) => <Record key={item.id} title={item.name} note={`Target ${date(item.target_date)} · ${item.owner.name}`} status={item.status} attention={item.overdue || item.status === 'at_risk'} />} /></Panel></div><div className="space-y-5"><Panel title="Client and brand context"><Record title={context.client?.company || context.client?.name || (workspace.identity.workType === 'Internal Work' ? 'Internal Work' : 'No canonical client')} note={context.client ? [context.client.industry, context.client.status].filter(Boolean).map(label).join(' · ') || 'Canonical client' : 'No client identity is attached to this project.'} /><Record title={context.brand?.name || 'No brand extension'} note={context.brand?.description || 'Brand context is available only through a valid engagement extension.'} /></Panel><Panel title="Ownership"><Record title={context.projectOwner.name} note={`Project owner · ${date(project.start_date)} to ${date(project.due_date)}`} /><Record title={context.engagementOwner?.name || 'No separate engagement lead'} note={workspace.identity.hasEngagement ? 'Operating engagement lead' : 'The canonical project remains the workspace root.'} /></Panel><Panel title="Active workstreams"><RecordList rows={workspace.workstreams} empty="No workstreams recorded." render={(item) => <Record key={item.id} title={item.name} note={`${label(item.department_id)} · ${item.owner.name}`} status={item.status} />} /></Panel><Panel title="Attention signals"><RecordList rows={workspace.attentionSignals} empty="No current attention signals." render={(item) => <p key={item} className="rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-200">{item}</p>} /></Panel></div></div>
}

function ServicesAndScope({ workspace, organizationId, membership, scopeRevision, requestSignal, onChanged, onAccessError }) {
  const { context, deliveryShape, engagement, identity } = workspace
  return <div className="space-y-5">
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Project scope" description="The canonical project statement remains the source for scope and exclusions.">
        <TextBlock value={context.scope} empty="No scope statement recorded." />
        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Explicit exclusions</p>
          <TextBlock value={context.exclusions} empty="No exclusions recorded." />
        </div>
      </Panel>
      <Panel title="Service context" description="Service selection and the project scope are separate records.">
        <Record title={deliveryShape.label} note={deliveryShape.note} />
        {identity.hasEngagement && <div className="mt-3"><Record title={engagement?.name || 'Operating engagement'} note={context.objective || 'No engagement objective recorded.'} status={engagement?.status} /></div>}
      </Panel>
    </div>
    <ProjectServiceScopePanel project={workspace.project} organizationId={organizationId} membership={membership} scopeRevision={scopeRevision} requestSignal={requestSignal} onChanged={onChanged} onAccessError={onAccessError} />
  </div>
}

function Journey({ workspace, navigate }) {
  if (!workspace.identity.hasEngagement) return <Empty title="No engagement extension" note="This project has no service journey. No engagement data has been fabricated." />
  const pipelineName = workspace.pipelineVersion?.name || workspace.pipelineTemplate?.slug
  return <div className="space-y-5"><Panel title="Delivery and pipeline preview" description="Read-only presentation of the already-instantiated service journey; this does not change active services."><div className="grid gap-3 md:grid-cols-3"><Record title={workspace.deliveryShape.label} note={workspace.deliveryShape.note} /><Record title={pipelineName || 'Direct or unrecorded composition'} note={workspace.pipelineOrigin ? `Template version ${workspace.pipelineVersion?.version_number || 'unknown'} · ${workspace.pipelineOrigin.was_customized ? 'Customized before creation' : 'Original selection'}` : 'No immutable pipeline-template origin is recorded.'} /><Record title={`${workspace.activeServices.length} active service${workspace.activeServices.length === 1 ? '' : 's'}`} note={`${workspace.summary.completedJourneyStages} of ${workspace.summary.totalJourneyStages} stages completed`} /></div></Panel><div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]"><Panel title="Instantiated journey"><RecordList rows={workspace.journey} empty="No journey stages were instantiated." render={(stage, index) => <div key={stage.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-300">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{stage.name}</p><Status value={stage.status} /></div><p className="mt-1 text-xs text-slate-500">{label(stage.accountable_department_id)} · {label(stage.stage_kind)}</p>{stage.blockers.length > 0 && <p className="mt-2 text-xs text-amber-300">Depends on: {stage.blockers.join(', ')}</p>}</div></div></div>} /></Panel><div className="space-y-5"><Panel title="Activated services"><RecordList rows={workspace.services} empty="No services activated." render={(item) => <Record key={item.id} title={item.service_catalog?.name || 'Service'} note={`${label(item.service_catalog?.department_id)} · ${item.owner.name}`} status={item.status} />} /></Panel><Panel title="Prerequisites"><RecordList rows={workspace.prerequisites} empty="No additional prerequisites recorded." render={(item) => <Record key={item.id} title={label(item.prerequisite_key)} note={`${label(item.satisfaction_method)} · ${item.description || 'No note'}`} status={item.status} />} /></Panel>{workspace.workshopLinks.length > 0 && <Panel title="Department Workshops"><div className="flex flex-wrap gap-2">{workspace.workshopLinks.map((item) => <button type="button" key={item.department} onClick={() => navigate(item.path)} className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 outline-none hover:bg-violet-500/15 focus-visible:ring-2 focus-visible:ring-violet-400">Open {label(item.department)} Workshop</button>)}</div></Panel>}</div></div></div>
}

function recordWorkshopPath(link, item, kind, originTab, origin) {
  if (!link) return null
  const context = parseWorkshopNavigation(new URL(link.path, 'https://anka.invalid').searchParams)
  return appendWorkshopNavigation(new URL(link.path, 'https://anka.invalid').pathname, {
    ...context, origin: origin || context.origin, originTab, workRecord: { kind, id: item.id },
    workshopTab: kind === 'project_task' ? 'tasks' : 'engagement-work',
  })
}

function ProjectTasks({ rows, workshopLinks, navigate, originTab = 'project-tasks', origin }) {
  return <Panel title="Project Tasks" description="Canonical project-level planning and execution tasks. These are not Engagement Work Items."><RecordList rows={rows} empty="No Project Tasks recorded." render={(item) => <WorkRecord key={item.id} item={item} kind="project_task" context={item.workstreamName} workshopPath={recordWorkshopPath(workshopLinks.find(link => link.department === item.department_id), item, 'project_task', originTab, origin)} navigate={navigate} />} /></Panel>
}

function EngagementWork({ rows, hasEngagement, workshopLinks, navigate, originTab = 'engagement-work', origin }) {
  if (!hasEngagement) return <Empty title="No engagement extension" note="Engagement Work Items do not apply to this project. Project Tasks remain available separately." />
  return <Panel title="Engagement Work Items" description="Delivery work attached to the engagement extension. These are not Project Tasks."><RecordList rows={rows} empty="No Engagement Work Items recorded." render={(item) => <WorkRecord key={item.id} item={item} kind="engagement_work_item" context={label(item.department_id)} automation={Boolean(item.automation_flagged_at)} workshopPath={recordWorkshopPath(workshopLinks.find(link => link.department === item.department_id), item, 'engagement_work_item', originTab, origin)} navigate={navigate} />} /></Panel>
}

const WORK_VIEWS = ['list', 'board', 'calendar']
const MONTH_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function WorkViews({ workspace, navigate, searchParams, setSearchParams }) {
  const view = WORK_VIEWS.includes(searchParams.get('workView')) ? searchParams.get('workView') : 'list'
  const suppliedMonth = searchParams.get('workMonth')
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(suppliedMonth || '')
    ? suppliedMonth : new Date().toISOString().slice(0, 7)
  const [year, monthNumber] = monthKey.split('-').map(Number)
  const allRecords = [
    ...workspace.projectTasks.map(item => ({ kind: 'project_task', item, context: item.workstreamName })),
    ...workspace.engagementWorkItems.map(item => ({ kind: 'engagement_work_item', item, context: label(item.department_id) })),
  ]
  const kindFilter = ['project_task', 'engagement_work_item'].includes(searchParams.get('workKind')) ? searchParams.get('workKind') : 'all'
  const requestedStatus = searchParams.get('workStatus') || 'all'
  const query = (searchParams.get('workQuery') || '').trim().toLowerCase()
  const availableStatuses = [...new Set(allRecords.map(({ item }) => item.status || 'unknown'))].sort()
  const statusFilter = availableStatuses.includes(requestedStatus) ? requestedStatus : 'all'
  const returnParams = new URLSearchParams({ tab: 'work' })
  for (const key of ['workView', 'workKind', 'workStatus', 'workQuery', 'workMonth']) {
    if (searchParams.has(key)) returnParams.set(key, searchParams.get(key))
  }
  const origin = `/sphere/workspace/projects/${encodeURIComponent(workspace.project.id)}?${returnParams}`
  const records = allRecords.filter(({ kind, item, context }) =>
    (kindFilter === 'all' || kind === kindFilter)
    && (statusFilter === 'all' || (item.status || 'unknown') === statusFilter)
    && (!query || [item.title, item.description, context, item.owner.name].some(value => String(value || '').toLowerCase().includes(query))))
  const setWorkParam = (key, value) => {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    setSearchParams(next, { replace: true })
  }
  const card = ({ kind, item, context }) => <WorkRecord key={`${kind}-${item.id}`} item={item} kind={kind}
    context={context} automation={kind === 'engagement_work_item' && Boolean(item.automation_flagged_at)}
    workshopPath={recordWorkshopPath(workspace.workshopLinks.find(link => link.department === item.department_id), item, kind, 'work', origin)}
    navigate={navigate} showKind />
  const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1))
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const calendarDays = Array.from({ length: Math.ceil((monthStart.getUTCDay() + monthEnd) / 7) * 7 }, (_, index) => {
    const day = index - monthStart.getUTCDay() + 1
    return day >= 1 && day <= monthEnd ? `${monthKey}-${String(day).padStart(2, '0')}` : null
  })
  const shiftMonth = offset => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7)
    setWorkParam('workMonth', next)
  }
  const statuses = [...new Set(records.map(({ item }) => item.status || 'unknown'))].sort()
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div><h2 className="font-semibold">Project work</h2><p className="mt-1 text-xs text-slate-500">Showing {records.length} of {allRecords.length} records. Statuses keep their source meaning; calendar dates are task due dates.</p></div>
      <div role="group" aria-label="Work view" className="flex gap-1 rounded-xl border border-white/10 p-1">
        {WORK_VIEWS.map(option => <button type="button" key={option} aria-pressed={view === option} onClick={() => setWorkParam('workView', option)} className={`rounded-lg px-3 py-1.5 text-sm ${view === option ? 'bg-violet-500/20 text-violet-100' : 'text-slate-400 hover:text-white'}`}>{label(option)}</button>)}
      </div>
    </div>
    <div className="grid gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 md:grid-cols-[minmax(0,1fr)_220px_220px]">
      <label className="text-xs font-medium text-slate-400">Search work<input type="search" maxLength={120} value={searchParams.get('workQuery') || ''} onChange={event => setWorkParam('workQuery', event.target.value)} placeholder="Title, owner, or description" className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" /></label>
      <label className="text-xs font-medium text-slate-400">Record type<select value={kindFilter} onChange={event => setWorkParam('workKind', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"><option value="all">All work</option><option value="project_task">Project Tasks</option><option value="engagement_work_item">Engagement Work Items</option></select></label>
      <label className="text-xs font-medium text-slate-400">Recorded status<select value={statusFilter} onChange={event => setWorkParam('workStatus', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"><option value="all">All statuses</option>{availableStatuses.map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label>
    </div>
    {view === 'list' && <><ProjectTasks rows={records.filter(({ kind }) => kind === 'project_task').map(({ item }) => item)} workshopLinks={workspace.workshopLinks} navigate={navigate} originTab="work" origin={origin} /><EngagementWork rows={records.filter(({ kind }) => kind === 'engagement_work_item').map(({ item }) => item)} hasEngagement={workspace.identity.hasEngagement} workshopLinks={workspace.workshopLinks} navigate={navigate} originTab="work" origin={origin} /></>}
    {view === 'board' && (records.length
      ? <div className="flex gap-4 overflow-x-auto pb-3">{statuses.map(status => <section key={status} className="w-72 shrink-0 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"><h3 className="mb-3 text-sm font-semibold">{label(status)} <span className="text-slate-500">({records.filter(({ item }) => (item.status || 'unknown') === status).length})</span></h3><div className="space-y-3">{records.filter(({ item }) => (item.status || 'unknown') === status).map(card)}</div></section>)}</div>
      : <Empty title="No project work" note="No Project Tasks or Engagement Work Items have been recorded." />)}
    {view === 'calendar' && <div className="space-y-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{monthStart.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3><div className="flex gap-2"><button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)} className="rounded-lg border border-white/10 px-3 py-1.5">←</button><button type="button" aria-label="Next month" onClick={() => shiftMonth(1)} className="rounded-lg border border-white/10 px-3 py-1.5">→</button></div></div><div className="overflow-x-auto"><div className="grid min-w-[840px] grid-cols-7 gap-2">{MONTH_DAYS.map(day => <div key={day} className="px-2 text-xs font-semibold text-slate-500">{day}</div>)}{calendarDays.map((day, index) => <div key={day || `blank-${index}`} aria-label={day || undefined} className="min-h-32 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2"><p className="mb-2 text-xs text-slate-400">{day?.slice(-2) || ''}</p>{day && records.filter(({ item }) => item.due_date?.slice(0, 10) === day).map(({ kind, item }) => <div key={`${kind}-${item.id}`} className="mb-1 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] p-2 text-xs"><p className="font-medium">{item.title}</p><p className="text-slate-500">{kind === 'project_task' ? 'Project Task' : 'Engagement Work Item'} · {label(item.status)}</p></div>)}</div>)}</div></div>{records.some(({ item }) => !item.due_date) && <Panel title="No due date" description="These records remain visible until a due date is set."><div className="grid gap-3 md:grid-cols-2">{records.filter(({ item }) => !item.due_date).map(card)}</div></Panel>}</div>}
  </div>
}

function WorkRecord({ item, kind, context, automation = false, workshopPath, navigate, showKind = false }) {
  return <div id={`work-record-${kind}-${item.id}`} tabIndex={-1} className={`rounded-xl border p-4 outline-none focus:ring-2 focus:ring-violet-400 ${item.overdue || item.status === 'blocked' ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-black/10'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div>{showKind && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-300">{kind === 'project_task' ? 'Project Task' : 'Engagement Work Item'}</p>}<p className="font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{context} · {item.owner.name} · Due {date(item.due_date)}</p></div><Status value={item.status} /></div>{item.description && <p className="mt-3 text-sm leading-6 text-slate-400">{item.description}</p>}<div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">{item.overdue && <Pill attention>Overdue</Pill>}{automation && <Pill attention>Automation flag</Pill>}<Pill>{label(item.priority)}</Pill>{workshopPath && <button type="button" onClick={() => navigate(workshopPath)} className="ml-auto rounded-lg border border-violet-500/25 px-2.5 py-1.5 font-semibold text-violet-200 hover:bg-violet-500/10 focus:outline-none focus:ring-2 focus:ring-violet-400">Open in Workshop</button>}</div></div>
}

function Outputs({ workspace }) {
  return <div className="space-y-5"><Panel title="Recorded source assets" description="Existing engagement assets are shown from their original records; listing them here does not approve or release them."><RecordList rows={workspace.existingAssets} empty={workspace.identity.hasEngagement ? 'No source assets were supplied for this engagement.' : 'No engagement extension; supplied assets do not apply.'} render={(item) => <AssetRecord key={item.id} item={item} />} /></Panel><Panel title="Delivery lifecycle" description="Generation, approval, client release, and completion are separate states."><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Record title="Generation" note="Version records show produced outputs." /><Record title="Approval" note="Review status shows internal or client decisions." /><Record title="Release" note="Client release is shown only from a recorded release timestamp." /><Record title="Completion" note="Deliverable status remains independent of release." /></div></Panel><_ProjectReviewEvidencePanel deliverables={workspace.deliverables} /><div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Panel title="Canonical deliverables"><RecordList rows={workspace.deliverables} empty="No deliverables recorded." render={(item) => <div key={item.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.workstreamName} · Due {date(item.due_date)}</p></div><Status value={item.status} /></div><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-3"><LifecycleFact term="Generated" value={item.versions.length ? `${item.versions.length} version${item.versions.length === 1 ? '' : 's'}` : 'No version'} /><LifecycleFact term="Approval" value={item.latestVersion ? label(item.latestVersion.review_status) : 'Not started'} /><LifecycleFact term="Client release" value={item.latestVersion?.client_released_at ? new Date(item.latestVersion.client_released_at).toLocaleString() : 'Not released'} /></dl></div>} /></Panel><div className="space-y-5"><Panel title="Review queue"><RecordList rows={workspace.reviewQueue} empty="No deliverable versions are currently in review or revision." render={(item) => <Record key={item.id} title={`${item.deliverableTitle} · v${item.version_number}`} note={item.change_summary || 'No change summary'} status={item.review_status} />} /></Panel><Panel title="Workshop artifacts"><RecordList rows={workspace.workshopArtifacts} empty={workspace.identity.hasEngagement ? 'No Workshop artifacts recorded.' : 'No engagement extension; Workshop artifacts do not apply.'} render={(item) => <Record key={item.id} title={item.title} note={`${label(item.artifact_type)} · ${item.versions.length} versions · ${item.approvedVersions} approved`} />} /></Panel></div></div></div>
}

function Activity({ rows }) {
  return <Panel title="Project and engagement activity" description="Canonical project events and engagement audit events remain labelled by source."><RecordList rows={rows} empty="No activity recorded." render={(item) => <Record key={`${item.source}-${item.id}`} title={label(item.label)} note={`${item.source} · ${item.actor.name} · ${new Date(item.occurred_at).toLocaleString()}`} />} /></Panel>
}

function Panel({ title, description, children }) {
  return <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><h2 className="font-semibold">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}<div className="mt-4">{children}</div></section>
}

function RecordList({ rows, empty, render }) {
  return rows.length ? <div className="space-y-3">{rows.map(render)}</div> : <p className="text-sm text-slate-500">{empty}</p>
}

function Record({ title, note, status, attention = false }) {
  return <div className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${attention ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-black/10'}`}><div><p className="text-sm font-medium text-white">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{note}</p></div>{status && <Status value={status} />}</div>
}

function TextBlock({ value, empty }) {
  return <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${value ? 'text-slate-300' : 'text-slate-500'}`}>{value || empty}</p>
}

function AssetRecord({ item }) {
  return <div className="rounded-xl border border-white/[0.07] bg-black/10 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-white">{item.name}</p><p className="mt-1 text-xs text-slate-500">{label(item.asset_kind)}{item.notes ? ` · ${item.notes}` : ''}</p></div>{item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-violet-300 outline-none hover:text-violet-200 focus-visible:ring-2 focus-visible:ring-violet-400">Open source ↗</a>}</div></div>
}

function LifecycleFact({ term, value }) {
  return <div className="rounded-lg bg-white/[0.025] p-2"><dt className="text-slate-600">{term}</dt><dd className="mt-1 text-slate-300">{value}</dd></div>
}

function Metric({ title, value, note }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs text-slate-500">{title}</p><p className="mt-2 text-xl font-semibold">{value}</p><p className="mt-1 text-[11px] text-slate-600">{note}</p></div>
}

function Status({ value }) {
  return <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300">{label(value)}</span>
}

function Pill({ children, attention = false }) {
  return <span className={`rounded-full border px-2 py-1 text-[11px] ${attention ? 'border-amber-500/20 bg-amber-500/10 text-amber-200' : 'border-violet-500/20 bg-violet-500/10 text-violet-200'}`}>{children}</span>
}

function Empty({ title, note }) {
  return <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center"><p className="font-medium text-slate-300">{title}</p><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{note}</p></div>
}

function StateMessage({ title, children, error = false, action }) {
  return <main className="flex min-h-full items-center justify-center bg-[#090c13] p-6 text-center text-slate-400"><div className="max-w-lg"><h1 className={`text-lg font-semibold ${error ? 'text-rose-300' : 'text-slate-200'}`}>{title}</h1><p className="mt-2 text-sm leading-6">{children}</p>{action && <button type="button" onClick={action} className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-white outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-violet-400">Return to Portfolio</button>}</div></main>
}
