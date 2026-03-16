import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Card from '../components/Card'
import StatCard from '../components/StatCard'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import AIPanel from '../components/AIPanel'

function normalizeStatus(value) {
  return String(value || 'unknown').replace(/[_-]/g, ' ').trim()
}

function getStatusVariant(status) {
  const normalized = String(status || '').toLowerCase()

  if (['done', 'completed'].includes(normalized)) return 'success'
  if (['blocked', 'blocked_review'].includes(normalized)) return 'danger'
  if (['in_progress', 'in progress', 'review', 'pending'].includes(normalized)) return 'warning'
  if (['active', 'planned', 'planning'].includes(normalized)) return 'primary'
  return 'default'
}

function getProjectSignal(project, relatedTasks = []) {
  const blockedCount = relatedTasks.filter((task) =>
    ['blocked', 'blocked_review'].includes(task.status)
  ).length

  if (blockedCount > 0) return { label: 'Technical blocker visible', variant: 'danger' }
  if (String(project?.priority || '').toLowerCase() === 'high') {
    return { label: 'High-priority execution', variant: 'warning' }
  }
  return { label: 'Execution stable', variant: 'success' }
}

export default function DevDashboard() {
  const [loading, setLoading] = useState(true)
  const [devData, setDevData] = useState({
    tasks: [],
    projects: [],
    sprints: [],
    docs: [],
    sprintsAvailable: true,
    docsAvailable: true,
  })

  useEffect(() => {
    fetchDevData()
  }, [])

  async function fetchDevData() {
    setLoading(true)

    try {
      const [tasksResult, projectsResult, sprintsResult, docsResult] = await Promise.allSettled([
        supabase.from('tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('projects').select('*').order('created_at', { ascending: false }),
        supabase.from('sprints').select('*').order('start_date', { ascending: false }),
        supabase.from('api_docs').select('*').order('category', { ascending: true }),
      ])

      const tasks =
        tasksResult.status === 'fulfilled' && !tasksResult.value.error
          ? tasksResult.value.data || []
          : []

      const projects =
        projectsResult.status === 'fulfilled' && !projectsResult.value.error
          ? projectsResult.value.data || []
          : []

      const sprintsAvailable =
        sprintsResult.status === 'fulfilled' && !sprintsResult.value.error

      const sprints =
        sprintsAvailable
          ? sprintsResult.value.data || []
          : []

      const docsAvailable =
        docsResult.status === 'fulfilled' && !docsResult.value.error

      const docs =
        docsAvailable
          ? docsResult.value.data || []
          : []

      setDevData({
        tasks,
        projects,
        sprints,
        docs,
        sprintsAvailable,
        docsAvailable,
      })
    } catch (error) {
      console.error('Failed to load development data:', error)
      setDevData({
        tasks: [],
        projects: [],
        sprints: [],
        docs: [],
        sprintsAvailable: false,
        docsAvailable: false,
      })
    } finally {
      setLoading(false)
    }
  }

  const derived = useMemo(() => {
    const tasks = devData.tasks || []
    const projects = devData.projects || []
    const sprints = devData.sprints || []
    const docs = devData.docs || []

    const openTasks = tasks.filter((task) => task.status !== 'done').length
    const inProgressTasks = tasks.filter((task) =>
      ['in_progress', 'review'].includes(task.status)
    ).length
    const blockedTasks = tasks.filter((task) =>
      ['blocked', 'blocked_review'].includes(task.status)
    ).length

    const activeSprint =
      sprints.find((sprint) =>
        ['active', 'in_progress', 'current'].includes(String(sprint.status || '').toLowerCase())
      ) ||
      sprints[0] ||
      null

    const executionProjects = projects.slice(0, 5).map((project) => {
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
        relatedTaskCount: relatedTasks.length,
      }
    })

    const queueSignals = tasks.slice(0, 6).map((task) => ({
      id: task.id,
      title: task.title || task.name || 'Untitled task',
      status: normalizeStatus(task.status),
      priority: task.priority ?? 'n/a',
      dueDate: task.due_date,
    }))

    return {
      openTasks,
      inProgressTasks,
      blockedTasks,
      sprintCount: sprints.length,
      docsCount: docs.length,
      activeSprint,
      executionProjects,
      queueSignals,
    }
  }, [devData])

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
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            Development Overview
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400 leading-7">
            A technical execution surface built around queue health, sprint context, blockers,
            docs, and assistant-guided support.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/80 px-5 py-4 bg-white/90 dark:bg-gray-800/90 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Development Environment
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            Execution first
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Queue, blockers, docs, terminal, assistant
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Open Work" value={derived.openTasks} change="Technical queue" trend="up" icon="🧩" color="blue" />
        <StatCard label="In Progress" value={derived.inProgressTasks} change="Execution in motion" trend="up" icon="⚙️" color="green" />
        <StatCard
          label="Blocked"
          value={derived.blockedTasks}
          change={derived.blockedTasks > 0 ? 'Needs attention' : 'No blocker pressure'}
          trend={derived.blockedTasks > 0 ? 'down' : 'up'}
          icon="🚧"
          color="yellow"
        />
        <StatCard label="Sprints" value={derived.sprintCount} change={devData.sprintsAvailable ? 'Sprint records available' : 'Sprint model unavailable'} trend="up" icon="🏁" color="purple" />
        <StatCard label="API Docs" value={derived.docsCount} change={devData.docsAvailable ? 'Support surface ready' : 'Docs unavailable'} trend="up" icon="📖" color="blue" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card
          title="Current Execution Context"
          subtitle="Development needs a calm, readable view of sprint timing and technical pressure."
        >
          {!devData.sprintsAvailable ? (
            <EmptyState
              icon="🏁"
              title="Sprints table not available"
              description="Development can still operate through queue and blocker views while sprint records are being shaped."
            />
          ) : !derived.activeSprint ? (
            <EmptyState
              icon="🏁"
              title="No active sprint found"
              description="Create or activate a sprint to surface current sprint goals and timing."
            />
          ) : (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-5 bg-gray-50/80 dark:bg-gray-900/80">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {derived.activeSprint.name || 'Unnamed sprint'}
                </h3>
                <Badge variant={getStatusVariant(derived.activeSprint.status)}>
                  {normalizeStatus(derived.activeSprint.status)}
                </Badge>
              </div>

              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 leading-6">
                {derived.activeSprint.goal || 'No sprint goal documented yet.'}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                {derived.activeSprint.start_date && (
                  <span>Start: {new Date(derived.activeSprint.start_date).toLocaleDateString()}</span>
                )}
                {derived.activeSprint.end_date && (
                  <>
                    <span>•</span>
                    <span>End: {new Date(derived.activeSprint.end_date).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            </div>
          )}
        </Card>

        <AIPanel
          title="Development Assistant"
          subtitle="Use the assistant for blocker summaries, task drafting, and environment-aware support."
          placeholder="Ask about blockers, queue changes, docs, or project actions..."
          compact
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Execution Projects"
          subtitle="A development lens on project momentum, blockers, and technical execution pressure."
        >
          {derived.executionProjects.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title="No development project context yet"
              description="Projects with related technical tasks will surface here."
            />
          ) : (
            <div className="space-y-3">
              {derived.executionProjects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50/80 dark:bg-gray-900/80"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {project.name}
                      </div>
                      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Owner: {project.owner} • Tasks: {project.relatedTaskCount}
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
          title="Queue Signals"
          subtitle="A quick read on the work currently shaping development flow."
        >
          {derived.queueSignals.length === 0 ? (
            <EmptyState
              icon="📋"
              title="No queue signals found"
              description="Tasks will appear here as development work enters the shared core."
            />
          ) : (
            <div className="space-y-3">
              {derived.queueSignals.map((task) => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50/80 dark:bg-gray-900/80"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {task.title}
                      </div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Priority: {task.priority}
                        {task.dueDate ? ` • Due: ${new Date(task.dueDate).toLocaleDateString()}` : ''}
                      </div>
                    </div>

                    <Badge variant={getStatusVariant(task.status)}>{task.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
