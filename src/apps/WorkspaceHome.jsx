import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { workspaceHome } from '../data/workspaceHome.js'

const label = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const date = (value) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : 'No due date'
const dateTime = (value) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Time unavailable'
const projectPath = (projectId, tab = 'overview') => `/sphere/workspace/projects/${projectId}?tab=${tab}`

export default function WorkspaceHome() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const {
    activeOrganizationId,
    activeOrganization,
    requestSignal,
    handleOrganizationAccessError,
  } = useOrganization()
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const home = useMemo(() => workspaceHome.forOrganization(activeOrganizationId, { signal: requestSignal }), [activeOrganizationId, requestSignal])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setSnapshot(await home.getSnapshot()) }
    catch (cause) {
      if (cause?.name !== 'AbortError') {
        handleOrganizationAccessError(cause)
        setError(cause.message || 'Unable to load Workspace Home.')
      }
    } finally { setLoading(false) }
  }, [handleOrganizationAccessError, home])

  useEffect(() => { load() }, [load])

  return (
    <div className="workspace-page">
      <div className="workspace-container">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="workspace-eyebrow">Workspace</p>
            <h1 className="workspace-title">Good to see you{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}.</h1>
            <p className="workspace-description">The work that needs attention across {activeOrganization?.name || 'your organization'}, with every signal linked back to its canonical record.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate('/sphere/my-work')} className="workspace-button workspace-button-primary">Open My Work</button>
            <button type="button" onClick={load} disabled={loading} className="workspace-button">{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </header>

        {error && <div role="alert" className="mt-6 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
        {loading && !snapshot && <LoadingState />}

        {snapshot && <>
          <Summary snapshot={snapshot} navigate={navigate} />

          <section className="mt-6 grid min-w-0 gap-5 xl:grid-cols-2">
            <Panel title="Priorities" description="Urgent and high-priority records, ordered without merging work types." action="Open My Work" onAction={() => navigate('/sphere/my-work')}>
              <WorkList rows={snapshot.priorities.slice(0, 7)} empty="No urgent or high-priority work is open." navigate={navigate} showPriority />
            </Panel>
            <Panel title="Due work" description="Overdue work first, followed by the nearest recorded due dates." action="Open Portfolio" onAction={() => navigate('/sphere/portfolio')}>
              <WorkList rows={snapshot.dueWork.slice(0, 7)} empty="No open work has a due date." navigate={navigate} showDue />
            </Panel>
          </section>

          <section className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel title="Blockers" description="Explicitly blocked Project Tasks and Engagement Work Items." action="View all projects" onAction={() => navigate('/sphere/portfolio')}>
              <WorkList rows={snapshot.blockers.slice(0, 6)} empty="No work is explicitly blocked." navigate={navigate} />
            </Panel>
            <Panel title="Reviews" description="Exact deliverable versions awaiting a human review decision." action="Open review queue" onAction={() => navigate('/sphere/my-work')}>
              <ReviewList rows={snapshot.reviews.slice(0, 6)} navigate={navigate} />
            </Panel>
          </section>

          <DepartmentSummary rows={snapshot.departments} navigate={navigate} />

          <section className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <Panel title="Recent activity" description="Recent internal activity from canonical project records." action="Reports & Records" onAction={() => navigate('/sphere/reports')}>
              <ActivityList rows={snapshot.activities.slice(0, 9)} navigate={navigate} />
            </Panel>
            <QuickLinks navigate={navigate} />
          </section>
        </>}
      </div>
    </div>
  )
}

function Summary({ snapshot, navigate }) {
  const cards = [
    ['Active projects', snapshot.summary.activeProjects, 'Portfolio', '/sphere/portfolio', 'violet'],
    ['Project Tasks', snapshot.summary.projectTasks, 'Open canonical tasks', '/sphere/portfolio', 'sky'],
    ['Engagement Work Items', snapshot.summary.engagementWorkItems, 'Open delivery items', '/sphere/portfolio', 'indigo'],
    ['Due in 14 days', snapshot.summary.dueSoon, `${snapshot.summary.overdue} overdue`, '/sphere/my-work', snapshot.summary.overdue ? 'rose' : 'emerald'],
    ['Blocked', snapshot.summary.blocked, 'Explicit blocked state', '/sphere/portfolio', snapshot.summary.blocked ? 'amber' : 'emerald'],
    ['Reviews', snapshot.summary.reviews, 'Human decisions waiting', '/sphere/my-work', 'fuchsia'],
  ]
  return <section aria-label="Workspace summary" className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">{cards.map(([title, value, note, path, tone]) => <button type="button" key={title} onClick={() => navigate(path)} className="workspace-metric group text-left"><span className={`workspace-metric-dot workspace-metric-dot-${tone}`} /><p className="text-xs font-medium text-slate-400">{title}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</p><p className="mt-1 text-[11px] text-slate-600 transition-colors group-hover:text-slate-400">{note}</p></button>)}</section>
}

