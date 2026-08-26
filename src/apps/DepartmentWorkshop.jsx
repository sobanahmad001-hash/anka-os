import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import DepartmentConnectors from '../components/DepartmentConnectors.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { delivery } from '../data/delivery.js'
import { TASK_TRANSITIONS } from '../data/deliveryRepository.js'

const DEPARTMENT_CONFIG = {
  content: {
    name: 'Content Workshop',
    shortName: 'Content',
    accent: 'amber',
    accentClass: 'text-amber-400',
    description: 'Research, strategy, messaging, writing, editing, and publishing handoffs connected to each engagement.',
  },
  design: {
    name: 'Design Workshop',
    shortName: 'Design',
    accent: 'pink',
    accentClass: 'text-pink-400',
    description: 'Creative briefs, identity systems, concepts, production, review targets, and approved design outputs.',
  },
  marketing: {
    name: 'Marketing Workshop',
    shortName: 'Marketing',
    accent: 'emerald',
    accentClass: 'text-emerald-400',
    description: 'Campaign planning, channel execution, distribution, optimization, reporting, and cross-department requests.',
  },
  development: {
    name: 'Development Studio',
    shortName: 'Development',
    accent: 'blue',
    accentClass: 'text-blue-400',
    description: 'WordPress delivery, cross-engagement development queues, QA, launch readiness, maintenance, and technical handoffs.',
  },
}

