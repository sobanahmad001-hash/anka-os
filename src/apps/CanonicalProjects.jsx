import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext.jsx'
import { featureFlags } from '../config/featureFlags.js'
import {
  TASK_TRANSITIONS,
  WORKSTREAM_DEPARTMENTS,
} from '../data/deliveryRepository.js'
import { delivery } from '../data/delivery.js'

const PROJECT_TEMPLATES = {
  custom: {
    slug: 'custom',
    label: 'Custom engagement',
    description: 'Choose only the workstreams this engagement needs.',
    departments: ['content'],
  },
  branding: {
    slug: 'branding',
    label: 'Branding',
    description: 'Shared research with verbal identity and visual identity workstreams.',
    departments: ['content', 'design'],
  },
  website: {
    slug: 'website-delivery',
    label: 'Website delivery',
    description: 'Content, design, delivery, and launch marketing in one engagement.',
    departments: ['content', 'design', 'development', 'marketing'],
  },
  campaign: {
    slug: 'campaign',
    label: 'Marketing campaign',
    description: 'Campaign strategy connected to content and creative production.',
    departments: ['content', 'design', 'marketing'],
  },
}

const TABS = [
  ['overview', 'Overview'],
  ['tasks', 'Tasks'],
  ['research', 'Research'],
  ['milestones', 'Milestones'],
  ['deliverables', 'Deliverables'],
  ['requests', 'Requests'],
  ['living-record', 'Living Record'],
]

const STATUS_STYLES = {
  planning: 'bg-slate-800 text-slate-300',
  active: 'bg-emerald-950 text-emerald-300',
  on_hold: 'bg-amber-950 text-amber-300',
  completed: 'bg-blue-950 text-blue-300',
  archived: 'bg-slate-900 text-slate-500',
  backlog: 'bg-slate-800 text-slate-300',
  ready: 'bg-indigo-950 text-indigo-300',
  in_progress: 'bg-blue-950 text-blue-300',
  blocked: 'bg-red-950 text-red-300',
  ready_for_review: 'bg-amber-950 text-amber-300',
  changes_required: 'bg-orange-950 text-orange-300',
  done: 'bg-emerald-950 text-emerald-300',
  cancelled: 'bg-slate-900 text-slate-500',
}

const STATUS_FILTERS = [
  ['all', 'All'],
  ['active', 'Active'],
  ['planning', 'Planning'],
  ['on_hold', 'On hold'],
  ['completed', 'Completed'],
]

const PROJECT_ACCENTS = {
  project: 'from-violet-500/25 to-indigo-500/10 text-violet-200 ring-violet-500/20',
  retainer: 'from-cyan-500/25 to-blue-500/10 text-cyan-200 ring-cyan-500/20',
  internal: 'from-amber-500/25 to-orange-500/10 text-amber-200 ring-amber-500/20',
}

const INPUT_CLASS = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
const LABEL_CLASS = 'mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400'

function labelize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`))
}

function StatusBadge({ value }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[value] || 'bg-slate-800 text-slate-300'}`}>
      {labelize(value)}
    </span>
  )
}

function Metric({ label, value, note }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.12)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</p>
        <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-violet-400/70" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</p>
      {note && <p className="mt-1 text-[11px] text-slate-600">{note}</p>}
    </div>
  )
}

function ProjectGlyph({ type }) {
  return (
    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ring-1 ${PROJECT_ACCENTS[type] || PROJECT_ACCENTS.project}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 19V8.5L12 4l7 4.5V19" />
        <path d="M9 19v-5h6v5M8 10h.01M16 10h.01" />
      </svg>
    </div>
  )
}

