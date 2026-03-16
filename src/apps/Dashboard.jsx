import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Card from '../components/Card'
import StatCard from '../components/StatCard'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import LoadingSkeleton from '../components/LoadingSkeleton'

function normalizeStatus(value) {
  return String(value || 'unknown').replace(/[_-]/g, ' ').trim()
}

function getTaskVariant(status) {
  const normalized = String(status || '').toLowerCase()
  if (['done', 'completed'].includes(normalized)) return 'success'
  if (['blocked', 'blocked_review'].includes(normalized)) return 'danger'
  if (['in_progress', 'in progress', 'review', 'pending'].includes(normalized)) return 'warning'
  return 'default'
}

function getProjectSignal(project, relatedTasks = []) {
  const blocked = relatedTasks.filter((task) =>
    ['blocked', 'blocked_review'].includes(task.status)
  ).length

  if (blocked > 0) return { label: 'Blocked work visible', variant: 'danger' }
  if (String(project?.priority || '').toLowerCase() === 'high') {
    return { label: 'Priority work in motion', variant: 'warning' }
  }
  return { label: 'Flow is stable', variant: 'success' }
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [dashboardData, setDashboardData] = useState({
    projects: [],
    tasks: [],
    users: [],
    updates: [],
    updatesAvailable: true,
  })

  useEffect(() => {
    fetchDashboardData()
  }, [])

  async function fetchDashboardData() {
    setLoading(true)

    try {
      const [projectsResult, tasksResult, usersResult, updatesResult] = await Promise.allSettled([
        supabase.from('projects').select('*').order('created_at', { ascending: false }),
        supabase.from('tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('project_updates').select('*').order('created_at', { ascending: false }).limit(8),
      ])

      const projects =
        projectsResult.status === 'fulfilled' && !projectsResult.value.error
          ? projectsResult.value.data || []
          : []

      const tasks =
        tasksResult.status === 'fulfilled' && !tasksResult.value.error
          ? tasksResult.value.data || []
          : []

      const users =
        usersResult.status === 'fulfilled' && !usersResult.value.error
          ? usersResult.value.data || []
          : []

      const updatesAvailable =
        updatesResult.status === 'fulfilled' && !updatesResult.value.error

      const updates =
        updatesAvailable
          ? updatesResult.value.data || []
          : []

      setDashboardData({
        projects,
        tasks,
        users,
        updates,
        updatesAvailable,
      })
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
      setDashboardData({
        projects: [],
        tasks: [],
        users: [],
        updates: [],
        updatesAvailable: false,
      })
    } finally {
      setLoading(false)
    }
  }

  const derived = useMemo(() => {
    const projects = dashboardData.projects || []
    const tasks = dashboardData.tasks || []
    const users = dashboardData.users || []
    const updates = dashboardData.updates || []

    const activeProjects = projects.filter((project) => {
      const status = String(project.status || '').toLowerCase()
      return !['done', 'completed', 'archived'].includes(status)
    }).length

    const openTasks = tasks.filter((task) => task.status !== 'done').length
    const blockedTasks = tasks.filter((task) =>
      ['blocked', 'blocked_review'].includes(task.status)
    ).length

    const attentionQueue = tasks
      .filter((task) => {
        if (['blocked', 'blocked_review'].includes(task.status)) return true
        if (!task.due_date) return false
        return new Date(task.due_date) < new Date() && task.status !== 'done'
      })
      .slice(0, 6)
      .map((task) => ({
        id: task.id,
        title: task.title || task.name || 'Untitled task',
        status: normalizeStatus(task.status),
        dueDate: task.due_date,
      }))

    const projectSnapshot = projects.slice(0, 5).map((project) => {
      const relatedTasks = tasks.filter((task) => {
        return (
          task.project_id === project.id ||
          task.project === project.id ||
          task.project_name === project.name
        )
      })

      return {
        id: project.id,
        name: project.name || project.title || 'Untitled Project',
        status: normalizeStatus(project.status),
        owner: project.owner || project.owner_name || project.lead || 'Unassigned',
        signal: getProjectSignal(project, relatedTasks),
      }
    })

    return {
      activeProjects,
      openTasks,
      blockedTasks,
      peopleCount: users.length,
      attentionQueue,
      projectSnapshot,
      updates,
    }
  }, [dashboardData])

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton type="card" count={4} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Shared Dashboard</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            A cross-environment operating view for projects, work, people, and current attention points.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-800">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Core View
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            Shared project-centered summary
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            This is not a generic home screen
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active Projects"
          value={derived.activeProjects}
          change="Cross-environment work"
          trend="up"
          icon="🗂️"
          color="blue"
        />
        <StatCard
          label="Open Work"
          value={derived.openTasks}
          change="Execution in motion"
          trend="up"
          icon="⚙️"
          color="green"
        />
        <StatCard
          label="Blocked Work"
          value={derived.blockedTasks}
          change={derived.blockedTasks > 0 ? 'Needs visibility' : 'No blocker signal'}
          trend={derived.blockedTasks > 0 ? 'down' : 'up'}
          icon="🚧"
          color="yellow"
        />
        <StatCard
          label="People"
          value={derived.peopleCount}
          change="Org capacity"
          trend="up"
          icon="👥"
          color="purple"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card
          title="Project Snapshot"
          subtitle="A lightweight view of the shared portfolio and current operating signals."
        >
          {derived.projectSnapshot.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title="No shared project visibility yet"
              description="Projects will appear here once the shared core is populated."
            />
          ) : (
            <div className="space-y-3">
              {derived.projectSnapshot.map((project) => (
                <div
                  key={project.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {project.name}
                      </div>
                      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Owner: {project.owner}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{project.status}</Badge>
                      <Badge variant={project.signal.variant}>{project.signal.label}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Attention Queue"
          subtitle="Work that likely needs visibility before it becomes coordination drag."
        >
          {derived.attentionQueue.length === 0 ? (
            <EmptyState
              icon="🧭"
              title="No items need attention"
              description="Blocked and overdue work will appear here when present."
            />
          ) : (
            <div className="space-y-3">
              {derived.attentionQueue.map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {task.title}
                      </div>
                      {task.dueDate && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Due: {new Date(task.dueDate).toLocaleDateString()}
                        </div>
                      )}
                    </div>

                    <Badge variant={getTaskVariant(task.status)}>{task.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Recent Project Updates"
        subtitle="Project-level change visibility belongs in the shared core."
      >
        {!dashboardData.updatesAvailable ? (
          <EmptyState
            icon="📝"
            title="Project updates table not available"
            description="Recent update visibility can attach here once project_updates is present."
          />
        ) : derived.updates.length === 0 ? (
          <EmptyState
            icon="📝"
            title="No recent project updates"
            description="As teams begin posting project updates, the shared dashboard will surface them here."
          />
        ) : (
          <div className="space-y-3">
            {derived.updates.map((update) => (
              <div
                key={update.id}
                className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {update.title || update.project_name || 'Project update'}
                    </div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {update.summary || update.content || 'No summary available.'}
                    </div>
                  </div>

                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {update.created_at
                      ? new Date(update.created_at).toLocaleString()
                      : 'No timestamp'}
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
