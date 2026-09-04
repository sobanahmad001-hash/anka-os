import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import DepartmentConnectors from '../components/DepartmentConnectors.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { delivery } from '../data/delivery.js'
import { TASK_TRANSITIONS } from '../data/deliveryRepository.js'

const ALL_DEPARTMENT_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const canViewDepartment = (membership, departmentId) => Boolean(
  membership && (ALL_DEPARTMENT_ROLES.has(membership.role) || membership.departmentId === departmentId)
)
const isAbortedRequest = (error, signal) => Boolean(signal?.aborted || error?.name === 'AbortError' || error?.cause?.name === 'AbortError')
const isCurrentOrganizationScope = (request, current) => Boolean(
  request?.organizationId &&
  request.organizationId === current?.organizationId &&
  request.revision === current?.revision &&
  !request.signal?.aborted
)

const DEPARTMENT_CONFIG = {
  content: {
    name: 'Content Department',
    shortName: 'Content',
    accent: 'amber',
    accentClass: 'text-amber-400',
    description: 'Research, strategy, messaging, writing, editing, and publishing handoffs connected to each engagement.',
    specialists: [{ name: 'Content Studio', description: 'Authoring, requests, and publishing preparation.', path: '/sphere/content/studio' }],
  },
  design: {
    name: 'Design Department',
    shortName: 'Design',
    accent: 'pink',
    accentClass: 'text-pink-400',
    description: 'Creative briefs, identity systems, concepts, production, review targets, and approved design outputs.',
    specialists: [{ name: 'Design Workshop', description: 'Direction generation, comparison, proofing, and release.', path: '/sphere/design/workshop' }, { name: 'Design Systems', description: 'Released design-system specifications and reuse.', path: '/sphere/design/systems' }],
  },
  marketing: {
    name: 'Marketing Department',
    shortName: 'Marketing',
    accent: 'emerald',
    accentClass: 'text-emerald-400',
    description: 'Campaign planning, channel execution, distribution, optimization, reporting, and cross-department requests.',
    specialists: [{ name: 'Marketing Studio', description: 'Campaign, reporting, planning, and optimization tools.', path: '/sphere/marketing/studio' }, { name: 'Technical SEO', description: 'Page health, inspection, and search tracking.', path: '/sphere/marketing/seo' }],
  },
  development: {
    name: 'Development Department',
    shortName: 'Development',
    accent: 'blue',
    accentClass: 'text-blue-400',
    description: 'WordPress delivery, cross-engagement development queues, QA, launch readiness, maintenance, and technical handoffs.',
    specialists: [],
  },
}

const TABS = [
  ['tasks', 'Project Tasks'],
  ['engagement-work', 'Engagement Work Items'],
  ['services', 'Services & Stages'],
  ['research', 'Research'],
  ['deliverables', 'Deliverables'],
  ['requests', 'Requests'],
  ['milestones', 'Milestones'],
  ['specialists', 'Specialist Queues'],
  ['connectors', 'Connectors'],
]

const INPUT_CLASS = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
const LABEL_CLASS = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500'

function labelize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dateLabel(value) {
  if (!value) return 'No date'
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`))
}

function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-800 text-slate-300',
    amber: 'bg-amber-950 text-amber-300',
    pink: 'bg-pink-950 text-pink-300',
    emerald: 'bg-emerald-950 text-emerald-300',
    blue: 'bg-blue-950 text-blue-300',
    red: 'bg-red-950 text-red-300',
  }
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone] || tones.slate}`}>{children}</span>
}

function Stat({ label, value, note }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{note}</p></div>
}

function Empty({ title, description }) {
  return <div className="rounded-xl border border-dashed border-slate-700 px-5 py-10 text-center"><p className="font-medium text-slate-200">{title}</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{description}</p></div>
}

function Field({ label, children }) {
  return <label><span className={LABEL_CLASS}>{label}</span>{children}</label>
}

const initialTask = { title: '', acceptanceCriteria: '', priority: 'medium', dueDate: '' }
const initialResearch = { title: '', researchType: 'general', question: '', findings: '' }
const initialDeliverable = { title: '', deliverableType: 'general', dueDate: '' }
const initialRequest = { title: '', requestedOutput: '', receivingWorkstreamId: '', priority: 'medium', requiredBy: '' }

