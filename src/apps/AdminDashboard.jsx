import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Card from '../components/Card'
import StatCard from '../components/StatCard'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import LoadingSkeleton from '../components/LoadingSkeleton'

function normalizeDepartmentName(value) {
  if (!value) return 'Unassigned'
  return String(value)
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCase(value) {
  return normalizeDepartmentName(value)
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function inferProjectHealth(project, relatedTasks = []) {
  const status = project?.status || ''
  const blockedTasks = relatedTasks.filter((task) => ['blocked', 'blocked_review'].includes(task.status)).length
  const overdueTasks = relatedTasks.filter((task) => {
    if (!task.due_date) return false
    return new Date(task.due_date) < new Date() && task.status !== 'done'
  }).length

  if (blockedTasks > 0) return 'At Risk'
  if (overdueTasks > 0) return 'Needs Attention'
  if (status === 'completed' || status === 'done') return 'Stable'
  return 'Active'
}

function inferHealthVariant(health) {
  if (health === 'At Risk') return 'danger'
  if (health === 'Needs Attention') return 'warning'
  if (health === 'Stable') return 'success'
  return 'default'
}

function inferDecisionState(project) {
  if (!project) return 'No signal'
  if (project.priority === 'high' || project.priority === 'urgent') return 'Review priority'
  if (project.status === 'planning') return 'Scope decision'
  if (project.status === 'blocked') return 'Escalation needed'
  return 'Tracked'
}

export default function AdminDashboard() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [adminData, setAdminData] = useState({
    users: [],
    departments: [],
    tasks: [],
    projects: [],
    projectsAvailable: true,
  })

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchAdminData()
    }
  }, [profile])

  async function fetchAdminData() {
    setLoading(true)

    try {
      const [profilesResult, departmentsResult, tasksResult, projectsResult] = await Promise.allSettled([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('departments').select('*').order('name'),
        supabase.from('tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('projects').select('*').order('created_at', { ascending: false }),
      ])

      const profiles =
        profilesResult.status === 'fulfilled' && !profilesResult.value.error
          ? profilesResult.value.data || []
          : []

      const departments =
        departmentsResult.status === 'fulfilled' && !departmentsResult.value.error
          ? departmentsResult.value.data || []
          : []

      const tasks =
        tasksResult.status === 'fulfilled' && !tasksResult.value.error
          ? tasksResult.value.data || []
          : []

      const projectsAvailable =
        projectsResult.status === 'fulfilled' && !projectsResult.value.error

      const projects =
        projectsAvailable
          ? projectsResult.value.data || []
          : []

      setAdminData({
        users: profiles,
        departments,
        tasks,
        projects,
        projectsAvailable,
      })
    } catch (error) {
      console.error('Failed to load admin dashboard data:', error)
      setAdminData({
        users: [],
        departments: [],
        tasks: [],
        projects: [],
        projectsAvailable: false,
      })
    } finally {
      setLoading(false)
    }
  }

  const derived = useMemo(() => {
    const users = adminData.users || []
    const departments = adminData.departments || []
    const tasks = adminData.tasks || []
    const projects = adminData.projects || []

    const admins = users.filter((user) => user.role === 'admin').length
    const activeTasks = tasks.filter((task) => task.status !== 'done').length
    const blockedTasks = tasks.filter((task) =>
      ['blocked', 'blocked_review'].includes(task.status)
    ).length
    const overdueTasks = tasks.filter((task) => {
      if (!task.due_date) return false
      return new Date(task.due_date) < new Date() && task.status !== 'done'
    }).length

    const usersByDepartment = users.reduce((acc, user) => {
      const key = normalizeDepartmentName(user.department)
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const departmentCoverage = Object.entries(usersByDepartment)
      .map(([department, count]) => ({
        department: titleCase(department),
        members: count,
        admins: users.filter(
          (user) => normalizeDepartmentName(user.department) === department && user.role === 'admin'
        ).length,
      }))
      .sort((a, b) => b.members - a.members)

    const portfolioRows = (projects || []).slice(0, 6).map((project) => {
      const relatedTasks = tasks.filter((task) => {
        return (
          task.project_id === project.id ||
          task.project === project.id ||
          task.project_name === project.name
        )
      })

      const blockerCount = relatedTasks.filter((task) =>
        ['blocked', 'blocked_review'].includes(task.status)
      ).length

      const health = inferProjectHealth(project, relatedTasks)

      return {
        id: project.id,
        name: project.name || project.title || 'Untitled Project',
        owner: project.owner || project.owner_name || project.lead || 'Unassigned',
        status: project.status || 'unknown',
        blockers: blockerCount,
        health,
        decisionState: inferDecisionState(project),
      }
    })

    const latestTasks = tasks.slice(0, 8).map((task) => ({
      id: task.id,
      title: task.title || task.name || 'Untitled task',
      status: task.status || 'unknown',
      due_date: task.due_date,
      assignee: task.assignee || task.owner || 'Unassigned',
    }))

    const governanceSignals = [
      {
        label: 'Rules surface',
        value: 'Settings route active',
        tone: 'Tracked in Admin shell',
      },
      {
        label: 'Permissions posture',
        value: `${admins} admin account${admins === 1 ? '' : 's'}`,
        tone: admins > 3 ? 'Review admin sprawl' : 'Within expected range',
      },
      {
        label: 'Decision visibility',
        value: portfolioRows.length > 0 ? 'Project-level decision cues available' : 'No project cues yet',
        tone: 'Dedicated decisions model can attach later',
      },
    ]

    return {
      totalUsers: users.length,
      totalDepartments: departments.length || Object.keys(usersByDepartment).length,
      totalProjects: projects.length,
      activeTasks,
      blockedTasks,
      overdueTasks,
      admins,
      departmentCoverage,
      portfolioRows,
      latestTasks,
      governanceSignals,
    }
  }, [adminData])

  if (!profile) return null

  if (profile.role !== 'admin') {
    return <Navigate to="/dev-dashboard" replace />
  }

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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Admin Overview</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Organizational oversight across portfolio health, execution risk, and team coverage.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-800">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Current Lens
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            Admin environment
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Org spine and cross-project visibility
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active Projects"
          value={derived.totalProjects}
          change={derived.totalProjects > 0 ? 'Portfolio in view' : 'No projects yet'}
          trend="up"
          icon="🗂️"
          color="blue"
        />
        <StatCard
          label="Open Work"
          value={derived.activeTasks}
          change={`${derived.blockedTasks} blocked`}
          trend={derived.blockedTasks > 0 ? 'down' : 'up'}
          icon="🧩"
          color="yellow"
        />
        <StatCard
          label="People"
          value={derived.totalUsers}
          change={`${derived.admins} admins`}
          trend="up"
          icon="👥"
          color="purple"
        />
        <StatCard
          label="Departments"
          value={derived.totalDepartments}
          change={derived.overdueTasks > 0 ? `${derived.overdueTasks} overdue tasks` : 'No overdue signal'}
          trend={derived.overdueTasks > 0 ? 'down' : 'up'}
          icon="🏛️"
          color="green"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card
          title="Portfolio Health"
          subtitle="A cross-project view built for oversight rather than execution detail."
        >
          {!adminData.projectsAvailable ? (
            <EmptyState
              icon="🗂️"
              title="Projects table not available"
              description="Admin can still oversee people and task signals, but portfolio rows will appear once project records are available."
            />
          ) : derived.portfolioRows.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title="No projects in portfolio"
              description="As project records land in the shared core, admin portfolio visibility will appear here."
            />
          ) : (
            <div className="space-y-3">
              {derived.portfolioRows.map((project) => (
                <div
                  key={project.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {project.name}
                      </div>
                      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Owner: {project.owner}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={inferHealthVariant(project.health)}>{project.health}</Badge>
                      <Badge>{project.status}</Badge>
                      <Badge variant={project.blockers > 0 ? 'danger' : 'success'}>
                        {project.blockers} blockers
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-md bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Decision signal
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                        {project.decisionState}
                      </div>
                    </div>

                    <div className="rounded-md bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Oversight note
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                        {project.blockers > 0
                          ? 'Escalation path should stay visible in admin.'
                          : 'Project is moving without current blocker pressure.'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Governance Signals"
          subtitle="Early admin-facing indicators for rules, permissions, and coordination posture."
        >
          <div className="space-y-3">
            {derived.governanceSignals.map((signal) => (
              <div
                key={signal.label}
                className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"
              >
                <div className="text-sm font-semibold text-gray-900 dark:text-white">
                  {signal.label}
                </div>
                <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  {signal.value}
                </div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {signal.tone}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Department Coverage"
          subtitle="Admin should understand where people are concentrated and where oversight may be thin."
        >
          {derived.departmentCoverage.length === 0 ? (
            <EmptyState
              icon="🏛️"
              title="No department structure yet"
              description="Department coverage will appear once people are assigned into the organizational spine."
            />
          ) : (
            <div className="space-y-3">
              {derived.departmentCoverage.map((dept) => (
                <div
                  key={dept.department}
                  className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {dept.department}
                    </div>
                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {dept.members} member{dept.members === 1 ? '' : 's'} • {dept.admins} admin{dept.admins === 1 ? '' : 's'}
                    </div>
                  </div>

                  <Badge variant={dept.members <= 1 ? 'warning' : 'success'}>
                    {dept.members <= 1 ? 'Thin coverage' : 'Covered'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Execution Pressure"
          subtitle="Cross-project work signals that need administrative awareness."
        >
          {derived.latestTasks.length === 0 ? (
            <EmptyState
              icon="🧩"
              title="No task activity found"
              description="Task-level execution signals will appear here as work enters the shared core."
            />
          ) : (
            <div className="space-y-3">
              {derived.latestTasks.map((task) => {
                const isBlocked = ['blocked', 'blocked_review'].includes(task.status)
                const isDone = task.status === 'done'

                return (
                  <div
                    key={task.id}
                    className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {task.title}
                      </div>
                      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Assignee: {task.assignee}
                      </div>
                      {task.due_date && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Due: {new Date(task.due_date).toLocaleDateString()}
                        </div>
                      )}
                    </div>

                    <Badge
                      variant={
                        isBlocked ? 'danger' : isDone ? 'success' : 'warning'
                      }
                    >
                      {task.status}
                    </Badge>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
