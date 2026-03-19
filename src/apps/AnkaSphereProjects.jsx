import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

const PHASES = ['product_modeling', 'development', 'marketing']
const PHASE_LABELS = { product_modeling: 'Product Modeling', development: 'Development', marketing: 'Marketing', completed: 'Completed' }
const PHASE_COLORS = { product_modeling: 'bg-purple-500', development: 'bg-blue-500', marketing: 'bg-green-500', completed: 'bg-gray-500' }
const STATUS_COLORS = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  pending_handoff: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  pending_client_approval: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  on_hold: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
}
const CONTENT_STATUS_COLORS = {
  not_started: 'bg-gray-700 text-gray-300',
  drafting: 'bg-blue-900 text-blue-300',
  review: 'bg-yellow-900 text-yellow-300',
  approved: 'bg-purple-900 text-purple-300',
  published: 'bg-green-900 text-green-300',
}
const PAGE_TYPES = ['homepage','service_page','solutions_page','location_page','event_page','blog','about','contact','other']
const DOC_TYPES = ['brand_identity','product_structure','keyword_research','content_brief','seo_strategy','handoff_notes','general']

export default function AnkaSphereProjects() {
  const { profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [phases, setPhases] = useState([])
  const [handoffs, setHandoffs] = useState([])
  const [timeline, setTimeline] = useState([])
  const [pages, setPages] = useState([])
  const [documents, setDocuments] = useState([])
  const [milestones, setMilestones] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('projects')
  const [activeTab, setActiveTab] = useState('overview')
  const [filterPhase, setFilterPhase] = useState('all')
  const [newProject, setNewProject] = useState({ name: '', description: '', client_id: '', budget: '', deadline: '' })
  const [newTask, setNewTask] = useState({ title: '', description: '', phase: 'product_modeling', due_date: '' })
  const [newPage, setNewPage] = useState({ page_name: '', url_slug: '', page_type: 'service_page', primary_keyword: '', primary_kw_volume: '', primary_kw_difficulty: '', content_status: 'not_started', assigned_writer: '' })
  const [newDoc, setNewDoc] = useState({ title: '', doc_type: 'brand_identity', content: '' })
  const [newMilestone, setNewMilestone] = useState({ title: '', phase: 'product_modeling', start_date: '', end_date: '', description: '' })
  const [editingDoc, setEditingDoc] = useState(null)
  const [editingPage, setEditingPage] = useState(null)
  const [showNewPageForm, setShowNewPageForm] = useState(false)
  const [showNewDocForm, setShowNewDocForm] = useState(false)
  const [showNewMilestoneForm, setShowNewMilestoneForm] = useState(false)
  const [aiInput, setAiInput] = useState('')
  const [aiMessages, setAiMessages] = useState([])
  const [aiLoading, setAiLoading] = useState(false)
  const aiEndRef = useRef(null)

  useEffect(() => { fetchProjects(); fetchClients() }, [])
  useEffect(() => { if (aiEndRef.current) aiEndRef.current.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages])

  async function fetchProjects() {
    setLoading(true)
    const { data } = await supabase.from('as_projects').select('*, as_clients(name, company)').order('created_at', { ascending: false })
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
    const [tasksRes, phasesRes, handoffsRes, timelineRes, pagesRes, docsRes, milestonesRes] = await Promise.all([
      supabase.from('as_tasks').select('*').eq('project_id', project.id).order('created_at'),
      supabase.from('as_project_phases').select('*').eq('project_id', project.id),
      supabase.from('as_handoff_requests').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      supabase.from('as_timeline_events').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('as_project_pages').select('*').eq('project_id', project.id).order('created_at'),
      supabase.from('as_project_documents').select('*').eq('project_id', project.id).order('updated_at', { ascending: false }),
      supabase.from('as_project_milestones').select('*').eq('project_id', project.id).order('start_date'),
    ])
    setTasks(tasksRes.data || [])
    setPhases(phasesRes.data || [])
    setHandoffs(handoffsRes.data || [])
    setTimeline(timelineRes.data || [])
    setPages(pagesRes.data || [])
    setDocuments(docsRes.data || [])
    setMilestones(milestonesRes.data || [])
  }

  async function createProject() {
    if (!newProject.name) return
    const { data, error } = await supabase.from('as_projects').insert({ ...newProject, budget: newProject.budget ? parseFloat(newProject.budget) : null, created_by: profile?.id }).select().single()
    if (!error && data) {
      await supabase.from('as_project_phases').insert(PHASES.map(phase => ({ project_id: data.id, phase, status: phase === 'product_modeling' ? 'in_progress' : 'not_started' })))
      await supabase.from('as_timeline_events').insert({ project_id: data.id, event_type: 'project_created', description: `Project "${data.name}" created`, created_by: profile?.id })
      setNewProject({ name: '', description: '', client_id: '', budget: '', deadline: '' })
      setView('projects')
      fetchProjects()
    }
  }

  async function createTask() {
    if (!newTask.title || !selectedProject) return
    const { error } = await supabase.from('as_tasks').insert({ ...newTask, project_id: selectedProject.id, created_by: profile?.id })
    if (!error) {
      await supabase.from('as_timeline_events').insert({ project_id: selectedProject.id, event_type: 'task_created', description: `Task "${newTask.title}" created`, created_by: profile?.id })
      setNewTask({ title: '', description: '', phase: 'product_modeling', due_date: '' })
      setView('detail')
      fetchProjectDetail(selectedProject)
    }
  }

  async function createPage() {
    if (!newPage.page_name || !selectedProject) return
    const { error } = await supabase.from('as_project_pages').insert({ ...newPage, project_id: selectedProject.id })
    if (!error) {
      setNewPage({ page_name: '', url_slug: '', page_type: 'service_page', primary_keyword: '', primary_kw_volume: '', primary_kw_difficulty: '', content_status: 'not_started', assigned_writer: '' })
      setShowNewPageForm(false)
      fetchProjectDetail(selectedProject)
    }
  }

  async function updatePage(pageId, field, value) {
    await supabase.from('as_project_pages').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', pageId)
    setPages(pages.map(p => p.id === pageId ? { ...p, [field]: value } : p))
  }

  async function createDocument() {
    if (!newDoc.title || !selectedProject) return
    const { error } = await supabase.from('as_project_documents').insert({ ...newDoc, project_id: selectedProject.id, updated_by: profile?.id })
    if (!error) {
      setNewDoc({ title: '', doc_type: 'brand_identity', content: '' })
      setShowNewDocForm(false)
      fetchProjectDetail(selectedProject)
    }
  }

  async function saveDocument(doc) {
    await supabase.from('as_project_documents').update({ content: doc.content, version: (doc.version || 1) + 1, updated_by: profile?.id, updated_at: new Date().toISOString() }).eq('id', doc.id)
    setEditingDoc(null)
    fetchProjectDetail(selectedProject)
  }

  async function createMilestone() {
    if (!newMilestone.title || !selectedProject) return
    const { error } = await supabase.from('as_project_milestones').insert({ ...newMilestone, project_id: selectedProject.id })
    if (!error) {
      setNewMilestone({ title: '', phase: 'product_modeling', start_date: '', end_date: '', description: '' })
      setShowNewMilestoneForm(false)
      fetchProjectDetail(selectedProject)
    }
  }

  async function updateMilestoneStatus(id, status) {
    await supabase.from('as_project_milestones').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setMilestones(milestones.map(m => m.id === id ? { ...m, status } : m))
  }

  async function updateTaskStatus(taskId, status) {
    await supabase.from('as_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', taskId)
    const task = tasks.find(t => t.id === taskId)
    if (status === 'done') {
      await supabase.from('as_timeline_events').insert({ project_id: selectedProject.id, event_type: 'task_completed', description: `Task "${task?.title}" completed`, created_by: profile?.id })
      await checkPhaseCompletion(task?.phase)
    }
    fetchProjectDetail(selectedProject)
  }

  async function checkPhaseCompletion(phase) {
    const phaseTasks = tasks.filter(t => t.phase === phase && !t.is_prep_task)
    const allDone = phaseTasks.every(t => t.status === 'done')
    if (allDone && phaseTasks.length > 0) {
      const toPhase = phase === 'product_modeling' ? 'development' : 'marketing'
      await supabase.from('as_handoff_requests').insert({ project_id: selectedProject.id, from_phase: phase, to_phase: toPhase, status: 'pending', requested_by: profile?.id, handoff_brief: { phase, tasks_completed: phaseTasks.length, auto_triggered: true } })
      await supabase.from('as_projects').update({ status: 'pending_handoff' }).eq('id', selectedProject.id)
    }
  }

  async function approveHandoff(handoffId, handoff) {
    await supabase.from('as_handoff_requests').update({ status: 'approved', reviewed_by: profile?.id, reviewed_at: new Date().toISOString() }).eq('id', handoffId)
    await supabase.from('as_project_phases').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('project_id', selectedProject.id).eq('phase', handoff.from_phase)
    await supabase.from('as_project_phases').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('project_id', selectedProject.id).eq('phase', handoff.to_phase)
    await supabase.from('as_projects').update({ current_phase: handoff.to_phase, status: 'active' }).eq('id', selectedProject.id)
    await supabase.from('as_timeline_events').insert({ project_id: selectedProject.id, event_type: 'handoff_approved', description: `Handoff to ${PHASE_LABELS[handoff.to_phase]} approved`, created_by: profile?.id })
    fetchProjectDetail({ ...selectedProject, current_phase: handoff.to_phase })
    fetchProjects()
  }

  async function rejectHandoff(handoffId) {
    await supabase.from('as_handoff_requests').update({ status: 'rejected', reviewed_by: profile?.id, reviewed_at: new Date().toISOString() }).eq('id', handoffId)
    await supabase.from('as_projects').update({ status: 'active' }).eq('id', selectedProject.id)
    fetchProjectDetail(selectedProject)
  }

  async function sendAiMessage() {
    if (!aiInput.trim() || !selectedProject) return
    const userMsg = aiInput.trim()
    setAiInput('')
    setAiMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setAiLoading(true)

    const context = {
      project: selectedProject,
      tasks_summary: `${tasks.filter(t => t.status === 'done').length}/${tasks.length} tasks done`,
      pages_summary: `${pages.length} pages tracked, ${pages.filter(p => p.content_status === 'published').length} published`,
      current_phase: selectedProject.current_phase,
      keywords_tracked: pages.filter(p => p.primary_keyword).length,
      pending_handoffs: handoffs.filter(h => h.status === 'pending').length,
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: `You are the Anka Sphere project assistant. You help manage client projects across Product Modeling, Development, and Marketing phases. Current project context: ${JSON.stringify(context)}. Be concise, direct, and actionable. Focus on project execution.`,
          messages: [
            ...aiMessages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMsg }
          ]
        })
      })
      const data = await response.json()
      const reply = data.content?.[0]?.text || 'No response'
      setAiMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'Error connecting to AI.' }])
    }
    setAiLoading(false)
  }

  function getPhaseProgress(phase) {
    const phaseTasks = tasks.filter(t => t.phase === phase && !t.is_prep_task)
    if (!phaseTasks.length) return 0
    return Math.round((phaseTasks.filter(t => t.status === 'done').length / phaseTasks.length) * 100)
  }

  function getMilestoneBar(milestone) {
    if (!milestone.start_date || !milestone.end_date) return { left: 0, width: 10 }
    const allDates = milestones.filter(m => m.start_date && m.end_date)
    if (!allDates.length) return { left: 0, width: 10 }
    const minDate = new Date(Math.min(...allDates.map(m => new Date(m.start_date))))
    const maxDate = new Date(Math.max(...allDates.map(m => new Date(m.end_date))))
    const totalDays = (maxDate - minDate) / (1000 * 60 * 60 * 24) || 1
    const start = new Date(milestone.start_date)
    const end = new Date(milestone.end_date)
    const left = ((start - minDate) / (1000 * 60 * 60 * 24) / totalDays) * 100
    const width = Math.max(((end - start) / (1000 * 60 * 60 * 24) / totalDays) * 100, 5)
    return { left, width }
  }

  const filteredProjects = filterPhase === 'all' ? projects : projects.filter(p => p.current_phase === filterPhase)

  if (loading) return <div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" /></div>

  // NEW PROJECT
  if (view === 'new_project') return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setView('projects')} className="text-gray-400 hover:text-white">←</button>
        <h2 className="text-xl font-bold text-white">New Project</h2>
      </div>
      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <div><label className="block text-sm text-gray-400 mb-1">Project Name *</label>
          <input value={newProject.name} onChange={e => setNewProject({...newProject, name: e.target.value})} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="e.g. REL Website Rebuild" /></div>
        <div><label className="block text-sm text-gray-400 mb-1">Description</label>
          <textarea value={newProject.description} onChange={e => setNewProject({...newProject, description: e.target.value})} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" rows={3} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm text-gray-400 mb-1">Client</label>
            <select value={newProject.client_id} onChange={e => setNewProject({...newProject, client_id: e.target.value})} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
              <option value="">No client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
            </select></div>
          <div><label className="block text-sm text-gray-400 mb-1">Budget ($)</label>
            <input type="number" value={newProject.budget} onChange={e => setNewProject({...newProject, budget: e.target.value})} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" /></div>
        </div>
        <div><label className="block text-sm text-gray-400 mb-1">Deadline</label>
          <input type="date" value={newProject.deadline} onChange={e => setNewProject({...newProject, deadline: e.target.value})} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" /></div>
        <div className="flex gap-3 pt-2">
          <button onClick={createProject} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors">Create Project</button>
          <button onClick={() => setView('projects')} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
        </div>
      </div>
    </div>
  )

  // NEW TASK
  if (view === 'new_task') return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setView('detail')} className="text-gray-400 hover:text-white">←</button>
        <h2 className="text-xl font-bold text-white">Add Task — {selectedProject?.name}</h2>
      </div>
      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <div><label className="block text-sm text-gray-400 mb-1">Task Title *</label>
          <input value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" /></div>
        <div><label className="block text-sm text-gray-400 mb-1">Description</label>
          <textarea value={newTask.description} onChange={e => setNewTask({...newTask, description: e.target.value})} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" rows={3} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm text-gray-400 mb-1">Phase</label>
            <select value={newTask.phase} onChange={e => setNewTask({...newTask, phase: e.target.value})} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
              {PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
            </select></div>
          <div><label className="block text-sm text-gray-400 mb-1">Due Date</label>
            <input type="date" value={newTask.due_date} onChange={e => setNewTask({...newTask, due_date: e.target.value})} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" /></div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={createTask} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-4 py-2 text-sm font-medium">Add Task</button>
          <button onClick={() => setView('detail')} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
        </div>
      </div>
    </div>
  )

  // PROJECT DETAIL
  if (view === 'detail' && selectedProject) {
    const pendingHandoffs = handoffs.filter(h => h.status === 'pending')
    const tabs = ['overview', 'tasks', 'pages', 'documents', 'gantt', 'timeline', 'handoffs', 'ai']

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('projects'); setSelectedProject(null) }} className="text-gray-400 hover:text-white text-lg">←</button>
            <div>
              <h2 className="text-lg font-bold text-white">{selectedProject.name}</h2>
              <p className="text-xs text-gray-400">{selectedProject.as_clients?.name || 'No client'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[selectedProject.status]}`}>{selectedProject.status?.replace(/_/g, ' ')}</span>
            <button onClick={() => setView('new_task')} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Task</button>
          </div>
        </div>

        {/* Handoff banner */}
        {pendingHandoffs.length > 0 && (
          <div className="mx-6 mt-3 bg-yellow-900/40 border border-yellow-600/50 rounded-lg p-3">
            <p className="text-yellow-300 text-sm font-medium mb-2">⚡ Handoff Approval Needed</p>
            {pendingHandoffs.map(h => (
              <div key={h.id} className="flex items-center justify-between">
                <p className="text-yellow-200 text-xs">{PHASE_LABELS[h.from_phase]} → {PHASE_LABELS[h.to_phase]}</p>
                <div className="flex gap-2">
                  <button onClick={() => approveHandoff(h.id, h)} className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 rounded">Approve</button>
                  <button onClick={() => rejectHandoff(h.id)} className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded">Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize whitespace-nowrap transition-colors ${activeTab === tab ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
              {tab === 'ai' ? '🤖 AI' : tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="bg-gray-800 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Phase Progress</h3>
                <div className="flex items-center gap-2">
                  {PHASES.map((phase, i) => {
                    const progress = getPhaseProgress(phase)
                    const isActive = selectedProject.current_phase === phase
                    const isComplete = phases.find(p => p.phase === phase)?.status === 'completed'
                    return (
                      <div key={phase} className="flex-1">
                        <div className={`rounded-lg p-3 border ${isActive ? 'border-purple-500 bg-purple-900/20' : isComplete ? 'border-green-500/30 bg-green-900/10' : 'border-gray-700 bg-gray-700/30'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-medium ${isActive ? 'text-purple-300' : isComplete ? 'text-green-400' : 'text-gray-500'}`}>{PHASE_LABELS[phase]}</span>
                            <span className="text-xs text-gray-400">{progress}%</span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full transition-all ${isComplete ? 'bg-green-500' : isActive ? 'bg-purple-500' : 'bg-gray-600'}`} style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Tasks', value: tasks.filter(t => !t.is_prep_task).length },
                  { label: 'Done', value: tasks.filter(t => t.status === 'done').length, color: 'text-green-400' },
                  { label: 'Pages', value: pages.length },
                  { label: 'Published', value: pages.filter(p => p.content_status === 'published').length, color: 'text-blue-400' },
                ].map(stat => (
                  <div key={stat.label} className="bg-gray-800 rounded-xl p-4 text-center">
                    <p className={`text-2xl font-bold ${stat.color || 'text-white'}`}>{stat.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>
              {selectedProject.description && <div className="bg-gray-800 rounded-xl p-5"><p className="text-sm text-gray-400">{selectedProject.description}</p></div>}
            </div>
          )}

          {/* TASKS */}
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
                          <select value={task.status} onChange={e => updateTaskStatus(task.id, e.target.value)} className="bg-gray-700 text-xs text-gray-300 rounded px-2 py-1 focus:outline-none">
                            <option value="todo">Todo</option>
                            <option value="in_progress">In Progress</option>
                            <option value="done">Done</option>
                            <option value="blocked">Blocked</option>
                          </select>
                          <div className="flex-1">
                            <p className={`text-sm ${task.status === 'done' ? 'line-through text-gray-500' : 'text-white'}`}>{task.title}</p>
                            {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                          </div>
                          {task.due_date && <span className="text-xs text-gray-500">{new Date(task.due_date).toLocaleDateString()}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
              {tasks.length === 0 && <div className="text-center py-12 text-gray-500"><p className="text-4xl mb-3">📋</p><p className="text-sm">No tasks yet</p><button onClick={() => setView('new_task')} className="mt-3 text-purple-400 text-sm hover:text-purple-300">+ Add first task</button></div>}
            </div>
          )}

          {/* PAGES & KEYWORDS */}
          {activeTab === 'pages' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Pages & Keywords ({pages.length})</h3>
                <button onClick={() => setShowNewPageForm(!showNewPageForm)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Add Page</button>
              </div>

              {showNewPageForm && (
                <div className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs text-gray-400 mb-1">Page Name *</label>
                      <input value={newPage.page_name} onChange={e => setNewPage({...newPage, page_name: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="Homepage" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">URL Slug</label>
                      <input value={newPage.url_slug} onChange={e => setNewPage({...newPage, url_slug: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="/services/airport" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Page Type</label>
                      <select value={newPage.page_type} onChange={e => setNewPage({...newPage, page_type: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {PAGE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Primary Keyword</label>
                      <input value={newPage.primary_keyword} onChange={e => setNewPage({...newPage, primary_keyword: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="chauffeur service nyc" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Search Volume</label>
                      <input value={newPage.primary_kw_volume} onChange={e => setNewPage({...newPage, primary_kw_volume: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="2400" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">KD</label>
                      <input value={newPage.primary_kw_difficulty} onChange={e => setNewPage({...newPage, primary_kw_difficulty: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="28" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Assigned Writer</label>
                      <input value={newPage.assigned_writer} onChange={e => setNewPage({...newPage, assigned_writer: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="Writer name" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Content Status</label>
                      <select value={newPage.content_status} onChange={e => setNewPage({...newPage, content_status: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {['not_started','drafting','review','approved','published'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                      </select></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createPage} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add Page</button>
                    <button onClick={() => setShowNewPageForm(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400">
                      <th className="text-left py-2 pr-3 font-medium">Page</th>
                      <th className="text-left py-2 pr-3 font-medium">Type</th>
                      <th className="text-left py-2 pr-3 font-medium">Primary Keyword</th>
                      <th className="text-left py-2 pr-3 font-medium">SV</th>
                      <th className="text-left py-2 pr-3 font-medium">KD</th>
                      <th className="text-left py-2 pr-3 font-medium">Position</th>
                      <th className="text-left py-2 pr-3 font-medium">Content</th>
                      <th className="text-left py-2 pr-3 font-medium">Writer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map(page => (
                      <tr key={page.id} className="border-b border-gray-700/50 hover:bg-gray-800/50">
                        <td className="py-2 pr-3">
                          <div className="text-white font-medium">{page.page_name}</div>
                          {page.url_slug && <div className="text-gray-500 text-xs">{page.url_slug}</div>}
                        </td>
                        <td className="py-2 pr-3 text-gray-400">{page.page_type?.replace(/_/g, ' ')}</td>
                        <td className="py-2 pr-3">
                          <input defaultValue={page.primary_keyword || ''} onBlur={e => updatePage(page.id, 'primary_keyword', e.target.value)}
                            className="bg-transparent text-gray-300 w-full focus:outline-none focus:bg-gray-700 rounded px-1" placeholder="—" /></td>
                        <td className="py-2 pr-3 text-gray-400">{page.primary_kw_volume || '—'}</td>
                        <td className="py-2 pr-3 text-gray-400">{page.primary_kw_difficulty || '—'}</td>
                        <td className="py-2 pr-3">
                          <input defaultValue={page.primary_kw_position || ''} onBlur={e => updatePage(page.id, 'primary_kw_position', e.target.value)}
                            className="bg-transparent text-gray-300 w-16 focus:outline-none focus:bg-gray-700 rounded px-1" placeholder="—" /></td>
                        <td className="py-2 pr-3">
                          <select value={page.content_status} onChange={e => updatePage(page.id, 'content_status', e.target.value)}
                            className={`text-xs px-2 py-0.5 rounded-full border-0 ${CONTENT_STATUS_COLORS[page.content_status]}`}>
                            {['not_started','drafting','review','approved','published'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                          </select></td>
                        <td className="py-2 pr-3 text-gray-400">{page.assigned_writer || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pages.length === 0 && <div className="text-center py-12 text-gray-500"><p className="text-4xl mb-3">🗂️</p><p className="text-sm">No pages tracked yet</p></div>}
              </div>
            </div>
          )}

          {/* DOCUMENTS */}
          {activeTab === 'documents' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Living Documents ({documents.length})</h3>
                <button onClick={() => setShowNewDocForm(!showNewDocForm)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ New Doc</button>
              </div>

              {showNewDocForm && (
                <div className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs text-gray-400 mb-1">Title *</label>
                      <input value={newDoc.title} onChange={e => setNewDoc({...newDoc, title: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="Brand Identity Document" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Type</label>
                      <select value={newDoc.doc_type} onChange={e => setNewDoc({...newDoc, doc_type: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {DOC_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select></div>
                  </div>
                  <div><label className="block text-xs text-gray-400 mb-1">Initial Content</label>
                    <textarea value={newDoc.content} onChange={e => setNewDoc({...newDoc, content: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none font-mono" rows={5} placeholder="Start writing..." /></div>
                  <div className="flex gap-2">
                    <button onClick={createDocument} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Create</button>
                    <button onClick={() => setShowNewDocForm(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {documents.map(doc => (
                  <div key={doc.id} className="bg-gray-800 rounded-xl p-4">
                    {editingDoc?.id === doc.id ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-white">{doc.title}</h4>
                          <div className="flex gap-2">
                            <button onClick={() => saveDocument(editingDoc)} className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 rounded">Save v{(doc.version || 1) + 1}</button>
                            <button onClick={() => setEditingDoc(null)} className="text-gray-400 text-xs hover:text-white px-2">Cancel</button>
                          </div>
                        </div>
                        <textarea value={editingDoc.content} onChange={e => setEditingDoc({...editingDoc, content: e.target.value})}
                          className="w-full bg-gray-700 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none font-mono" rows={12} />
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="text-sm font-semibold text-white">{doc.title}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">{doc.doc_type?.replace(/_/g, ' ')}</span>
                              <span className="text-xs text-gray-500">v{doc.version || 1}</span>
                              <span className="text-xs text-gray-500">{new Date(doc.updated_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <button onClick={() => setEditingDoc({...doc})} className="text-purple-400 text-xs hover:text-purple-300 px-2 py-1">Edit</button>
                        </div>
                        {doc.content ? (
                          <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans line-clamp-4">{doc.content}</pre>
                        ) : (
                          <p className="text-xs text-gray-600 italic">No content yet. Click Edit to start writing.</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {documents.length === 0 && <div className="text-center py-12 text-gray-500"><p className="text-4xl mb-3">📄</p><p className="text-sm">No documents yet</p></div>}
              </div>
            </div>
          )}

          {/* GANTT */}
          {activeTab === 'gantt' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Project Timeline</h3>
                <button onClick={() => setShowNewMilestoneForm(!showNewMilestoneForm)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Milestone</button>
              </div>

              {showNewMilestoneForm && (
                <div className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs text-gray-400 mb-1">Milestone Title *</label>
                      <input value={newMilestone.title} onChange={e => setNewMilestone({...newMilestone, title: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Phase</label>
                      <select value={newMilestone.phase} onChange={e => setNewMilestone({...newMilestone, phase: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                      </select></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Start Date</label>
                      <input type="date" value={newMilestone.start_date} onChange={e => setNewMilestone({...newMilestone, start_date: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">End Date</label>
                      <input type="date" value={newMilestone.end_date} onChange={e => setNewMilestone({...newMilestone, end_date: e.target.value})} className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" /></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createMilestone} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add</button>
                    <button onClick={() => setShowNewMilestoneForm(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                  </div>
                </div>
              )}

              {milestones.length > 0 ? (
                <div className="space-y-2">
                  {/* Gantt chart */}
                  <div className="bg-gray-800 rounded-xl p-4 overflow-x-auto">
                    <div className="min-w-[600px]">
                      {PHASES.map(phase => {
                        const phaseMilestones = milestones.filter(m => m.phase === phase)
                        if (!phaseMilestones.length) return null
                        return (
                          <div key={phase} className="mb-4">
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase]}`} />
                              <span className="text-xs font-semibold text-gray-300">{PHASE_LABELS[phase]}</span>
                            </div>
                            {phaseMilestones.map(m => {
                              const { left, width } = getMilestoneBar(m)
                              return (
                                <div key={m.id} className="flex items-center gap-3 mb-2">
                                  <div className="w-32 flex-shrink-0">
                                    <p className="text-xs text-gray-300 truncate">{m.title}</p>
                                  </div>
                                  <div className="flex-1 bg-gray-700 rounded-full h-6 relative">
                                    <div className={`absolute h-6 rounded-full flex items-center px-2 text-xs font-medium text-white ${
                                      m.status === 'completed' ? 'bg-green-600' :
                                      m.status === 'in_progress' ? 'bg-purple-600' :
                                      m.status === 'blocked' ? 'bg-red-600' : 'bg-gray-600'
                                    }`} style={{ left: `${left}%`, width: `${width}%`, minWidth: '40px' }}>
                                      {m.start_date && <span className="truncate text-xs">{new Date(m.start_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>}
                                    </div>
                                  </div>
                                  <select value={m.status} onChange={e => updateMilestoneStatus(m.id, e.target.value)}
                                    className={`text-xs px-2 py-0.5 rounded border-0 flex-shrink-0 ${m.status === 'completed' ? 'bg-green-900 text-green-300' : m.status === 'in_progress' ? 'bg-purple-900 text-purple-300' : m.status === 'blocked' ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300'}`}>
                                    <option value="not_started">Not started</option>
                                    <option value="in_progress">In progress</option>
                                    <option value="completed">Completed</option>
                                    <option value="blocked">Blocked</option>
                                  </select>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500"><p className="text-4xl mb-3">📅</p><p className="text-sm">No milestones yet</p></div>
              )}
            </div>
          )}

          {/* TIMELINE */}
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
              {timeline.length === 0 && <div className="text-center py-12 text-gray-500"><p className="text-sm">No events yet</p></div>}
            </div>
          )}

          {/* HANDOFFS */}
          {activeTab === 'handoffs' && (
            <div className="space-y-3">
              {handoffs.map(h => (
                <div key={h.id} className="bg-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-white">{PHASE_LABELS[h.from_phase]} → {PHASE_LABELS[h.to_phase]}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${h.status === 'approved' ? 'bg-green-900 text-green-300' : h.status === 'rejected' ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}`}>{h.status}</span>
                  </div>
                  <p className="text-xs text-gray-400">{new Date(h.created_at).toLocaleString()}</p>
                  {h.status === 'pending' && profile?.role === 'admin' && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => approveHandoff(h.id, h)} className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1.5 rounded">Approve</button>
                      <button onClick={() => rejectHandoff(h.id)} className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5 rounded">Reject</button>
                    </div>
                  )}
                </div>
              ))}
              {handoffs.length === 0 && <div className="text-center py-12 text-gray-500"><p className="text-sm">No handoffs yet</p></div>}
            </div>
          )}

          {/* AI ASSISTANT */}
          {activeTab === 'ai' && (
            <div className="flex flex-col h-full" style={{ minHeight: '400px' }}>
              <div className="flex-1 space-y-3 overflow-y-auto mb-4 max-h-96">
                {aiMessages.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p className="text-3xl mb-3">🤖</p>
                    <p className="text-sm font-medium text-gray-400">Anka Sphere AI</p>
                    <p className="text-xs mt-1 mb-4">Context-aware project assistant</p>
                    <div className="space-y-2">
                      {['What pages still need content?', 'Summarize project status', 'What keywords are we tracking?', 'What needs to be done next?'].map(s => (
                        <button key={s} onClick={() => { setAiInput(s); }} className="block w-full text-left text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg transition-colors">{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {aiMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs rounded-xl px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-200'}`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {aiLoading && <div className="flex justify-start"><div className="bg-gray-800 rounded-xl px-3 py-2 text-sm text-gray-400">Thinking...</div></div>}
                <div ref={aiEndRef} />
              </div>
              <div className="flex gap-2">
                <input value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendAiMessage()}
                  className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Ask about this project..." />
                <button onClick={sendAiMessage} disabled={aiLoading || !aiInput.trim()} className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm">→</button>
              </div>
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
        <button onClick={() => setView('new_project')} className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg">+ New Project</button>
      </div>
      <div className="flex gap-2 px-6 py-3 border-b border-gray-700/50">
        {['all', ...PHASES, 'completed'].map(phase => (
          <button key={phase} onClick={() => setFilterPhase(phase)} className={`px-3 py-1 text-xs rounded-full transition-colors ${filterPhase === phase ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white bg-gray-700/50'}`}>
            {phase === 'all' ? 'All' : PHASE_LABELS[phase] || phase}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {filteredProjects.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-5xl mb-4">🚀</p>
            <p className="text-lg font-medium text-gray-400">No projects yet</p>
            <button onClick={() => setView('new_project')} className="mt-4 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm">+ New Project</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredProjects.map(project => (
              <div key={project.id} onClick={() => fetchProjectDetail(project)} className="bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-purple-500/50 rounded-xl p-5 cursor-pointer transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">{project.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{project.as_clients?.name || 'No client'}{project.as_clients?.company ? ` · ${project.as_clients.company}` : ''}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[project.status]}`}>{project.status?.replace(/_/g, ' ')}</span>
                </div>
                {project.description && <p className="text-sm text-gray-400 mb-3 line-clamp-2">{project.description}</p>}
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[project.current_phase] || 'bg-gray-500'}`} />
                  <span className="text-xs text-gray-400">{PHASE_LABELS[project.current_phase]}</span>
                  {project.deadline && <span className="text-xs text-gray-500 ml-auto">Due {new Date(project.deadline).toLocaleDateString()}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
