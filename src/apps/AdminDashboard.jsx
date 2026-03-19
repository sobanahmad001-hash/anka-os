import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePerformanceInference } from '../hooks/usePerformanceInference.js'

const DEPT_COLORS = {
  design: 'bg-pink-500',
  development: 'bg-blue-500',
  marketing: 'bg-green-500',
}

const HEALTH_COLORS = {
  'At Risk': 'bg-red-900/50 text-red-300 border border-red-700/50',
  'Needs Attention': 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
  Stable: 'bg-green-900/50 text-green-300 border border-green-700/50',
  Active: 'bg-blue-900/50 text-blue-300 border border-blue-700/50',
}

const PHASE_LABELS = {
  product_modeling: 'Product Modeling',
  development: 'Development',
  marketing: 'Marketing',
  completed: 'Completed',
}

const PHASE_COLORS = {
  product_modeling: 'bg-purple-500',
  development: 'bg-blue-500',
  marketing: 'bg-green-500',
  completed: 'bg-gray-500',
}

function inferHealth(project, tasks = []) {
  const blocked = tasks.filter(t => t.status === 'blocked').length
  const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done').length
  if (blocked > 0) return 'At Risk'
  if (overdue > 0) return 'Needs Attention'
  if (project.status === 'completed') return 'Stable'
  return 'Active'
}

