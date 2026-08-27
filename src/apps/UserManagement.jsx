import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const DEPARTMENTS = [
  { id: 'content', label: 'Content' },
  { id: 'design', label: 'Design' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'development', label: 'Delivery & Development' },
]
const ROLES = [
  { id: 'operations_admin', label: 'Operations admin' },
  { id: 'executive', label: 'Executive' },
  { id: 'department_manager', label: 'Department manager' },
  { id: 'project_owner', label: 'Project owner' },
  { id: 'contributor', label: 'Contributor' },
]

const profileRole = role => {
  if (role === 'operations_admin') return 'admin'
  if (role === 'executive') return 'executive'
  if (role === 'department_manager') return 'department_head'
  return 'member'
}

export default function UserManagement() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [invite, setInvite] = useState({ email: '', department: 'content', role: 'contributor' })
  const [inviting, setInviting] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filterDepartment, setFilterDepartment] = useState('all')

  useEffect(() => {
    if (profile?.role === 'admin') loadUsers()
  }, [profile?.role])

  async function loadUsers() {
    setLoading(true)
    setError('')
    const [{ data: memberships, error: membershipError }, { data: profiles, error: profileError }] = await Promise.all([
      supabase.from('organization_memberships').select('*').eq('organization_id', ORGANIZATION_ID),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    ])
    if (membershipError || profileError) {
      setError(membershipError?.message || profileError?.message || 'Unable to load team')
      setUsers([])
    } else {
      const byUser = new Map((memberships || []).map(item => [item.user_id, item]))
      setUsers((profiles || []).map(item => ({ ...item, membership: byUser.get(item.id) || null })))
    }
    setLoading(false)
  }

  async function updateUser(user, updates) {
    setSaving(user.id)
    setError('')
    const nextDepartment = updates.department ?? user.membership?.department_id ?? user.department
    const nextRole = updates.role ?? user.membership?.role ?? 'contributor'
    const [{ error: membershipError }, { error: profileError }] = await Promise.all([
      supabase.from('organization_memberships').update({
        department_id: nextDepartment,
        role: nextRole,
        updated_at: new Date().toISOString(),
      }).eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id),
      supabase.from('profiles').update({
        department: nextDepartment,
        role: profileRole(nextRole),
        updated_at: new Date().toISOString(),
      }).eq('id', user.id),
    ])
    if (membershipError || profileError) setError(membershipError?.message || profileError?.message)
    await loadUsers()
    setSaving(null)
  }

  async function callTeamFunction(method, body) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Your session has expired. Please sign in again.')
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok || result.error) throw new Error(result.error || 'Team service request failed')
    return result
  }

  async function inviteUser() {
    if (!invite.email.trim()) return
    setInviting(true)
    setError('')
    setNotice('')
    try {
      const result = await callTeamFunction('POST', invite)
      setNotice(result.message)
      setInvite({ email: '', department: 'content', role: 'contributor' })
      await loadUsers()
    } catch (inviteError) {
      setError(inviteError.message)
    } finally {
      setInviting(false)
    }
  }

  async function removeUser(user) {
    if (!confirm(`Remove ${user.full_name || user.email} from Anka Sphere?`)) return
    setSaving(user.id)
    setError('')
    try {
      await callTeamFunction('DELETE', { user_id: user.id })
      setUsers(current => current.filter(item => item.id !== user.id))
    } catch (removeError) {
      setError(removeError.message)
    } finally {
      setSaving(null)
    }
  }

  const filtered = useMemo(() => users.filter(user => {
    const query = search.trim().toLowerCase()
    const department = user.membership?.department_id || user.department
    return (!query || user.full_name?.toLowerCase().includes(query) || user.email?.toLowerCase().includes(query)) &&
      (filterDepartment === 'all' || department === filterDepartment)
  }), [users, search, filterDepartment])

  if (profile?.role !== 'admin') return <Navigate to="/sphere/engagements" replace />
  if (loading) return <div className="flex h-full items-center justify-center bg-gray-950"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-purple-500" /></div>

  return (
    <div className="flex h-full flex-col bg-gray-950 text-white">
      <header className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <div>
          <h2 className="text-lg font-bold">Team Management</h2>
          <p className="mt-0.5 text-xs text-gray-400">{users.length} organization members across four departments</p>
        </div>
        <button onClick={() => setShowInvite(value => !value)} className="rounded-lg bg-purple-600 px-4 py-2 text-sm hover:bg-purple-700">+ Invite Member</button>
      </header>

      <section className="grid grid-cols-2 gap-3 border-b border-gray-800 px-6 py-4 md:grid-cols-5">
        <Stat label="Total" value={users.length} color="text-white" />
        {DEPARTMENTS.map(department => (
          <Stat key={department.id} label={department.label} value={users.filter(user => (user.membership?.department_id || user.department) === department.id).length} color="text-purple-300" />
        ))}
      </section>

      {showInvite && (
        <section className="mx-6 mt-4 space-y-4 rounded-xl border border-gray-700 bg-gray-800 p-5">
          <h3 className="text-sm font-semibold">Invite a team member</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Email">
              <input type="email" value={invite.email} onChange={event => setInvite({ ...invite, email: event.target.value })} placeholder="teammate@company.com" className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-purple-500" />
            </Field>
            <Field label="Department">
              <select value={invite.department} onChange={event => setInvite({ ...invite, department: event.target.value })} className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm">
                {DEPARTMENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Organization role">
              <select value={invite.role} onChange={event => setInvite({ ...invite, role: event.target.value })} className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm">
                {ROLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex gap-3">
            <button onClick={inviteUser} disabled={inviting || !invite.email.trim()} className="rounded-lg bg-purple-600 px-4 py-2 text-sm disabled:opacity-50">{inviting ? 'Sending…' : 'Send invite'}</button>
            <button onClick={() => setShowInvite(false)} className="px-3 text-sm text-gray-400 hover:text-white">Cancel</button>
          </div>
        </section>
      )}

      {(error || notice) && <div className={`mx-6 mt-4 rounded-lg border px-4 py-3 text-sm ${error ? 'border-red-800 bg-red-950/50 text-red-300' : 'border-green-800 bg-green-950/50 text-green-300'}`}>{error || notice}</div>}

      <section className="flex items-center gap-3 px-6 py-3">
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search team…" className="w-52 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs outline-none" />
        <select value={filterDepartment} onChange={event => setFilterDepartment(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs">
          <option value="all">All departments</option>
          {DEPARTMENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="ml-auto text-xs text-gray-500">{filtered.length} shown</span>
      </section>

      <main className="flex-1 space-y-2 overflow-y-auto px-6 pb-6">
        {filtered.map(user => {
          const department = user.membership?.department_id || user.department || 'content'
          const role = user.membership?.role || 'contributor'
          return (
            <article key={user.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-700 bg-gray-800 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-600 text-sm font-bold">{(user.full_name || user.email || '?')[0].toUpperCase()}</div>
              <div className="min-w-48 flex-1">
                <p className="text-sm font-semibold">{user.full_name || 'No name set'} {user.id === profile?.id && <span className="ml-1 text-xs text-gray-500">you</span>}</p>
                <p className="text-xs text-gray-400">{user.email || 'No email'}</p>
              </div>
              <Field label="Department">
                <select value={department} onChange={event => updateUser(user, { department: event.target.value })} disabled={saving === user.id} className="rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-xs">
                  {DEPARTMENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Role">
                <select value={role} onChange={event => updateUser(user, { role: event.target.value })} disabled={user.id === profile?.id || saving === user.id} className="rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-xs disabled:opacity-50">
                  {ROLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  {role === 'system_owner' && <option value="system_owner">System owner</option>}
                </select>
              </Field>
              {user.id !== profile?.id && <button onClick={() => removeUser(user)} disabled={saving === user.id} className="rounded-lg px-3 py-2 text-xs text-red-300 hover:bg-red-950/50 disabled:opacity-50">Remove</button>}
            </article>
          )
        })}
        {!filtered.length && <div className="py-16 text-center text-sm text-gray-500">No team members found.</div>}
      </main>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs text-gray-400">{label}</span>{children}</label>
}

function Stat({ label, value, color }) {
  return <div className="rounded-xl border border-gray-700 bg-gray-800 p-3 text-center"><p className={`text-xl font-bold ${color}`}>{value}</p><p className="mt-0.5 text-xs text-gray-500">{label}</p></div>
}
