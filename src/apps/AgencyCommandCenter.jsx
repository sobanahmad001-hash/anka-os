import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { delivery } from '../data/delivery.js'

const DEPARTMENTS = [
  ['content', 'Content'], ['design', 'Design'],
  ['marketing', 'Marketing'], ['development', 'Delivery & Development'],
]
const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const dateLabel = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value.length === 10 ? `${value}T00:00:00` : value)) : 'Not set'
const isOverdue = value => Boolean(value && new Date(value.length === 10 ? `${value}T23:59:59` : value) < new Date())

export default function AgencyCommandCenter() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    try { setData(await delivery.getAgencyCommandCenter()) }
    catch (loadError) { setError(loadError.message) }
    finally { setLoading(false) }
  }

  const intelligence = useMemo(() => {
    if (!data) return null
    const blockedTasks = data.tasks.filter(task => task.status === 'blocked')
    const overdueTasks = data.tasks.filter(task => isOverdue(task.due_date))
    const overdueRequests = data.requests.filter(request => isOverdue(request.required_by))
    const atRiskProjects = data.projects.filter(project => (
      ['at_risk', 'blocked'].includes(project.health)
      || blockedTasks.some(task => task.project_id === project.id)
      || overdueTasks.some(task => task.project_id === project.id)
    ))
    const departmentLoad = Object.fromEntries(DEPARTMENTS.map(([id]) => [id, {
      tasks: data.tasks.filter(task => task.department_id === id).length,
      blocked: blockedTasks.filter(task => task.department_id === id).length,
      overdue: overdueTasks.filter(task => task.department_id === id).length,
      members: data.members.filter(member => member.department_id === id).length,
    }]))
    return { blockedTasks, overdueTasks, overdueRequests, atRiskProjects, departmentLoad }
  }, [data])

  if (!['admin', 'executive', 'department_head'].includes(profile?.role)) return <Navigate to="/sphere/my-work" replace />
  if (loading) return <div className="flex h-full items-center justify-center bg-[var(--anka-canvas)]"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[var(--anka-violet)]" /></div>

  return <div className="min-h-full bg-[var(--anka-canvas)] text-[var(--anka-ink)]">
    <header className="border-b border-[var(--anka-line)] bg-[var(--anka-surface)] px-6 py-6"><div className="workspace-container flex flex-wrap items-end justify-between gap-4"><div><p className="workspace-eyebrow">Agency operations</p><h1 className="workspace-title">Anka Sphere Command Centre</h1><p className="mt-1 text-sm text-[var(--anka-muted)]">Delivery health, capacity pressure, review queues, and current risks across the studio.</p></div><button onClick={load} className="workspace-button">Refresh live state</button></div></header>
    {error && <div className="mx-auto mt-4 max-w-7xl rounded-xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] px-4 py-3 text-sm text-[var(--anka-danger)]">{error}</div>}
    {data && intelligence && <main className="workspace-page workspace-container space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Active engagements" value={data.projects.filter(item => item.status === 'active').length} note={`${data.clients.length} clients`} /><Metric label="Projects at risk" value={intelligence.atRiskProjects.length} tone={intelligence.atRiskProjects.length ? 'danger' : 'good'} note="Health, blockers, or overdue work" /><Metric label="Open work" value={data.tasks.length} note={`${intelligence.blockedTasks.length} blocked`} /><Metric label="Overdue" value={intelligence.overdueTasks.length + intelligence.overdueRequests.length} tone={intelligence.overdueTasks.length + intelligence.overdueRequests.length ? 'danger' : 'good'} note="Tasks and requests" /><Metric label="Internal reviews" value={data.reviewVersions.filter(item => item.review_status === 'ready_for_internal_review').length} note="Human decisions waiting" /><Metric label="Client-ready" value={data.reviewVersions.filter(item => item.review_status === 'ready_for_client_review').length} note="Approved, not released" /></section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]"><Panel title="Department workload" description="Open work compared with active people; pressure indicators are operational, not performance scores."><div className="grid gap-3 md:grid-cols-2">{DEPARTMENTS.map(([id, label]) => { const load = intelligence.departmentLoad[id]; return <button key={id} onClick={() => navigate(`/sphere/${id === 'development' ? 'delivery' : id}`)} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4 text-left hover:border-[var(--anka-violet)]"><div className="flex justify-between"><p className="font-medium">{label}</p><span className="text-xs text-[var(--anka-muted)]">{load.members} people</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><MiniMetric label="Open" value={load.tasks} /><MiniMetric label="Blocked" value={load.blocked} danger={load.blocked > 0} /><MiniMetric label="Overdue" value={load.overdue} danger={load.overdue > 0} /></div></button> })}</div></Panel><Panel title="Attention required" description="The highest-signal exceptions to clear first."><div className="space-y-3">{intelligence.atRiskProjects.slice(0, 6).map(project => <button key={project.id} onClick={() => navigate('/sphere/engagements')} className="w-full rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4 text-left hover:border-[var(--anka-danger)]"><div className="flex justify-between gap-3"><p className="font-medium">{project.name}</p><span className="h-fit rounded-full bg-[var(--anka-danger-soft)] px-2 py-1 text-[10px] text-[var(--anka-danger)]">{labelize(project.health || 'attention')}</span></div><p className="mt-2 text-xs text-[var(--anka-muted)]">Due {dateLabel(project.due_date)} · {intelligence.blockedTasks.filter(task => task.project_id === project.id).length} blocked · {intelligence.overdueTasks.filter(task => task.project_id === project.id).length} overdue</p></button>)}{!intelligence.atRiskProjects.length && <Empty text="No project currently meets the at-risk rules." />}</div></Panel></section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]"><Panel title="Approval and release queue" description="Internal quality remains mandatory before anything appears to clients."><div className="space-y-3">{data.reviewVersions.slice(0, 8).map(version => <button key={version.id} onClick={() => navigate('/sphere/my-work')} className="w-full rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4 text-left hover:border-[var(--anka-violet)]"><div className="flex justify-between gap-3"><div><p className="font-medium">{version.title}</p><p className="mt-1 text-xs text-[var(--anka-muted)]">{version.projects?.name} · {version.deliverables?.title} · v{version.version_number}</p></div><span className="h-fit rounded-full bg-[var(--anka-warning-soft)] px-2 py-1 text-[10px] text-[var(--anka-warning)]">{labelize(version.review_status)}</span></div></button>)}{!data.reviewVersions.length && <Empty text="No versions are awaiting review or release." />}</div></Panel><Panel title="Recent delivery activity" description="Database-generated events also update each Living Project Record."><div className="space-y-1">{data.activities.slice(0, 12).map(event => <div key={event.id} className="flex gap-3 border-b border-[var(--anka-line)] py-3 last:border-0"><div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--anka-violet)]" /><div className="min-w-0"><p className="text-sm text-[var(--anka-ink)]">{labelize(event.action)}</p><p className="mt-1 truncate text-xs text-[var(--anka-muted)]">{event.metadata?.title || event.metadata?.name || labelize(event.target_type)} · {dateLabel(event.occurred_at)}</p></div></div>)}{!data.activities.length && <Empty text="Activity will appear when canonical work begins." />}</div></Panel></section>

      <section><Panel title="Upcoming milestones" description="Shared deadlines across all active engagements."><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.milestones.slice(0, 9).map(item => <article key={item.id} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4"><div className="flex justify-between gap-3"><p className="font-medium">{item.name}</p><span className={`text-xs ${isOverdue(item.target_date) ? 'text-[var(--anka-danger)]' : 'text-[var(--anka-muted)]'}`}>{dateLabel(item.target_date)}</span></div><p className="mt-2 text-xs text-[var(--anka-muted)]">{item.projects?.name} · {labelize(item.status)}</p></article>)}{!data.milestones.length && <Empty text="No open milestones." />}</div></Panel></section>
    </main>}
  </div>
}

function Metric({ label, value, note, tone }) { const color = tone === 'danger' ? 'text-[var(--anka-danger)]' : tone === 'good' ? 'text-[var(--anka-success)]' : 'text-[var(--anka-ink)]'; return <div className="workspace-card p-4"><p className="text-xs uppercase tracking-wider text-[var(--anka-muted)]">{label}</p><p className={`mt-2 text-3xl font-semibold ${color}`}>{value}</p><p className="mt-1 text-[11px] text-[var(--anka-muted)]">{note}</p></div> }
function MiniMetric({ label, value, danger }) { return <div className="rounded-lg bg-[var(--anka-surface)] p-2"><p className={`font-semibold ${danger ? 'text-[var(--anka-danger)]' : 'text-[var(--anka-ink)]'}`}>{value}</p><p className="text-[10px] text-[var(--anka-muted)]">{label}</p></div> }
function Panel({ title, description, children }) { return <section className="workspace-card p-5"><div className="mb-4"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-[var(--anka-muted)]">{description}</p></div>{children}</section> }
function Empty({ text }) { return <div className="rounded-xl border border-dashed border-[var(--anka-line)] px-4 py-10 text-center text-sm text-[var(--anka-muted)]">{text}</div> }
