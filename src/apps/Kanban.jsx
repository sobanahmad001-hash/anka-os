import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Badge from '../components/Badge'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'

const COLUMN_ORDER = ['todo', 'in_progress', 'blocked', 'done']

const COLUMN_META = {
  todo: { title: 'Todo', subtitle: 'Ready to be picked up' },
  in_progress: { title: 'In Progress', subtitle: 'Work actively moving' },
  blocked: { title: 'Blocked', subtitle: 'Needs resolution or escalation' },
  done: { title: 'Done', subtitle: 'Completed execution' },
}

function getPriorityLabel(priority) {
  const value = Number(priority)

  if (value >= 5) return { label: 'Critical', variant: 'danger' }
  if (value >= 3) return { label: 'High', variant: 'warning' }
  if (value >= 1) return { label: 'Normal', variant: 'success' }
  return { label: 'Unset', variant: 'default' }
}

function normalizeTaskStatus(status) {
  const normalized = String(status || '').toLowerCase()

  if (normalized === 'todo') return 'todo'
  if (['in_progress', 'review'].includes(normalized)) return 'in_progress'
  if (['blocked', 'blocked_review'].includes(normalized)) return 'blocked'
  if (['done', 'completed'].includes(normalized)) return 'done'

  return 'todo'
}

export default function Kanban() {
  const [taskRows, setTaskRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'todo',
    priority: 3,
    due_date: '',
  })

  useEffect(() => {
    fetchTasks()
  }, [])

  async function fetchTasks() {
    setLoading(true)

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching tasks:', error)
      setTaskRows([])
    } else {
      setTaskRows(data || [])
    }

    setLoading(false)
  }

  async function updateTaskStatus(taskId, newStatus) {
    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus })
      .eq('id', taskId)

    if (!error) fetchTasks()
  }

  async function createTask(e) {
    e.preventDefault()
    if (!form.title.trim()) return

    setCreating(true)

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      priority: Number(form.priority),
      due_date: form.due_date || null,
    }

    const { error } = await supabase.from('tasks').insert([payload])

    setCreating(false)

    if (error) {
      console.error('Create task error:', error)
      alert(`Could not create task: ${error.message}`)
      return
    }

    setForm({
      title: '',
      description: '',
      status: 'todo',
      priority: 3,
      due_date: '',
    })
    setShowCreate(false)
    fetchTasks()
  }

  const groupedTasks = useMemo(() => {
    const groups = {
      todo: [],
      in_progress: [],
      blocked: [],
      done: [],
    }

    taskRows.forEach((task) => {
      const status = normalizeTaskStatus(task.status)
      groups[status].push(task)
    })

    return groups
  }, [taskRows])

  const summary = useMemo(() => {
    return {
      total: taskRows.length,
      blocked: groupedTasks.blocked.length,
      inProgress: groupedTasks.in_progress.length,
      done: groupedTasks.done.length,
    }
  }, [taskRows, groupedTasks])

  if (loading) return <div className="p-6">Loading development queue...</div>

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Sprint / Queue</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400 leading-7">
            Move technical work through execution, surface blockers early, and keep delivery visible.
          </p>
        </div>

        <button
          onClick={() => setShowCreate((prev) => !prev)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-white font-medium hover:bg-blue-700 transition-colors"
        >
          {showCreate ? 'Hide Form' : 'New Task'}
        </button>
      </div>

      {showCreate && (
        <Card
          title="Create Task"
          subtitle="A lightweight queue entry flow for development testing."
          action={
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-xl border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-200"
            >
              Close
            </button>
          }
        >
          <form onSubmit={createTask} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Task title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-800 dark:text-white"
                placeholder="Investigate auth state regression"
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
                placeholder="Add the technical notes or next step details"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-800 dark:text-white"
              >
                <option value="todo">Todo</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-800 dark:text-white"
              >
                <option value={1}>Low</option>
                <option value={3}>Normal</option>
                <option value={5}>Critical</option>
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
                {creating ? 'Creating...' : 'Create Task'}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title="Queue Summary"
        subtitle="Development execution is healthiest when blocked work is visible, not hidden inside progress."
      >
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-gray-50/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">Total</div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.total}</div>
          </div>
          <div className="rounded-2xl bg-gray-50/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">In Progress</div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.inProgress}</div>
          </div>
          <div className="rounded-2xl bg-gray-50/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">Blocked</div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.blocked}</div>
          </div>
          <div className="rounded-2xl bg-gray-50/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">Done</div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.done}</div>
          </div>
        </div>
      </Card>

      {summary.total === 0 ? (
        <Card>
          <EmptyState
            icon="📋"
            title="No development tasks found"
            description="Create technical work items to start shaping the queue."
          />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-4">
          {COLUMN_ORDER.map((status) => (
            <div
              key={status}
              className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/80 p-4"
              onDrop={(e) => {
                e.preventDefault()
                const draggedTaskId = e.dataTransfer.getData('taskId')
                updateTaskStatus(draggedTaskId, status)
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {COLUMN_META[status].title} ({groupedTasks[status].length})
                </h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {COLUMN_META[status].subtitle}
                </p>
              </div>

              <div className="space-y-3">
                {groupedTasks[status].length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">
                    No tasks here.
                  </div>
                ) : (
                  groupedTasks[status].map((task) => {
                    const priority = getPriorityLabel(task.priority)

                    return (
                      <div
                        key={task.id}
                        className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 p-4 shadow-sm cursor-move"
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('taskId', task.id)}
                      >
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">
                          {task.title || task.name || 'Untitled task'}
                        </div>

                        {task.description && (
                          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-6 line-clamp-3">
                            {task.description}
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Badge variant={priority.variant} size="sm">
                            {priority.label}
                          </Badge>

                          {task.due_date && (
                            <Badge size="sm">
                              Due {new Date(task.due_date).toLocaleDateString()}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
