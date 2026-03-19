import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

const PHASE_LABELS = {
  product_modeling: 'Product Modeling',
  development: 'Development',
  marketing: 'Marketing',
}
const PHASE_COLORS = {
  product_modeling: 'bg-purple-500',
  development: 'bg-blue-500',
  marketing: 'bg-green-500',
}
const STATUS_COLORS = {
  todo: 'bg-gray-700 text-gray-300',
  in_progress: 'bg-blue-900/50 text-blue-300',
  done: 'bg-green-900/50 text-green-300',
  blocked: 'bg-red-900/50 text-red-300',
}
const PRIORITY_COLORS = {
  low: 'text-gray-400',
  medium: 'text-blue-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
}

export default function AnkaSphereTeamBoard() {
  const { profile, user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('mine') // mine | all | unassigned
  const [filterProject, setFilterProject] = useState('all')
  const [filterPhase, setFilterPhase] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selectedMember, setSelectedMember] = useState('all')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [tasksRes, projectsRes, membersRes] = await Promise.all([
      supabase.from('as_tasks').select(`
        *,
        as_projects(id, name, current_phase, as_clients(name))
      `).order('created_at', { ascending: false }),
      supabase.from('as_projects').select('id, name, current_phase, as_clients(name)').order('name'),
      supabase.from('profiles').select('id, full_name, email, department, role').order('full_name'),
    ])
    setTasks(tasksRes.data || [])
    setProjects(projectsRes.data || [])
    setMembers(membersRes.data || [])
    setLoading(false)
  }

  async function updateTaskStatus(taskId, status) {
    await supabase.from('as_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', taskId)
    setTasks(tasks.map(t => t.id === taskId ? { ...t, status } : t))
  }

  async function assignTask(taskId, userId) {
    await supabase.from('as_tasks').update({ assigned_to: userId || null, updated_at: new Date().toISOString() }).eq('id', taskId)
    setTasks(tasks.map(t => t.id === taskId ? { ...t, assigned_to: userId } : t))
  }

  function getMemberName(userId) {
    const m = members.find(m => m.id === userId)
    return m?.full_name || m?.email || 'Unassigned'
  }

  function getMemberInitial(userId) {
    const m = members.find(m => m.id === userId)
    return (m?.full_name || m?.email || '?')[0].toUpperCase()
  }

  // Filter tasks
  let filtered = [...tasks]
  if (viewMode === 'mine') filtered = filtered.filter(t => t.assigned_to === user?.id)
  if (viewMode === 'unassigned') filtered = filtered.filter(t => !t.assigned_to)
  if (filterProject !== 'all') filtered = filtered.filter(t => t.project_id === filterProject)
  if (filterPhase !== 'all') filtered = filtered.filter(t => t.phase === filterPhase)
  if (filterStatus !== 'all') filtered = filtered.filter(t => t.status === filterStatus)
  if (selectedMember !== 'all' && viewMode === 'all') filtered = filtered.filter(t => t.assigned_to === selectedMember)

  // Group by status for kanban
  const columns = {
    todo: filtered.filter(t => t.status === 'todo'),
    in_progress: filtered.filter(t => t.status === 'in_progress'),
    blocked: filtered.filter(t => t.status === 'blocked'),
    done: filtered.filter(t => t.status === 'done'),
  }

  // Stats
  const myTasks = tasks.filter(t => t.assigned_to === user?.id)
  const myBlocked = myTasks.filter(t => t.status === 'blocked').length
  const myDue = myTasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done').length

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-gray-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-white">Team Board</h2>
            <p className="text-xs text-gray-400 mt-0.5">All Sphere tasks across all projects</p>
          </div>
          <button onClick={fetchAll} className="text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700">↻ Refresh</button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: 'My Tasks', value: myTasks.filter(t => t.status !== 'done').length, color: 'text-white' },
            { label: 'In Progress', value: myTasks.filter(t => t.status === 'in_progress').length, color: 'text-blue-400' },
            { label: 'Blocked', value: myBlocked, color: myBlocked > 0 ? 'text-red-400' : 'text-gray-500' },
            { label: 'Overdue', value: myDue, color: myDue > 0 ? 'text-yellow-400' : 'text-gray-500' },
          ].map(s => (
            <div key={s.label} className="bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode */}
          <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
            {[['mine', 'My Tasks'], ['all', 'All Tasks'], ['unassigned', 'Unassigned']].map(([v, l]) => (
              <button key={v} onClick={() => setViewMode(v)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === v ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Project filter */}
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
            className="bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5 border border-gray-700 focus:outline-none">
            <option value="all">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {/* Phase filter */}
          <select value={filterPhase} onChange={e => setFilterPhase(e.target.value)}
            className="bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5 border border-gray-700 focus:outline-none">
            <option value="all">All Phases</option>
            {Object.entries(PHASE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          {/* Member filter (only in all mode) */}
          {viewMode === 'all' && (
            <select value={selectedMember} onChange={e => setSelectedMember(e.target.value)}
              className="bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5 border border-gray-700 focus:outline-none">
              <option value="all">All Members</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
            </select>
          )}

          <span className="text-xs text-gray-500 ml-auto">{filtered.length} tasks</span>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4 h-full min-w-max">
          {Object.entries(columns).map(([status, statusTasks]) => (
            <div key={status} className="w-72 flex flex-col">
              {/* Column header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    status === 'done' ? 'bg-green-500' :
                    status === 'in_progress' ? 'bg-blue-500' :
                    status === 'blocked' ? 'bg-red-500' : 'bg-gray-500'
                  }`} />
                  <span className="text-sm font-semibold text-white capitalize">{status.replace(/_/g, ' ')}</span>
                </div>
                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700">{statusTasks.length}</span>
              </div>

              {/* Cards */}
              <div className="flex-1 space-y-3 overflow-y-auto">
                {statusTasks.map(task => (
                  <div key={task.id} className={`bg-gray-800 rounded-xl p-4 border transition-colors ${
                    task.status === 'blocked' ? 'border-red-700/50' :
                    task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done' ? 'border-yellow-700/50' :
                    'border-gray-700 hover:border-purple-500/50'
                  }`}>
                    {/* Project + phase badge */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${PHASE_COLORS[task.phase] || 'bg-gray-500'}`} />
                      <span className="text-xs text-gray-500 truncate">{task.as_projects?.name || 'Unknown project'}</span>
                    </div>

                    {/* Task title */}
                    <p className={`text-sm font-medium mb-2 ${task.status === 'done' ? 'line-through text-gray-500' : 'text-white'}`}>
                      {task.title}
                    </p>

                    {task.description && (
                      <p className="text-xs text-gray-500 mb-3 line-clamp-2">{task.description}</p>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between gap-2">
                      {/* Assignee */}
                      <select value={task.assigned_to || ''} onChange={e => assignTask(task.id, e.target.value)}
                        className="flex-1 bg-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500 truncate">
                        <option value="">Unassigned</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                      </select>

                      {/* Status */}
                      <select value={task.status} onChange={e => updateTaskStatus(task.id, e.target.value)}
                        className={`text-xs px-2 py-1 rounded-lg border-0 focus:outline-none ${STATUS_COLORS[task.status]}`}>
                        <option value="todo">Todo</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </div>

                    {/* Due date + priority */}
                    <div className="flex items-center justify-between mt-2">
                      <span className={`text-xs ${PRIORITY_COLORS[task.priority] || 'text-gray-500'}`}>
                        {task.priority || 'medium'}
                      </span>
                      {task.due_date && (
                        <span className={`text-xs ${new Date(task.due_date) < new Date() && task.status !== 'done' ? 'text-red-400' : 'text-gray-500'}`}>
                          {new Date(task.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {statusTasks.length === 0 && (
                  <div className="border border-dashed border-gray-700 rounded-xl p-6 text-center text-gray-600">
                    <p className="text-xs">No tasks</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
