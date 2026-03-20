import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { createNotification } from '../hooks/useNotifications.js'

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
  active: 'bg-green-900/50 text-green-300',
  pending_handoff: 'bg-yellow-900/50 text-yellow-300',
  pending_client_approval: 'bg-orange-900/50 text-orange-300',
  on_hold: 'bg-gray-700 text-gray-300',
  completed: 'bg-blue-900/50 text-blue-300',
  cancelled: 'bg-red-900/50 text-red-300',
}
const TASK_STATUS_COLORS = {
  todo: 'bg-gray-700 text-gray-300',
  in_progress: 'bg-blue-900/50 text-blue-300',
  done: 'bg-green-900/50 text-green-300',
  blocked: 'bg-red-900/50 text-red-300',
}
const CONTENT_STATUS_COLORS = {
  not_started: 'bg-gray-700 text-gray-300',
  drafting: 'bg-blue-900/50 text-blue-300',
  review: 'bg-yellow-900/50 text-yellow-300',
  approved: 'bg-purple-900/50 text-purple-300',
  published: 'bg-green-900/50 text-green-300',
}
const PAGE_TYPES = ['homepage','service_page','solutions_page','location_page','event_page','blog','about','contact','other']
const DOC_TYPES = ['brand_identity','product_structure','keyword_research','content_brief','seo_strategy','handoff_notes','general']
const PRIORITY_COLORS = {
  low: 'text-gray-400', medium: 'text-blue-400', high: 'text-orange-400', urgent: 'text-red-400'
}

