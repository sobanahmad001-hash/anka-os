import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { clientWorkspace } from '../data/clientWorkspace'

const TABS = [['overview', 'Overview'], ['projects', 'Projects'], ['people', 'People & Access'], ['due', 'Dated Work'], ['requests', 'Requests'], ['delivery', 'Deliverables & Releases']]
const label = (value) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown'
const date = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString() : 'No date'

export default function ClientWorkspace() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState(null)
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setWorkspace(await clientWorkspace.get(clientId)) } catch (cause) { setError(cause.message || 'Unable to load this client workspace.') } finally { setLoading(false) }
  }, [clientId])
  useEffect(() => { load() }, [load])
  if (loading && !workspace) return <State>Loading client workspace…</State>
  if (!workspace) return <State error={error} action={() => navigate('/sphere/clients')}>Return to Clients</State>
  const { client, summary } = workspace
  return <main className="min-h-full bg-[#090c13] p-4 text-slate-100 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1500px]">
    <button type="button" onClick={() => navigate('/sphere/clients')} className="text-sm font-medium text-slate-500 hover:text-white">← Clients & Brands</button>
    <header className="mt-5 flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Client Workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{client.company || client.name}</h1><p className="mt-2 text-sm text-slate-400">{client.name}{client.industry ? ` · ${client.industry}` : ''} · Owner: {client.owner.name}</p><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">{client.notes || 'Canonical client context across projects, people, dated work, requests, deliverables, and releases.'}</p></div><div className="flex items-center gap-2"><button type="button" onClick={load} disabled={loading} className="rounded-xl border border-white/10 px-4 py-2 text-sm disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button><Status value={client.status} /></div></header>
    {error && <div role="alert" className="mt-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
    <section aria-label="Client workspace summary" className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><Metric title="Active projects" value={summary.activeProjects} /><Metric title="One-time" value={summary.oneTimeProjects} /><Metric title="Retainers" value={summary.retainers} /><Metric title="Project Tasks" value={summary.openProjectTasks} /><Metric title="Engagement Work Items" value={summary.openEngagementWorkItems} /><Metric title="Open requests" value={summary.openRequests} /><Metric title="Releases" value={summary.releases} /></section>
    <nav aria-label="Client workspace sections" className="mt-7 flex gap-1 overflow-x-auto border-b border-white/[0.08]">{TABS.map(([id, title]) => <button type="button" key={id} onClick={() => setTab(id)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === id ? 'border-violet-400 text-white' : 'border-transparent text-slate-500 hover:text-slate-200'}`}>{title}</button>)}</nav>
    <div className="mt-6">{tab === 'overview' && <Overview workspace={workspace} navigate={navigate} />}{tab === 'projects' && <Projects rows={workspace.projects} navigate={navigate} />}{tab === 'people' && <People rows={workspace.people} />}{tab === 'due' && <DueWork rows={workspace.dueWork} />}{tab === 'requests' && <Requests projects={workspace.projects} />}{tab === 'delivery' && <Delivery workspace={workspace} />}</div>
  </div></main>
}

function Overview({ workspace, navigate }) {
  return <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Panel title="Client context"><Record title={workspace.agencyClient?.legal_name || workspace.client.company || workspace.client.name} note={[workspace.agencyClient?.primary_email || workspace.client.email, workspace.agencyClient?.website_url].filter(Boolean).join(' · ') || 'No additional relationship details recorded.'} /><div className="mt-3 flex flex-wrap gap-2">{workspace.brands.map((brand) => <Pill key={brand.id}>{brand.name}{brand.is_default ? ' · Default' : ''}</Pill>)}{!workspace.brands.length && <span className="text-sm text-slate-500">No agency-client extension or brands recorded.</span>}</div></Panel><Panel title="Current portfolio"><RecordList rows={workspace.projects.filter((row) => !['completed', 'cancelled', 'archived'].includes(row.status))} empty="No active client projects." render={(project) => <button type="button" key={project.id} onClick={() => navigate(`/sphere/workspace/projects/${project.id}`)} className="w-full text-left"><Record title={project.name} note={`${label(project.engagement_type)} · ${project.brandName || 'No brand'} · ${project.owner.name}`} status={project.status} /></button>} /></Panel></div>
}

function Projects({ rows, navigate }) {
  return <Panel title="Projects and retainers" description="One-time projects and retainers share the canonical project model. No recurring commitment schedule is inferred here."><RecordList rows={rows} empty="No projects belong to this client." render={(project) => <button type="button" key={project.id} onClick={() => navigate(`/sphere/workspace/projects/${project.id}`)} className="w-full text-left"><Record title={project.name} note={`${label(project.engagement_type)} · ${project.brandName || 'No brand'} · ${project.counts.openProjectTasks} Project Tasks · ${project.counts.openEngagementWorkItems} Engagement Work Items`} status={project.status} /></button>} /></Panel>
}

function People({ rows }) {
  return <Panel title="People & project access" description="Read-only visibility of existing contact and project-access records."><RecordList rows={rows} empty="No client contacts recorded." render={(contact) => <div key={contact.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{contact.full_name}</p><p className="mt-1 text-xs text-slate-500">{contact.email || 'No email'} · {label(contact.portal_role)}</p></div><Status value={contact.status} /></div><div className="mt-3 flex flex-wrap gap-2">{contact.access.length ? contact.access.map((grant) => <Pill key={grant.id}>{grant.projectName} · {label(grant.access_role)} · {label(grant.status)}</Pill>) : <span className="text-xs text-slate-600">No project access grants.</span>}</div></div>} /></Panel>
}

function DueWork({ rows }) {
  return <Panel title="Dated work" description="Project Tasks and Engagement Work Items remain explicitly labelled and are never merged into one count."><RecordList rows={rows} empty="No open dated records." render={(item) => <Record key={`${item.source}-${item.id}`} title={item.title} note={`${item.source} · ${item.projectName} · ${item.owner.name} · ${date(item.date)}`} status={item.status} attention={item.overdue} />} /></Panel>
}

function Requests({ projects }) {
  const rows = projects.flatMap((project) => project.requests.map((request) => ({ ...request, projectName: project.name })))
  return <Panel title="Existing requests" description="Communication context is limited to existing request records; this workspace creates no new message store."><RecordList rows={rows} empty="No requests recorded." render={(item) => <Record key={item.id} title={item.title} note={`${item.projectName} · ${label(item.request_origin)} · Required ${date(item.required_by)}`} status={item.status} />} /></Panel>
}

function Delivery({ workspace }) {
  return <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Panel title="Deliverables"><RecordList rows={workspace.deliverables} empty="No deliverables recorded." render={(item) => <Record key={item.id} title={item.title} note={`${item.projectName} · ${item.versions.length} version${item.versions.length === 1 ? '' : 's'} · Due ${date(item.due_date)}`} status={item.status} />} /></Panel><Panel title="Released client items"><RecordList rows={workspace.releases} empty="No client releases recorded." render={(item) => <Record key={item.id} title={item.title} note={`${item.projectName} · ${label(item.item_type)} · Released ${date(item.released_at)}`} status={item.status} />} /></Panel></div>
}

function Panel({ title, description, children }) { return <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><h2 className="font-semibold">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}<div className="mt-4">{children}</div></section> }
function RecordList({ rows, empty, render }) { return rows.length ? <div className="space-y-3">{rows.map(render)}</div> : <p className="text-sm text-slate-500">{empty}</p> }
function Record({ title, note, status, attention = false }) { return <div className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${attention ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-black/10'}`}><div><p className="text-sm font-medium text-white">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{note}</p></div>{status && <Status value={status} />}</div> }
function Metric({ title, value }) { return <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs text-slate-500">{title}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div> }
function Status({ value }) { return <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300">{label(value)}</span> }
function Pill({ children }) { return <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-200">{children}</span> }
function State({ children, error, action }) { return <main className="flex min-h-full items-center justify-center bg-[#090c13] p-6 text-center text-slate-400"><div><p className={error ? 'text-rose-300' : ''}>{error || children}</p>{action && <button type="button" onClick={action} className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-white">Return to Clients</button>}</div></main> }