function WorkList({ rows, empty, navigate, showPriority = false, showDue = false }) {
  if (!rows.length) return <Empty text={empty} />
  return <div className="divide-y divide-white/[0.06]">{rows.map((row) => <button type="button" key={`${row.source}-${row.id}`} onClick={() => navigate(projectPath(row.projectId, row.tab))} className="group flex w-full min-w-0 items-start gap-3 py-3 text-left first:pt-0 last:pb-0"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${row.source === 'Project Task' ? 'bg-sky-400' : 'bg-violet-400'}`} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-200 group-hover:text-white">{row.title}</span><span className="mt-1 block truncate text-xs text-slate-500">{row.source} · {row.projectName}</span></span><span className="shrink-0 text-right">{showPriority && <Badge tone={row.priority === 'urgent' ? 'rose' : 'amber'}>{label(row.priority)}</Badge>}{showDue && <span className={`block text-xs font-medium ${row.overdue ? 'text-rose-300' : 'text-slate-400'}`}>{row.overdue ? 'Overdue · ' : ''}{date(row.dueDate)}</span>}{!showPriority && !showDue && <Badge tone="amber">Blocked</Badge>}</span></button>)}</div>
}

function ReviewList({ rows, navigate }) {
  if (!rows.length) return <Empty text="No exact versions are waiting for review." />
  return <div className="divide-y divide-white/[0.06]">{rows.map((row) => <button type="button" key={row.id} onClick={() => navigate(projectPath(row.project_id, 'outputs'))} className="group flex w-full min-w-0 items-start justify-between gap-3 py-3 text-left first:pt-0 last:pb-0"><span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-200 group-hover:text-white">{row.title}</span><span className="mt-1 block truncate text-xs text-slate-500">{row.projectName} · Version {row.version_number}</span></span><Badge tone={row.review_status === 'ready_for_internal_review' ? 'amber' : 'violet'}>{row.review_status === 'ready_for_internal_review' ? 'Internal review' : 'Client review'}</Badge></button>)}</div>
}

function DepartmentSummary({ rows, navigate }) {
  const paths = { content: '/sphere/content', design: '/sphere/design', marketing: '/sphere/marketing', development: '/sphere/delivery' }
  return <section className="mt-5"><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-base font-semibold">Department summary</h2><p className="mt-1 text-xs text-slate-500">Operational load only; these counts are not performance scores.</p></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{rows.map((row) => <button type="button" key={row.id} onClick={() => navigate(paths[row.id])} className="workspace-card group p-4 text-left"><div className="flex items-center justify-between gap-3"><h3 className="font-medium text-slate-100">{row.name}</h3><span className="text-slate-600 transition-transform group-hover:translate-x-0.5">→</span></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><MiniMetric label="Project Tasks" value={row.projectTasks} tone="sky" /><MiniMetric label="Engagement Items" value={row.engagementWorkItems} tone="violet" /><MiniMetric label="Due soon" value={row.dueSoon} /><MiniMetric label="Blocked" value={row.blocked} tone={row.blocked ? 'rose' : 'slate'} /></div></button>)}</div></section>
}

function ActivityList({ rows, navigate }) {
  if (!rows.length) return <Empty text="Recent project activity will appear here." />
  return <div className="divide-y divide-white/[0.06]">{rows.map((row) => <button type="button" key={row.id} onClick={() => navigate(row.project_id ? projectPath(row.project_id, 'activity') : '/sphere/reports')} className="group flex w-full min-w-0 items-start gap-3 py-3 text-left first:pt-0 last:pb-0"><span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-400/15 bg-violet-500/10 text-[10px] font-semibold text-violet-300">A</span><span className="min-w-0 flex-1"><span className="block text-sm text-slate-300 group-hover:text-white">{label(row.action)}</span><span className="mt-1 block truncate text-xs text-slate-600">{row.metadata?.title || row.metadata?.name || row.projectName || label(row.target_type)}</span></span><span className="shrink-0 text-[11px] text-slate-600">{dateTime(row.occurred_at)}</span></button>)}</div>
}

function QuickLinks({ navigate }) {
  const links = [
    ['Portfolio', 'Filter and inspect every canonical project.', '/sphere/portfolio'],
    ['Client Work', 'Open client relationships and connected projects.', '/sphere/clients'],
    ['Internal Work', 'Coordinate projects classified as internal.', '/sphere/internal'],
    ['Reports & Records', 'Review Living Project Records and snapshots.', '/sphere/reports'],
  ]
  return <Panel title="Explore the workspace" description="Move from the overview into the record you need."><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">{links.map(([title, description, path]) => <button type="button" key={path} onClick={() => navigate(path)} className="group rounded-xl border border-white/[0.06] bg-black/10 p-3 text-left hover:border-violet-400/20 hover:bg-violet-500/[0.04]"><span className="flex items-center justify-between text-sm font-medium text-slate-200"><span>{title}</span><span className="text-slate-600 group-hover:text-violet-300">→</span></span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></button>)}</div></Panel>
}

function Panel({ title, description, action, onAction, children }) {
  return <section className="workspace-card min-w-0 p-5"><div className="mb-4 flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold text-slate-100">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>{action && <button type="button" onClick={onAction} className="shrink-0 text-xs font-medium text-violet-300 hover:text-violet-200">{action} →</button>}</div>{children}</section>
}

function MiniMetric({ label: title, value, tone = 'slate' }) { const colors = { sky: 'text-sky-300', violet: 'text-violet-300', rose: 'text-rose-300', slate: 'text-slate-300' }; return <div className="rounded-xl bg-white/[0.025] p-2.5"><p className={`text-base font-semibold ${colors[tone] || colors.slate}`}>{value}</p><p className="mt-0.5 text-[10px] text-slate-600">{title}</p></div> }
function Badge({ children, tone }) { const tones = { rose: 'bg-rose-500/10 text-rose-300', amber: 'bg-amber-500/10 text-amber-300', violet: 'bg-violet-500/10 text-violet-300' }; return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${tones[tone] || 'bg-white/[0.05] text-slate-400'}`}>{children}</span> }
function Empty({ text }) { return <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-9 text-center text-sm text-slate-600">{text}</div> }
function LoadingState() { return <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div className="workspace-skeleton h-28" /><div className="workspace-skeleton h-28" /><div className="workspace-skeleton h-28" /></div> }
