import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { projectEngagementWorkspace } from '../data/projectEngagementWorkspace'
import RetainerPlanningPanel from '../components/RetainerPlanningPanel'

const TABS = [
  ['overview', 'Overview'],
  ['journey', 'Journey'],
  ['project-tasks', 'Project Tasks'],
  ['engagement-work', 'Engagement Work Items'],
  ['outputs', 'Deliverables & Reviews'],
  ['activity', 'Activity'],
]

const label = (value) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown'
const date = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString() : 'Not set'

export default function ProjectEngagementWorkspace() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState(null)
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setWorkspace(await projectEngagementWorkspace.get(projectId)) }
    catch (cause) { setError(cause.message || 'Unable to load this workspace.') }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  if (loading && !workspace) return <StateMessage>Loading project workspace…</StateMessage>
  if (!workspace) return <StateMessage error={error} action={() => navigate('/sphere/workspace')}>Return to Portfolio</StateMessage>

  const { project, identity, summary } = workspace
  const showRetainerPlanning = identity.hasEngagement
    && (project.engagement_type === 'retainer' || workspace.engagement?.engagement_type === 'retainer')
  const tabs = showRetainerPlanning
    ? [...TABS.slice(0, 4), ['retainer-planning', 'Retainer Planning'], ...TABS.slice(4)]
    : TABS
  return (
    <main className="min-h-full bg-[#090c13] p-4 text-slate-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <button type="button" onClick={() => navigate('/sphere/workspace')} className="text-sm font-medium text-slate-500 hover:text-white">← Portfolio Workspace</button>
        <header className="mt-5 flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2 text-xs"><Pill>{identity.workType}</Pill><Pill>{label(project.engagement_type)}</Pill>{identity.hasEngagement && <Pill>Engagement connected</Pill>}</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-2 text-sm text-slate-400">{[identity.clientName, identity.brandName].filter(Boolean).join(' · ') || 'No client or brand identity is required for this project.'}</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">{project.description || project.scope_statement || 'No project description recorded.'}</p>
          </div>
          <div className="flex items-center gap-2"><button type="button" onClick={load} disabled={loading} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm hover:bg-white/[0.08] disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button><Status value={project.status} /></div>
        </header>

        {error && <div role="alert" className="mt-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
        <section aria-label="Workspace summary" className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric title="Project Tasks" value={summary.openProjectTasks} note="Open canonical tasks" />
          <Metric title="Engagement Work Items" value={summary.openEngagementWorkItems} note="Open delivery items" />
          <Metric title="Journey" value={`${summary.completedJourneyStages}/${summary.totalJourneyStages}`} note="Completed stages" />
          <Metric title="Milestones" value={summary.openMilestones} note="Open checkpoints" />
          <Metric title="Review queue" value={summary.reviewQueue} note="Versions in review/revision" />
          <Metric title="Due" value={date(project.due_date)} note={`${label(project.health)} health`} />
        </section>

        <nav aria-label="Project workspace sections" className="mt-7 flex gap-1 overflow-x-auto border-b border-white/[0.08]">
          {tabs.map(([id, title]) => <button type="button" key={id} onClick={() => setTab(id)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === id ? 'border-violet-400 text-white' : 'border-transparent text-slate-500 hover:text-slate-200'}`}>{title}</button>)}
        </nav>

        <div className="mt-6">
          {tab === 'overview' && <Overview workspace={workspace} />}
          {tab === 'journey' && <Journey workspace={workspace} navigate={navigate} />}
          {tab === 'project-tasks' && <ProjectTasks rows={workspace.projectTasks} />}
          {tab === 'engagement-work' && <EngagementWork rows={workspace.engagementWorkItems} hasEngagement={identity.hasEngagement} />}
          {tab === 'retainer-planning' && showRetainerPlanning && <RetainerPlanningPanel project={project} engagement={workspace.engagement} services={workspace.services} />}
          {tab === 'outputs' && <Outputs workspace={workspace} />}
          {tab === 'activity' && <Activity rows={workspace.activity} />}
        </div>
      </div>
    </main>
  )
}

function Overview({ workspace }) {
  const { project, engagement } = workspace
  return <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]"><div className="space-y-5"><Panel title="Project scope"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{project.scope_statement || 'No scope statement recorded.'}</p>{project.exclusions && <p className="mt-4 border-t border-white/[0.07] pt-4 text-sm text-slate-400"><span className="font-medium text-slate-300">Exclusions:</span> {project.exclusions}</p>}</Panel><Panel title="Milestones"><RecordList rows={workspace.milestones} empty="No milestones recorded." render={(item) => <Record key={item.id} title={item.name} note={`Target ${date(item.target_date)} · ${item.owner.name}`} status={item.status} attention={item.overdue || item.status === 'at_risk'} />} /></Panel></div><div className="space-y-5"><Panel title="Ownership"><Record title={project.owner.name} note={`Project owner · ${date(project.start_date)} to ${date(project.due_date)}`} /><Record title={engagement?.lead_owner_id ? 'Engagement lead assigned' : 'No separate engagement lead'} note={engagement?.objective || 'The canonical project remains the workspace root.'} /></Panel><Panel title="Active workstreams"><RecordList rows={workspace.workstreams} empty="No workstreams recorded." render={(item) => <Record key={item.id} title={item.name} note={`${label(item.department_id)} · ${item.owner.name}`} status={item.status} />} /></Panel><Panel title="Attention signals"><RecordList rows={workspace.attentionSignals} empty="No current attention signals." render={(item) => <p key={item} className="rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-200">{item}</p>} /></Panel></div></div>
}

function Journey({ workspace, navigate }) {
  if (!workspace.identity.hasEngagement) return <Empty title="No engagement extension" note="This project has no service journey. No engagement data has been fabricated." />
  return <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]"><Panel title="Instantiated journey"><RecordList rows={workspace.journey} empty="No journey stages were instantiated." render={(stage, index) => <div key={stage.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-300">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{stage.name}</p><Status value={stage.status} /></div><p className="mt-1 text-xs text-slate-500">{label(stage.accountable_department_id)} · {label(stage.stage_kind)}</p>{stage.blockers.length > 0 && <p className="mt-2 text-xs text-amber-300">Depends on: {stage.blockers.join(', ')}</p>}</div></div></div>} /></Panel><div className="space-y-5"><Panel title="Activated services"><RecordList rows={workspace.services} empty="No services activated." render={(item) => <Record key={item.id} title={item.service_catalog?.name || 'Service'} note={`${label(item.service_catalog?.department_id)} · ${item.owner.name}`} status={item.status} />} /></Panel><Panel title="Prerequisites"><RecordList rows={workspace.prerequisites} empty="No additional prerequisites recorded." render={(item) => <Record key={item.id} title={label(item.prerequisite_key)} note={`${label(item.satisfaction_method)} · ${item.description || 'No note'}`} status={item.status} />} /></Panel>{workspace.workshopLinks.length > 0 && <Panel title="Department Workshops"><div className="flex flex-wrap gap-2">{workspace.workshopLinks.map((item) => <button type="button" key={item.department} onClick={() => navigate(item.path)} className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/15">Open {label(item.department)} Workshop</button>)}</div></Panel>}</div></div>
}

function ProjectTasks({ rows }) {
  return <Panel title="Project Tasks" description="Canonical project-level planning and execution tasks. These are not Engagement Work Items."><RecordList rows={rows} empty="No Project Tasks recorded." render={(item) => <WorkRecord key={item.id} item={item} context={item.workstreamName} />} /></Panel>
}

function EngagementWork({ rows, hasEngagement }) {
  if (!hasEngagement) return <Empty title="No engagement extension" note="Engagement Work Items do not apply to this project. Project Tasks remain available separately." />
  return <Panel title="Engagement Work Items" description="Delivery work attached to the engagement extension. These are not Project Tasks."><RecordList rows={rows} empty="No Engagement Work Items recorded." render={(item) => <WorkRecord key={item.id} item={item} context={label(item.department_id)} automation={Boolean(item.automation_flagged_at)} />} /></Panel>
}

function WorkRecord({ item, context, automation = false }) {
  return <div className={`rounded-xl border p-4 ${item.overdue || item.status === 'blocked' ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-black/10'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{context} · {item.owner.name} · Due {date(item.due_date)}</p></div><Status value={item.status} /></div>{item.description && <p className="mt-3 text-sm leading-6 text-slate-400">{item.description}</p>}<div className="mt-3 flex flex-wrap gap-2 text-[11px]">{item.overdue && <Pill attention>Overdue</Pill>}{automation && <Pill attention>Automation flag</Pill>}<Pill>{label(item.priority)}</Pill></div></div>
}

function Outputs({ workspace }) {
  return <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Panel title="Canonical deliverables"><RecordList rows={workspace.deliverables} empty="No deliverables recorded." render={(item) => <div key={item.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.workstreamName} · Due {date(item.due_date)}</p></div><Status value={item.status} /></div><p className="mt-3 text-xs text-slate-400">{item.versions.length} version{item.versions.length === 1 ? '' : 's'}{item.latestVersion ? ` · Latest: ${label(item.latestVersion.review_status)}` : ''}</p></div>} /></Panel><div className="space-y-5"><Panel title="Review queue"><RecordList rows={workspace.reviewQueue} empty="No deliverable versions are currently in review or revision." render={(item) => <Record key={item.id} title={`${item.deliverableTitle} · v${item.version_number}`} note={item.change_summary || 'No change summary'} status={item.review_status} />} /></Panel><Panel title="Workshop artifacts"><RecordList rows={workspace.workshopArtifacts} empty={workspace.identity.hasEngagement ? 'No Workshop artifacts recorded.' : 'No engagement extension; Workshop artifacts do not apply.'} render={(item) => <Record key={item.id} title={item.title} note={`${label(item.artifact_type)} · ${item.versions.length} versions · ${item.approvedVersions} approved`} />} /></Panel></div></div>
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

function StateMessage({ children, error, action }) {
  return <main className="flex min-h-full items-center justify-center bg-[#090c13] p-6 text-center text-slate-400"><div><p className={error ? 'text-rose-300' : ''}>{error || children}</p>{action && <button type="button" onClick={action} className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-white">Return to Portfolio</button>}</div></main>
}