function Panel({ title, description, action, children }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-white">{title}</h3>
          {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyPanel({ title, description }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 px-5 py-10 text-center">
      <p className="font-medium text-slate-200">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{description}</p>
    </div>
  )
}

const initialEngagement = {
  name: '',
  description: '',
  engagementType: 'project',
  template: 'branding',
  clientId: '',
  newClientName: '',
  newClientCompany: '',
  dueDate: '',
  scopeStatement: '',
  exclusions: '',
  departments: [...PROJECT_TEMPLATES.branding.departments],
}

export default function CanonicalProjects() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showIntake, setShowIntake] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [engagement, setEngagement] = useState(initialEngagement)
  const [taskForm, setTaskForm] = useState({ title: '', workstreamId: '', priority: 'medium', dueDate: '', acceptanceCriteria: '' })
  const [researchForm, setResearchForm] = useState({ title: '', workstreamId: '', researchType: 'market', question: '', findings: '' })
  const [milestoneForm, setMilestoneForm] = useState({ name: '', description: '', targetDate: '' })
  const [deliverableForm, setDeliverableForm] = useState({ title: '', workstreamId: '', deliverableType: 'general', dueDate: '' })
  const [requestForm, setRequestForm] = useState({ title: '', requestedOutput: '', requestingWorkstreamId: '', receivingWorkstreamId: '', priority: 'medium', requiredBy: '' })

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  )

  useEffect(() => {
    loadIndex()
  }, [])

  async function loadIndex() {
    setLoading(true)
    setError('')
    try {
      const [projectRows, clientRows] = await Promise.all([
        delivery.listProjects(),
        delivery.listClients(),
      ])
      setProjects(projectRows || [])
      setClients(clientRows || [])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  async function openWorkspace(projectId) {
    setDetailLoading(true)
    setError('')
    try {
      setWorkspace(await delivery.getProjectWorkspace(projectId))
      setActiveTab('overview')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setDetailLoading(false)
    }
  }

  async function refreshWorkspace() {
    if (!workspace?.project?.id) return
    setWorkspace(await delivery.getProjectWorkspace(workspace.project.id))
  }

  function chooseTemplate(templateKey) {
    const template = PROJECT_TEMPLATES[templateKey]
    setEngagement((current) => ({
      ...current,
      template: templateKey,
      departments: [...template.departments],
    }))
  }

  function toggleDepartment(departmentId) {
    setEngagement((current) => ({
      ...current,
      departments: current.departments.includes(departmentId)
        ? current.departments.filter((id) => id !== departmentId)
        : [...current.departments, departmentId],
    }))
  }

  async function createEngagement(event) {
    event.preventDefault()
    if (!user?.id || !engagement.name.trim() || engagement.departments.length === 0) return

    setSaving(true)
    setError('')
    try {
      let clientId = engagement.clientId || null
      if (!clientId && engagement.newClientName.trim()) {
        const client = await delivery.createClient({
          name: engagement.newClientName,
          company: engagement.newClientCompany,
        }, user.id)
        clientId = client.id
      }

      const project = await delivery.createProject({
        name: engagement.name,
        description: engagement.description,
        engagementType: engagement.engagementType,
        clientId,
        dueDate: engagement.dueDate,
        scopeStatement: engagement.scopeStatement,
        exclusions: engagement.exclusions,
        status: 'active',
      }, user.id)

      const workstreams = await delivery.createWorkstreams(project.id, engagement.departments, user.id)
      await delivery.activateWorkflowTemplate(
        project.id,
        workstreams,
        PROJECT_TEMPLATES[engagement.template].slug,
        user.id
      )
      setEngagement(initialEngagement)
      setShowIntake(false)
      await loadIndex()
      await openWorkspace(project.id)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function createTask(event) {
    event.preventDefault()
    if (!user?.id || !workspace?.project?.id) return
    setSaving(true)
    try {
      const workstream = workspace.workstreams.find((item) => item.id === taskForm.workstreamId)
      await delivery.createTask({
        projectId: workspace.project.id,
        workstreamId: taskForm.workstreamId || null,
        departmentId: workstream?.department_id || null,
        title: taskForm.title,
        priority: taskForm.priority,
        dueDate: taskForm.dueDate,
        acceptanceCriteria: taskForm.acceptanceCriteria,
      }, user.id)
      setTaskForm({ title: '', workstreamId: '', priority: 'medium', dueDate: '', acceptanceCriteria: '' })
      await refreshWorkspace()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function transitionTask(taskId, status) {
    setSaving(true)
    try {
      await delivery.transitionTask(taskId, status)
      await refreshWorkspace()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function createResearch(event) {
    event.preventDefault()
    if (!user?.id || !workspace?.project?.id) return
    setSaving(true)
    try {
      await delivery.createResearchRecord({
        projectId: workspace.project.id,
        ...researchForm,
      }, user.id)
      setResearchForm({ title: '', workstreamId: '', researchType: 'market', question: '', findings: '' })
      await refreshWorkspace()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function createMilestone(event) {
    event.preventDefault()
    if (!user?.id || !workspace?.project?.id) return
    setSaving(true)
    try {
      await delivery.createMilestone({
        projectId: workspace.project.id,
        ...milestoneForm,
        position: workspace.milestones.length,
      }, user.id)
      setMilestoneForm({ name: '', description: '', targetDate: '' })
      await refreshWorkspace()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function createDeliverable(event) {
    event.preventDefault()
    if (!user?.id || !workspace?.project?.id) return
    setSaving(true)
    try {
      await delivery.createDeliverable({
        projectId: workspace.project.id,
        ...deliverableForm,
      }, user.id)
      setDeliverableForm({ title: '', workstreamId: '', deliverableType: 'general', dueDate: '' })
      await refreshWorkspace()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function createRequest(event) {
    event.preventDefault()
    if (!user?.id || !workspace?.project?.id) return
    setSaving(true)
    try {
      await delivery.createInternalRequest({
        projectId: workspace.project.id,
        ...requestForm,
      }, user.id)
      setRequestForm({ title: '', requestedOutput: '', requestingWorkstreamId: '', receivingWorkstreamId: '', priority: 'medium', requiredBy: '' })
      await refreshWorkspace()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading || detailLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-700 border-t-purple-500" />
      </div>
    )
  }

  if (workspace) {
    return (
      <ProjectWorkspace
        workspace={workspace}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onBack={() => { setWorkspace(null); loadIndex() }}
        error={error}
        saving={saving}
        taskForm={taskForm}
        setTaskForm={setTaskForm}
        onCreateTask={createTask}
        onTransitionTask={transitionTask}
        researchForm={researchForm}
        setResearchForm={setResearchForm}
        onCreateResearch={createResearch}
        milestoneForm={milestoneForm}
        setMilestoneForm={setMilestoneForm}
        onCreateMilestone={createMilestone}
        deliverableForm={deliverableForm}
        setDeliverableForm={setDeliverableForm}
        onCreateDeliverable={createDeliverable}
        requestForm={requestForm}
        setRequestForm={setRequestForm}
        onCreateRequest={createRequest}
      />
    )
  }

  const activeCount = projects.filter((project) => project.status === 'active').length
  const dueSoonCount = projects.filter((project) => {
    if (!project.due_date) return false
    const days = (new Date(project.due_date) - new Date()) / 86400000
    return days >= 0 && days <= 14
  }).length
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const filteredProjects = projects.filter((project) => {
    const client = clientsById.get(project.client_id)
    const matchesStatus = statusFilter === 'all' || project.status === statusFilter
    const matchesSearch = !normalizedSearch || [
      project.name,
      project.description,
      project.engagement_type,
      client?.name,
      client?.company,
    ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch))
    return matchesStatus && matchesSearch
  })

  return (
    <div className="h-full overflow-y-auto text-white">
      <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-400">
              <span>Anka Sphere</span><span className="text-slate-700">/</span><span className="text-slate-500">Delivery</span>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Projects</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Plan, coordinate, and release every client engagement from one accountable workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowIntake(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.08)] transition hover:-translate-y-0.5 hover:bg-violet-100"
          >
            <span className="text-lg leading-none">+</span> New engagement
          </button>
        </div>

        {error && (
          <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Total engagements" value={projects.length} note="Projects, retainers, and internal work" />
          <Metric label="Active delivery" value={activeCount} note="Currently moving through production" />
          <Metric label="Due soon" value={dueSoonCount} note="Due within the next 14 days" />
          <Metric label="Client approvals" value={featureFlags.clientApprovals ? 'Enabled' : 'Off'} note="Exact released-version decisions" />
        </div>

        <section className="mt-6 overflow-hidden rounded-3xl border border-white/[0.07] bg-[#0e111a]/80 shadow-[0_28px_100px_rgba(0,0,0,0.24)] backdrop-blur-sm">
          <div className="border-b border-white/[0.07] p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Engagement directory</h2>
                <p className="mt-1 text-xs text-slate-500">{filteredProjects.length} of {projects.length} visible</p>
              </div>
              <label className="relative block w-full xl:max-w-md">
                <span className="sr-only">Search projects or clients</span>
                <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search projects or clients…"
                  className="w-full rounded-xl border border-white/[0.08] bg-black/20 py-2.5 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10"
                />
              </label>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {STATUS_FILTERS.map(([value, label]) => {
                const count = value === 'all' ? projects.length : projects.filter((project) => project.status === value).length
                const active = statusFilter === value
                return (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setStatusFilter(value)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? 'border-violet-400/25 bg-violet-500/15 text-violet-100' : 'border-white/[0.07] bg-white/[0.02] text-slate-500 hover:border-white/15 hover:text-slate-200'}`}
                  >
                    {label}<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-violet-400/15 text-violet-200' : 'bg-white/[0.04] text-slate-600'}`}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5">
          {projects.length === 0 ? (
            <EmptyPanel
              title="No canonical engagements yet"
              description="The test data has been cleared. Create the first real internal engagement to activate workstreams and its Living Project Record."
            />
          ) : filteredProjects.length === 0 ? (
            <EmptyPanel
              title="No matching engagements"
              description="Try a different client, project name, or delivery status."
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredProjects.map((project) => {
                const client = clientsById.get(project.client_id)
                return (
                  <button
                    type="button"
                    key={project.id}
                    onClick={() => openWorkspace(project.id)}
                    className="group rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-violet-500/30 hover:bg-white/[0.045] hover:shadow-[0_20px_50px_rgba(0,0,0,0.2)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProjectGlyph type={project.engagement_type} />
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-600">{labelize(project.engagement_type)}</p>
                          <h3 className="mt-1 truncate text-base font-semibold text-white transition-colors group-hover:text-violet-100">{project.name}</h3>
                        </div>
                      </div>
                      <StatusBadge value={project.status} />
                    </div>
                    <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-slate-400">
                      {project.description || 'No description added yet.'}
                    </p>
                    <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4 text-xs text-slate-500">
                      <span className="truncate">{client?.company || client?.name || 'Internal engagement'}</span>
                      <span className="shrink-0">Due {formatDate(project.due_date)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          </div>
        </section>
      </div>

      {showIntake && (
        <EngagementIntake
          engagement={engagement}
          setEngagement={setEngagement}
          clients={clients}
          saving={saving}
          onClose={() => setShowIntake(false)}
          onSubmit={createEngagement}
          onChooseTemplate={chooseTemplate}
          onToggleDepartment={toggleDepartment}
        />
      )}
    </div>
  )
}

function EngagementIntake({ engagement, setEngagement, clients, saving, onClose, onSubmit, onChooseTemplate, onToggleDepartment }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 py-5 backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-400">Project intake</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Create an engagement</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white">Close</button>
        </div>

        <div className="space-y-7 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className={LABEL_CLASS}>Engagement name</span>
              <input required className={INPUT_CLASS} value={engagement.name} onChange={(event) => setEngagement({ ...engagement, name: event.target.value })} />
            </label>
            <label>
              <span className={LABEL_CLASS}>Engagement type</span>
              <select className={INPUT_CLASS} value={engagement.engagementType} onChange={(event) => setEngagement({ ...engagement, engagementType: event.target.value })}>
                <option value="project">Project</option>
                <option value="retainer">Retainer</option>
                <option value="internal">Internal initiative</option>
              </select>
            </label>
          </div>

          <label>
            <span className={LABEL_CLASS}>Brief description</span>
            <textarea className={`${INPUT_CLASS} min-h-24 resize-y`} value={engagement.description} onChange={(event) => setEngagement({ ...engagement, description: event.target.value })} />
          </label>

          <div>
            <p className={LABEL_CLASS}>Delivery pattern</p>
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(PROJECT_TEMPLATES).map(([key, template]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => onChooseTemplate(key)}
                  className={`rounded-xl border p-4 text-left transition ${engagement.template === key ? 'border-purple-500 bg-purple-950/30' : 'border-slate-700 bg-slate-950/40 hover:border-slate-600'}`}
                >
                  <p className="font-medium text-white">{template.label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{template.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={LABEL_CLASS}>Activated workstreams</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {WORKSTREAM_DEPARTMENTS.map((department) => {
                const selected = engagement.departments.includes(department.id)
                return (
                  <button
                    type="button"
                    key={department.id}
                    onClick={() => onToggleDepartment(department.id)}
                    className={`rounded-xl border px-3 py-3 text-sm font-medium transition ${selected ? 'border-purple-500 bg-purple-950/40 text-purple-200' : 'border-slate-700 bg-slate-950 text-slate-400'}`}
                  >
                    {selected ? 'Selected · ' : ''}{department.name}
                  </button>
                )
              })}
            </div>
            {engagement.departments.length === 0 && <p className="mt-2 text-xs text-red-300">Select at least one workstream.</p>}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className={LABEL_CLASS}>Existing client</span>
              <select className={INPUT_CLASS} value={engagement.clientId} onChange={(event) => setEngagement({ ...engagement, clientId: event.target.value, newClientName: '', newClientCompany: '' })}>
                <option value="">Internal or add a new client below</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
              </select>
            </label>
            <label>
              <span className={LABEL_CLASS}>Target date</span>
              <input type="date" className={INPUT_CLASS} value={engagement.dueDate} onChange={(event) => setEngagement({ ...engagement, dueDate: event.target.value })} />
            </label>
            {!engagement.clientId && (
              <>
                <label>
                  <span className={LABEL_CLASS}>New client contact/name</span>
                  <input className={INPUT_CLASS} value={engagement.newClientName} onChange={(event) => setEngagement({ ...engagement, newClientName: event.target.value })} />
                </label>
                <label>
                  <span className={LABEL_CLASS}>New client company</span>
                  <input className={INPUT_CLASS} value={engagement.newClientCompany} onChange={(event) => setEngagement({ ...engagement, newClientCompany: event.target.value })} />
                </label>
              </>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className={LABEL_CLASS}>Scope statement</span>
              <textarea className={`${INPUT_CLASS} min-h-28 resize-y`} value={engagement.scopeStatement} onChange={(event) => setEngagement({ ...engagement, scopeStatement: event.target.value })} />
            </label>
            <label>
              <span className={LABEL_CLASS}>Exclusions</span>
              <textarea className={`${INPUT_CLASS} min-h-28 resize-y`} value={engagement.exclusions} onChange={(event) => setEngagement({ ...engagement, exclusions: event.target.value })} />
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-800 bg-slate-900/95 px-6 py-4 backdrop-blur">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800">Cancel</button>
          <button disabled={saving || !engagement.name.trim() || engagement.departments.length === 0} className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Creating…' : 'Create engagement'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ProjectWorkspace(props) {
  const { workspace, activeTab, setActiveTab, onBack, error } = props
  const { project, workstreams, tasks, research, milestones, deliverables, requests, livingRecord } = workspace
  const workstreamsById = new Map(workstreams.map((item) => [item.id, item]))
  const doneTasks = tasks.filter((task) => task.status === 'done').length

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-white">
      <div className="border-b border-slate-800 bg-slate-950/95 px-6 py-5">
        <button type="button" onClick={onBack} className="text-sm font-medium text-slate-400 hover:text-white">← Projects & Retainers</button>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <StatusBadge value={project.status} />
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{project.description || 'No project description yet.'}</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>{labelize(project.engagement_type)}</p>
            <p className="mt-1">Due {formatDate(project.due_date)}</p>
          </div>
        </div>
        <div className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-800">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${activeTab === id ? 'border-purple-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {error && <div className="mb-5 rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}

        {activeTab === 'overview' && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Workstreams" value={workstreams.length} note="Activated departments" />
              <Metric label="Tasks" value={`${doneTasks}/${tasks.length}`} note="Completed work units" />
              <Metric label="Open requests" value={requests.filter((request) => !['completed', 'declined', 'withdrawn'].includes(request.status)).length} note="Handoffs and revisions" />
              <Metric label="Client visibility" value={project.portal_visible ? 'On' : 'Off'} note="Internal quality gate remains required" />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Scope" description="The agreed delivery boundary for this engagement.">
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{project.scope_statement || 'Scope has not been documented yet.'}</p>
                {project.exclusions && <div className="mt-4 border-t border-slate-800 pt-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Exclusions</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-400">{project.exclusions}</p></div>}
              </Panel>
              <Panel title="Active workstreams" description="Department workshops sharing this engagement record.">
                <div className="space-y-3">
                  {workstreams.map((workstream) => (
                    <div key={workstream.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      <div><p className="text-sm font-medium text-white">{workstream.name}</p><p className="mt-1 text-xs text-slate-500">Internal by default</p></div>
                      <StatusBadge value={workstream.status} />
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        )}

        {activeTab === 'tasks' && <TasksTab {...props} workstreamsById={workstreamsById} />}
        {activeTab === 'research' && <ResearchTab {...props} workstreamsById={workstreamsById} />}
        {activeTab === 'milestones' && <MilestonesTab {...props} />}
        {activeTab === 'deliverables' && <DeliverablesTab {...props} workstreamsById={workstreamsById} />}
        {activeTab === 'requests' && <RequestsTab {...props} workstreamsById={workstreamsById} />}
        {activeTab === 'living-record' && (
          <Panel title="Living Project Record" description="Generated automatically from canonical records; this is not a second manually edited project document.">
            <div className="grid gap-4 md:grid-cols-3">
              <Metric label="Source version" value={livingRecord?.source_version || 1} note="Increments with generated refreshes" />
              <Metric label="Generated" value={livingRecord?.generated_at ? new Date(livingRecord.generated_at).toLocaleDateString() : 'Pending'} note="Internal projection" />
              <Metric label="Client projection" value={Object.keys(livingRecord?.client_projection || {}).length ? 'Prepared' : 'Not released'} note="No internal fields exposed" />
            </div>
            <pre className="mt-5 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs leading-6 text-slate-300">{JSON.stringify(livingRecord?.internal_projection || {}, null, 2)}</pre>
          </Panel>
        )}
      </div>
    </div>
  )
}

function TasksTab({ workspace, taskForm, setTaskForm, onCreateTask, onTransitionTask, saving, workstreamsById }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <Panel title="Execution queue" description="Server-enforced lifecycle; tasks cannot jump directly from production to done.">
        {workspace.tasks.length === 0 ? <EmptyPanel title="No tasks yet" description="Create the first work unit and connect it to the accountable workstream." /> : (
          <div className="space-y-3">
            {workspace.tasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-medium text-white">{task.title}</p><p className="mt-1 text-xs text-slate-500">{workstreamsById.get(task.workstream_id)?.name || 'Shared project work'} · Due {formatDate(task.due_date)}</p></div>
                  <StatusBadge value={task.status} />
                </div>
                {task.acceptance_criteria && <p className="mt-3 text-sm leading-6 text-slate-400">Acceptance: {task.acceptance_criteria}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  {(TASK_TRANSITIONS[task.status] || []).map((status) => (
                    <button disabled={saving} type="button" key={status} onClick={() => onTransitionTask(task.id, status)} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-purple-600 hover:text-white disabled:opacity-50">
                      Move to {labelize(status)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Add task" description="Internal by default.">
        <form onSubmit={onCreateTask} className="space-y-4">
          <Field label="Task title"><input required className={INPUT_CLASS} value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} /></Field>
          <WorkstreamSelect value={taskForm.workstreamId} onChange={(value) => setTaskForm({ ...taskForm, workstreamId: value })} workstreams={workspace.workstreams} />
          <Field label="Acceptance criteria"><textarea className={`${INPUT_CLASS} min-h-20`} value={taskForm.acceptanceCriteria} onChange={(event) => setTaskForm({ ...taskForm, acceptanceCriteria: event.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority"><select className={INPUT_CLASS} value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })}><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></Field>
            <Field label="Due date"><input type="date" className={INPUT_CLASS} value={taskForm.dueDate} onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value })} /></Field>
          </div>
          <SubmitButton saving={saving}>Create task</SubmitButton>
        </form>
      </Panel>
    </div>
  )
}

function ResearchTab({ workspace, researchForm, setResearchForm, onCreateResearch, saving, workstreamsById }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <Panel title="Research index" description="Evidence can support any project workstream without becoming a separate department.">
        {workspace.research.length === 0 ? <EmptyPanel title="No research records yet" description="Capture the question, evidence, findings, and workstream context here." /> : (
          <div className="space-y-3">{workspace.research.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex justify-between gap-3"><div><p className="font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{labelize(item.research_type)} · {workstreamsById.get(item.workstream_id)?.name || 'Shared research'}</p></div><StatusBadge value={item.status} /></div>{item.question && <p className="mt-3 text-sm text-slate-400">Question: {item.question}</p>}{item.findings && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{item.findings}</p>}</div>)}</div>
        )}
      </Panel>
      <Panel title="Add research" description="Draft evidence for later review.">
        <form onSubmit={onCreateResearch} className="space-y-4">
          <Field label="Title"><input required className={INPUT_CLASS} value={researchForm.title} onChange={(event) => setResearchForm({ ...researchForm, title: event.target.value })} /></Field>
          <WorkstreamSelect allowShared value={researchForm.workstreamId} onChange={(value) => setResearchForm({ ...researchForm, workstreamId: value })} workstreams={workspace.workstreams} />
          <Field label="Research type"><select className={INPUT_CLASS} value={researchForm.researchType} onChange={(event) => setResearchForm({ ...researchForm, researchType: event.target.value })}><option value="market">Market</option><option value="competitor">Competitor</option><option value="audience">Audience</option><option value="keyword">Keyword</option><option value="visual">Visual</option><option value="technical">Technical</option><option value="general">General</option></select></Field>
          <Field label="Question"><textarea className={`${INPUT_CLASS} min-h-20`} value={researchForm.question} onChange={(event) => setResearchForm({ ...researchForm, question: event.target.value })} /></Field>
          <Field label="Initial findings"><textarea className={`${INPUT_CLASS} min-h-24`} value={researchForm.findings} onChange={(event) => setResearchForm({ ...researchForm, findings: event.target.value })} /></Field>
          <SubmitButton saving={saving}>Create research record</SubmitButton>
        </form>
      </Panel>
    </div>
  )
}

function MilestonesTab({ workspace, milestoneForm, setMilestoneForm, onCreateMilestone, saving }) {
  return <div className="grid gap-5 xl:grid-cols-[1fr_340px]"><Panel title="Milestone timeline" description="Engagement-level checkpoints shared across workstreams.">{workspace.milestones.length === 0 ? <EmptyPanel title="No milestones yet" description="Add the first delivery checkpoint for the engagement." /> : <div className="space-y-3">{workspace.milestones.map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div><p className="font-medium text-white">{item.name}</p><p className="mt-1 text-xs text-slate-500">Target {formatDate(item.target_date)}</p></div><StatusBadge value={item.status} /></div>)}</div>}</Panel><Panel title="Add milestone" description="Internal until deliberately released."><form onSubmit={onCreateMilestone} className="space-y-4"><Field label="Milestone name"><input required className={INPUT_CLASS} value={milestoneForm.name} onChange={(event) => setMilestoneForm({ ...milestoneForm, name: event.target.value })} /></Field><Field label="Description"><textarea className={`${INPUT_CLASS} min-h-20`} value={milestoneForm.description} onChange={(event) => setMilestoneForm({ ...milestoneForm, description: event.target.value })} /></Field><Field label="Target date"><input type="date" className={INPUT_CLASS} value={milestoneForm.targetDate} onChange={(event) => setMilestoneForm({ ...milestoneForm, targetDate: event.target.value })} /></Field><SubmitButton saving={saving}>Create milestone</SubmitButton></form></Panel></div>
}

function DeliverablesTab({ workspace, deliverableForm, setDeliverableForm, onCreateDeliverable, saving, workstreamsById }) {
  return <div className="grid gap-5 xl:grid-cols-[1fr_340px]"><Panel title="Deliverables" description="The output identity remains stable while later versions move through internal review.">{workspace.deliverables.length === 0 ? <EmptyPanel title="No deliverables yet" description="Create the output identity now; version uploads and quality review are implemented in Phase 3." /> : <div className="space-y-3">{workspace.deliverables.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex justify-between gap-3"><div><p className="font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{workstreamsById.get(item.workstream_id)?.name} · Due {formatDate(item.due_date)}</p></div><StatusBadge value={item.status} /></div><p className="mt-3 text-xs text-slate-500">{item.deliverable_versions?.length || 0} versions · Internal only</p></div>)}</div>}</Panel><Panel title="Add deliverable" description="No client visibility at creation."><form onSubmit={onCreateDeliverable} className="space-y-4"><Field label="Title"><input required className={INPUT_CLASS} value={deliverableForm.title} onChange={(event) => setDeliverableForm({ ...deliverableForm, title: event.target.value })} /></Field><WorkstreamSelect required value={deliverableForm.workstreamId} onChange={(value) => setDeliverableForm({ ...deliverableForm, workstreamId: value })} workstreams={workspace.workstreams} /><Field label="Type"><input className={INPUT_CLASS} value={deliverableForm.deliverableType} onChange={(event) => setDeliverableForm({ ...deliverableForm, deliverableType: event.target.value })} /></Field><Field label="Due date"><input type="date" className={INPUT_CLASS} value={deliverableForm.dueDate} onChange={(event) => setDeliverableForm({ ...deliverableForm, dueDate: event.target.value })} /></Field><SubmitButton saving={saving}>Create deliverable</SubmitButton></form></Panel></div>
}

function RequestsTab({ workspace, requestForm, setRequestForm, onCreateRequest, saving, workstreamsById }) {
  return <div className="grid gap-5 xl:grid-cols-[1fr_340px]"><Panel title="Cross-department requests" description="Structured handoffs with an expected output and accountable receiving workstream.">{workspace.requests.length === 0 ? <EmptyPanel title="No requests yet" description="Use requests when one workstream needs a defined output from another." /> : <div className="space-y-3">{workspace.requests.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex justify-between gap-3"><div><p className="font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{workstreamsById.get(item.requesting_workstream_id)?.name || 'Project'} → {workstreamsById.get(item.receiving_workstream_id)?.name || 'Unassigned'}</p></div><StatusBadge value={item.status} /></div><p className="mt-3 text-sm leading-6 text-slate-400">{item.requested_output}</p></div>)}</div>}</Panel><Panel title="Create request" description="Internal handoff by default."><form onSubmit={onCreateRequest} className="space-y-4"><Field label="Title"><input required className={INPUT_CLASS} value={requestForm.title} onChange={(event) => setRequestForm({ ...requestForm, title: event.target.value })} /></Field><WorkstreamSelect label="Requesting workstream" value={requestForm.requestingWorkstreamId} onChange={(value) => setRequestForm({ ...requestForm, requestingWorkstreamId: value })} workstreams={workspace.workstreams} /><WorkstreamSelect label="Receiving workstream" value={requestForm.receivingWorkstreamId} onChange={(value) => setRequestForm({ ...requestForm, receivingWorkstreamId: value })} workstreams={workspace.workstreams} /><Field label="Requested output"><textarea required className={`${INPUT_CLASS} min-h-24`} value={requestForm.requestedOutput} onChange={(event) => setRequestForm({ ...requestForm, requestedOutput: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Priority"><select className={INPUT_CLASS} value={requestForm.priority} onChange={(event) => setRequestForm({ ...requestForm, priority: event.target.value })}><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></Field><Field label="Required by"><input type="date" className={INPUT_CLASS} value={requestForm.requiredBy} onChange={(event) => setRequestForm({ ...requestForm, requiredBy: event.target.value })} /></Field></div><SubmitButton saving={saving}>Create request</SubmitButton></form></Panel></div>
}

function Field({ label, children }) {
  return <label><span className={LABEL_CLASS}>{label}</span>{children}</label>
}

function WorkstreamSelect({ label = 'Workstream', value, onChange, workstreams, allowShared = false, required = false }) {
  return <Field label={label}><select required={required} className={INPUT_CLASS} value={value} onChange={(event) => onChange(event.target.value)}><option value="">{allowShared ? 'Shared across project' : 'Select workstream'}</option>{workstreams.map((workstream) => <option key={workstream.id} value={workstream.id}>{workstream.name}</option>)}</select></Field>
}

function SubmitButton({ saving, children }) {
  return <button disabled={saving} className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Saving…' : children}</button>
}
