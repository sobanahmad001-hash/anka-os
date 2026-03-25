import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { callAI } from '../lib/callAI.js'

const STATUS_COLORS = {
  planning: 'bg-gray-700 text-gray-300',
  active: 'bg-green-900/50 text-green-300',
  on_hold: 'bg-yellow-900/50 text-yellow-300',
  completed: 'bg-blue-900/50 text-blue-300',
  archived: 'bg-gray-800 text-gray-500',
}

const PRIORITY_COLORS = {
  low: 'text-gray-400',
  medium: 'text-blue-400',
  normal: 'text-blue-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
}

const NODE_COLORS = {
  start: 'bg-purple-600',
  research: 'bg-blue-600',
  task_batch: 'bg-green-600',
  decision: 'bg-yellow-600',
  milestone: 'bg-pink-600',
  blocker: 'bg-red-600',
  completed: 'bg-gray-600',
}

export default function Projects() {
  const { profile, user } = useAuth()
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [view, setView] = useState('list')

  const [projectTasks, setProjectTasks] = useState([])
  const [research, setResearch] = useState([])
  const [documents, setDocuments] = useState([])
  const [flowchart, setFlowchart] = useState([])

  const [showNewProject, setShowNewProject] = useState(false)
  const [showNewTask, setShowNewTask] = useState(false)
  const [showNewResearch, setShowNewResearch] = useState(false)
  const [showNewDoc, setShowNewDoc] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [editingResearch, setEditingResearch] = useState(null)

  const [newProject, setNewProject] = useState({ name: '', description: '', status: 'active', priority: 'medium', due_date: '', department_id: 'development' })
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', due_date: '' })
  const [newResearch, setNewResearch] = useState({ title: '', content: '', source: '' })
  const [newDoc, setNewDoc] = useState({ title: '', content: '', doc_type: 'living' })

  const [aiLoading, setAiLoading] = useState(false)
  const [taskSuggestions, setTaskSuggestions] = useState([])
  const [suggestingFor, setSuggestingFor] = useState(null)
  const aiRef = useRef(null)

  useEffect(() => { fetchProjects() }, [])

  async function fetchProjects() {
    setLoading(true)
    const [projRes, taskRes] = await Promise.allSettled([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').order('created_at', { ascending: false })
    ])
    setProjects(projRes.status === 'fulfilled' ? projRes.value.data || [] : [])
    setTasks(taskRes.status === 'fulfilled' ? taskRes.value.data || [] : [])
    setLoading(false)
  }

  async function fetchProjectDetail(project) {
    setSelectedProject(project)
    setView('detail')
    setActiveTab('overview')
    const [tasksRes, researchRes, docsRes, flowRes] = await Promise.all([
      supabase.from('tasks').select('*').eq('project_id', project.id).order('created_at'),
      supabase.from('project_research').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      supabase.from('project_documents').select('*').eq('project_id', project.id).order('updated_at', { ascending: false }),
      supabase.from('project_flowchart_nodes').select('*').eq('project_id', project.id).order('node_order'),
    ])
    setProjectTasks(tasksRes.data || [])
    setResearch(researchRes.data || [])
    setDocuments(docsRes.data || [])
    setFlowchart(flowRes.data || [])
  }

  async function createProject() {
    if (!newProject.name) return
    const { data, error } = await supabase.from('projects').insert({
      ...newProject, progress: 0, owner_id: user?.id
    }).select().single()
    if (!error && data) {
      await Promise.all([
        supabase.from('project_documents').insert({
          project_id: data.id, doc_type: 'living',
          title: `${data.name} - Living Document`, content: `# ${data.name}\n\n## Overview\n\n## Goals\n\n## Key Decisions\n\n## Current Status\n`,
          updated_by: user?.id
        }),
        supabase.from('project_flowchart_nodes').insert({
          project_id: data.id, node_type: 'start',
          label: 'Project Started', description: `${data.name} initialized`, node_order: 0
        })
      ])
      setShowNewProject(false)
      setNewProject({ name: '', description: '', status: 'active', priority: 'medium', due_date: '', department_id: 'development' })
      fetchProjects()
    }
  }

  async function createTask() {
    if (!newTask.title || !selectedProject) return
    const { error } = await supabase.from('tasks').insert({
      ...newTask, project_id: selectedProject.id,
      user_id: user?.id, assigned_to: user?.id,
      department: selectedProject.department_id || 'development'
    })
    if (!error) {
      setShowNewTask(false)
      setNewTask({ title: '', description: '', priority: 'medium', due_date: '' })
      fetchProjectDetail(selectedProject)
    }
  }

  async function updateTaskStatus(taskId, status) {
    await supabase.from('tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', taskId)
    setProjectTasks(projectTasks.map(t => t.id === taskId ? { ...t, status } : t))
    if (status === 'done') {
      const task = projectTasks.find(t => t.id === taskId)
      const doneCount = projectTasks.filter(t => t.status === 'done').length + 1
      if (doneCount % 3 === 0) {
        await supabase.from('project_flowchart_nodes').insert({
          project_id: selectedProject.id, node_type: 'task_batch',
          label: `${doneCount} Tasks Completed`, description: `Milestone: ${task?.title} and others`,
          node_order: flowchart.length + 1
        })
        fetchProjectDetail(selectedProject)
      }
    }
  }

  async function createResearch() {
    if (!newResearch.title || !selectedProject) return
    const { data, error } = await supabase.from('project_research').insert({
      ...newResearch, project_id: selectedProject.id, created_by: user?.id
    }).select().single()
    if (!error && data) {
      await supabase.from('project_flowchart_nodes').insert({
        project_id: selectedProject.id, node_type: 'research',
        label: `Research: ${data.title}`, description: data.content?.slice(0, 100),
        node_order: flowchart.length + 1
      })
      setShowNewResearch(false)
      setNewResearch({ title: '', content: '', source: '' })
      fetchProjectDetail(selectedProject)
    }
  }

  async function suggestTasksFromResearch(researchItem) {
    setSuggestingFor(researchItem.id)
    setAiLoading(true)
    try {
      const text = await callAI({
        system: `You are a project manager AI. Given research notes, suggest 4-6 concrete actionable tasks. Return ONLY a JSON array like: [{"title":"Task name","description":"Brief description","priority":"medium"}]. No markdown, no explanation.`,
        messages: [{ role: 'user', content: `Project: ${selectedProject?.name}\nResearch Title: ${researchItem.title}\nResearch Content: ${researchItem.content}\n\nSuggest tasks based on this research.` }],
        maxTokens: 1000
      })
      const suggestions = JSON.parse(text.replace(/```json|```/g, '').trim())
      setTaskSuggestions(suggestions)
    } catch (e) {
      setTaskSuggestions([{ title: 'AI error', description: 'Could not generate suggestions', priority: 'low' }])
    }
    setAiLoading(false)
  }

  async function approveTaskSuggestions(researchId) {
    if (!taskSuggestions.length || !selectedProject) return
    const inserts = taskSuggestions.map(t => ({
      title: t.title, description: t.description,
      priority: t.priority || 'medium', project_id: selectedProject.id,
      user_id: user?.id, assigned_to: user?.id,
      department: selectedProject.department_id || 'development',
      status: 'todo'
    }))
    await supabase.from('tasks').insert(inserts)
    await supabase.from('project_research').update({ tasks_approved: true }).eq('id', researchId)
    await supabase.from('project_flowchart_nodes').insert({
      project_id: selectedProject.id, node_type: 'task_batch',
      label: `${inserts.length} Tasks Created`, description: `From research: ${researchId}`,
      node_order: flowchart.length + 1
    })
    setTaskSuggestions([])
    setSuggestingFor(null)
    fetchProjectDetail(selectedProject)
  }

  async function saveDocument(doc) {
    await supabase.from('project_documents').update({
      content: doc.content, version: (doc.version || 1) + 1,
      updated_by: user?.id, updated_at: new Date().toISOString()
    }).eq('id', doc.id)
    setEditingDoc(null)
    fetchProjectDetail(selectedProject)
  }

  async function createDocument() {
    if (!newDoc.title || !selectedProject) return
    await supabase.from('project_documents').insert({
      ...newDoc, project_id: selectedProject.id, updated_by: user?.id
    })
    setShowNewDoc(false)
    setNewDoc({ title: '', content: '', doc_type: 'living' })
    fetchProjectDetail(selectedProject)
  }

  async function addFlowchartNode(type, label) {
    await supabase.from('project_flowchart_nodes').insert({
      project_id: selectedProject.id, node_type: type,
      label, node_order: flowchart.length + 1
    })
    fetchProjectDetail(selectedProject)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-gray-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  )

  if (view === 'detail' && selectedProject) {
    const doneTasks = projectTasks.filter(t => t.status === 'done').length
    const totalTasks = projectTasks.length
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

    return (
      <div className="flex flex-col h-full bg-gray-950 text-white">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('list'); setSelectedProject(null) }} className="text-gray-400 hover:text-white text-lg">Back</button>
            <div>
              <h2 className="text-lg font-bold text-white">{selectedProject.name}</h2>
              <p className="text-xs text-gray-400 capitalize">{selectedProject.department_id} - {selectedProject.status}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-xs text-gray-400">{progress}% complete</p>
              <div className="w-24 bg-gray-700 rounded-full h-1.5 mt-1">
                <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[selectedProject.status] || 'bg-gray-700 text-gray-300'}`}>
              {selectedProject.status}
            </span>
          </div>
        </div>

        <div className="flex gap-1 px-6 pt-4 border-b border-gray-800 pb-3">
          {['overview', 'tasks', 'research', 'document', 'flowchart'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${activeTab === tab ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">

          {activeTab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Total Tasks', value: totalTasks },
                  { label: 'Completed', value: doneTasks, color: 'text-green-400' },
                  { label: 'Blocked', value: projectTasks.filter(t => t.status === 'blocked').length, color: 'text-red-400' },
                  { label: 'Research', value: research.length, color: 'text-blue-400' },
                ].map(s => (
                  <div key={s.label} className="bg-gray-800 rounded-xl p-4 text-center border border-gray-700">
                    <p className={`text-2xl font-bold ${s.color || 'text-white'}`}>{s.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {selectedProject.description && (
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Description</h3>
                  <p className="text-sm text-gray-300">{selectedProject.description}</p>
                </div>
              )}

              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Recent Tasks</h3>
                <div className="space-y-2">
                  {projectTasks.slice(0, 4).map(t => (
                    <div key={t.id} className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${t.status === 'done' ? 'bg-green-500' : t.status === 'blocked' ? 'bg-red-500' : t.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-600'}`} />
                      <p className={`text-sm flex-1 ${t.status === 'done' ? 'line-through text-gray-500' : 'text-gray-300'}`}>{t.title}</p>
                      <span className="text-xs text-gray-500 capitalize">{t.status?.replace(/_/g, ' ')}</span>
                    </div>
                  ))}
                  {projectTasks.length === 0 && <p className="text-sm text-gray-500">No tasks yet</p>}
                </div>
              </div>

              <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Log Event to Flowchart</h3>
                <div className="flex gap-2 flex-wrap">
                  {['decision', 'milestone', 'blocker'].map(type => (
                    <button key={type} onClick={() => {
                      const label = prompt(`Label for ${type}:`)
                      if (label) addFlowchartNode(type, label)
                    }} className={`text-xs px-3 py-1.5 rounded-lg text-white ${NODE_COLORS[type]} hover:opacity-80 transition-opacity capitalize`}>
                      + {type}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Tasks ({projectTasks.length})</h3>
                <button onClick={() => setShowNewTask(!showNewTask)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Add Task</button>
              </div>

              {showNewTask && (
                <div className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3 border border-gray-700">
                  <input value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                    placeholder="Task title *" />
                  <textarea value={newTask.description} onChange={e => setNewTask({...newTask, description: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none" rows={2}
                    placeholder="Description..." />
                  <div className="grid grid-cols-2 gap-3">
                    <select value={newTask.priority} onChange={e => setNewTask({...newTask, priority: e.target.value})}
                      className="bg-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none">
                      {['low','medium','high','urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <input type="date" value={newTask.due_date} onChange={e => setNewTask({...newTask, due_date: e.target.value})}
                      className="bg-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createTask} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add</button>
                    <button onClick={() => setShowNewTask(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {['todo', 'in_progress', 'blocked', 'done'].map(status => {
                  const statusTasks = projectTasks.filter(t => t.status === status)
                  if (!statusTasks.length) return null
                  return (
                    <div key={status}>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 mt-4">{status.replace(/_/g, ' ')} ({statusTasks.length})</p>
                      <div className="space-y-2">
                        {statusTasks.map(task => (
                          <div key={task.id} className="bg-gray-800 rounded-lg p-3 flex items-center gap-3 border border-gray-700">
                            <select value={task.status} onChange={e => updateTaskStatus(task.id, e.target.value)}
                              className="bg-gray-700 text-xs text-gray-300 rounded px-2 py-1 focus:outline-none">
                              <option value="todo">Todo</option>
                              <option value="in_progress">In Progress</option>
                              <option value="done">Done</option>
                              <option value="blocked">Blocked</option>
                            </select>
                            <div className="flex-1">
                              <p className={`text-sm ${task.status === 'done' ? 'line-through text-gray-500' : 'text-white'}`}>{task.title}</p>
                              {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                            </div>
                            <span className={`text-xs font-medium ${PRIORITY_COLORS[task.priority] || 'text-gray-400'}`}>{task.priority}</span>
                            {task.due_date && <span className="text-xs text-gray-500">{new Date(task.due_date).toLocaleDateString()}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {projectTasks.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <p className="text-4xl mb-3">No tasks yet</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'research' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Research Sessions ({research.length})</h3>
                <button onClick={() => setShowNewResearch(!showNewResearch)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ New Research</button>
              </div>

              {showNewResearch && (
                <div className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3 border border-gray-700">
                  <input value={newResearch.title} onChange={e => setNewResearch({...newResearch, title: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                    placeholder="Research title *" />
                  <textarea value={newResearch.content} onChange={e => setNewResearch({...newResearch, content: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none font-mono" rows={6}
                    placeholder="Paste research notes, findings, market analysis..." />
                  <input value={newResearch.source} onChange={e => setNewResearch({...newResearch, source: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                    placeholder="Source URL or reference (optional)" />
                  <div className="flex gap-2">
                    <button onClick={createResearch} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Save Research</button>
                    <button onClick={() => setShowNewResearch(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {research.map(r => (
                  <div key={r.id} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-white">{r.title}</h4>
                        {r.source && <a href={r.source} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">{r.source}</a>}
                        <p className="text-xs text-gray-500 mt-1">{new Date(r.created_at).toLocaleDateString()}</p>
                      </div>
                      {r.tasks_approved && <span className="text-xs bg-green-900/50 text-green-300 px-2 py-0.5 rounded-full">Tasks created</span>}
                    </div>

                    {r.content && (
                      <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans mb-4 line-clamp-4">{r.content}</pre>
                    )}

                    {!r.tasks_approved && (
                      <div>
                        {suggestingFor === r.id && taskSuggestions.length > 0 ? (
                          <div>
                            <p className="text-xs text-gray-400 mb-2">AI suggests these tasks:</p>
                            <div className="space-y-2 mb-3">
                              {taskSuggestions.map((s, i) => (
                                <div key={i} className="bg-gray-700 rounded-lg px-3 py-2 flex items-start gap-2">
                                  <div className="flex-1">
                                    <p className="text-xs font-medium text-white">{s.title}</p>
                                    {s.description && <p className="text-xs text-gray-400 mt-0.5">{s.description}</p>}
                                  </div>
                                  <span className={`text-xs flex-shrink-0 ${PRIORITY_COLORS[s.priority] || 'text-gray-400'}`}>{s.priority}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => approveTaskSuggestions(r.id)}
                                className="bg-green-600 hover:bg-green-700 text-white text-xs px-4 py-1.5 rounded">
                                Approve All ({taskSuggestions.length} tasks)
                              </button>
                              <button onClick={() => { setTaskSuggestions([]); setSuggestingFor(null) }}
                                className="text-gray-400 text-xs hover:text-white px-3">Dismiss</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => suggestTasksFromResearch(r)}
                            disabled={aiLoading && suggestingFor === r.id}
                            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs px-4 py-1.5 rounded-lg transition-colors">
                            {aiLoading && suggestingFor === r.id ? 'Thinking...' : 'Suggest Tasks from Research'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {research.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <p className="text-sm">No research yet</p>
                    <p className="text-xs mt-1">Add research notes and AI will suggest tasks from them</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'document' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Project Documents ({documents.length})</h3>
                <button onClick={() => setShowNewDoc(!showNewDoc)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ New Doc</button>
              </div>

              {showNewDoc && (
                <div className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3 border border-gray-700">
                  <div className="grid grid-cols-2 gap-3">
                    <input value={newDoc.title} onChange={e => setNewDoc({...newDoc, title: e.target.value})}
                      className="bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="Document title *" />
                    <select value={newDoc.doc_type} onChange={e => setNewDoc({...newDoc, doc_type: e.target.value})}
                      className="bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none">
                      {['living','decision','brief','handoff','general'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <textarea value={newDoc.content} onChange={e => setNewDoc({...newDoc, content: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none font-mono" rows={5}
                    placeholder="Start writing..." />
                  <div className="flex gap-2">
                    <button onClick={createDocument} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Create</button>
                    <button onClick={() => setShowNewDoc(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {documents.map(doc => (
                  <div key={doc.id} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                    {editingDoc?.id === doc.id ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-white">{doc.title}</h4>
                          <div className="flex gap-2">
                            <button onClick={() => saveDocument(editingDoc)} className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 rounded">Save v{(doc.version || 1) + 1}</button>
                            <button onClick={() => setEditingDoc(null)} className="text-gray-400 text-xs hover:text-white">Cancel</button>
                          </div>
                        </div>
                        <textarea value={editingDoc.content} onChange={e => setEditingDoc({...editingDoc, content: e.target.value})}
                          className="w-full bg-gray-700 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none font-mono" rows={14} />
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="text-sm font-semibold text-white">{doc.title}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded capitalize">{doc.doc_type}</span>
                              <span className="text-xs text-gray-500">v{doc.version || 1}</span>
                              <span className="text-xs text-gray-500">{new Date(doc.updated_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <button onClick={() => setEditingDoc({...doc})} className="text-purple-400 text-xs hover:text-purple-300">Edit</button>
                        </div>
                        {doc.content ? (
                          <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans">{doc.content}</pre>
                        ) : (
                          <p className="text-xs text-gray-600 italic">Empty document. Click Edit to start writing.</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {documents.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <p className="text-sm">No documents yet</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'flowchart' && (
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Project Evolution ({flowchart.length} nodes)</h3>
              {flowchart.length > 0 ? (
                <div className="relative">
                  <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-700" />
                  <div className="space-y-4">
                    {flowchart.map((node, i) => (
                      <div key={node.id} className="flex items-start gap-4 relative">
                        <div className={`w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center text-lg z-10 ${NODE_COLORS[node.node_type] || 'bg-gray-700'}`}>
                          {node.node_type === 'start' ? 'S' :
                           node.node_type === 'research' ? 'R' :
                           node.node_type === 'task_batch' ? 'T' :
                           node.node_type === 'decision' ? 'D' :
                           node.node_type === 'milestone' ? 'M' :
                           node.node_type === 'blocker' ? 'B' : 'O'}
                        </div>
                        <div className="flex-1 bg-gray-800 rounded-xl p-4 border border-gray-700">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-semibold text-white">{node.label}</p>
                            <span className="text-xs text-gray-500">{new Date(node.created_at).toLocaleDateString()}</span>
                          </div>
                          {node.description && <p className="text-xs text-gray-400">{node.description}</p>}
                          <span className={`text-xs px-2 py-0.5 rounded-full mt-2 inline-block text-white ${NODE_COLORS[node.node_type]}`}>
                            {node.node_type.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-sm">No events logged yet</p>
                  <p className="text-xs mt-1">Nodes appear automatically as you add research, complete tasks, and log decisions</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div>
          <h2 className="text-xl font-bold text-white">Projects</h2>
          <p className="text-xs text-gray-400 mt-0.5">{projects.length} projects - Intelligence Loop enabled</p>
        </div>
        <button onClick={() => setShowNewProject(!showNewProject)} className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg">+ New Project</button>
      </div>

      {showNewProject && (
        <div className="mx-6 mt-4 bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Project Name *</label>
              <input value={newProject.name} onChange={e => setNewProject({...newProject, name: e.target.value})}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g. Anka Diversify Platform" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <textarea value={newProject.description} onChange={e => setNewProject({...newProject, description: e.target.value})}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" rows={2} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Department</label>
              <select value={newProject.department_id} onChange={e => setNewProject({...newProject, department_id: e.target.value})}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="development">Development</option>
                <option value="design">Design</option>
                <option value="marketing">Marketing</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Priority</label>
              <select value={newProject.priority} onChange={e => setNewProject({...newProject, priority: e.target.value})}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                {['low','medium','high','urgent'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Due Date</label>
              <input type="date" value={newProject.due_date} onChange={e => setNewProject({...newProject, due_date: e.target.value})}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={createProject} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Create Project</button>
            <button onClick={() => setShowNewProject(false)} className="text-gray-400 text-sm hover:text-white px-3">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {projects.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg font-medium text-gray-400">No projects yet</p>
            <button onClick={() => setShowNewProject(true)} className="mt-4 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm">+ New Project</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {projects.map(project => {
              const pTasks = tasks.filter(t => t.project_id === project.id)
              const done = pTasks.filter(t => t.status === 'done').length
              const blocked = pTasks.filter(t => t.status === 'blocked').length
              const progress = pTasks.length > 0 ? Math.round((done / pTasks.length) * 100) : project.progress || 0
              return (
                <div key={project.id} onClick={() => fetchProjectDetail(project)}
                  className="bg-gray-800 border border-gray-700 hover:border-purple-500/50 rounded-xl p-5 cursor-pointer transition-all group">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">{project.name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5 capitalize">{project.department_id || 'unassigned'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {blocked > 0 && <span className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded-full">{blocked} blocked</span>}
                      <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[project.status] || 'bg-gray-700 text-gray-300'}`}>{project.status}</span>
                    </div>
                  </div>
                  {project.description && <p className="text-sm text-gray-400 mb-3 line-clamp-1">{project.description}</p>}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                      <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{progress}%</span>
                    <span className={`text-xs flex-shrink-0 ${PRIORITY_COLORS[project.priority] || 'text-gray-400'}`}>{project.priority}</span>
                    {project.due_date && <span className="text-xs text-gray-500 flex-shrink-0">Due {new Date(project.due_date).toLocaleDateString()}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
