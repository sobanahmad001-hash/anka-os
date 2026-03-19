import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
const PHASES = ['product_modeling', 'development', 'marketing']
const PHASE_LABELS = {
  product_modeling: 'Product Modeling',
  development: 'Development',
  marketing: 'Marketing',
  completed: 'Completed'
}
const PHASE_COLORS = {
  product_modeling: 'bg-purple-500',
  development: 'bg-blue-500',
  marketing: 'bg-green-500',
  completed: 'bg-gray-500'
}
const STATUS_COLORS = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  pending_handoff: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  pending_client_approval: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  on_hold: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
}
export default function AnkaSphereProjects() {
  const { profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [phases, setPhases] = useState([])
  const [handoffs, setHandoffs] = useState([])
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('projects') // projects | detail | new_project | new_task
  const [activeTab, setActiveTab] = useState('overview') // overview | tasks | timeline | handoffs
  const [newProject, setNewProject] = useState({ name: '', description: '', client_id: '', budget: '', deadline: '' })
  const [newTask, setNewTask] = useState({ title: '', description: '', phase: 'product_modeling', due_date: '' })
  const [filterPhase, setFilterPhase] = useState('all')
  useEffect(() => { fetchProjects(); fetchClients() }, [])
  async function fetchProjects() {
    setLoading(true)
    const { data } = await supabase
      .from('as_projects')
      .select('*, as_clients(name, company)')
      .order('created_at', { ascending: false })
    setProjects(data || [])
    setLoading(false)
  }
  async function fetchClients() {
    const { data } = await supabase.from('as_clients').select('id, name, company').order('name')
    setClients(data || [])
  }
  async function fetchProjectDetail(project) {
    setSelectedProject(project)
    setView('detail')
    setActiveTab('overview')
    const [tasksRes, phasesRes, handoffsRes, timelineRes] = await Promise.all([
      supabase.from('as_tasks').select('*').eq('project_id', project.id).order('created_at'),
      supabase.from('as_project_phases').select('*').eq('project_id', project.id),
      supabase.from('as_handoff_requests').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      supabase.from('as_timeline_events').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(30)
    ])
    setTasks(tasksRes.data || [])
    setPhases(phasesRes.data || [])
    setHandoffs(handoffsRes.data || [])
    setTimeline(timelineRes.data || [])
  }
  async function createProject() {
    if (!newProject.name) return
    const { data, error } = await supabase.from('as_projects').insert({
      ...newProject,
      budget: newProject.budget ? parseFloat(newProject.budget) : null,
      created_by: profile?.id
    }).select().single()
    if (!error && data) {
      // auto-create phases
      await supabase.from('as_project_phases').insert(
        PHASES.map(phase => ({ project_id: data.id, phase, status: phase === 'product_modeling' ? 'in_progress' : 'not_started' }))
      )
      await supabase.from('as_timeline_events').insert({
        project_id: data.id, event_type: 'project_created',
        description: `Project "${data.name}" created`, created_by: profile?.id
      })
      setNewProject({ name: '', description: '', client_id: '', budget: '', deadline: '' })
      setView('projects')
      fetchProjects()
    }
  }
  async function createTask() {
    if (!newTask.title || !selectedProject) return
    const { error } = await supabase.from('as_tasks').insert({
      ...newTask, project_id: selectedProject.id, created_by: profile?.id
    })
    if (!error) {
      await supabase.from('as_timeline_events').insert({
        project_id: selectedProject.id, event_type: 'task_created',
        description: `Task "${newTask.title}" created in ${PHASE_LABELS[newTask.phase]}`,
        created_by: profile?.id
      })
      setNewTask({ title: '', description: '', phase: 'product_modeling', due_date: '' })
      setView('detail')
      fetchProjectDetail(selectedProject)
    }
  }
  async function updateTaskStatus(taskId, status) {
    await supabase.from('as_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', taskId)
    const task = tasks.find(t => t.id === taskId)
    if (status === 'done') {
      await supabase.from('as_timeline_events').insert({
        project_id: selectedProject.id, event_type: 'task_completed',
        description: `Task "${task?.title}" completed`, created_by: profile?.id
      })
      await checkPhaseCompletion(task?.phase)
    }
    fetchProjectDetail(selectedProject)
  }
  async function checkPhaseCompletion(phase) {
    const phaseTasks = tasks.filter(t => t.phase === phase && !t.is_prep_task)
    const allDone = phaseTasks.every(t => t.status === 'done')
    if (allDone && phaseTasks.length > 0) {
      await supabase.from('as_handoff_requests').insert({
        project_id: selectedProject.id,
        from_phase: phase,
        to_phase: phase === 'product_modeling' ? 'development' : 'marketing',
        status: 'pending',
        requested_by: profile?.id,
        handoff_brief: { phase, tasks_completed: phaseTasks.length, auto_triggered: true }
      })
      await supabase.from('as_timeline_events').insert({
        project_id: selectedProject.id, event_type: 'handoff_requested',
        description: `All ${PHASE_LABELS[phase]} tasks done — handoff requested`,
        created_by: profile?.id
      })
      await supabase.from('as_projects').update({ status: 'pending_handoff' }).eq('id', selectedProject.id)
    }
  }
  async function approveHandoff(handoffId, handoff) {
    await supabase.from('as_handoff_requests').update({
      status: 'approved', reviewed_by: profile?.id, reviewed_at: new Date().toISOString()
    }).eq('id', handoffId)
    await supabase.from('as_project_phases').update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('project_id', selectedProject.id).eq('phase', handoff.from_phase)
    await supabase.from('as_project_phases').update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('project_id', selectedProject.id).eq('phase', handoff.to_phase)
    await supabase.from('as_projects').update({ current_phase: handoff.to_phase, status: 'active' }).eq('id', selectedProject.id)
    await supabase.from('as_timeline_events').insert({
      project_id: selectedProject.id, event_type: 'handoff_approved',
      description: `Handoff from ${PHASE_LABELS[handoff.from_phase]} to ${PHASE_LABELS[handoff.to_phase]} approved`,
      created_by: profile?.id
    })
    fetchProjectDetail({ ...selectedProject, current_phase: handoff.to_phase })
    fetchProjects()
  }
  async function rejectHandoff(handoffId, notes) {
    await supabase.from('as_handoff_requests').update({
      status: 'rejected', reviewed_by: profile?.id,
      reviewed_at: new Date().toISOString(), review_notes: notes
    }).eq('id', handoffId)
    await supabase.from('as_projects').update({ status: 'active' }).eq('id', selectedProject.id)
    fetchProjectDetail(selectedProject)
  }
  function getPhaseProgress(phase) {
    const phaseTasks = tasks.filter(t => t.phase === phase && !t.is_prep_task)
    if (!phaseTasks.length) return 0
    const done = phaseTasks.filter(t => t.status === 'done').length
    return Math.round((done / phaseTasks.length) * 100)
  }
  const filteredProjects = filterPhase === 'all' ? projects : projects.filter(p => p.current_phase === filterPhase)
  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  )
  // NEW PROJECT FORM
  if (view === 'new_project') return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setView('projects')} className="text-gray-400 hover:text-white transition-colors">←</button>
        <h2 className="text-xl font-bold text-white">New Project</h2>
      </div>
      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Project Name *</label>
          <input value={newProject.name} onChange={e => setNewProject({...newProject, name: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="e.g. Brand System Rebuild" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Description</label>
          <textarea value={newProject.description} onChange={e => setNewProject({...newProject, description: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
            rows={3} placeholder="Project overview..." />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Client</label>
            <select value={newProject.client_id} onChange={e => setNewProject({...newProject, client_id: e.target.value})}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
              <option value="">No client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name} {c.company ? `— ${c.company}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Budget ($)</label>
            <input type="number" value={newProject.budget} onChange={e => setNewProject({...newProject, budget: e.target.value})}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="50000" />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Deadline</label>
          <input type="date" value={newProject.deadline} onChange={e => setNewProject({...newProject, deadline: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={createProject}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors">
            Create Project
          </button>
          <button onClick={() => setView('projects')}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
  // NEW TASK FORM
  if (view === 'new_task') return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setView('detail')} className="text-gray-400 hover:text-white transition-colors">←</button>
        <h2 className="text-xl font-bold text-white">Add Task — {selectedProject?.name}</h2>
      </div>
      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Task Title *</label>
          <input value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="e.g. Define service scope" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Description</label>
          <textarea value={newTask.description} onChange={e => setNewTask({...newTask, description: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
            rows={3} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Phase</label>
            <select value={newTask.phase} onChange={e => setNewTask({...newTask, phase: e.target.value})}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
              {PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Due Date</label>
            <input type="date" value={newTask.due_date} onChange={e => setNewTask({...newTask, due_date: e.target.value})}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={createTask}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors">
            Add Task
          </button>
          <button onClick={() => setView('detail')}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
  // PROJECT DETAIL
  if (view === 'detail' && selectedProject) {
    const pendingHandoffs = handoffs.filter(h => h.status === 'pending')
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('projects'); setSelectedProject(null) }}
              className="text-gray-400 hover:text-white transition-colors text-lg">←</button>
            <div>
              <h2 className="text-lg font-bold text-white">{selectedProject.name}</h2>
              <p className="text-xs text-gray-400">{selectedProject.as_clients?.name || 'No client'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[selectedProject.status]}`}>
              {selectedProject.status?.replace(/_/g, ' ')}
            </span>
            <button onClick={() => setView('new_task')}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
              + Add Task
            </button>
          </div>
        </div>
        {/* Pending handoff banner */}
        {pendingHandoffs.length > 0 && (
          <div className="mx-6 mt-4 bg-yellow-900/40 border border-yellow-600/50 rounded-lg p-3">
            <p className="text-yellow-300 text-sm font-medium mb-2">⚡ Handoff Approval Needed</p>
            {pendingHandoffs.map(h => (
              <div key={h.id} className="flex items-center justify-between">
                <p className="text-yellow-200 text-xs">
                  {PHASE_LABELS[h.from_phase]} → {PHASE_LABELS[h.to_phase]}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => approveHandoff(h.id, h)}
                    className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 rounded transition-colors">
                    Approve
                  </button>
                  <button onClick={() => rejectHandoff(h.id, 'Needs more work')}
                    className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded transition-colors">
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4">
          {['overview', 'tasks', 'timeline', 'handoffs'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                activeTab === tab ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}>
              {tab}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Phase progress */}
              <div className="bg-gray-800 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Phase Progress</h3>
                <div className="flex items-center gap-2">
                  {PHASES.map((phase, i) => {
                    const progress = getPhaseProgress(phase)
                    const isActive = selectedProject.current_phase === phase
                    const isComplete = phases.find(p => p.phase === phase)?.status === 'completed'
                    return (
                      <div key={phase} className="flex-1">
                        <div className={`rounded-lg p-3 border ${
                          isActive ? 'border-purple-500 bg-purple-900/20' :
                          isComplete ? 'border-green-500/30 bg-green-900/10' : 'border-gray-700 bg-gray-700/30'
                        }`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-medium ${isActive ? 'text-purple-300' : isComplete ? 'text-green-400' : 'text-gray-500'}`}>
                              {PHASE_LABELS[phase]}
                            </span>
                            <span className="text-xs text-gray-400">{progress}%</span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full transition-all ${isComplete ? 'bg-green-500' : isActive ? 'bg-purple-500' : 'bg-gray-600'}`}
                              style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                        {i < PHASES.length - 1 && (
                          <div className="flex justify-end mt-1 mr-0">
                            <span className="text-gray-600 text-xs">→</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Total Tasks', value: tasks.filter(t => !t.is_prep_task).length },
                  { label: 'Completed', value: tasks.filter(t => t.status === 'done').length, color: 'text-green-400' },
                  { label: 'Blocked', value: tasks.filter(t => t.status === 'blocked').length, color: 'text-red-400' }
                ].map(stat => (
                  <div key={stat.label} className="bg-gray-800 rounded-xl p-4 text-center">
                    <p className={`text-2xl font-bold ${stat.color || 'text-white'}`}>{stat.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>
              {/* Project info */}
              <div className="bg-gray-800 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-gray-300">Project Details</h3>
                {selectedProject.description && <p className="text-sm text-gray-400">{selectedProject.description}</p>}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {selectedProject.budget && (
                    <div><span className="text-gray-500">Budget: </span><span className="text-gray-300">${Number(selectedProject.budget).toLocaleString()}</span></div>
                  )}
                  {selectedProject.deadline && (
                    <div><span className="text-gray-500">Deadline: </span><span className="text-gray-300">{new Date(selectedProject.deadline).toLocaleDateString()}</span></div>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* TASKS TAB */}
          {activeTab === 'tasks' && (
            <div className="space-y-6">
              {PHASES.map(phase => {
                const phaseTasks = tasks.filter(t => t.phase === phase)
                if (!phaseTasks.length) return null
                return (
                  <div key={phase}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase]}`} />
                      <h3 className="text-sm font-semibold text-gray-300">{PHASE_LABELS[phase]}</h3>
                      <span className="text-xs text-gray-500">{phaseTasks.filter(t => t.status === 'done').length}/{phaseTasks.length}</span>
                    </div>
                    <div className="space-y-2">
                      {phaseTasks.map(task => (
                        <div key={task.id} className="bg-gray-800 rounded-lg p-3 flex items-center gap-3">
                          <select value={task.status} onChange={e => updateTaskStatus(task.id, e.target.value)}
                            className="bg-gray-700 text-xs text-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500">
                            <option value="todo">Todo</option>
                            <option value="in_progress">In Progress</option>
                            <option value="done">Done</option>
                            <option value="blocked">Blocked</option>
                          </select>
                          <div className="flex-1">
                            <p className={`text-sm ${task.status === 'done' ? 'line-through text-gray-500' : 'text-white'}`}>{task.title}</p>
                            {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                          </div>
                          {task.is_prep_task && <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded">prep</span>}
                          {task.due_date && <span className="text-xs text-gray-500">{new Date(task.due_date).toLocaleDateString()}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
              {tasks.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-3">📋</p>
                  <p className="text-sm">No tasks yet</p>
                  <button onClick={() => setView('new_task')} className="mt-3 text-purple-400 text-sm hover:text-purple-300">+ Add first task</button>
                </div>
              )}
            </div>
          )}
          {/* TIMELINE TAB */}
          {activeTab === 'timeline' && (
            <div className="space-y-2">
              {timeline.map(event => (
                <div key={event.id} className="flex gap-3 items-start">
                  <div className="w-2 h-2 rounded-full bg-purple-500 mt-2 flex-shrink-0" />
                  <div className="flex-1 bg-gray-800 rounded-lg p-3">
                    <p className="text-sm text-gray-200">{event.description}</p>
                    <p className="text-xs text-gray-500 mt-1">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {timeline.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-3">📅</p>
                  <p className="text-sm">No timeline events yet</p>
                </div>
              )}
            </div>
          )}
          {/* HANDOFFS TAB */}
          {activeTab === 'handoffs' && (
            <div className="space-y-3">
              {handoffs.map(h => (
                <div key={h.id} className="bg-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-white">
                      {PHASE_LABELS[h.from_phase]} → {PHASE_LABELS[h.to_phase]}
                    </p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      h.status === 'approved' ? 'bg-green-900 text-green-300' :
                      h.status === 'rejected' ? 'bg-red-900 text-red-300' :
                      'bg-yellow-900 text-yellow-300'
                    }`}>{h.status}</span>
                  </div>
                  <p className="text-xs text-gray-400">{new Date(h.created_at).toLocaleString()}</p>
                  {h.review_notes && <p className="text-xs text-gray-400 mt-2 italic">"{h.review_notes}"</p>}
                  {h.status === 'pending' && profile?.role === 'admin' && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => approveHandoff(h.id, h)}
                        className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1.5 rounded transition-colors">
                        Approve
                      </button>
                      <button onClick={() => rejectHandoff(h.id, 'Needs more work')}
                        className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5 rounded transition-colors">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {handoffs.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-3">🔄</p>
                  <p className="text-sm">No handoffs yet</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }
  // PROJECTS LIST
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
        <div>
          <h2 className="text-lg font-bold text-white">Anka Sphere Projects</h2>
          <p className="text-xs text-gray-400">{projects.length} projects</p>
        </div>
        <button onClick={() => setView('new_project')}
          className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          + New Project
        </button>
      </div>
      {/* Phase filter */}
      <div className="flex gap-2 px-6 py-3 border-b border-gray-700/50">
        {['all', ...PHASES, 'completed'].map(phase => (
          <button key={phase} onClick={() => setFilterPhase(phase)}
            className={`px-3 py-1 text-xs rounded-full transition-colors capitalize ${
              filterPhase === phase ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white bg-gray-700/50'
            }`}>
            {phase === 'all' ? 'All' : PHASE_LABELS[phase] || phase}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {filteredProjects.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-5xl mb-4">🚀</p>
            <p className="text-lg font-medium text-gray-400">No projects yet</p>
            <p className="text-sm mt-1">Create your first Anka Sphere project</p>
            <button onClick={() => setView('new_project')}
              className="mt-4 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm transition-colors">
              + New Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredProjects.map(project => (
              <div key={project.id} onClick={() => fetchProjectDetail(project)}
                className="bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-purple-500/50 rounded-xl p-5 cursor-pointer transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">{project.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{project.as_clients?.name || 'No client'} {project.as_clients?.company ? `· ${project.as_clients.company}` : ''}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[project.status]}`}>
                    {project.status?.replace(/_/g, ' ')}
                  </span>
                </div>
                {project.description && <p className="text-sm text-gray-400 mb-3 line-clamp-2">{project.description}</p>}
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[project.current_phase] || 'bg-gray-500'}`} />
                  <span className="text-xs text-gray-400">{PHASE_LABELS[project.current_phase]}</span>
                  {project.deadline && (
                    <span className="text-xs text-gray-500 ml-auto">Due {new Date(project.deadline).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