const TABS = [
  ['tasks', 'Work Queue'],
  ['research', 'Research'],
  ['deliverables', 'Deliverables'],
  ['requests', 'Requests'],
  ['milestones', 'Milestones'],
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
  const config = DEPARTMENT_CONFIG[departmentId]
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

  useEffect(() => {
    loadWorkspace()
  }, [departmentId])

  async function loadWorkspace() {
    setLoading(true)
    setError('')
    try {
      const result = await delivery.getDepartmentWorkspace(departmentId)
      setWorkspace(result)
      setSelectedWorkstreamId((current) => (
        result.workstreams.some((workstream) => workstream.id === current)
          ? current
          : result.workstreams[0]?.id || ''
      ))
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  const selectedWorkstream = workspace?.workstreams.find((workstream) => workstream.id === selectedWorkstreamId)
  const projectId = selectedWorkstream?.project_id
  const projectName = selectedWorkstream?.projects?.name || 'Project'

  const visibleData = useMemo(() => {
    if (!workspace) return { tasks: [], research: [], deliverables: [], requests: [], milestones: [] }
    if (!selectedWorkstreamId) return workspace
    return {
      ...workspace,
      tasks: workspace.tasks.filter((item) => item.workstream_id === selectedWorkstreamId),
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

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-slate-950"><div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-700 border-t-purple-500" /></div>
  }

  const overdue = workspace.tasks.filter((task) => task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()).length
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
          <Link to="/sphere/projects" className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-purple-600 hover:text-white">Projects & Retainers</Link>
        </div>

        {error && <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Active workstreams" value={workspace.workstreams.length} note="Across current engagements" />
          <Stat label="Open tasks" value={workspace.tasks.filter((task) => !['done', 'cancelled'].includes(task.status)).length} note="Department execution queue" />
          <Stat label="Overdue" value={overdue} note="Needs scheduling attention" />
          <Stat label="Incoming requests" value={incoming} note="Cross-department handoffs" />
        </div>

        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-slate-800">
          {TABS.map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${activeTab === id ? 'border-purple-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>{label}</button>)}
        </div>

        {activeTab === 'connectors' ? (
          <div className="mt-6"><DepartmentConnectors departmentId={departmentId} departmentName={config.shortName} /></div>
        ) : workspace.workstreams.length === 0 ? (
          <div className="mt-7"><Empty title={`No active ${config.shortName} workstreams`} description="Create or update an engagement in Projects & Retainers and activate this department. The work will appear here automatically. Department connectors remain available from the Connectors tab." /></div>
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
    return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><Header title="Work queue" description="Only tasks owned by this department workstream." />{data.tasks.length === 0 ? <Empty title="No tasks in this workstream" description="Add the first task using the action panel." /> : <div className="space-y-3">{data.tasks.map((task) => <div key={task.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-white">{task.title}</p><p className="mt-1 text-xs text-slate-500">{projectNames.get(task.project_id)} · Due {dateLabel(task.due_date)}</p></div><Badge tone={task.status === 'blocked' ? 'red' : task.status === 'done' ? 'emerald' : 'blue'}>{labelize(task.status)}</Badge></div>{task.acceptance_criteria && <p className="mt-3 text-sm leading-6 text-slate-400">Acceptance: {task.acceptance_criteria}</p>}<div className="mt-4 flex flex-wrap gap-2">{(TASK_TRANSITIONS[task.status] || []).map((status) => <button disabled={saving} type="button" key={status} onClick={() => onTransition(task.id, status)} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-purple-600 hover:text-white disabled:opacity-50">Move to {labelize(status)}</button>)}</div></div>)}</div>}</section>
  }

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
  if (activeTab === 'milestones') return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><Header title="Engagement-level control" description="Milestones span departments. Create and manage them from Projects & Retainers to keep one accountable project timeline." /><Link to="/sphere/projects" className="block rounded-xl bg-purple-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-purple-500">Open project workspace</Link></section>
  if (activeTab === 'tasks') return <FormShell title="Add task" description="Creates internal department work." onSubmit={props.onCreateTask} saving={saving}><Field label="Task title"><input required className={INPUT_CLASS} value={props.taskForm.title} onChange={(event) => props.setTaskForm({ ...props.taskForm, title: event.target.value })} /></Field><Field label="Acceptance criteria"><textarea className={`${INPUT_CLASS} min-h-24`} value={props.taskForm.acceptanceCriteria} onChange={(event) => props.setTaskForm({ ...props.taskForm, acceptanceCriteria: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Priority"><select className={INPUT_CLASS} value={props.taskForm.priority} onChange={(event) => props.setTaskForm({ ...props.taskForm, priority: event.target.value })}><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></Field><Field label="Due"><input type="date" className={INPUT_CLASS} value={props.taskForm.dueDate} onChange={(event) => props.setTaskForm({ ...props.taskForm, dueDate: event.target.value })} /></Field></div></FormShell>
  if (activeTab === 'research') return <FormShell title="Add research" description="Evidence remains shared with the project." onSubmit={props.onCreateResearch} saving={saving}><Field label="Title"><input required className={INPUT_CLASS} value={props.researchForm.title} onChange={(event) => props.setResearchForm({ ...props.researchForm, title: event.target.value })} /></Field><Field label="Type"><select className={INPUT_CLASS} value={props.researchForm.researchType} onChange={(event) => props.setResearchForm({ ...props.researchForm, researchType: event.target.value })}><option>general</option><option>market</option><option>competitor</option><option>audience</option><option>keyword</option><option>visual</option><option>technical</option></select></Field><Field label="Question"><textarea className={`${INPUT_CLASS} min-h-20`} value={props.researchForm.question} onChange={(event) => props.setResearchForm({ ...props.researchForm, question: event.target.value })} /></Field><Field label="Findings"><textarea className={`${INPUT_CLASS} min-h-24`} value={props.researchForm.findings} onChange={(event) => props.setResearchForm({ ...props.researchForm, findings: event.target.value })} /></Field></FormShell>
  if (activeTab === 'deliverables') return <FormShell title="Add deliverable" description="Creates the output identity; version review comes next." onSubmit={props.onCreateDeliverable} saving={saving}><Field label="Title"><input required className={INPUT_CLASS} value={props.deliverableForm.title} onChange={(event) => props.setDeliverableForm({ ...props.deliverableForm, title: event.target.value })} /></Field><Field label="Type"><input className={INPUT_CLASS} value={props.deliverableForm.deliverableType} onChange={(event) => props.setDeliverableForm({ ...props.deliverableForm, deliverableType: event.target.value })} /></Field><Field label="Due"><input type="date" className={INPUT_CLASS} value={props.deliverableForm.dueDate} onChange={(event) => props.setDeliverableForm({ ...props.deliverableForm, dueDate: event.target.value })} /></Field></FormShell>
  return <FormShell title="Create request" description="Send a structured output request to another workstream." onSubmit={props.onCreateRequest} saving={saving}><Field label="Title"><input required className={INPUT_CLASS} value={props.requestForm.title} onChange={(event) => props.setRequestForm({ ...props.requestForm, title: event.target.value })} /></Field><Field label="Receiving workstream"><select required className={INPUT_CLASS} value={props.requestForm.receivingWorkstreamId} onChange={(event) => props.setRequestForm({ ...props.requestForm, receivingWorkstreamId: event.target.value })}><option value="">Select receiving team</option>{props.receivingWorkstreams.map((workstream) => <option key={workstream.id} value={workstream.id}>{workstream.name}</option>)}</select></Field><Field label="Requested output"><textarea required className={`${INPUT_CLASS} min-h-24`} value={props.requestForm.requestedOutput} onChange={(event) => props.setRequestForm({ ...props.requestForm, requestedOutput: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Priority"><select className={INPUT_CLASS} value={props.requestForm.priority} onChange={(event) => props.setRequestForm({ ...props.requestForm, priority: event.target.value })}><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></Field><Field label="Required by"><input type="date" className={INPUT_CLASS} value={props.requestForm.requiredBy} onChange={(event) => props.setRequestForm({ ...props.requestForm, requiredBy: event.target.value })} /></Field></div></FormShell>
}

function FormShell({ title, description, onSubmit, saving, children }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><Header title={title} description={description} /><form onSubmit={onSubmit} className="space-y-4">{children}<button disabled={saving} className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50">{saving ? 'Saving…' : title}</button></form></section>
}

export { DEPARTMENT_CONFIG }