export default function DepartmentWorkshop({ departmentId }) {
  const { user } = useAuth()
  const { activeMembership, activeOrganizationId, selectionRequired, loading: organizationLoading, handleOrganizationAccessError, scopeRevision, requestSignal } = useOrganization()
  const currentScope = useRef(null)
  currentScope.current = { organizationId: activeOrganizationId, revision: scopeRevision }
  const config = DEPARTMENT_CONFIG[departmentId]
  const departmentAllowed = canViewDepartment(activeMembership, departmentId)
  const [workspace, setWorkspace] = useState(null)
  const [activeTab, setActiveTab] = useState('tasks')
  const [selectedWorkstreamId, setSelectedWorkstreamId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [taskForm, setTaskForm] = useState(initialTask)
  const [researchForm, setResearchForm] = useState(initialResearch)
  const [deliverableForm, setDeliverableForm] = useState(initialDeliverable)
  const [requestForm, setRequestForm] = useState(initialRequest)

  const loadWorkspace = useCallback(async () => {
    if (organizationLoading || selectionRequired || !activeOrganizationId || !departmentAllowed) return
    const requestedScope = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    setLoading(true)
    setError('')
    try {
      const result = await delivery.getDepartmentWorkspace(departmentId, activeOrganizationId, { signal: requestSignal })
      if (!isCurrentOrganizationScope(requestedScope, currentScope.current)) return
      setWorkspace(result)
      setSelectedWorkstreamId((current) => (
        result.workstreams.some((workstream) => workstream.id === current)
          ? current
          : result.workstreams[0]?.id || ''
      ))
    } catch (loadError) {
      if (!isAbortedRequest(loadError, requestSignal) && isCurrentOrganizationScope(requestedScope, currentScope.current)) {
        handleOrganizationAccessError(loadError, { membershipMismatch: loadError.membershipMismatch })
        setError(loadError.message)
      }
    } finally {
      if (isCurrentOrganizationScope(requestedScope, currentScope.current)) setLoading(false)
    }
  }, [activeOrganizationId, departmentAllowed, departmentId, handleOrganizationAccessError, organizationLoading, requestSignal, scopeRevision, selectionRequired])

  useEffect(() => {
    setWorkspace(null); setActiveTab('tasks'); setSelectedWorkstreamId(''); setLoading(true); setSaving(false); setError('')
    setTaskForm(initialTask); setResearchForm(initialResearch); setDeliverableForm(initialDeliverable); setRequestForm(initialRequest)
    if (!organizationLoading && !selectionRequired && activeOrganizationId && departmentAllowed) loadWorkspace()
    else if (!organizationLoading) setLoading(false)
  }, [activeOrganizationId, departmentAllowed, departmentId, loadWorkspace, organizationLoading, scopeRevision, selectionRequired])

  const selectedWorkstream = workspace?.workstreams.find((workstream) => workstream.id === selectedWorkstreamId)
  const projectId = selectedWorkstream?.project_id
  const projectName = selectedWorkstream?.projects?.name || 'Project'

  const visibleData = useMemo(() => {
    if (!workspace) return { tasks: [], workItems: [], services: [], stages: [], research: [], deliverables: [], requests: [], milestones: [] }
    if (!selectedWorkstreamId) return workspace
    const engagementIds = workspace.engagements.filter((engagement) => engagement.project_id === projectId).map((engagement) => engagement.id)
    return {
      ...workspace,
      tasks: workspace.tasks.filter((item) => item.workstream_id === selectedWorkstreamId),
      workItems: workspace.workItems.filter((item) => item.project_id === projectId && engagementIds.includes(item.engagement_id)),
      services: workspace.services.filter((item) => engagementIds.includes(item.engagement_id)),
      stages: workspace.stages.filter((item) => engagementIds.includes(item.engagement_id)),
      research: workspace.research.filter((item) => item.workstream_id === null || item.workstream_id === selectedWorkstreamId),
      deliverables: workspace.deliverables.filter((item) => item.workstream_id === selectedWorkstreamId),
      requests: workspace.requests.filter((item) => item.requesting_workstream_id === selectedWorkstreamId || item.receiving_workstream_id === selectedWorkstreamId),
      milestones: workspace.milestones.filter((item) => item.project_id === projectId),
    }
  }, [workspace, selectedWorkstreamId, projectId])

  const receivingWorkstreams = (workspace?.relatedWorkstreams || []).filter((workstream) => (
    workstream.project_id === projectId && workstream.id !== selectedWorkstreamId
  ))

  async function runMutation(action) {
    setSaving(true)
    setError('')
    try {
      await action()
      await loadWorkspace()
    } catch (mutationError) {
      setError(mutationError.message)
    } finally {
      setSaving(false)
    }
  }

  function createTask(event) {
    event.preventDefault()
    if (!user?.id || !selectedWorkstream) return
    runMutation(async () => {
      await delivery.createTask({
        projectId,
        workstreamId: selectedWorkstreamId,
        departmentId,
        ...taskForm,
      }, user.id)
      setTaskForm(initialTask)
    })
  }

  function createResearch(event) {
    event.preventDefault()
    if (!user?.id || !selectedWorkstream) return
    runMutation(async () => {
      await delivery.createResearchRecord({
        projectId,
        workstreamId: selectedWorkstreamId,
        ...researchForm,
      }, user.id)
      setResearchForm(initialResearch)
    })
  }

  function createDeliverable(event) {
    event.preventDefault()
    if (!user?.id || !selectedWorkstream) return
    runMutation(async () => {
      await delivery.createDeliverable({
        projectId,
        workstreamId: selectedWorkstreamId,
        ...deliverableForm,
      }, user.id)
      setDeliverableForm(initialDeliverable)
    })
  }

  function createRequest(event) {
    event.preventDefault()
    if (!user?.id || !selectedWorkstream) return
    runMutation(async () => {
      await delivery.createInternalRequest({
        projectId,
        requestingWorkstreamId: selectedWorkstreamId,
        ...requestForm,
      }, user.id)
      setRequestForm(initialRequest)
    })
  }

  if (!config) return null

  if (organizationLoading || loading) {
    return <div className="flex h-full items-center justify-center bg-slate-950"><div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-700 border-t-purple-500" /></div>
  }

  if (!departmentAllowed) return <div className="flex h-full items-center justify-center bg-slate-950 p-6 text-center"><div><h1 className="text-xl font-semibold text-white">Department workspace unavailable</h1><p className="mt-2 text-sm text-slate-400">Your active team membership does not include this department.</p></div></div>

  const projectTaskOverdue = workspace.tasks.filter((task) => task.due_date && !['done', 'cancelled'].includes(task.status) && new Date(task.due_date) < new Date()).length
  const workItemOverdue = workspace.workItems.filter((item) => item.due_date && item.status !== 'done' && new Date(item.due_date) < new Date()).length
  const incoming = workspace.requests.filter((request) => workspace.workstreams.some((workstream) => workstream.id === request.receiving_workstream_id) && !['completed', 'declined', 'withdrawn'].includes(request.status)).length

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${config.accentClass}`}>Department Workspace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{config.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{config.description}</p>
          </div>
          <Link to="/sphere/engagements" className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-purple-600 hover:text-white">Engagements</Link>
        </div>

        {error && <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Stat label="Active workstreams" value={workspace.workstreams.length} note="Across current engagements" />
          <Stat label="Project Tasks" value={workspace.tasks.filter((task) => !['done', 'cancelled'].includes(task.status)).length} note={`${projectTaskOverdue} overdue`} />
          <Stat label="Engagement Work Items" value={workspace.workItems.filter((item) => item.status !== 'done').length} note={`${workItemOverdue} overdue`} />
          <Stat label="Service commitments" value={workspace.services.length} note="Planned and active scope" />
          <Stat label="Active stages" value={workspace.stages.filter((stage) => !['completed', 'cancelled'].includes(stage.status)).length} note="Accountable journey stages" />
          <Stat label="Incoming requests" value={incoming} note="Cross-department handoffs" />
        </div>

        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-slate-800">
          {TABS.map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${activeTab === id ? 'border-purple-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>{label}</button>)}
        </div>

        {activeTab === 'connectors' ? (
          <div className="mt-6"><DepartmentConnectors departmentId={departmentId} departmentName={config.shortName} /></div>
        ) : activeTab === 'specialists' ? (
          <div className="mt-6"><SpecialistQueues config={config} /></div>
        ) : workspace.workstreams.length === 0 ? (
          <div className="mt-7"><Empty title={`No active ${config.shortName} workstreams`} description="Create an engagement and activate this department's services. The work will appear here automatically. Department connectors remain available from the Connectors tab." /></div>
        ) : (
          <>
            <div className="mt-7 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <label className="grid gap-2 md:grid-cols-[190px_1fr] md:items-center">
                <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-500">Current workstream</span>
                <select className={INPUT_CLASS} value={selectedWorkstreamId} onChange={(event) => setSelectedWorkstreamId(event.target.value)}>
                  {workspace.workstreams.map((workstream) => <option key={workstream.id} value={workstream.id}>{workstream.projects?.name || workstream.name} · {workstream.name}</option>)}
                </select>
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Badge tone={config.accent}>{config.shortName}</Badge>
                <span>{projectName}</span>
                <span>·</span>
                <span>{labelize(selectedWorkstream?.projects?.engagement_type)}</span>
                <span>·</span>
                <span>Due {dateLabel(selectedWorkstream?.projects?.due_date)}</span>
              </div>
            </div>

            <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_350px]">
              <WorkspaceList activeTab={activeTab} data={visibleData} workspace={workspace} selectedWorkstreamId={selectedWorkstreamId} onTransition={(taskId, status) => runMutation(() => delivery.transitionTask(taskId, status))} saving={saving} />
              <ActionPanel activeTab={activeTab} saving={saving} taskForm={taskForm} setTaskForm={setTaskForm} researchForm={researchForm} setResearchForm={setResearchForm} deliverableForm={deliverableForm} setDeliverableForm={setDeliverableForm} requestForm={requestForm} setRequestForm={setRequestForm} receivingWorkstreams={receivingWorkstreams} onCreateTask={createTask} onCreateResearch={createResearch} onCreateDeliverable={createDeliverable} onCreateRequest={createRequest} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function WorkspaceList({ activeTab, data, workspace, selectedWorkstreamId, onTransition, saving }) {
  const projectNames = new Map(workspace.workstreams.map((workstream) => [workstream.project_id, workstream.projects?.name || 'Project']))
  const workstreamNames = new Map(workspace.relatedWorkstreams.map((workstream) => [workstream.id, workstream.name]))

  if (activeTab === 'tasks') {
    return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><Header title="Project Tasks" description="Canonical project-level tasks owned by this department workstream." />{data.tasks.length === 0 ? <Empty title="No Project Tasks in this workstream" description="Add the first task using the action panel." /> : <div className="space-y-3">{data.tasks.map((task) => <div key={task.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-white">{task.title}</p><p className="mt-1 text-xs text-slate-500">{projectNames.get(task.project_id)} · Due {dateLabel(task.due_date)}</p></div><Badge tone={task.status === 'blocked' ? 'red' : task.status === 'done' ? 'emerald' : 'blue'}>{labelize(task.status)}</Badge></div>{task.acceptance_criteria && <p className="mt-3 text-sm leading-6 text-slate-400">Acceptance: {task.acceptance_criteria}</p>}<div className="mt-4 flex flex-wrap gap-2">{(TASK_TRANSITIONS[task.status] || []).map((status) => <button disabled={saving} type="button" key={status} onClick={() => onTransition(task.id, status)} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-purple-600 hover:text-white disabled:opacity-50">Move to {labelize(status)}</button>)}</div></div>)}</div>}</section>
  }

  if (activeTab === 'engagement-work') return <ListSection title="Engagement Work Items" description="Engagement-level commitments remain separate from Project Tasks and are managed in their owning engagement." emptyTitle="No Engagement Work Items">{data.workItems.map((item) => <Record key={item.id} title={item.title} meta={`${item.engagements?.name || 'Engagement'} · Due ${dateLabel(item.due_date)}`} badge={item.status}><p>{item.description || 'No description provided.'}</p></Record>)}</ListSection>

  if (activeTab === 'services') return <section className="space-y-5"><ListSection title="Service commitments" description="Existing services whose catalogue ownership belongs to this department." emptyTitle="No service commitments">{data.services.map((item) => <Record key={item.id} title={item.service_catalog?.name || 'Service'} meta={`Target ${dateLabel(item.target_date)}`} badge={item.status}><p>{item.service_catalog?.slug || 'Canonical service'}</p></Record>)}</ListSection><ListSection title="Accountable stages" description="Existing engagement stages assigned to this department." emptyTitle="No accountable stages">{data.stages.map((item) => <Record key={item.id} title={item.name} meta={`${labelize(item.stage_kind)} · Position ${item.position + 1}`} badge={item.status}><p>Journey stage for the selected engagement.</p></Record>)}</ListSection></section>

  if (activeTab === 'research') {
    return <ListSection title="Research" description="Shared project evidence and department-specific research." emptyTitle="No research records">{data.research.map((item) => <Record key={item.id} title={item.title} meta={`${labelize(item.research_type)} · ${item.workstream_id ? 'Department-owned' : 'Shared project research'}`} badge={item.status}><p>{item.findings || item.question || 'Research record created; findings pending.'}</p></Record>)}</ListSection>
  }

  if (activeTab === 'deliverables') {
    return <ListSection title="Deliverables" description="Outputs owned by this workstream; all remain internal until the quality flow releases an exact version." emptyTitle="No deliverables">{data.deliverables.map((item) => <Record key={item.id} title={item.title} meta={`${labelize(item.deliverable_type)} · Due ${dateLabel(item.due_date)}`} badge={item.status}><p>{item.deliverable_versions?.length || 0} versions recorded</p></Record>)}</ListSection>
  }

  if (activeTab === 'requests') {
    return <ListSection title="Requests & handoffs" description="Incoming and outgoing work contracts for this workstream." emptyTitle="No requests">{data.requests.map((item) => { const incoming = item.receiving_workstream_id === selectedWorkstreamId; return <Record key={item.id} title={item.title} meta={`${incoming ? 'Incoming from' : 'Outgoing to'} ${workstreamNames.get(incoming ? item.requesting_workstream_id : item.receiving_workstream_id) || 'another workstream'}`} badge={item.status}><p>{item.requested_output}</p></Record> })}</ListSection>
  }

  return <ListSection title="Project milestones" description="Shared engagement checkpoints relevant to this department's active project." emptyTitle="No milestones">{data.milestones.map((item) => <Record key={item.id} title={item.name} meta={`${projectNames.get(item.project_id)} · ${dateLabel(item.target_date)}`} badge={item.status}><p>{item.description || 'No milestone description.'}</p></Record>)}</ListSection>
}

function Header({ title, description }) {
  return <div className="mb-5"><h2 className="font-semibold text-white">{title}</h2><p className="mt-1 text-sm text-slate-400">{description}</p></div>
}

function ListSection({ title, description, emptyTitle, children }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><Header title={title} description={description} />{hasChildren ? <div className="space-y-3">{children}</div> : <Empty title={emptyTitle} description="Create the first record from the action panel or the project workspace." />}</section>
}

function Record({ title, meta, badge, children }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-white">{title}</p><p className="mt-1 text-xs text-slate-500">{meta}</p></div><Badge>{labelize(badge)}</Badge></div><div className="mt-3 text-sm leading-6 text-slate-400">{children}</div></div>
}

function ActionPanel(props) {
  const { activeTab, saving } = props
  if (activeTab === 'milestones') return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><Header title="Engagement-level control" description="Milestones span departments. Manage them from the engagement workspace to keep one accountable journey." /><Link to="/sphere/engagements" className="block rounded-xl bg-purple-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-purple-500">Open engagement workspace</Link></section>
  if (activeTab === 'engagement-work' || activeTab === 'services') return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><Header title="Existing authority retained" description="This coordination view is read-only for engagement services, stages, and Work Items. Use the owning engagement or specialist workspace for supported actions." /><Link to="/sphere/engagements" className="block rounded-xl bg-purple-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-purple-500">Open engagement workspace</Link></section>
  if (activeTab === 'tasks') return <FormShell title="Add task" description="Creates internal department work." onSubmit={props.onCreateTask} saving={saving}><Field label="Task title"><input required className={INPUT_CLASS} value={props.taskForm.title} onChange={(event) => props.setTaskForm({ ...props.taskForm, title: event.target.value })} /></Field><Field label="Acceptance criteria"><textarea className={`${INPUT_CLASS} min-h-24`} value={props.taskForm.acceptanceCriteria} onChange={(event) => props.setTaskForm({ ...props.taskForm, acceptanceCriteria: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Priority"><select className={INPUT_CLASS} value={props.taskForm.priority} onChange={(event) => props.setTaskForm({ ...props.taskForm, priority: event.target.value })}><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></Field><Field label="Due"><input type="date" className={INPUT_CLASS} value={props.taskForm.dueDate} onChange={(event) => props.setTaskForm({ ...props.taskForm, dueDate: event.target.value })} /></Field></div></FormShell>
  if (activeTab === 'research') return <FormShell title="Add research" description="Evidence remains shared with the project." onSubmit={props.onCreateResearch} saving={saving}><Field label="Title"><input required className={INPUT_CLASS} value={props.researchForm.title} onChange={(event) => props.setResearchForm({ ...props.researchForm, title: event.target.value })} /></Field><Field label="Type"><select className={INPUT_CLASS} value={props.researchForm.researchType} onChange={(event) => props.setResearchForm({ ...props.researchForm, researchType: event.target.value })}><option>general</option><option>market</option><option>competitor</option><option>audience</option><option>keyword</option><option>visual</option><option>technical</option></select></Field><Field label="Question"><textarea className={`${INPUT_CLASS} min-h-20`} value={props.researchForm.question} onChange={(event) => props.setResearchForm({ ...props.researchForm, question: event.target.value })} /></Field><Field label="Findings"><textarea className={`${INPUT_CLASS} min-h-24`} value={props.researchForm.findings} onChange={(event) => props.setResearchForm({ ...props.researchForm, findings: event.target.value })} /></Field></FormShell>
  if (activeTab === 'deliverables') return <FormShell title="Add deliverable" description="Creates the output identity; version review comes next." onSubmit={props.onCreateDeliverable} saving={saving}><Field label="Title"><input required className={INPUT_CLASS} value={props.deliverableForm.title} onChange={(event) => props.setDeliverableForm({ ...props.deliverableForm, title: event.target.value })} /></Field><Field label="Type"><input className={INPUT_CLASS} value={props.deliverableForm.deliverableType} onChange={(event) => props.setDeliverableForm({ ...props.deliverableForm, deliverableType: event.target.value })} /></Field><Field label="Due"><input type="date" className={INPUT_CLASS} value={props.deliverableForm.dueDate} onChange={(event) => props.setDeliverableForm({ ...props.deliverableForm, dueDate: event.target.value })} /></Field></FormShell>
  return <FormShell title="Create request" description="Send a structured output request to another workstream." onSubmit={props.onCreateRequest} saving={saving}><Field label="Title"><input required className={INPUT_CLASS} value={props.requestForm.title} onChange={(event) => props.setRequestForm({ ...props.requestForm, title: event.target.value })} /></Field><Field label="Receiving workstream"><select required className={INPUT_CLASS} value={props.requestForm.receivingWorkstreamId} onChange={(event) => props.setRequestForm({ ...props.requestForm, receivingWorkstreamId: event.target.value })}><option value="">Select receiving team</option>{props.receivingWorkstreams.map((workstream) => <option key={workstream.id} value={workstream.id}>{workstream.name}</option>)}</select></Field><Field label="Requested output"><textarea required className={`${INPUT_CLASS} min-h-24`} value={props.requestForm.requestedOutput} onChange={(event) => props.setRequestForm({ ...props.requestForm, requestedOutput: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Priority"><select className={INPUT_CLASS} value={props.requestForm.priority} onChange={(event) => props.setRequestForm({ ...props.requestForm, priority: event.target.value })}><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></Field><Field label="Required by"><input type="date" className={INPUT_CLASS} value={props.requestForm.requiredBy} onChange={(event) => props.setRequestForm({ ...props.requestForm, requiredBy: event.target.value })} /></Field></div></FormShell>
}

function SpecialistQueues({ config }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><Header title="Specialist queues" description="Department coordination stays here; specialist production behavior remains in its existing Studio or Workshop." />{config.specialists.length ? <div className="grid gap-3 md:grid-cols-2">{config.specialists.map((item) => <Link key={item.path} to={item.path} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 hover:border-purple-600"><p className="font-medium text-white">{item.name}</p><p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p></Link>)}</div> : <Empty title="No separate specialist queue" description="Development coordination and its existing supported actions remain on this workspace." />}</section>
}

function FormShell({ title, description, onSubmit, saving, children }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><Header title={title} description={description} /><form onSubmit={onSubmit} className="space-y-4">{children}<button disabled={saving} className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50">{saving ? 'Saving…' : title}</button></form></section>
}

export { DEPARTMENT_CONFIG }
