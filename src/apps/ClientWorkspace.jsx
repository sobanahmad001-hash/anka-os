import { useCallback, useEffect, useRef, useState } from 'react'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clientWorkspace } from '../data/clientWorkspace'
import ClientPeopleAccess from './ClientPeopleAccess.jsx'

const INVITATION_ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const TABS = [['overview', 'Overview'], ['projects', 'Projects'], ['people', 'People & Access'], ['due', 'Dated Work'], ['requests', 'Requests'], ['delivery', 'Deliverables & Releases']]
const label = (value) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown'
const date = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString() : 'No date'

export default function ClientWorkspace() {
  const { clientId } = useParams()
  const navigate = useNavigate()

  const { activeOrganizationId, activeMembership, selectionRequired, loading: organizationLoading, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const currentRequest = useRef(null)
  currentRequest.current = { organizationId: activeOrganizationId, revision: scopeRevision, recordId: clientId }
  const requestGeneration = useRef(0)
  const [workspace, setWorkspace] = useState(null)
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
    try {
      const result = await clientWorkspace.get(clientId, activeOrganizationId, { signal: requestSignal })
      if (isCurrent()) setWorkspace(result)
    } catch (cause) {
      if (isCurrent() && cause.name !== 'AbortError' && cause.cause?.name !== 'AbortError') {
        handleOrganizationAccessError(cause, { membershipMismatch: cause.membershipMismatch })
        setError(cause.message || 'Unable to load this workspace.')
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [activeOrganizationId, handleOrganizationAccessError, organizationLoading, requestSignal, scopeRevision, selectionRequired, clientId])

  useEffect(() => {
    setWorkspace(null)
    setTab('overview')
    setError('')
    setLoading(true)
    load()
    return () => { requestGeneration.current += 1 }
  }, [load])

  if (loading && !workspace) return <State>Loading client workspace…</State>
  if (!workspace) return <State error={error} action={() => navigate('/sphere/clients')}>Return to Clients</State>
  const { client, summary } = workspace
  return <main className="workspace-page"><div className="workspace-container">
    <DirectoryNavigation />
    <Link to="/sphere/clients" className="mt-5 inline-block text-sm font-medium text-[var(--anka-muted)] hover:text-[var(--anka-ink)] focus:ring-2 focus:ring-[var(--anka-focus)]">← Client Work directory</Link>
    <header className="mt-5 flex flex-wrap items-start justify-between gap-5"><div><p className="workspace-eyebrow">Client Workspace</p><h1 className="workspace-title">{client.company || client.name}</h1><p className="mt-2 text-sm text-[var(--anka-muted)]">{client.name}{client.industry ? ` · ${client.industry}` : ''} · Owner: {client.owner.name}</p><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--anka-muted)]">{client.notes || 'Canonical client context across projects, people, dated work, requests, deliverables, and releases.'}</p></div><div className="flex items-center gap-2"><button type="button" onClick={load} disabled={loading} className="workspace-button disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button><Status value={client.status} /></div></header>
    {error && <div role="alert" className="mt-5 rounded-xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] p-4 text-sm text-[var(--anka-danger)]">{error}</div>}
    <section aria-label="Client workspace summary" className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><Metric title="Active projects" value={summary.activeProjects} /><Metric title="One-time" value={summary.oneTimeProjects} /><Metric title="Retainers" value={summary.retainers} /><Metric title="Project Tasks" value={summary.openProjectTasks} /><Metric title="Engagement Work Items" value={summary.openEngagementWorkItems} /><Metric title="Open requests" value={summary.openRequests} /><Metric title="Releases" value={summary.releases} /></section>
    <nav aria-label="Client workspace sections" className="mt-7 flex gap-1 overflow-x-auto border-b border-[var(--anka-line)]">{TABS.map(([id, title]) => <button type="button" key={id} onClick={() => setTab(id)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === id ? 'border-[var(--anka-violet)] text-[var(--anka-ink)]' : 'border-transparent text-[var(--anka-muted)] hover:text-[var(--anka-ink)]'}`}>{title}</button>)}</nav>
    <div className="mt-6">{tab === 'overview' && <Overview workspace={workspace} navigate={navigate} />}{tab === 'projects' && <Projects rows={workspace.projects} navigate={navigate} />}{tab === 'people' && <ClientPeopleAccess key={clientId + ':' + activeOrganizationId} rows={workspace.people} projects={workspace.projects} clientId={clientId} organizationId={activeOrganizationId} canInvite={activeOrganizationId === INVITATION_ORGANIZATION_ID && ['system_owner', 'operations_admin', 'executive', 'project_owner'].includes(activeMembership?.role)} onInvited={load} />}{tab === 'due' && <DueWork rows={workspace.dueWork} />}{tab === 'requests' && <Requests projects={workspace.projects} />}{tab === 'delivery' && <Delivery workspace={workspace} />}</div>
  </div></main>
}

function Overview({ workspace, navigate }) {
  return <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Panel title="Client context"><Record title={workspace.agencyClient?.legal_name || workspace.client.company || workspace.client.name} note={[workspace.agencyClient?.primary_email || workspace.client.email, workspace.agencyClient?.website_url].filter(Boolean).join(' · ') || 'No additional relationship details recorded.'} /><div className="mt-3 flex flex-wrap gap-2">{workspace.brands.map((brand) => <Pill key={brand.id}>{brand.name}{brand.is_default ? ' · Default' : ''}</Pill>)}{!workspace.brands.length && <span className="text-sm text-[var(--anka-muted)]">No agency-client extension or brands recorded.</span>}</div></Panel><Panel title="Current portfolio"><RecordList rows={workspace.projects.filter((row) => !['completed', 'cancelled', 'archived'].includes(row.status))} empty="No active client projects." render={(project) => <button type="button" key={project.id} onClick={() => navigate(`/sphere/workspace/projects/${project.id}`)} className="w-full text-left"><Record title={project.name} note={`${label(project.engagement_type)} · ${project.brandName || 'No brand'} · ${project.owner.name}`} status={project.status} /></button>} /></Panel></div>
}

function Projects({ rows, navigate }) {
  return <Panel title="Projects and retainers" description="One-time projects and retainers share the canonical project model. No recurring commitment schedule is inferred here."><RecordList rows={rows} empty="No projects belong to this client." render={(project) => <button type="button" key={project.id} onClick={() => navigate(`/sphere/workspace/projects/${project.id}`)} className="w-full text-left"><Record title={project.name} note={`${label(project.engagement_type)} · ${project.brandName || 'No brand'} · ${project.counts.openProjectTasks} Project Tasks · ${project.counts.openEngagementWorkItems} Engagement Work Items`} status={project.status} /></button>} /></Panel>
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

function DirectoryNavigation() {
  return <nav aria-label="Work directories" className="flex flex-wrap gap-2"><Link to="/sphere/portfolio" className="rounded-xl border border-[var(--anka-line)] px-3 py-2 text-sm font-medium text-[var(--anka-muted)] hover:text-[var(--anka-ink)] focus:ring-2 focus:ring-[var(--anka-focus)]">Company work</Link><Link to="/sphere/clients" aria-current="page" className="rounded-xl border border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] px-3 py-2 text-sm font-medium text-[var(--anka-violet)] focus:ring-2 focus:ring-[var(--anka-focus)]">Client Work</Link><Link to="/sphere/internal" className="rounded-xl border border-[var(--anka-line)] px-3 py-2 text-sm font-medium text-[var(--anka-muted)] hover:text-[var(--anka-ink)] focus:ring-2 focus:ring-[var(--anka-focus)]">Internal Work</Link></nav>
}
function Panel({ title, description, children }) { return <section className="workspace-card p-5"><h2 className="font-semibold">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-[var(--anka-muted)]">{description}</p>}<div className="mt-4">{children}</div></section> }
function RecordList({ rows, empty, render }) { return rows.length ? <div className="space-y-3">{rows.map(render)}</div> : <p className="text-sm text-[var(--anka-muted)]">{empty}</p> }
function Record({ title, note, status, attention = false }) { return <div className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${attention ? 'border-[var(--anka-warning)] bg-[var(--anka-warning-soft)]' : 'border-[var(--anka-line)] bg-[var(--anka-surface-raised)]'}`}><div><p className="text-sm font-medium text-[var(--anka-ink)]">{title}</p><p className="mt-1 text-xs leading-5 text-[var(--anka-muted)]">{note}</p></div>{status && <Status value={status} />}</div> }
function Metric({ title, value }) { return <div className="workspace-card p-4"><p className="text-xs text-[var(--anka-muted)]">{title}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div> }
function Status({ value }) { return <span className="shrink-0 rounded-full border border-[var(--anka-line)] bg-[var(--anka-surface)] px-2 py-1 text-[11px] text-[var(--anka-ink)]">{label(value)}</span> }
function Pill({ children }) { return <span className="rounded-full border border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] px-2 py-1 text-[11px] text-[var(--anka-violet)]">{children}</span> }
function State({ children, error, action }) { return <main className="flex min-h-full items-center justify-center bg-[var(--anka-canvas)] p-6 text-center text-[var(--anka-muted)]"><div><p className={error ? 'text-[var(--anka-danger)]' : ''}>{error || children}</p>{action && <button type="button" onClick={action} className="mt-4 workspace-button text-[var(--anka-ink)]">Return to Clients</button>}</div></main> }