export default function AdminDashboard() {
  const { profile } = useAuth()
  const { computeAllSnapshots, getSnapshots } = usePerformanceInference()
  const [snapshots, setSnapshots] = useState([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState('overview')
  const [data, setData] = useState({
    users: [], departments: [], tasks: [], projects: [],
    asProjects: [], asTasks: [], asClients: [], asHandoffs: [], asNotifications: [],
  })

  useEffect(() => {
    if (profile?.role === 'admin') fetchAll()
  }, [profile])

  async function fetchAll() {
    setLoading(true)
    const [
      usersRes, deptsRes, tasksRes, projectsRes,
      asProjectsRes, asTasksRes, asClientsRes, asHandoffsRes, asNotifsRes
    ] = await Promise.allSettled([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('departments').select('*').order('name'),
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('as_projects').select('*, as_clients(name, company)').order('created_at', { ascending: false }),
      supabase.from('as_tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('as_clients').select('*').order('name'),
      supabase.from('as_handoff_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('as_notifications').select('*').eq('read', false).order('created_at', { ascending: false }).limit(20),
    ])

    const get = (res) => (res.status === 'fulfilled' && !res.value.error) ? res.value.data || [] : []

    const profilesData = get(usersRes)
    setData({
      users: profilesData,
      departments: get(deptsRes),
      tasks: get(tasksRes),
      projects: get(projectsRes),
      asProjects: get(asProjectsRes),
      asTasks: get(asTasksRes),
      asClients: get(asClientsRes),
      asHandoffs: get(asHandoffsRes),
      asNotifications: get(asNotifsRes),
    })
    if (profilesData.length) await computePerformance(profilesData)
    setLoading(false)
  }

  async function computePerformance(userList) {
    if (!userList?.length) return
    setSnapshotsLoading(true)
    await computeAllSnapshots(userList.map(u => u.id))
    const snaps = await getSnapshots(userList.map(u => u.id))
    setSnapshots(snaps)
    setSnapshotsLoading(false)
  }

  if (!profile) return null
  if (profile.role !== 'admin') return <Navigate to="/dev-dashboard" replace />

  const { users, departments, tasks, projects, asProjects, asTasks, asClients, asHandoffs, asNotifications } = data

  // Derived stats
  const blockedTasks = tasks.filter(t => t.status === 'blocked').length
  const doneTasks = tasks.filter(t => t.status === 'done').length
  const activeTasks = tasks.filter(t => t.status !== 'done').length
  const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done').length
  const activeAsProjects = asProjects.filter(p => p.status === 'active' || p.status === 'pending_handoff').length
  const pendingHandoffs = asHandoffs.length

  // Department breakdown
  const deptStats = ['design', 'development', 'marketing'].map(dept => {
    const members = users.filter(u => u.department === dept)
    const deptTasks = tasks.filter(t => t.department === dept)
    const deptBlocked = deptTasks.filter(t => t.status === 'blocked').length
    const deptDone = deptTasks.filter(t => t.status === 'done').length
    const deptActive = deptTasks.filter(t => t.status !== 'done').length
    return { dept, members: members.length, tasks: deptTasks.length, blocked: deptBlocked, done: deptDone, active: deptActive }
  })

  // Portfolio rows - combined internal + sphere
  const portfolioRows = [
    ...projects.slice(0, 5).map(p => ({
      id: p.id, name: p.name, type: 'internal',
      status: p.status, phase: p.department,
      health: inferHealth(p, tasks.filter(t => t.project_id === p.id)),
      client: null,
    })),
    ...asProjects.slice(0, 5).map(p => ({
      id: p.id, name: p.name, type: 'sphere',
      status: p.status, phase: p.current_phase,
      health: inferHealth(p, asTasks.filter(t => t.project_id === p.id)),
      client: p.as_clients?.name,
    })),
  ]

  const SECTIONS = ['overview', 'departments', 'sphere', 'portfolio', 'people']

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Top header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Admin Control Center</h1>
          <p className="text-xs text-gray-400 mt-0.5">Central hub - all departments, all signals</p>
        </div>
        <div className="flex items-center gap-2">
          {asNotifications.length > 0 && (
            <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">
              {asNotifications.length} unread
            </span>
          )}
          <button onClick={fetchAll} className="text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Command strip */}
      <div className="grid grid-cols-6 gap-0 border-b border-gray-800">
        {[
          { label: 'Team Members', value: users.length, color: 'text-white' },
          { label: 'Active Tasks', value: activeTasks, color: 'text-white' },
          { label: 'Blocked', value: blockedTasks, color: blockedTasks > 0 ? 'text-red-400' : 'text-white' },
          { label: 'Overdue', value: overdueTasks, color: overdueTasks > 0 ? 'text-yellow-400' : 'text-white' },
          { label: 'Sphere Projects', value: activeAsProjects, color: 'text-purple-400' },
          { label: 'Pending Handoffs', value: pendingHandoffs, color: pendingHandoffs > 0 ? 'text-orange-400' : 'text-white' },
        ].map((stat, i) => (
          <div key={i} className={`px-4 py-3 border-r border-gray-800 last:border-r-0 ${stat.color === 'text-red-400' || stat.color === 'text-yellow-400' ? 'bg-gray-900/50' : ''}`}>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Section nav */}
      <div className="flex gap-1 px-6 py-3 border-b border-gray-800">
        {SECTIONS.map(s => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${activeSection === s ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">

        {activeSection === 'overview' && (
          <div className="space-y-6">
            {asHandoffs.length > 0 && (
              <div className="bg-orange-900/30 border border-orange-700/50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-orange-300 mb-3">{asHandoffs.length} Sphere Handoff{asHandoffs.length > 1 ? 's' : ''} Awaiting Approval</h3>
                <div className="space-y-2">
                  {asHandoffs.map(h => {
                    const project = asProjects.find(p => p.id === h.project_id)
                    return (
                      <div key={h.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                        <div>
                          <p className="text-sm text-white font-medium">{project?.name || 'Unknown project'}</p>
                          <p className="text-xs text-gray-400">{PHASE_LABELS[h.from_phase]} to {PHASE_LABELS[h.to_phase]}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async () => {
                            await supabase.from('as_handoff_requests').update({ status: 'approved', reviewed_by: profile.id, reviewed_at: new Date().toISOString() }).eq('id', h.id)
                            await supabase.from('as_project_phases').update({ status: 'completed' }).eq('project_id', h.project_id).eq('phase', h.from_phase)
                            await supabase.from('as_project_phases').update({ status: 'in_progress' }).eq('project_id', h.project_id).eq('phase', h.to_phase)
                            await supabase.from('as_projects').update({ current_phase: h.to_phase, status: 'active' }).eq('id', h.project_id)
                            fetchAll()
                          }} className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 rounded transition-colors">Approve</button>
                          <button onClick={async () => {
                            await supabase.from('as_handoff_requests').update({ status: 'rejected', reviewed_by: profile.id, reviewed_at: new Date().toISOString() }).eq('id', h.id)
                            fetchAll()
                          }} className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded transition-colors">Reject</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              {deptStats.map(d => (
                <div key={d.dept} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <div className="flex items-center gap-2 mb-4">
                    <div className={`w-2 h-2 rounded-full ${DEPT_COLORS[d.dept]}`} />
                    <h3 className="text-sm font-semibold text-white capitalize">{d.dept}</h3>
                    <span className="text-xs text-gray-500 ml-auto">{d.members} members</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-xl font-bold text-white">{d.active}</p><p className="text-xs text-gray-500">Active</p></div>
                    <div><p className="text-xl font-bold text-green-400">{d.done}</p><p className="text-xs text-gray-500">Done</p></div>
                    <div><p className={`text-xl font-bold ${d.blocked > 0 ? 'text-red-400' : 'text-gray-600'}`}>{d.blocked}</p><p className="text-xs text-gray-500">Blocked</p></div>
                  </div>
                  {d.tasks > 0 && (
                    <div className="mt-3">
                      <div className="w-full bg-gray-700 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${DEPT_COLORS[d.dept]}`} style={{ width: `${Math.round((d.done / d.tasks) * 100)}%` }} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{Math.round((d.done / d.tasks) * 100)}% complete</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {blockedTasks > 0 && (
              <div className="bg-gray-800 rounded-xl p-5 border border-red-800/30">
                <h3 className="text-sm font-semibold text-red-400 mb-3">Blocked Work ({blockedTasks})</h3>
                <div className="space-y-2">
                  {tasks.filter(t => t.status === 'blocked').slice(0, 5).map(t => (
                    <div key={t.id} className="flex items-center justify-between bg-gray-700/50 rounded-lg px-3 py-2">
                      <p className="text-sm text-white">{t.title}</p>
                      <span className="text-xs text-gray-400 capitalize">{t.department || 'unassigned'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeSection === 'departments' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">Department Performance</h3>
            {deptStats.map(d => {
              const deptUsers = users.filter(u => u.department === d.dept)
              const deptTasks = tasks.filter(t => t.department === d.dept)
              const deptProjects = projects.filter(p => p.department_id === d.dept)
              return (
                <div key={d.dept} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <div className="flex items-center gap-3 mb-5">
                    <div className={`w-3 h-3 rounded-full ${DEPT_COLORS[d.dept]}`} />
                    <h4 className="text-base font-bold text-white capitalize">{d.dept}</h4>
                  </div>
                  <div className="grid grid-cols-4 gap-4 mb-5">
                    {[
                      { label: 'Members', value: d.members },
                      { label: 'Projects', value: deptProjects.length },
                      { label: 'Tasks', value: d.tasks },
                      { label: 'Completion', value: `${d.tasks > 0 ? Math.round((d.done / d.tasks) * 100) : 0}%` },
                    ].map(stat => (
                      <div key={stat.label} className="bg-gray-700/50 rounded-lg p-3 text-center">
                        <p className="text-xl font-bold text-white">{stat.value}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                  {deptUsers.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Team</p>
                      <div className="flex flex-wrap gap-2">
                        {deptUsers.map(u => (
                          <div key={u.id} className="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-1.5">
                            <div className="w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold text-white">
                              {u.full_name?.[0] || '?'}
                            </div>
                            <span className="text-xs text-gray-300">{u.full_name || u.email}</span>
                            <span className="text-xs text-gray-500">{u.role}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {activeSection === 'sphere' && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Total Clients', value: asClients.length },
                { label: 'Active Projects', value: asProjects.filter(p => p.status === 'active').length, color: 'text-green-400' },
                { label: 'Pending Handoffs', value: asHandoffs.length, color: asHandoffs.length > 0 ? 'text-orange-400' : 'text-white' },
                { label: 'Completed', value: asProjects.filter(p => p.status === 'completed').length, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-800 rounded-xl p-4 text-center border border-gray-700">
                  <p className={`text-2xl font-bold ${s.color || 'text-white'}`}>{s.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Sphere Projects by Phase</h3>
              {['product_modeling', 'development', 'marketing', 'completed'].map(phase => {
                const phaseProjects = asProjects.filter(p => p.current_phase === phase)
                if (!phaseProjects.length) return null
                return (
                  <div key={phase} className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase]}`} />
                      <span className="text-xs font-medium text-gray-300">{PHASE_LABELS[phase]}</span>
                      <span className="text-xs text-gray-500">({phaseProjects.length})</span>
                    </div>
                    <div className="space-y-2">
                      {phaseProjects.map(p => {
                        const projectTasks = asTasks.filter(t => t.project_id === p.id)
                        const done = projectTasks.filter(t => t.status === 'done').length
                        const total = projectTasks.length
                        return (
                          <div key={p.id} className="flex items-center gap-3 bg-gray-700/50 rounded-lg px-3 py-2">
                            <div className="flex-1">
                              <p className="text-sm text-white font-medium">{p.name}</p>
                              <p className="text-xs text-gray-400">{p.as_clients?.name || 'No client'}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-300">{total > 0 ? `${done}/${total} tasks` : 'No tasks'}</p>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-green-900/50 text-green-300' : p.status === 'pending_handoff' ? 'bg-orange-900/50 text-orange-300' : 'bg-gray-700 text-gray-400'}`}>
                                {p.status?.replace(/_/g, ' ')}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {asProjects.length === 0 && <p className="text-sm text-gray-500 text-center py-8">No Sphere projects yet</p>}
            </div>

            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Clients ({asClients.length})</h3>
              <div className="space-y-2">
                {asClients.map(c => {
                  const clientProjects = asProjects.filter(p => p.client_id === c.id)
                  return (
                    <div key={c.id} className="flex items-center justify-between bg-gray-700/50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-white font-medium">{c.name}</p>
                        <p className="text-xs text-gray-400">{c.company || 'No company'} - {c.email}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-300">{clientProjects.length} project{clientProjects.length !== 1 ? 's' : ''}</p>
                        <span className={`text-xs ${c.portal_access ? 'text-green-400' : 'text-gray-500'}`}>{c.portal_access ? 'Portal active' : 'No portal'}</span>
                      </div>
                    </div>
                  )
                })}
                {asClients.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No clients yet</p>}
              </div>
            </div>
          </div>
        )}

        {activeSection === 'portfolio' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">Unified Portfolio ({portfolioRows.length} projects)</h3>
            {portfolioRows.map(p => (
              <div key={p.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${p.type === 'sphere' ? 'bg-purple-900/50 text-purple-300' : 'bg-gray-700 text-gray-300'}`}>
                        {p.type === 'sphere' ? 'Sphere' : 'Internal'}
                      </span>
                      <h4 className="text-sm font-semibold text-white">{p.name}</h4>
                    </div>
                    {p.client && <p className="text-xs text-gray-400 mt-1">Client: {p.client}</p>}
                    <p className="text-xs text-gray-500 mt-0.5 capitalize">{p.type === 'sphere' ? PHASE_LABELS[p.phase] : p.phase}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${HEALTH_COLORS[p.health]}`}>{p.health}</span>
                    <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded-full capitalize">{p.status?.replace(/_/g, ' ')}</span>
                  </div>
                </div>
              </div>
            ))}
            {portfolioRows.length === 0 && <div className="text-center py-12 text-gray-500"><p className="text-4xl mb-3">No projects yet</p></div>}
          </div>
        )}

        {activeSection === 'people' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-300">Team Performance ({users.length} members)</h3>
              <button onClick={() => computePerformance(users)}
                disabled={snapshotsLoading}
                className="text-xs text-purple-400 hover:text-purple-300 bg-gray-800 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {snapshotsLoading ? 'Computing...' : '↻ Recompute'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {users.map(u => {
                const snap = snapshots.find(s => s.user_id === u.id)
                const userTasks = tasks.filter(t => t.assigned_to === u.id)
                const userBlocked = userTasks.filter(t => t.status === 'blocked').length
                const userActive = userTasks.filter(t => t.status !== 'done').length

                const riskLevel = snap
                  ? snap.blocker_rate > 30 || snap.overdue_rate > 40 ? 'high'
                    : snap.blocker_rate > 15 || snap.tasks_overdue > 0 ? 'medium'
                    : 'low'
                  : null

                return (
                  <div key={u.id} className={`bg-gray-800 rounded-xl p-5 border transition-colors ${
                    riskLevel === 'high' ? 'border-red-700/50' :
                    riskLevel === 'medium' ? 'border-yellow-700/50' :
                    'border-gray-700'
                  }`}>
                    {/* Header */}
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-base font-bold text-white flex-shrink-0">
                        {u.full_name?.[0] || u.email?.[0] || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white truncate">{u.full_name || 'Unnamed'}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                            u.role === 'admin' ? 'bg-purple-900/50 text-purple-300' : 'bg-gray-700 text-gray-400'
                          }`}>{u.role}</span>
                          {riskLevel === 'high' && <span className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded-full">At Risk</span>}
                          {riskLevel === 'medium' && <span className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded-full">Watch</span>}
                        </div>
                        <p className="text-xs text-gray-400">{u.email}</p>
                        <p className="text-xs text-gray-500 capitalize">{u.department || 'No department'}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {snap?.trend === 'up' && <span className="text-xs text-green-400">Improving</span>}
                        {snap?.trend === 'down' && <span className="text-xs text-red-400">Declining</span>}
                        {snap?.trend === 'flat' && <span className="text-xs text-gray-400">Steady</span>}
                        {snap?.trend === 'new' && <span className="text-xs text-gray-500">New data</span>}
                      </div>
                    </div>

                    {/* Metrics grid */}
                    {snap ? (
                      <div className="grid grid-cols-6 gap-2">
                        {[
                          { label: 'Active days', value: `${snap.activity_days}/7`, color: snap.activity_days >= 4 ? 'text-green-400' : snap.activity_days >= 2 ? 'text-yellow-400' : 'text-red-400' },
                          { label: 'Completed', value: snap.tasks_completed, color: snap.tasks_completed > 0 ? 'text-green-400' : 'text-gray-400' },
                          { label: 'Completion %', value: `${snap.completion_rate}%`, color: snap.completion_rate >= 70 ? 'text-green-400' : snap.completion_rate >= 40 ? 'text-yellow-400' : 'text-red-400' },
                          { label: 'Blocked', value: snap.tasks_blocked, color: snap.tasks_blocked > 0 ? 'text-red-400' : 'text-gray-500' },
                          { label: 'Overdue', value: snap.tasks_overdue, color: snap.tasks_overdue > 0 ? 'text-yellow-400' : 'text-gray-500' },
                          { label: 'Avg response', value: snap.avg_response_hours ? `${snap.avg_response_hours}h` : '—', color: 'text-gray-300' },
                        ].map(m => (
                          <div key={m.label} className="bg-gray-700/50 rounded-lg p-2 text-center">
                            <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
                            <p className="text-xs text-gray-500 mt-0.5 leading-tight">{m.label}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                          <p className="text-lg font-bold text-white">{userActive}</p>
                          <p className="text-xs text-gray-500">Active tasks</p>
                        </div>
                        <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                          <p className={`text-lg font-bold ${userBlocked > 0 ? 'text-red-400' : 'text-gray-600'}`}>{userBlocked}</p>
                          <p className="text-xs text-gray-500">Blocked</p>
                        </div>
                        <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                          <p className="text-xs text-gray-500 mt-2">No snapshot yet</p>
                          <p className="text-xs text-gray-600">Click Recompute</p>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {users.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-3">👥</p>
                  <p className="text-sm">No team members yet</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
