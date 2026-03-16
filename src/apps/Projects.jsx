import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Card from '../components/Card'
import StatCard from '../components/StatCard'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import LoadingSkeleton from '../components/LoadingSkeleton'

function normalizeText(value, fallback = 'Unknown') {
  if (!value) return fallback
  return String(value).replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function titleCase(value, fallback = 'Unknown') {
  return normalizeText(value, fallback)
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getStatusVariant(status) {
  const normalized = String(status || '').toLowerCase()

  if (['completed', 'done'].includes(normalized)) return 'success'
  if (['blocked', 'blocked_review'].includes(normalized)) return 'danger'
  if (['planning', 'review', 'pending'].includes(normalized)) return 'warning'
  if (['active', 'in_progress', 'in progress'].includes(normalized)) return 'primary'
  return 'default'
}

function getProjectHealth(project, relatedTasks = []) {
  const blockedTasks = relatedTasks.filter((task) =>
    ['blocked', 'blocked_review'].includes(task.status)
  ).length

  const overdueTasks = relatedTasks.filter((task) => {
    if (!task.due_date) return false
    return new Date(task.due_date) < new Date() && task.status !== 'done'
  }).length

  const progress = Number(project?.progress || 0)
  const status = String(project?.status || '').toLowerCase()

  if (blockedTasks > 0) return { label: 'At Risk', variant: 'danger' }
  if (overdueTasks > 0) return { label: 'Needs Attention', variant: 'warning' }
  if (['completed', 'done'].includes(status) || progress >= 100) {
    return { label: 'Stable', variant: 'success' }
  }
  return { label: 'Active', variant: 'primary' }
}

function getDecisionSignal(project) {
  const status = String(project?.status || '').toLowerCase()
  const priority = String(project?.priority || '').toLowerCase()

  if (priority === 'high' || priority === 'urgent') return 'Priority review'
  if (status === 'planning') return 'Scope alignment'
  if (status === 'blocked') return 'Escalation required'
  return 'Tracked'
}

export default function Projects() {
  const [loading, setLoading] = useState(true)
  const [projectRows, setProjectRows] = useState([])
  const [taskRows, setTaskRows] = useState([])
  const [projectsAvailable, setProjectsAvailable] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    status: 'planning',
    priority: 'normal',
    due_date: '',
  })

  useEffect(() => {
    fetchSharedProjectCore()
  }, [])

  async function fetchSharedProjectCore() {
    setLoading(true)

    try {
      const [projectsResult, tasksResult] = await Promise.allSettled([
        supabase.from('projects').select('*').order('created_at', { ascending: false }),
        supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      ])

      const projectsOk =
        projectsResult.status === 'fulfilled' && !projectsResult.value.error

      const tasksOk =
        tasksResult.status === 'fulfilled' && !tasksResult.value.error

      setProjectsAvailable(projectsOk)
      setProjectRows(projectsOk ? projectsResult.value.data || [] : [])
      setTaskRows(tasksOk ? tasksResult.value.data || [] : [])
    } catch (error) {
      console.error('Error fetching shared project core:', error)
      setProjectsAvailable(false)
      setProjectRows([])
      setTaskRows([])
    } finally {
      setLoading(false)
    }
  }

  async function createProject(e) {
    e.preventDefault()
    if (!form.name.trim()) return

    setCreating(true)

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      status: form.status,
      priority: form.priority,
      progress: 0,
      due_date: form.due_date || null,
    }

    const { error } = await supabase.from('projects').insert([payload])

    setCreating(false)

    if (error) {
      console.error('Create project error:', error)
      alert(`Could not create project: ${error.message}`)
      return
    }

    setForm({
      name: '',
      description: '',
      status: 'planning',
      priority: 'normal',
      due_date: '',
    })
    setShowCreate(false)
    fetchSharedProjectCore()
  }

  const derived = useMemo(() => {
    const totalProjects = projectRows.length
    const activeProjects = projectRows.filter((project) => {
      const status = String(project.status || '').toLowerCase()
      return !['done', 'completed', 'archived'].includes(status)
    }).length

    const completedProjects = projectRows.filter((project) => {
      const status = String(project.status || '').toLowerCase()
      return ['done', 'completed'].includes(status)
    }).length

    const blockedTasks = taskRows.filter((task) =>
      ['blocked', 'blocked_review'].includes(task.status)
    ).length

    const rows = projectRows.map((project) => {
      const relatedTasks = taskRows.filter((task) => {
        return (
          task.project_id === project.id ||
          task.project === project.id ||
          task.project_name === project.name
        )
      })

      const health = getProjectHealth(project, relatedTasks)
      const blockerCount = relatedTasks.filter((task) =>
        ['blocked', 'blocked_review'].includes(task.status)
      ).length

      return {
        id: project.id,
        name: project.name || project.title || 'Untitled Project',
        description: project.description || 'No project description yet.',
        owner: normalizeText(project.owner || project.owner_name || project.lead, 'Unassigned'),
        department: titleCase(project.department || project.department_id, 'Shared Core'),
        status: normalizeText(project.status, 'unknown'),
        priority: titleCase(project.priority, 'Normal'),
        dueDate: project.due_date,
        progress: Number(project.progress || 0),
        blockerCount,
        relatedTaskCount: relatedTasks.length,
        health,
        decisionSignal: getDecisionSignal(project),
      }
    })

    return {
      totalProjects,
      activeProjects,
      completedProjects,
      blockedTasks,
      rows,
    }
  }, [projectRows, taskRows])

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton type="card" count={4} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Projects Core</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400 leading-7">
            Shared project visibility across environments, ownership, and execution pressure.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/80 px-5 py-4 bg-white/90 dark:bg-gray-800/90 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Shared Core
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            Project registry and portfolio context
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Cross-environment operational center
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Projects" value={derived.totalProjects} change="Shared portfolio" trend="up" icon="🗂️" color="blue" />
        <StatCard label="Active Projects" value={derived.activeProjects} change="Execution in motion" trend="up" icon="⚙️" color="green" />
        <StatCard label="Completed" value={derived.completedProjects} change="Closed delivery" trend="up" icon="✅" color="purple" />
        <StatCard
          label="Blocked Tasks"
          value={derived.blockedTasks}
          change={derived.blockedTasks > 0 ? 'Needs visibility' : 'No blocker signal'}
          trend={derived.blockedTasks > 0 ? 'down' : 'up'}
          icon="🚧"
          color="yellow"
        />
      </div>

      {showCreate && (
        <Card
          title="Create Project"
          subtitle="A lightweight project creation flow for shared-core testing."
          action={
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-200"
            >
              Close
            </button>
          }
        >
          <form onSubmit={createProject} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Project name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-800 dark:text-white"
                placeholder="Launch workflow refactor"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-3 dark:bg-gray-800 dark:text-white"
                rows="4"
                placeholder="Outline the project scope, outcome, or operating goal"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-800 dark:text-white"
              >
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-800 dark:text-white"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Due date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-800 dark:text-white"
              />
            </div>

            <div className="md:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title="Project Registry"
        subtitle="The shared project core should stay visible across Admin, Development, Design, and Marketing."
        action={
          <button
            onClick={() => setShowCreate((prev) => !prev)}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            {showCreate ? 'Hide Form' : 'New Project'}
          </button>
        }
      >
        {!projectsAvailable ? (
          <EmptyState
            icon="🗂️"
            title="Projects table not available"
            description="The shared core needs project records before portfolio visibility can fully render."
          />
        ) : derived.rows.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="No projects found"
            description="Create the first shared-core project to start organizing work across environments."
          />
        ) : (
          <div className="space-y-4">
            {derived.rows.map((project) => (
              <div
                key={project.id}
                className="rounded-2xl border border-gray-200 dark:border-gray-700 p-5 bg-gray-50/80 dark:bg-gray-900/80"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {project.name}
                      </h3>
                      <Badge variant={project.health.variant}>{project.health.label}</Badge>
                      <Badge variant={getStatusVariant(project.status)}>{project.status}</Badge>
                    </div>

                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-6">
                      {project.description}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                      <span>Owner: {project.owner}</span>
                      <span>•</span>
                      <span>Department: {project.department}</span>
                      <span>•</span>
                      <span>Priority: {project.priority}</span>
                      <span>•</span>
                      <span>Tasks: {project.relatedTaskCount}</span>
                      {project.dueDate && (
                        <>
                          <span>•</span>
                          <span>Due: {new Date(project.dueDate).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="xl:w-72 w-full">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Progress</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {project.progress}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      <div
                        className="h-2 rounded-full bg-blue-600"
                        style={{ width: `${Math.max(0, Math.min(project.progress, 100))}%` }}
                      />
                    </div>

                    <div className="mt-3 grid gap-2">
                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-3 bg-white dark:bg-gray-800">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          Blocker Signal
                        </div>
                        <div className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                          {project.blockerCount} blocker{project.blockerCount === 1 ? '' : 's'}
                        </div>
                      </div>

                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-3 bg-white dark:bg-gray-800">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          Decision Signal
                        </div>
                        <div className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                          {project.decisionSignal}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
