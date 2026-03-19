import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
const PHASE_LABELS = {
  product_modeling: 'Product Modeling',
  development: 'Development',
  marketing: 'Marketing',
  completed: 'Completed'
}
const PHASE_ORDER = ['product_modeling', 'development', 'marketing']
export default function AnkaSpherePortal() {
  const { user } = useAuth()
  const [client, setClient] = useState(null)
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [timeline, setTimeline] = useState([])
  const [signoffs, setSignoffs] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('dashboard')
  const [feedbackText, setFeedbackText] = useState('')
  useEffect(() => {
    if (user) fetchClientData()
  }, [user])
  useEffect(() => {
    if (!selectedProject) return
    const channel = supabase
      .channel(`project-${selectedProject.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'as_tasks', filter: `project_id=eq.${selectedProject.id}` },
        () => fetchProjectDetail(selectedProject))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'as_timeline_events', filter: `project_id=eq.${selectedProject.id}` },
        () => fetchProjectDetail(selectedProject))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [selectedProject?.id])
  async function fetchClientData() {
    setLoading(true)
    const { data: clientData } = await supabase
      .from('as_clients')
      .select('*')
      .eq('auth_user_id', user.id)
      .single()
    if (clientData) {
      setClient(clientData)
      const { data: projectsData } = await supabase
        .from('as_projects')
        .select('*')
        .eq('client_id', clientData.id)
        .order('created_at', { ascending: false })
      setProjects(projectsData || [])
    }
    setLoading(false)
  }
  async function fetchProjectDetail(project) {
    setSelectedProject(project)
    setView('project')
    const [tasksRes, timelineRes, signoffsRes] = await Promise.all([
      supabase.from('as_tasks').select('*').eq('project_id', project.id).order('created_at'),
      supabase.from('as_timeline_events').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('as_client_signoffs').select('*').eq('project_id', project.id).order('requested_at', { ascending: false })
    ])
    setTasks(tasksRes.data || [])
    setTimeline(timelineRes.data || [])
    setSignoffs(signoffsRes.data || [])
  }
  async function respondToSignoff(signoffId, status) {
    await supabase.from('as_client_signoffs').update({
      status, feedback: feedbackText, responded_at: new Date().toISOString()
    }).eq('id', signoffId)
    await supabase.from('as_timeline_events').insert({
      project_id: selectedProject.id,
      event_type: status === 'approved' ? 'client_signoff_approved' : 'client_signoff_changes_requested',
      description: status === 'approved'
        ? `Client approved ${selectedProject.current_phase} phase`
        : `Client requested changes: ${feedbackText}`,
    })
    setFeedbackText('')
    fetchProjectDetail(selectedProject)
  }
  function getPhaseProgress(phase) {
    const phaseTasks = tasks.filter(t => t.phase === phase && !t.is_prep_task)
    if (!phaseTasks.length) return 0
    return Math.round((phaseTasks.filter(t => t.status === 'done').length / phaseTasks.length) * 100)
  }
  function getOverallProgress() {
    const allTasks = tasks.filter(t => !t.is_prep_task)
    if (!allTasks.length) return 0
    return Math.round((allTasks.filter(t => t.status === 'done').length / allTasks.length) * 100)
  }
  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  )
  if (!client) return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <p className="text-5xl mb-4">🔒</p>
      <h3 className="text-lg font-semibold text-white mb-2">No Client Account Found</h3>
      <p className="text-sm text-gray-400">Your account hasn't been linked to a client profile yet. Contact your project manager.</p>
    </div>
  )
  // PROJECT DETAIL
  if (view === 'project' && selectedProject) {
    const pendingSignoff = signoffs.find(s => s.status === 'pending')
    const currentPhaseIndex = PHASE_ORDER.indexOf(selectedProject.current_phase)
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-700">
          <button onClick={() => setView('dashboard')} className="text-gray-400 hover:text-white transition-colors">←</button>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">{selectedProject.name}</h2>
            <p className="text-xs text-gray-400">Overall Progress — {getOverallProgress()}%</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Sign-off request */}
          {pendingSignoff && (
            <div className="bg-purple-900/30 border border-purple-500/50 rounded-xl p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xl">✍️</span>
                <div className="flex-1">
                  <h3 className="text-white font-semibold mb-1">Your Approval is Needed</h3>
                  <p className="text-sm text-purple-200 mb-4">
                    The {PHASE_LABELS[selectedProject.current_phase]} phase is complete. Please review and approve to move forward.
                  </p>
                  <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                    className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                    rows={2} placeholder="Optional feedback or notes..." />
                  <div className="flex gap-3">
                    <button onClick={() => respondToSignoff(pendingSignoff.id, 'approved')}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-2 rounded-lg font-medium transition-colors">
                      ✅ Approve & Move Forward
                    </button>
                    <button onClick={() => respondToSignoff(pendingSignoff.id, 'changes_requested')}
                      className="flex-1 bg-orange-600 hover:bg-orange-700 text-white text-sm py-2 rounded-lg font-medium transition-colors">
                      🔄 Request Changes
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Phase pipeline */}
          <div className="bg-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Project Pipeline</h3>
            <div className="space-y-3">
              {PHASE_ORDER.map((phase, i) => {
                const progress = getPhaseProgress(phase)
                const isActive = selectedProject.current_phase === phase
                const isComplete = i < currentPhaseIndex
                const isUpcoming = i > currentPhaseIndex
                return (
                  <div key={phase} className={`rounded-lg p-4 border ${
                    isActive ? 'border-purple-500 bg-purple-900/20' :
                    isComplete ? 'border-green-500/30 bg-green-900/10' :
                    'border-gray-700 bg-gray-700/20 opacity-50'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{isComplete ? '✅' : isActive ? '🔄' : '⏸️'}</span>
                        <span className={`text-sm font-medium ${isActive ? 'text-purple-300' : isComplete ? 'text-green-400' : 'text-gray-500'}`}>
                          {PHASE_LABELS[phase]}
                        </span>
                      </div>
                      {!isUpcoming && <span className="text-xs text-gray-400">{progress}%</span>}
                    </div>
                    {!isUpcoming && (
                      <div className="w-full bg-gray-700 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${isComplete ? 'bg-green-500' : 'bg-purple-500'}`}
                          style={{ width: `${progress}%` }} />
                      </div>
                    )}
                    {isActive && (
                      <div className="mt-2 space-y-1">
                        {tasks.filter(t => t.phase === phase && !t.is_prep_task).slice(0, 4).map(task => (
                          <div key={task.id} className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              task.status === 'done' ? 'bg-green-500' :
                              task.status === 'in_progress' ? 'bg-blue-500' :
                              task.status === 'blocked' ? 'bg-red-500' : 'bg-gray-600'
                            }`} />
                            <span className={`text-xs ${task.status === 'done' ? 'line-through text-gray-500' : 'text-gray-300'}`}>
                              {task.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {/* Live activity feed */}
          <div className="bg-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Live Activity</h3>
            <div className="space-y-3">
              {timeline.slice(0, 10).map(event => (
                <div key={event.id} className="flex gap-3 items-start">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-gray-300">{event.description}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {timeline.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No activity yet</p>}
            </div>
          </div>
        </div>
      </div>
    )
  }
  // DASHBOARD
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-700">
        <h2 className="text-lg font-bold text-white">Client Portal</h2>
        <p className="text-xs text-gray-400">{client.name} {client.company ? `· ${client.company}` : ''}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {projects.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-5xl mb-4">🚀</p>
            <p className="text-sm">No projects yet. Your project manager will add your first project soon.</p>
          </div>
        ) : (
          projects.map(project => {
            const currentPhaseIndex = PHASE_ORDER.indexOf(project.current_phase)
            return (
              <div key={project.id} onClick={() => fetchProjectDetail(project)}
                className="bg-gray-800 border border-gray-700 hover:border-purple-500/50 rounded-xl p-5 cursor-pointer transition-all group">
                <div className="flex items-start justify-between mb-4">
                  <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">{project.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    project.status === 'active' ? 'bg-green-900/50 text-green-300' :
                    project.status === 'completed' ? 'bg-blue-900/50 text-blue-300' :
                    'bg-yellow-900/50 text-yellow-300'
                  }`}>{project.status?.replace(/_/g, ' ')}</span>
                </div>
                {/* Mini pipeline */}
                <div className="flex items-center gap-1 mb-3">
                  {PHASE_ORDER.map((phase, i) => (
                    <div key={phase} className="flex items-center gap-1 flex-1">
                      <div className={`flex-1 h-1.5 rounded-full ${
                        i < currentPhaseIndex ? 'bg-green-500' :
                        i === currentPhaseIndex ? 'bg-purple-500' : 'bg-gray-700'
                      }`} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Currently: {PHASE_LABELS[project.current_phase]}</span>
                  {project.deadline && (
                    <span className="text-xs text-gray-500">Due {new Date(project.deadline).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