export default function AnkaSphereProjects() {
  const { profile, user } = useAuth()
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [members, setMembers] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [phases, setPhases] = useState([])
  const [handoffs, setHandoffs] = useState([])
  const [timeline, setTimeline] = useState([])
  const [pages, setPages] = useState([])
  const [documents, setDocuments] = useState([])
  const [milestones, setMilestones] = useState([])
  const [deliverables, setDeliverables] = useState([])
  const [signoffs, setSignoffs] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('projects')
  const [activeTab, setActiveTab] = useState('overview')
  const [filterPhase, setFilterPhase] = useState('all')

  // Forms
  const [newProject, setNewProject] = useState({ name: '', description: '', client_id: '', budget: '', deadline: '' })
  const [newTask, setNewTask] = useState({ title: '', description: '', phase: 'product_modeling', due_date: '', assigned_to: '', priority: 'medium' })
  const [newPage, setNewPage] = useState({ page_name: '', url_slug: '', page_type: 'service_page', primary_keyword: '', primary_kw_volume: '', primary_kw_difficulty: '', content_status: 'not_started', assigned_writer: '' })
  const [newDoc, setNewDoc] = useState({ title: '', doc_type: 'brand_identity', content: '' })
  const [newMilestone, setNewMilestone] = useState({ title: '', phase: 'product_modeling', start_date: '', end_date: '', description: '' })
  const [showNewPageForm, setShowNewPageForm] = useState(false)
  const [showNewDocForm, setShowNewDocForm] = useState(false)
  const [showNewMilestoneForm, setShowNewMilestoneForm] = useState(false)
  const [showNewTask, setShowNewTask] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)

  // File upload
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadPhase, setUploadPhase] = useState('product_modeling')
  const [uploadTitle, setUploadTitle] = useState('')
  const fileInputRef = useRef(null)

  // Sign-off modal
  const [showSignoffModal, setShowSignoffModal] = useState(false)
  const [signoffPhase, setSignoffPhase] = useState(null)
  const [signoffFeedback, setSignoffFeedback] = useState('')

  // AI assistant
  const [aiMessages, setAiMessages] = useState([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiMode, setAiMode] = useState('assist')
  const [aiOutput, setAiOutput] = useState('')
  const aiEndRef = useRef(null)

  useEffect(() => { fetchProjects(); fetchClients(); fetchMembers() }, [])
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

  async function fetchMembers() {
    const { data } = await supabase.from('profiles').select('id, full_name, email, department, role').order('full_name')
    setMembers(data || [])
  }

  async function fetchProjectDetail(project) {
    setSelectedProject(project)
    setView('detail')
    setActiveTab('overview')
    const [tasksRes, phasesRes, handoffsRes, timelineRes, pagesRes, docsRes, milestonesRes, deliverablesRes, signoffsRes] = await Promise.all([
      supabase.from('as_tasks').select('*').eq('project_id', project.id).order('created_at'),
      supabase.from('as_project_phases').select('*').eq('project_id', project.id),
      supabase.from('as_handoff_requests').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      supabase.from('as_timeline_events').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('as_project_pages').select('*').eq('project_id', project.id).order('created_at'),
      supabase.from('as_project_documents').select('*').eq('project_id', project.id).order('updated_at', { ascending: false }),
      supabase.from('as_project_milestones').select('*').eq('project_id', project.id).order('start_date'),
      supabase.from('as_deliverables').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      supabase.from('as_client_signoffs').select('*').eq('project_id', project.id).order('requested_at', { ascending: false }),
    ])
    setTasks(tasksRes.data || [])
    setPhases(phasesRes.data || [])
    setHandoffs(handoffsRes.data || [])
    setTimeline(timelineRes.data || [])
    setPages(pagesRes.data || [])
    setDocuments(docsRes.data || [])
    setMilestones(milestonesRes.data || [])
    setDeliverables(deliverablesRes.data || [])
    setSignoffs(signoffsRes.data || [])
  }

  async function createProject() {
    if (!newProject.name) return
    const { data, error } = await supabase.from('as_projects').insert({
      ...newProject,
      budget: newProject.budget ? parseFloat(newProject.budget) : null,
      created_by: user?.id
    }).select().single()
    if (!error && data) {
      await supabase.from('as_project_phases').insert(
        PHASES.map(phase => ({ project_id: data.id, phase, status: phase === 'product_modeling' ? 'in_progress' : 'not_started' }))
      )
      await supabase.from('as_timeline_events').insert({
        project_id: data.id, event_type: 'project_created',
        description: `Project "${data.name}" created`, created_by: user?.id
      })
      setNewProject({ name: '', description: '', client_id: '', budget: '', deadline: '' })
      setView('projects')
      fetchProjects()
    }
  }

  async function createTask() {
    if (!newTask.title || !selectedProject) return
    const { error } = await supabase.from('as_tasks').insert({
      ...newTask,
      project_id: selectedProject.id,
      created_by: user?.id,
      assigned_to: newTask.assigned_to || null
    })
    if (!error) {
      await supabase.from('as_timeline_events').insert({
        project_id: selectedProject.id, event_type: 'task_created',
        description: `Task "${newTask.title}" created in ${PHASE_LABELS[newTask.phase]}`,
        created_by: user?.id
      })
      // Notify assigned user
      if (newTask.assigned_to && newTask.assigned_to !== user?.id) {
        await createNotification(
          newTask.assigned_to,
          'task_assigned',
          'Task assigned to you',
          `"${newTask.title}" in ${selectedProject.name}`,
          selectedProject.id
        )
      }
      setNewTask({ title: '', description: '', phase: 'product_modeling', due_date: '', assigned_to: '', priority: 'medium' })
      setShowNewTask(false)
      fetchProjectDetail(selectedProject)
    }
  }

  async function updateTaskStatus(taskId, status) {
    await supabase.from('as_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', taskId)
    const task = tasks.find(t => t.id === taskId)
    if (status === 'done') {
      await supabase.from('as_timeline_events').insert({
        project_id: selectedProject.id, event_type: 'task_completed',
        description: `Task "${task?.title}" completed`, created_by: user?.id
      })
      await checkPhaseCompletion(task?.phase)
    }
    setTasks(tasks.map(t => t.id === taskId ? { ...t, status } : t))
  }

  async function assignTask(taskId, assignedTo) {
    await supabase.from('as_tasks').update({ assigned_to: assignedTo || null, updated_at: new Date().toISOString() }).eq('id', taskId)
    setTasks(tasks.map(t => t.id === taskId ? { ...t, assigned_to: assignedTo } : t))
  }

  async function checkPhaseCompletion(phase) {
    const freshTasks = await supabase.from('as_tasks').select('*').eq('project_id', selectedProject.id).eq('phase', phase)
    const fresh = freshTasks.data || []
    const nonPrep = fresh.filter(t => !t.is_prep_task)
    if (nonPrep.length > 0 && nonPrep.every(t => t.status === 'done')) {
      const toPhase = phase === 'product_modeling' ? 'development' : 'marketing'
      if (phase !== 'marketing') {
        await supabase.from('as_handoff_requests').insert({
          project_id: selectedProject.id,
          from_phase: phase,
          to_phase: toPhase,
          status: 'pending',
          requested_by: user?.id,
          handoff_brief: { auto_triggered: true, tasks_completed: nonPrep.length }
        })
        await supabase.from('as_projects').update({ status: 'pending_handoff' }).eq('id', selectedProject.id)
        await supabase.from('as_timeline_events').insert({
          project_id: selectedProject.id, event_type: 'handoff_requested',
          description: `All ${PHASE_LABELS[phase]} tasks done — handoff to ${PHASE_LABELS[toPhase]} requested`,
          created_by: user?.id
        })
        // Notify admin
        if (profile?.role !== 'admin') {
          const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
          for (const admin of admins || []) {
            await createNotification(
              admin.id,
              'handoff_requested',
              'Handoff approval needed',
              `All ${PHASE_LABELS[phase]} tasks done in ${selectedProject.name}`,
              selectedProject.id
            )
          }
        }
      } else {
        await requestClientSignoff('marketing')
      }
      fetchProjectDetail(selectedProject)
    }
  }

  async function approveHandoff(handoffId, handoff) {
    await supabase.from('as_handoff_requests').update({
      status: 'approved', reviewed_by: user?.id, reviewed_at: new Date().toISOString()
    }).eq('id', handoffId)
    await supabase.from('as_project_phases').update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('project_id', selectedProject.id).eq('phase', handoff.from_phase)
    await supabase.from('as_project_phases').update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('project_id', selectedProject.id).eq('phase', handoff.to_phase)
    await supabase.from('as_projects').update({ current_phase: handoff.to_phase, status: 'active' }).eq('id', selectedProject.id)
    await supabase.from('as_timeline_events').insert({
      project_id: selectedProject.id, event_type: 'handoff_approved',
      description: `Handoff approved: ${PHASE_LABELS[handoff.from_phase]} → ${PHASE_LABELS[handoff.to_phase]}`,
      created_by: user?.id
    })
    // Notify all project members
    await createNotification(
      user?.id,
      'handoff_approved',
      'Handoff approved',
      `${PHASE_LABELS[handoff.from_phase]} → ${PHASE_LABELS[handoff.to_phase]} in ${selectedProject.name}`,
      selectedProject.id
    )
    fetchProjectDetail({ ...selectedProject, current_phase: handoff.to_phase, status: 'active' })
    fetchProjects()
  }

  async function rejectHandoff(handoffId) {
    await supabase.from('as_handoff_requests').update({
      status: 'rejected', reviewed_by: user?.id, reviewed_at: new Date().toISOString()
    }).eq('id', handoffId)
    await supabase.from('as_projects').update({ status: 'active' }).eq('id', selectedProject.id)
    fetchProjectDetail(selectedProject)
  }

  async function requestClientSignoff(phase) {
    const phaseDeliverables = deliverables.filter(d => d.phase === phase).map(d => d.id)
    await supabase.from('as_client_signoffs').insert({
      project_id: selectedProject.id,
      phase,
      status: 'pending',
      deliverables_reviewed: phaseDeliverables
    })
    await supabase.from('as_projects').update({ status: 'pending_client_approval' }).eq('id', selectedProject.id)
    await supabase.from('as_timeline_events').insert({
      project_id: selectedProject.id, event_type: 'client_signoff_requested',
      description: `Client sign-off requested for ${PHASE_LABELS[phase]}`, created_by: user?.id
    })
    fetchProjectDetail(selectedProject)
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !selectedProject) return
    setUploadingFile(true)
    try {
      const ext = file.name.split('.').pop()
      const fileName = `${selectedProject.id}/${Date.now()}.${ext}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('sphere-deliverables')
        .upload(fileName, file)
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('sphere-deliverables').getPublicUrl(fileName)
      await supabase.from('as_deliverables').insert({
        project_id: selectedProject.id,
        phase: uploadPhase,
        title: uploadTitle || file.name,
        file_url: urlData.publicUrl,
        file_type: file.type,
        file_size: file.size,
        deliverable_type: ext,
        created_by: user?.id,
        uploaded_by: user?.id
      })
      await supabase.from('as_timeline_events').insert({
        project_id: selectedProject.id, event_type: 'deliverable_uploaded',
        description: `File uploaded: ${uploadTitle || file.name}`, created_by: user?.id
      })
      setUploadTitle('')
      fetchProjectDetail(selectedProject)
    } catch (err) {
      console.error('Upload error:', err)
    }
    setUploadingFile(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function deleteDeliverable(deliverable) {
    if (!deliverable.file_url) return
    const path = deliverable.file_url.split('sphere-deliverables/')[1]
    await supabase.storage.from('sphere-deliverables').remove([path])
    await supabase.from('as_deliverables').delete().eq('id', deliverable.id)
    fetchProjectDetail(selectedProject)
  }

  async function createDocument() {
    if (!newDoc.title || !selectedProject) return
    await supabase.from('as_project_documents').insert({ ...newDoc, project_id: selectedProject.id, updated_by: user?.id })
    setNewDoc({ title: '', doc_type: 'brand_identity', content: '' })
    setShowNewDocForm(false)
    fetchProjectDetail(selectedProject)
  }

  async function saveDocument(doc) {
    await supabase.from('as_project_documents').update({
      content: doc.content, version: (doc.version || 1) + 1,
      updated_by: user?.id, updated_at: new Date().toISOString()
    }).eq('id', doc.id)
    setEditingDoc(null)
    fetchProjectDetail(selectedProject)
  }

  async function createPage() {
    if (!newPage.page_name || !selectedProject) return
    await supabase.from('as_project_pages').insert({ ...newPage, project_id: selectedProject.id })
    setNewPage({ page_name: '', url_slug: '', page_type: 'service_page', primary_keyword: '', primary_kw_volume: '', primary_kw_difficulty: '', content_status: 'not_started', assigned_writer: '' })
    setShowNewPageForm(false)
    fetchProjectDetail(selectedProject)
  }

  async function updatePage(pageId, field, value) {
    await supabase.from('as_project_pages').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', pageId)
    setPages(pages.map(p => p.id === pageId ? { ...p, [field]: value } : p))
  }

  async function createMilestone() {
    if (!newMilestone.title || !selectedProject) return
    await supabase.from('as_project_milestones').insert({ ...newMilestone, project_id: selectedProject.id })
    setNewMilestone({ title: '', phase: 'product_modeling', start_date: '', end_date: '', description: '' })
    setShowNewMilestoneForm(false)
    fetchProjectDetail(selectedProject)
  }

  async function updateMilestoneStatus(id, status) {
    await supabase.from('as_project_milestones').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setMilestones(milestones.map(m => m.id === id ? { ...m, status } : m))
  }

  async function sendAiMessage() {
    if (!aiInput.trim() || !selectedProject) return
    const userMsg = aiInput.trim()
    setAiInput('')
    setAiMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setAiLoading(true)

    const projectContext = {
      name: selectedProject.name,
      phase: selectedProject.current_phase,
      status: selectedProject.status,
      client: selectedProject.as_clients?.name,
      tasks_total: tasks.length,
      tasks_done: tasks.filter(t => t.status === 'done').length,
      tasks_blocked: tasks.filter(t => t.status === 'blocked').length,
      pages_count: pages.length,
      pages_published: pages.filter(p => p.content_status === 'published').length,
      keywords: pages.filter(p => p.primary_keyword).map(p => p.primary_keyword).slice(0, 10),
      documents: documents.map(d => ({ title: d.title, type: d.doc_type })),
      recent_timeline: timeline.slice(0, 5).map(e => e.description),
    }

    const systemPrompt = aiMode === 'execute'
      ? `You are the Anka Sphere AI work assistant. You help execute actual work for the team. You can write content, create SEO briefs, draft copy, create task descriptions, write marketing copy, or produce any deliverable the team needs.\n\nProject context: ${JSON.stringify(projectContext)}\n\nWhen executing work, produce a complete, high-quality output the team can use directly. Format appropriately for the task type.`
      : `You are the Anka Sphere AI work assistant. You help the team plan, prioritize, and manage project work.\n\nProject context: ${JSON.stringify(projectContext)}\n\nBe direct, specific, and actionable. Reference actual project data when relevant.`

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: systemPrompt,
          messages: [
            ...aiMessages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMsg }
          ]
        })
      })
      const data = await response.json()
      const reply = data.content?.[0]?.text || 'No response'
      setAiMessages(prev => [...prev, { role: 'assistant', content: reply }])
      if (aiMode === 'execute') setAiOutput(reply)
    } catch (e) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: '❌ AI error. Check connection.' }])
    }
    setAiLoading(false)
  }

  function getMemberName(userId) {
    const m = members.find(m => m.id === userId)
    return m?.full_name || m?.email?.split('@')[0] || 'Unassigned'
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
    const left = ((new Date(milestone.start_date) - minDate) / (1000 * 60 * 60 * 24) / totalDays) * 100
    const width = Math.max(((new Date(milestone.end_date) - new Date(milestone.start_date)) / (1000 * 60 * 60 * 24) / totalDays) * 100, 5)
    return { left, width }
  }

  const filteredProjects = filterPhase === 'all' ? projects : projects.filter(p => p.current_phase === filterPhase)
  const pendingHandoffs = handoffs.filter(h => h.status === 'pending')
  const pendingSignoff = signoffs.find(s => s.status === 'pending')

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-gray-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  )

  // NEW PROJECT FORM
  if (view === 'new_project') return (
    <div className="p-6 max-w-2xl mx-auto bg-gray-950 min-h-full">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setView('projects')} className="text-gray-400 hover:text-white">←</button>
        <h2 className="text-xl font-bold text-white">New Sphere Project</h2>
      </div>
      <div className="bg-gray-800 rounded-xl p-6 space-y-4 border border-gray-700">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Project Name *</label>
          <input value={newProject.name} onChange={e => setNewProject({...newProject, name: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Description</label>
          <textarea value={newProject.description} onChange={e => setNewProject({...newProject, description: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" rows={3} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Client</label>
            <select value={newProject.client_id} onChange={e => setNewProject({...newProject, client_id: e.target.value})}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
              <option value="">No client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Budget ($)</label>
            <input type="number" value={newProject.budget} onChange={e => setNewProject({...newProject, budget: e.target.value})}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Deadline</label>
          <input type="date" value={newProject.deadline} onChange={e => setNewProject({...newProject, deadline: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={createProject} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-4 py-2 text-sm font-medium">Create Project</button>
          <button onClick={() => setView('projects')} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
        </div>
      </div>
    </div>
  )

  // PROJECT DETAIL
  if (view === 'detail' && selectedProject) {
    const tabs = ['overview', 'board', 'tasks', 'files', 'pages', 'documents', 'gantt', 'timeline', 'handoffs', 'ai']

    return (
      <div className="flex flex-col h-full bg-gray-950 text-white">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('projects'); setSelectedProject(null) }} className="text-gray-400 hover:text-white text-lg">←</button>
            <div>
              <h2 className="text-lg font-bold text-white">{selectedProject.name}</h2>
              <p className="text-xs text-gray-400">{selectedProject.as_clients?.name || 'No client'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[selectedProject.status] || 'bg-gray-700 text-gray-300'}`}>
              {selectedProject.status?.replace(/_/g, ' ')}
            </span>
            <button onClick={() => setShowNewTask(true)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Task</button>
            {profile?.role === 'admin' && (
              <button onClick={() => { setSignoffPhase(selectedProject.current_phase); setShowSignoffModal(true) }}
                className="bg-orange-600 hover:bg-orange-700 text-white text-xs px-3 py-1.5 rounded-lg">
                Request Sign-off
              </button>
            )}
          </div>
        </div>

        {/* Pending handoff banner */}
        {pendingHandoffs.length > 0 && profile?.role === 'admin' && (
          <div className="mx-6 mt-3 bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-3">
            <p className="text-yellow-300 text-xs font-medium mb-2">⚡ Handoff Approval Needed</p>
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

        {/* Pending sign-off banner */}
        {pendingSignoff && (
          <div className="mx-6 mt-3 bg-purple-900/30 border border-purple-700/50 rounded-xl p-3">
            <p className="text-purple-300 text-xs font-medium">✍️ Client sign-off pending for {PHASE_LABELS[pendingSignoff.phase]}</p>
          </div>
        )}

        {/* New task modal */}
        {showNewTask && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-md border border-gray-700 space-y-4">
              <h3 className="text-lg font-bold text-white">New Task</h3>
              <input value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="Task title *" autoFocus />
              <textarea value={newTask.description} onChange={e => setNewTask({...newTask, description: e.target.value})}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" rows={2}
                placeholder="Description..." />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Phase</label>
                  <select value={newTask.phase} onChange={e => setNewTask({...newTask, phase: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none">
                    {PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Priority</label>
                  <select value={newTask.priority} onChange={e => setNewTask({...newTask, priority: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none">
                    {['low','medium','high','urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Assign To</label>
                  <select value={newTask.assigned_to} onChange={e => setNewTask({...newTask, assigned_to: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none">
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Due Date</label>
                  <input type="date" value={newTask.due_date} onChange={e => setNewTask({...newTask, due_date: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={createTask} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg py-2 text-sm font-medium">Add Task</button>
                <button onClick={() => setShowNewTask(false)} className="px-4 text-gray-400 hover:text-white text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Sign-off modal */}
        {showSignoffModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-md border border-gray-700 space-y-4">
              <h3 className="text-lg font-bold text-white">Request Client Sign-off</h3>
              <p className="text-sm text-gray-400">This will notify the client that <span className="text-white font-medium">{PHASE_LABELS[signoffPhase]}</span> is ready for review.</p>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Phase</label>
                <select value={signoffPhase} onChange={e => setSignoffPhase(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                </select>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-2">Deliverables included ({deliverables.filter(d => d.phase === signoffPhase).length} files)</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {deliverables.filter(d => d.phase === signoffPhase).map(d => (
                    <div key={d.id} className="flex items-center gap-2 text-xs text-gray-300">
                      <span>📎</span><span>{d.title}</span>
                    </div>
                  ))}
                  {deliverables.filter(d => d.phase === signoffPhase).length === 0 && (
                    <p className="text-xs text-gray-500 italic">No files uploaded for this phase yet</p>
                  )}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { requestClientSignoff(signoffPhase); setShowSignoffModal(false) }}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg py-2 text-sm font-medium">Send to Client</button>
                <button onClick={() => setShowSignoffModal(false)} className="px-4 text-gray-400 hover:text-white text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 overflow-x-auto pb-3 border-b border-gray-800">
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize whitespace-nowrap transition-colors ${activeTab === tab ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              {tab === 'ai' ? '🤖 AI' : tab === 'board' ? '📋 Board' : tab === 'files' ? '📁 Files' : tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">

          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Phase Progress</h3>
                <div className="flex items-stretch gap-2">
                  {PHASES.map((phase) => {
                    const progress = getPhaseProgress(phase)
                    const isActive = selectedProject.current_phase === phase
                    const isComplete = phases.find(p => p.phase === phase)?.status === 'completed'
                    return (
                      <div key={phase} className="flex-1">
                        <div className={`rounded-lg p-3 border h-full ${isActive ? 'border-purple-500 bg-purple-900/20' : isComplete ? 'border-green-500/30 bg-green-900/10' : 'border-gray-700 bg-gray-700/20'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-medium ${isActive ? 'text-purple-300' : isComplete ? 'text-green-400' : 'text-gray-500'}`}>{PHASE_LABELS[phase]}</span>
                            <span className="text-xs text-gray-400">{progress}%</span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${isComplete ? 'bg-green-500' : isActive ? 'bg-purple-500' : 'bg-gray-600'}`} style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Total Tasks', value: tasks.filter(t => !t.is_prep_task).length },
                  { label: 'Completed', value: tasks.filter(t => t.status === 'done').length, color: 'text-green-400' },
                  { label: 'Blocked', value: tasks.filter(t => t.status === 'blocked').length, color: 'text-red-400' },
                  { label: 'Files', value: deliverables.length, color: 'text-blue-400' },
                ].map(s => (
                  <div key={s.label} className="bg-gray-800 rounded-xl p-4 text-center border border-gray-700">
                    <p className={`text-2xl font-bold ${s.color || 'text-white'}`}>{s.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
              {selectedProject.description && (
                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                  <p className="text-sm text-gray-300">{selectedProject.description}</p>
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                    {selectedProject.budget && <span>Budget: ${Number(selectedProject.budget).toLocaleString()}</span>}
                    {selectedProject.deadline && <span>Deadline: {new Date(selectedProject.deadline).toLocaleDateString()}</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* KANBAN BOARD */}
          {activeTab === 'board' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Task Board</h3>
                <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                  {['all', ...PHASES].map(p => (
                    <button key={p} onClick={() => setFilterPhase(p)}
                      className={`px-2 py-1 text-xs rounded-md transition-colors capitalize ${filterPhase === p ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                      {p === 'all' ? 'All' : PHASE_LABELS[p].split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-4">
                {(['todo', 'in_progress', 'blocked', 'done']).map(status => {
                  const colTasks = tasks.filter(t => {
                    const phaseMatch = filterPhase === 'all' || t.phase === filterPhase
                    return t.status === status && phaseMatch
                  })
                  return (
                    <div key={status} className="w-64 flex-shrink-0">
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`w-2 h-2 rounded-full ${status === 'done' ? 'bg-green-500' : status === 'in_progress' ? 'bg-blue-500' : status === 'blocked' ? 'bg-red-500' : 'bg-gray-500'}`} />
                        <span className="text-xs font-semibold text-white capitalize">{status.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded-full">{colTasks.length}</span>
                      </div>
                      <div className="space-y-2">
                        {colTasks.map(task => (
                          <div key={task.id} className={`bg-gray-800 rounded-xl p-3 border ${task.status === 'blocked' ? 'border-red-700/50' : 'border-gray-700'}`}>
                            <div className="flex items-center gap-1 mb-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${PHASE_COLORS[task.phase]}`} />
                              <span className="text-xs text-gray-500">{PHASE_LABELS[task.phase]?.split(' ')[0]}</span>
                            </div>
                            <p className={`text-xs font-medium mb-2 ${task.status === 'done' ? 'line-through text-gray-500' : 'text-white'}`}>{task.title}</p>
                            <div className="flex items-center gap-2">
                              <select value={task.assigned_to || ''} onChange={e => assignTask(task.id, e.target.value)}
                                className="flex-1 bg-gray-700 text-gray-300 text-xs rounded px-1.5 py-1 focus:outline-none truncate">
                                <option value="">Unassigned</option>
                                {members.map(m => <option key={m.id} value={m.id}>{m.full_name?.split(' ')[0] || m.email?.split('@')[0]}</option>)}
                              </select>
                              <select value={task.status} onChange={e => updateTaskStatus(task.id, e.target.value)}
                                className={`text-xs px-1.5 py-1 rounded border-0 focus:outline-none ${TASK_STATUS_COLORS[task.status]}`}>
                                <option value="todo">Todo</option>
                                <option value="in_progress">In Progress</option>
                                <option value="done">Done</option>
                                <option value="blocked">Blocked</option>
                              </select>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <span className={`text-xs ${PRIORITY_COLORS[task.priority] || 'text-gray-500'}`}>{task.priority}</span>
                              {task.due_date && <span className={`text-xs ${new Date(task.due_date) < new Date() && task.status !== 'done' ? 'text-red-400' : 'text-gray-500'}`}>{new Date(task.due_date).toLocaleDateString()}</span>}
                            </div>
                          </div>
                        ))}
                        {colTasks.length === 0 && (
                          <div className="border-2 border-dashed border-gray-800 rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-600">Empty</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* TASKS LIST */}
          {activeTab === 'tasks' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Tasks ({tasks.length})</h3>
              </div>
              {PHASES.map(phase => {
                const phaseTasks = tasks.filter(t => t.phase === phase)
                if (!phaseTasks.length) return null
                return (
                  <div key={phase} className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase]}`} />
                      <h4 className="text-sm font-semibold text-gray-300">{PHASE_LABELS[phase]}</h4>
                      <span className="text-xs text-gray-500">{phaseTasks.filter(t => t.status === 'done').length}/{phaseTasks.length}</span>
                    </div>
                    <div className="space-y-2">
                      {phaseTasks.map(task => (
                        <div key={task.id} className="bg-gray-800 rounded-xl p-3 border border-gray-700 flex items-center gap-3">
                          <select value={task.status} onChange={e => updateTaskStatus(task.id, e.target.value)}
                            className={`text-xs px-2 py-1 rounded-lg border-0 focus:outline-none flex-shrink-0 ${TASK_STATUS_COLORS[task.status]}`}>
                            <option value="todo">Todo</option>
                            <option value="in_progress">In Progress</option>
                            <option value="done">Done</option>
                            <option value="blocked">Blocked</option>
                          </select>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${task.status === 'done' ? 'line-through text-gray-500' : 'text-white'}`}>{task.title}</p>
                            {task.description && <p className="text-xs text-gray-500 truncate">{task.description}</p>}
                          </div>
                          <select value={task.assigned_to || ''} onChange={e => assignTask(task.id, e.target.value)}
                            className="bg-gray-700 text-xs text-gray-300 rounded-lg px-2 py-1 focus:outline-none flex-shrink-0">
                            <option value="">Unassigned</option>
                            {members.map(m => <option key={m.id} value={m.id}>{m.full_name?.split(' ')[0] || m.email?.split('@')[0]}</option>)}
                          </select>
                          <span className={`text-xs flex-shrink-0 ${PRIORITY_COLORS[task.priority] || 'text-gray-400'}`}>{task.priority}</span>
                          {task.due_date && <span className="text-xs text-gray-500 flex-shrink-0">{new Date(task.due_date).toLocaleDateString()}</span>}
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
                  <button onClick={() => setShowNewTask(true)} className="mt-3 text-purple-400 text-sm hover:text-purple-300">+ Add first task</button>
                </div>
              )}
            </div>
          )}

          {/* FILES & DELIVERABLES */}
          {activeTab === 'files' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Files & Deliverables ({deliverables.length})</h3>
              </div>
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 border-dashed mb-6">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Upload File</h4>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">File Title</label>
                    <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="e.g. Homepage Wireframe" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Phase</label>
                    <select value={uploadPhase} onChange={e => setUploadPhase(e.target.value)}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none">
                      {PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" accept="*/*" />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}
                    className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                    {uploadingFile ? '⏳ Uploading...' : '📎 Choose File'}
                  </button>
                  <p className="text-xs text-gray-500">Any file type — docs, images, videos, designs</p>
                </div>
              </div>
              {PHASES.map(phase => {
                const phaseFiles = deliverables.filter(d => d.phase === phase)
                if (!phaseFiles.length) return null
                return (
                  <div key={phase} className="mb-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase]}`} />
                      <h4 className="text-sm font-semibold text-gray-300">{PHASE_LABELS[phase]}</h4>
                      <span className="text-xs text-gray-500">{phaseFiles.length} files</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {phaseFiles.map(file => (
                        <div key={file.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex items-start gap-3">
                          <div className="text-2xl flex-shrink-0">
                            {file.file_type?.startsWith('image') ? '🖼️' :
                             file.file_type?.includes('pdf') ? '📄' :
                             file.file_type?.includes('video') ? '🎥' :
                             file.deliverable_type === 'figma' ? '🎨' : '📎'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{file.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {file.file_size ? `${Math.round(file.file_size / 1024)}KB` : ''} {file.deliverable_type}
                            </p>
                            <p className="text-xs text-gray-500">{new Date(file.created_at).toLocaleDateString()}</p>
                          </div>
                          <div className="flex flex-col gap-1 flex-shrink-0">
                            {file.file_url && (
                              <a href={file.file_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:text-blue-300">↗ Open</a>
                            )}
                            <button onClick={() => deleteDeliverable(file)}
                              className="text-xs text-red-400 hover:text-red-300">Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
              {deliverables.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-3">📁</p>
                  <p className="text-sm">No files uploaded yet</p>
                </div>
              )}
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
                <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-gray-700 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs text-gray-400 mb-1">Page Name *</label>
                      <input value={newPage.page_name} onChange={e => setNewPage({...newPage, page_name: e.target.value})}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">URL Slug</label>
                      <input value={newPage.url_slug} onChange={e => setNewPage({...newPage, url_slug: e.target.value})}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="/services/airport" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Page Type</label>
                      <select value={newPage.page_type} onChange={e => setNewPage({...newPage, page_type: e.target.value})}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {PAGE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Primary Keyword</label>
                      <input value={newPage.primary_keyword} onChange={e => setNewPage({...newPage, primary_keyword: e.target.value})}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Search Volume</label>
                      <input value={newPage.primary_kw_volume} onChange={e => setNewPage({...newPage, primary_kw_volume: e.target.value})}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">KD</label>
                      <input value={newPage.primary_kw_difficulty} onChange={e => setNewPage({...newPage, primary_kw_difficulty: e.target.value})}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Assigned Writer</label>
                      <input value={newPage.assigned_writer} onChange={e => setNewPage({...newPage, assigned_writer: e.target.value})}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" /></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Content Status</label>
                      <select value={newPage.content_status} onChange={e => setNewPage({...newPage, content_status: e.target.value})}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
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
                      {['Page','Type','Primary Keyword','SV','KD','Position','Content','Writer'].map(h => (
                        <th key={h} className="text-left py-2 pr-3 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map(page => (
                      <tr key={page.id} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                        <td className="py-2 pr-3"><div className="text-white font-medium">{page.page_name}</div>{page.url_slug && <div className="text-gray-500">{page.url_slug}</div>}</td>
                        <td className="py-2 pr-3 text-gray-400">{page.page_type?.replace(/_/g,' ')}</td>
                        <td className="py-2 pr-3"><input defaultValue={page.primary_keyword||''} onBlur={e=>updatePage(page.id,'primary_keyword',e.target.value)} className="bg-transparent text-gray-300 w-full focus:outline-none focus:bg-gray-700 rounded px-1" placeholder="—"/></td>
                        <td className="py-2 pr-3 text-gray-400">{page.primary_kw_volume||'—'}</td>
                        <td className="py-2 pr-3 text-gray-400">{page.primary_kw_difficulty||'—'}</td>
                        <td className="py-2 pr-3"><input defaultValue={page.primary_kw_position||''} onBlur={e=>updatePage(page.id,'primary_kw_position',e.target.value)} className="bg-transparent text-gray-300 w-16 focus:outline-none focus:bg-gray-700 rounded px-1" placeholder="—"/></td>
                        <td className="py-2 pr-3"><select value={page.content_status} onChange={e=>updatePage(page.id,'content_status',e.target.value)} className={`text-xs px-2 py-0.5 rounded-full border-0 ${CONTENT_STATUS_COLORS[page.content_status]}`}>{['not_started','drafting','review','approved','published'].map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></td>
                        <td className="py-2 pr-3 text-gray-400">{page.assigned_writer||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pages.length===0&&<div className="text-center py-8 text-gray-500"><p className="text-sm">No pages tracked yet</p></div>}
              </div>
            </div>
          )}

          {/* DOCUMENTS */}
          {activeTab === 'documents' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Documents ({documents.length})</h3>
                <button onClick={() => setShowNewDocForm(!showNewDocForm)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ New Doc</button>
              </div>
              {showNewDocForm && (
                <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-gray-700 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input value={newDoc.title} onChange={e=>setNewDoc({...newDoc,title:e.target.value})}
                      className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="Title *"/>
                    <select value={newDoc.doc_type} onChange={e=>setNewDoc({...newDoc,doc_type:e.target.value})}
                      className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                      {DOC_TYPES.map(t=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
                    </select>
                  </div>
                  <textarea value={newDoc.content} onChange={e=>setNewDoc({...newDoc,content:e.target.value})}
                    className="w-full bg-gray-700 text-white rounded px-2 py-2 text-xs focus:outline-none resize-none font-mono" rows={4} placeholder="Start writing..."/>
                  <div className="flex gap-2">
                    <button onClick={createDocument} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Create</button>
                    <button onClick={()=>setShowNewDocForm(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                  </div>
                </div>
              )}
              <div className="space-y-3">
                {documents.map(doc=>(
                  <div key={doc.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                    {editingDoc?.id===doc.id?(
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-white">{doc.title}</h4>
                          <div className="flex gap-2">
                            <button onClick={()=>saveDocument(editingDoc)} className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 rounded">Save v{(doc.version||1)+1}</button>
                            <button onClick={()=>setEditingDoc(null)} className="text-gray-400 text-xs hover:text-white">Cancel</button>
                          </div>
                        </div>
                        <textarea value={editingDoc.content} onChange={e=>setEditingDoc({...editingDoc,content:e.target.value})}
                          className="w-full bg-gray-700 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none font-mono" rows={12}/>
                      </div>
                    ):(
                      <div>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="text-sm font-semibold text-white">{doc.title}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded capitalize">{doc.doc_type?.replace(/_/g,' ')}</span>
                              <span className="text-xs text-gray-500">v{doc.version||1} · {new Date(doc.updated_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <button onClick={()=>setEditingDoc({...doc})} className="text-purple-400 text-xs hover:text-purple-300">Edit</button>
                        </div>
                        {doc.content?<pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans line-clamp-4">{doc.content}</pre>
                          :<p className="text-xs text-gray-600 italic">Empty. Click Edit to start writing.</p>}
                      </div>
                    )}
                  </div>
                ))}
                {documents.length===0&&<div className="text-center py-8 text-gray-500"><p className="text-sm">No documents yet</p></div>}
              </div>
            </div>
          )}

          {/* GANTT */}
          {activeTab === 'gantt' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Timeline</h3>
                <button onClick={()=>setShowNewMilestoneForm(!showNewMilestoneForm)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Milestone</button>
              </div>
              {showNewMilestoneForm&&(
                <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-gray-700 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input value={newMilestone.title} onChange={e=>setNewMilestone({...newMilestone,title:e.target.value})}
                      className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" placeholder="Milestone title *"/>
                    <select value={newMilestone.phase} onChange={e=>setNewMilestone({...newMilestone,phase:e.target.value})}
                      className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                      {PHASES.map(p=><option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                    </select>
                    <input type="date" value={newMilestone.start_date} onChange={e=>setNewMilestone({...newMilestone,start_date:e.target.value})}
                      className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                    <input type="date" value={newMilestone.end_date} onChange={e=>setNewMilestone({...newMilestone,end_date:e.target.value})}
                      className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createMilestone} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add</button>
                    <button onClick={()=>setShowNewMilestoneForm(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                  </div>
                </div>
              )}
              {milestones.length>0?(
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 overflow-x-auto">
                  <div className="min-w-[500px] space-y-3">
                    {PHASES.map(phase=>{
                      const pm=milestones.filter(m=>m.phase===phase)
                      if(!pm.length) return null
                      return(
                        <div key={phase} className="mb-4">
                          <div className="flex items-center gap-2 mb-2">
                            <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase]}`}/>
                            <span className="text-xs font-semibold text-gray-300">{PHASE_LABELS[phase]}</span>
                          </div>
                          {pm.map(m=>{
                            const{left,width}=getMilestoneBar(m)
                            return(
                              <div key={m.id} className="flex items-center gap-3 mb-2">
                                <div className="w-28 flex-shrink-0"><p className="text-xs text-gray-300 truncate">{m.title}</p></div>
                                <div className="flex-1 bg-gray-700 rounded-full h-6 relative">
                                  <div className={`absolute h-6 rounded-full flex items-center px-2 text-xs font-medium text-white ${m.status==='completed'?'bg-green-600':m.status==='in_progress'?'bg-purple-600':m.status==='blocked'?'bg-red-600':'bg-gray-600'}`}
                                    style={{left:`${left}%`,width:`${width}%`,minWidth:'40px'}}>
                                    {m.start_date&&<span className="truncate text-xs">{new Date(m.start_date).toLocaleDateString('en',{month:'short',day:'numeric'})}</span>}
                                  </div>
                                </div>
                                <select value={m.status} onChange={e=>updateMilestoneStatus(m.id,e.target.value)}
                                  className={`text-xs px-2 py-0.5 rounded border-0 flex-shrink-0 ${m.status==='completed'?'bg-green-900 text-green-300':m.status==='in_progress'?'bg-purple-900 text-purple-300':'bg-gray-700 text-gray-300'}`}>
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
              ):<div className="text-center py-12 text-gray-500"><p className="text-4xl mb-3">📅</p><p className="text-sm">No milestones yet</p></div>}
            </div>
          )}

          {/* TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="space-y-2">
              {timeline.map(event=>(
                <div key={event.id} className="flex gap-3 items-start">
                  <div className="w-2 h-2 rounded-full bg-purple-500 mt-2 flex-shrink-0"/>
                  <div className="flex-1 bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <p className="text-sm text-gray-200">{event.description}</p>
                    <p className="text-xs text-gray-500 mt-1">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {timeline.length===0&&<div className="text-center py-8 text-gray-500"><p className="text-sm">No events yet</p></div>}
            </div>
          )}

          {/* HANDOFFS */}
          {activeTab === 'handoffs' && (
            <div className="space-y-3">
              {handoffs.map(h=>(
                <div key={h.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-white">{PHASE_LABELS[h.from_phase]} → {PHASE_LABELS[h.to_phase]}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${h.status==='approved'?'bg-green-900 text-green-300':h.status==='rejected'?'bg-red-900 text-red-300':'bg-yellow-900 text-yellow-300'}`}>{h.status}</span>
                  </div>
                  <p className="text-xs text-gray-400">{new Date(h.created_at).toLocaleString()}</p>
                  {h.status==='pending'&&profile?.role==='admin'&&(
                    <div className="flex gap-2 mt-3">
                      <button onClick={()=>approveHandoff(h.id,h)} className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1.5 rounded">Approve</button>
                      <button onClick={()=>rejectHandoff(h.id)} className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5 rounded">Reject</button>
                    </div>
                  )}
                </div>
              ))}
              {handoffs.length===0&&<div className="text-center py-8 text-gray-500"><p className="text-sm">No handoffs yet</p></div>}
            </div>
          )}

          {/* AI WORK ASSISTANT */}
          {activeTab === 'ai' && (
            <div className="flex flex-col" style={{height:'500px'}}>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                  <button onClick={()=>setAiMode('assist')}
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors ${aiMode==='assist'?'bg-purple-600 text-white':'text-gray-400 hover:text-white'}`}>
                    💬 Assist
                  </button>
                  <button onClick={()=>setAiMode('execute')}
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors ${aiMode==='execute'?'bg-green-600 text-white':'text-gray-400 hover:text-white'}`}>
                    ⚡ Execute
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  {aiMode==='assist'?'Ask questions, get guidance, plan work':'AI produces actual deliverables — content, briefs, copy'}
                </p>
                {aiMessages.length>0&&(
                  <button onClick={()=>setAiMessages([])} className="text-xs text-gray-500 hover:text-gray-300 ml-auto">Clear</button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 mb-4">
                {aiMessages.length===0&&(
                  <div className="text-center py-6 text-gray-500">
                    <p className="text-3xl mb-2">🤖</p>
                    <p className="text-sm font-medium text-gray-400">Anka Sphere AI</p>
                    <p className="text-xs mt-1 mb-4">Context-aware work assistant for {selectedProject.name}</p>
                    <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
                      {(aiMode==='assist'?[
                        'What tasks are blocked?',
                        'Summarize project status',
                        'What should the team focus on next?',
                        'Which pages are missing keywords?',
                      ]:[
                        'Write homepage meta title and description',
                        'Create a content brief for the services page',
                        'Write 3 social media posts for this project',
                        'Draft a client update email',
                      ]).map(s=>(
                        <button key={s} onClick={()=>setAiInput(s)}
                          className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-left border border-gray-700">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {aiMessages.map((msg,i)=>(
                  <div key={i} className={`flex ${msg.role==='user'?'justify-end':'justify-start'}`}>
                    <div className={`max-w-2xl rounded-xl px-4 py-3 text-sm ${msg.role==='user'?'bg-purple-600 text-white':'bg-gray-800 text-gray-200 border border-gray-700'}`}>
                      <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                    </div>
                  </div>
                ))}
                {aiLoading&&(
                  <div className="flex justify-start">
                    <div className="bg-gray-800 rounded-xl px-4 py-3 text-sm text-gray-400 border border-gray-700">
                      <span className="animate-pulse">Thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={aiEndRef}/>
              </div>
              <div className="flex gap-2">
                <input value={aiInput} onChange={e=>setAiInput(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendAiMessage()}
                  className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700"
                  placeholder={aiMode==='assist'?'Ask about this project...':'Describe what to create...'}/>
                <button onClick={sendAiMessage} disabled={aiLoading||!aiInput.trim()}
                  className={`px-4 py-2 rounded-xl text-sm disabled:opacity-50 transition-colors ${aiMode==='execute'?'bg-green-600 hover:bg-green-700':'bg-purple-600 hover:bg-purple-700'} text-white`}>
                  {aiMode==='execute'?'⚡':'→'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    )
  }

  // PROJECTS LIST
  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div>
          <h2 className="text-lg font-bold text-white">Anka Sphere Projects</h2>
          <p className="text-xs text-gray-400 mt-0.5">{projects.length} projects</p>
        </div>
        <button onClick={()=>setView('new_project')} className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg">+ New Project</button>
      </div>
      <div className="flex gap-2 px-6 py-3 border-b border-gray-800">
        {['all',...PHASES,'completed'].map(phase=>(
          <button key={phase} onClick={()=>setFilterPhase(phase)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${filterPhase===phase?'bg-purple-600 text-white':'text-gray-400 hover:text-white bg-gray-800'}`}>
            {phase==='all'?'All':PHASE_LABELS[phase]||phase}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {filteredProjects.length===0?(
          <div className="text-center py-20 text-gray-500">
            <p className="text-5xl mb-4">🚀</p>
            <p className="text-lg font-medium text-gray-400">No projects yet</p>
            <button onClick={()=>setView('new_project')} className="mt-4 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm">+ New Project</button>
          </div>
        ):(
          <div className="grid grid-cols-1 gap-4">
            {filteredProjects.map(project=>(
              <div key={project.id} onClick={()=>fetchProjectDetail(project)}
                className="bg-gray-800 border border-gray-700 hover:border-purple-500/50 rounded-xl p-5 cursor-pointer transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">{project.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{project.as_clients?.name||'No client'}{project.as_clients?.company?` · ${project.as_clients.company}`:''}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[project.status]||'bg-gray-700 text-gray-300'}`}>{project.status?.replace(/_/g,' ')}</span>
                </div>
                {project.description&&<p className="text-sm text-gray-400 mb-3 line-clamp-1">{project.description}</p>}
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[project.current_phase]||'bg-gray-500'}`}/>
                  <span className="text-xs text-gray-400">{PHASE_LABELS[project.current_phase]}</span>
                  {project.deadline&&<span className="text-xs text-gray-500 ml-auto">Due {new Date(project.deadline).toLocaleDateString()}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
