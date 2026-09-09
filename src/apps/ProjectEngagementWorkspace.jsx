import { useCallback, useEffect, useRef, useState } from 'react'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { projectEngagementWorkspace } from '../data/projectEngagementWorkspace'
import RetainerPlanningPanel from '../components/RetainerPlanningPanel'
import ProjectPlanningPanel from '../components/ProjectPlanningPanel.jsx'
import { appendWorkshopNavigation, parseWorkshopNavigation } from '../data/workshopNavigation.js'

const TABS = [
  ['overview', 'Setup & context'],
  ['journey', 'Journey'],
  ['project-tasks', 'Project Tasks'],
  ['engagement-work', 'Engagement Work Items'],
  ['planning', 'Planning'],
  ['outputs', 'Deliverables & Reviews'],
  ['activity', 'Activity'],
]

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
    ? [...TABS.slice(0, 5), ['retainer-planning', 'Retainer Planning'], ...TABS.slice(5)]
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
          <div className="flex items-center gap-2"><button type="button" onClick={load} disabled={loading} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm hover:bg-white/[0.08] disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button><Status value={project.status} /></div>
        </header>

        {error && <div role="alert" className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100"><p className="font-medium">Refresh failed; showing previously loaded data.</p><p className="mt-1 text-xs text-amber-200/80">{error}{loadedAt ? ` · Loaded ${loadedAt.toLocaleTimeString()}` : ''}</p></div>}
        <section aria-label="Workspace summary" className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Metric title="Project Tasks" value={summary.openProjectTasks} note="Open canonical tasks" />
          <Metric title="Engagement Work Items" value={summary.openEngagementWorkItems} note="Open delivery items" />
          <Metric title="Active services" value={workspace.activeServices.length} note={workspace.deliveryShape.label} />
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
          {tab === 'journey' && <Journey workspace={workspace} navigate={navigate} />}
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

function Journey({ workspace, navigate }) {
  if (!workspace.identity.hasEngagement) return <Empty title="No engagement extension" note="This project has no service journey. No engagement data has been fabricated." />
  const pipelineName = workspace.pipelineVersion?.name || workspace.pipelineTemplate?.slug
  return <div className="space-y-5"><Panel title="Delivery and pipeline preview" description="Read-only presentation of the already-instantiated service journey; this does not change active services."><div className="grid gap-3 md:grid-cols-3"><Record title={workspace.deliveryShape.label} note={workspace.deliveryShape.note} /><Record title={pipelineName || 'Direct or unrecorded composition'} note={workspace.pipelineOrigin ? `Template version ${workspace.pipelineVersion?.version_number || 'unknown'} · ${workspace.pipelineOrigin.was_customized ? 'Customized before creation' : 'Original selection'}` : 'No immutable pipeline-template origin is recorded.'} /><Record title={`${workspace.activeServices.length} active service${workspace.activeServices.length === 1 ? '' : 's'}`} note={`${workspace.summary.completedJourneyStages} of ${workspace.summary.totalJourneyStages} stages completed`} /></div></Panel><div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]"><Panel title="Instantiated journey"><RecordList rows={workspace.journey} empty="No journey stages were instantiated." render={(stage, index) => <div key={stage.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-300">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{stage.name}</p><Status value={stage.status} /></div><p className="mt-1 text-xs text-slate-500">{label(stage.accountable_department_id)} · {label(stage.stage_kind)}</p>{stage.blockers.length > 0 && <p className="mt-2 text-xs text-amber-300">Depends on: {stage.blockers.join(', ')}</p>}</div></div></div>} /></Panel><div className="space-y-5"><Panel title="Activated services"><RecordList rows={workspace.services} empty="No services activated." render={(item) => <Record key={item.id} title={item.service_catalog?.name || 'Service'} note={`${label(item.service_catalog?.department_id)} · ${item.owner.name}`} status={item.status} />} /></Panel><Panel title="Prerequisites"><RecordList rows={workspace.prerequisites} empty="No additional prerequisites recorded." render={(item) => <Record key={item.id} title={label(item.prerequisite_key)} note={`${label(item.satisfaction_method)} · ${item.description || 'No note'}`} status={item.status} />} /></Panel>{workspace.workshopLinks.length > 0 && <Panel title="Department Workshops"><div className="flex flex-wrap gap-2">{workspace.workshopLinks.map((item) => <button type="button" key={item.department} onClick={() => navigate(item.path)} className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 outline-none hover:bg-violet-500/15 focus-visible:ring-2 focus-visible:ring-violet-400">Open {label(item.department)} Workshop</button>)}</div></Panel>}</div></div></div>
}

function recordWorkshopPath(link, item, kind, originTab) {
  if (!link) return null
  const context = parseWorkshopNavigation(new URL(link.path, 'https://anka.invalid').searchParams)
  return appendWorkshopNavigation(new URL(link.path, 'https://anka.invalid').pathname, {
    ...context, originTab, workRecord: { kind, id: item.id },
    workshopTab: kind === 'project_task' ? 'tasks' : 'engagement-work',
  })
}

function ProjectTasks({ rows, workshopLinks, navigate }) {
  return <Panel title="Project Tasks" description="Canonical project-level planning and execution tasks. These are not Engagement Work Items."><RecordList rows={rows} empty="No Project Tasks recorded." render={(item) => <WorkRecord key={item.id} item={item} kind="project_task" context={item.workstreamName} workshopPath={recordWorkshopPath(workshopLinks.find(link => link.department === item.department_id), item, 'project_task', 'project-tasks')} navigate={navigate} />} /></Panel>
}

function EngagementWork({ rows, hasEngagement, workshopLinks, navigate }) {
  if (!hasEngagement) return <Empty title="No engagement extension" note="Engagement Work Items do not apply to this project. Project Tasks remain available separately." />
  return <Panel title="Engagement Work Items" description="Delivery work attached to the engagement extension. These are not Project Tasks."><RecordList rows={rows} empty="No Engagement Work Items recorded." render={(item) => <WorkRecord key={item.id} item={item} kind="engagement_work_item" context={label(item.department_id)} automation={Boolean(item.automation_flagged_at)} workshopPath={recordWorkshopPath(workshopLinks.find(link => link.department === item.department_id), item, 'engagement_work_item', 'engagement-work')} navigate={navigate} />} /></Panel>
}

function WorkRecord({ item, kind, context, automation = false, workshopPath, navigate }) {
  return <div id={`work-record-${kind}-${item.id}`} tabIndex={-1} className={`rounded-xl border p-4 outline-none focus:ring-2 focus:ring-violet-400 ${item.overdue || item.status === 'blocked' ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-black/10'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{context} · {item.owner.name} · Due {date(item.due_date)}</p></div><Status value={item.status} /></div>{item.description && <p className="mt-3 text-sm leading-6 text-slate-400">{item.description}</p>}<div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">{item.overdue && <Pill attention>Overdue</Pill>}{automation && <Pill attention>Automation flag</Pill>}<Pill>{label(item.priority)}</Pill>{workshopPath && <button type="button" onClick={() => navigate(workshopPath)} className="ml-auto rounded-lg border border-violet-500/25 px-2.5 py-1.5 font-semibold text-violet-200 hover:bg-violet-500/10 focus:outline-none focus:ring-2 focus:ring-violet-400">Open in Workshop</button>}</div></div>
}

function Outputs({ workspace }) {
  return <div className="space-y-5"><Panel title="Delivery lifecycle" description="Generation, approval, client release, and completion are separate states."><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Record title="Generation" note="Version records show produced outputs." /><Record title="Approval" note="Review status shows internal or client decisions." /><Record title="Release" note="Client release is shown only from a recorded release timestamp." /><Record title="Completion" note="Deliverable status remains independent of release." /></div></Panel><div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Panel title="Canonical deliverables"><RecordList rows={workspace.deliverables} empty="No deliverables recorded." render={(item) => <div key={item.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.workstreamName} · Due {date(item.due_date)}</p></div><Status value={item.status} /></div><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-3"><LifecycleFact term="Generated" value={item.versions.length ? `${item.versions.length} version${item.versions.length === 1 ? '' : 's'}` : 'No version'} /><LifecycleFact term="Approval" value={item.latestVersion ? label(item.latestVersion.review_status) : 'Not started'} /><LifecycleFact term="Client release" value={item.latestVersion?.client_released_at ? new Date(item.latestVersion.client_released_at).toLocaleString() : 'Not released'} /></dl></div>} /></Panel><div className="space-y-5"><Panel title="Review queue"><RecordList rows={workspace.reviewQueue} empty="No deliverable versions are currently in review or revision." render={(item) => <Record key={item.id} title={`${item.deliverableTitle} · v${item.version_number}`} note={item.change_summary || 'No change summary'} status={item.review_status} />} /></Panel><Panel title="Workshop artifacts"><RecordList rows={workspace.workshopArtifacts} empty={workspace.identity.hasEngagement ? 'No Workshop artifacts recorded.' : 'No engagement extension; Workshop artifacts do not apply.'} render={(item) => <Record key={item.id} title={item.title} note={`${label(item.artifact_type)} · ${item.versions.length} versions · ${item.approvedVersions} approved`} />} /></Panel></div></div></div>
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
