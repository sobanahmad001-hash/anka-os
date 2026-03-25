import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Navigate } from 'react-router-dom'

const DEPARTMENTS = ['design', 'development', 'marketing']
const ROLES = ['admin', 'member']

const DEPT_COLORS = {
  design: 'bg-pink-900/50 text-pink-300 border-pink-700/50',
  development: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  marketing: 'bg-green-900/50 text-green-300 border-green-700/50',
  unassigned: 'bg-gray-700 text-gray-400 border-gray-600',
}

const ROLE_COLORS = {
  admin: 'bg-purple-900/50 text-purple-300',
  member: 'bg-gray-700 text-gray-300',
}

export default function UserManagement() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteDept, setInviteDept] = useState('design')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState(null)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('all')

  if (profile?.role !== 'admin') return <Navigate to="/sphere/projects" replace />

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    setUsers(data || [])
    setLoading(false)
  }

  async function updateUser(userId, updates) {
    setSaving(userId)
    await supabase.from('profiles').update({
      ...updates,
      updated_at: new Date().toISOString()
    }).eq('id', userId)
    setUsers(users.map(u => u.id === userId ? { ...u, ...updates } : u))
    setSaving(null)
  }

  async function inviteUser() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email: inviteEmail,
            department: inviteDept,
            role: inviteRole,
          })
        }
      )
      const result = await response.json()
      if (result.error) throw new Error(result.error)
      setInviteResult({ success: true, message: result.message })
      setInviteEmail('')
      setTimeout(() => fetchUsers(), 2000)
    } catch (err) {
      setInviteResult({ success: false, message: err.message })
    }
    setInviting(false)
  }

  const filtered = users.filter(u => {
    const matchSearch = !search || u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
    const matchDept = filterDept === 'all' || u.department === filterDept || (!u.department && filterDept === 'unassigned')
    return matchSearch && matchDept
  })

  const stats = {
    total: users.length,
    admins: users.filter(u => u.role === 'admin').length,
    unassigned: users.filter(u => !u.department).length,
    byDept: DEPARTMENTS.reduce((acc, d) => ({ ...acc, [d]: users.filter(u => u.department === d).length }), {}),
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-gray-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Team Management</h2>
          <p className="text-xs text-gray-400 mt-0.5">{stats.total} members � {stats.unassigned} unassigned</p>
        </div>
        <button onClick={() => setShowInvite(!showInvite)}
          className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg">
          + Invite Member
        </button>
      </div>

      {/* Stats */}
      <div className="px-6 py-4 border-b border-gray-800">
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Total', value: stats.total, color: 'text-white' },
            { label: 'Admins', value: stats.admins, color: 'text-purple-400' },
            { label: 'Design', value: stats.byDept.design, color: 'text-pink-400' },
            { label: 'Development', value: stats.byDept.development, color: 'text-blue-400' },
            { label: 'Marketing', value: stats.byDept.marketing, color: 'text-green-400' },
          ].map(s => (
            <div key={s.label} className="bg-gray-800 rounded-xl p-3 text-center border border-gray-700">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="mx-6 mt-4 bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
          <h3 className="text-sm font-semibold text-white">Invite New Team Member</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-xs text-gray-400 mb-1">Email *</label>
              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                placeholder="teammate@company.com" type="email" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Department</label>
              <select value={inviteDept} onChange={e => setInviteDept(e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none">
                {DEPARTMENTS.map(d => <option key={d} value={d} className="capitalize">{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Role</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none">
                {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
              </select>
            </div>
          </div>
          {inviteResult && (
            <div className={`rounded-lg p-3 text-xs font-medium ${inviteResult.success ? 'bg-green-900/30 text-green-300 border border-green-700/50' : 'bg-red-900/30 text-red-300 border border-red-700/50'}`}>
              {inviteResult.success ? '?' : '?'} {inviteResult.message}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={inviteUser} disabled={inviting || !inviteEmail.trim()}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
            <button onClick={() => { setShowInvite(false); setInviteResult(null) }}
              className="text-gray-400 text-sm hover:text-white px-3">Cancel</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="px-6 py-3 flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-xs border border-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500 w-48"
          placeholder="Search by name or email..." />
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          {['all', ...DEPARTMENTS, 'unassigned'].map(d => (
            <button key={d} onClick={() => setFilterDept(d)}
              className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${filterDept === d ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {d}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 ml-auto">{filtered.length} members</span>
      </div>

      {/* User list */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="space-y-2">
          {filtered.map(user => (
            <div key={user.id} className={`bg-gray-800 rounded-xl p-4 border transition-all ${saving === user.id ? 'border-purple-500/50' : 'border-gray-700'}`}>
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {(user.full_name || user.email || '?')[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-white truncate">
                      {user.full_name || 'No name set'}
                    </p>
                    {user.id === profile?.id && (
                      <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">you</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{user.email || 'No email'}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Joined {new Date(user.created_at).toLocaleDateString()}
                  </p>
                </div>

                {/* Department selector */}
                <div className="flex-shrink-0">
                  <label className="block text-xs text-gray-500 mb-1">Department</label>
                  <select
                    value={user.department || ''}
                    onChange={e => updateUser(user.id, { department: e.target.value || null })}
                    className={`text-xs px-3 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-purple-500 ${user.department ? DEPT_COLORS[user.department] : DEPT_COLORS.unassigned} bg-transparent`}>
                    <option value="">Unassigned</option>
                    {DEPARTMENTS.map(d => (
                      <option key={d} value={d} className="bg-gray-800 text-white capitalize">{d}</option>
                    ))}
                  </select>
                </div>

                {/* Role selector */}
                <div className="flex-shrink-0">
                  <label className="block text-xs text-gray-500 mb-1">Role</label>
                  <select
                    value={user.role || 'member'}
                    onChange={e => updateUser(user.id, { role: e.target.value })}
                    disabled={user.id === profile?.id}
                    className={`text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 ${ROLE_COLORS[user.role] || ROLE_COLORS.member} bg-transparent border border-gray-600`}>
                    {ROLES.map(r => (
                      <option key={r} value={r} className="bg-gray-800 text-white capitalize">{r}</option>
                    ))}
                  </select>
                </div>

                {/* Status indicator */}
                <div className="flex-shrink-0 w-6 text-center">
                  {saving === user.id ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500 mx-auto" />
                  ) : (
                    <div className={`w-2 h-2 rounded-full mx-auto ${user.department ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  )}
                </div>

                {/* Delete user button — only admin can delete, can't delete yourself */}
                {profile?.role === 'admin' && user.id !== profile?.id && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Remove ${user.full_name || user.email} from the team?`)) return
                      await supabase.from('profiles').delete().eq('id', user.id)
                      const { data: { session } } = await supabase.auth.getSession()
                      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
                        method: 'DELETE',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${session?.access_token}`,
                          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        },
                        body: JSON.stringify({ user_id: user.id })
                      })
                      setUsers(users.filter(u => u.id !== user.id))
                    }}
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors text-xs"
                    title="Remove from team">
                    🗑
                  </button>
                )}
              </div>

              {/* Warning if unassigned */}
              {!user.department && (
                <div className="mt-3 flex items-center gap-2 bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-3 py-2">
                  <span className="text-yellow-400 text-xs">?</span>
                  <p className="text-xs text-yellow-300">No department assigned � this user will only see core Sphere items and no department-specific tools</p>
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <p className="text-4xl mb-3">??</p>
              <p className="text-sm">No team members found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
