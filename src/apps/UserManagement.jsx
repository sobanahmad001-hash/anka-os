import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../context/OrganizationContext'
import AuthorityCompatibilityAdmin from '../components/AuthorityCompatibilityAdmin'
import { canShowAuthorityAdministration } from '../data/authorityAdministration'

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
  const { profile, user } = useAuth()
  const scope = useOrganization()
  const [legacy, setLegacy] = useState(false)
  const canAdmin = canShowAuthorityAdministration(scope.activeMembership)
  const canLegacy = profile?.role === 'admin'
  if (scope.loading) return <p className="p-6 text-[var(--anka-ink)]">Loading organization…</p>
  if (!canAdmin && !canLegacy) return <div className="p-6 text-[var(--anka-ink)]">Select an organization where you are an active System Owner or Operations Admin to manage compatibility records.</div>
  const showLegacy = canLegacy && (legacy || !canAdmin)
  return <div className="flex h-full flex-col overflow-auto bg-[var(--anka-canvas)] text-[var(--anka-ink)]">
    <nav aria-label="Team administration modes" className="flex flex-wrap gap-3 border-b border-[var(--anka-line)] p-4 text-sm text-[var(--anka-ink)]">
      {canAdmin && <button className="workspace-button aria-pressed:border-[var(--anka-violet)] aria-pressed:bg-[var(--anka-violet-soft)] aria-pressed:text-[var(--anka-violet)]" aria-pressed={!showLegacy} onClick={() => setLegacy(false)}>Compatibility records — selected organization</button>}
      {canLegacy && <button className="workspace-button aria-pressed:border-[var(--anka-violet)] aria-pressed:bg-[var(--anka-violet-soft)] aria-pressed:text-[var(--anka-violet)]" aria-pressed={showLegacy} onClick={() => setLegacy(true)}>Legacy team controls — Anka organization</button>}
    </nav>
    {showLegacy ? <LegacyTeamManagement /> : <AuthorityCompatibilityAdmin
      key={user?.id + ':' + scope.activeOrganizationId + ':' + scope.scopeRevision}
      organizationId={scope.activeOrganizationId} organizationName={scope.activeOrganization?.name} requestSignal={scope.requestSignal} />}
  </div>
}

function LegacyTeamManagement() {
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
      setUsers((profiles || []).filter(item => byUser.has(item.id)).map(item => ({ ...item, membership: byUser.get(item.id) })))
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

  async function deactivateUser(user) {
    if (!confirm(`Deactivate ${user.full_name || user.email} in Anka only? Work and history will be retained. Assigned work must be reviewed for reassignment. Other organizations and Auth sessions are unchanged.`)) return
    setSaving(user.id)
    setError('')
    try {
      const result = await callTeamFunction('POST', { action: 'deactivate', user_id: user.id, request_id: crypto.randomUUID() })
      setNotice(result.message)
      await loadUsers()
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
  if (loading) return <div className="flex h-full items-center justify-center bg-[var(--anka-canvas)]"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[var(--anka-violet)]" /></div>

  return (
    <div className="flex h-full flex-col bg-[var(--anka-canvas)] text-[var(--anka-ink)]">
      <header className="flex items-center justify-between border-b border-[var(--anka-line)] px-6 py-4">
        <div>
          <h2 className="workspace-title">Team Management</h2>
          <p className="mt-0.5 text-xs text-[var(--anka-muted)]">{users.length} organization members across four departments</p>
        </div>
        <button onClick={() => setShowInvite(value => !value)} className="workspace-button workspace-button-primary">+ Invite Member</button>
      </header>

      <section className="grid grid-cols-2 gap-3 border-b border-[var(--anka-line)] px-6 py-4 md:grid-cols-5">
        <Stat label="Total" value={users.length} color="text-[var(--anka-ink)]" />
        {DEPARTMENTS.map(department => (
          <Stat key={department.id} label={department.label} value={users.filter(user => (user.membership?.department_id || user.department) === department.id).length} color="text-[var(--anka-violet)]" />
        ))}
      </section>

      {showInvite && (
        <section className="mx-6 mt-4 space-y-4 workspace-card p-5">
          <h3 className="text-sm font-semibold">Invite a team member</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Email">
              <input type="email" value={invite.email} onChange={event => setInvite({ ...invite, email: event.target.value })} placeholder="teammate@company.com" className="w-full rounded-lg bg-[var(--anka-surface-raised)] px-3 py-2 text-sm focus:ring-1 focus:ring-[var(--anka-focus)]" />
            </Field>
            <Field label="Department">
              <select value={invite.department} onChange={event => setInvite({ ...invite, department: event.target.value })} className="w-full rounded-lg bg-[var(--anka-surface-raised)] px-3 py-2 text-sm">
                {DEPARTMENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Organization role">
              <select value={invite.role} onChange={event => setInvite({ ...invite, role: event.target.value })} className="w-full rounded-lg bg-[var(--anka-surface-raised)] px-3 py-2 text-sm">
                {ROLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex gap-3">
            <button onClick={inviteUser} disabled={inviting || !invite.email.trim()} className="workspace-button workspace-button-primary disabled:opacity-50">{inviting ? 'Sending…' : 'Send invite'}</button>
            <button onClick={() => setShowInvite(false)} className="px-3 text-sm text-[var(--anka-muted)] hover:text-[var(--anka-ink)]">Cancel</button>
          </div>
        </section>
      )}

      {(error || notice) && <div className={`mx-6 mt-4 rounded-lg border px-4 py-3 text-sm ${error ? 'border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] text-[var(--anka-danger)]' : 'border-[var(--anka-success)] bg-[var(--anka-success-soft)] text-[var(--anka-success)]'}`}>{error || notice}</div>}

      <section className="flex items-center gap-3 px-6 py-3">
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search team…" className="w-52 rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface-raised)] px-3 py-2 text-xs" />
        <select value={filterDepartment} onChange={event => setFilterDepartment(event.target.value)} className="rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface-raised)] px-3 py-2 text-xs">
          <option value="all">All departments</option>
          {DEPARTMENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="ml-auto text-xs text-[var(--anka-muted)]">{filtered.length} shown</span>
      </section>

      <main className="flex-1 space-y-2 overflow-y-auto px-6 pb-6">
        {filtered.map(user => {
          const department = user.membership?.department_id || user.department || 'content'
          const role = user.membership?.role || 'contributor'
          return (
            <article key={user.id} className="flex flex-wrap items-center gap-4 workspace-card p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--anka-violet-soft)] text-sm font-bold">{(user.full_name || user.email || '?')[0].toUpperCase()}</div>
              <div className="min-w-48 flex-1">
                <p className="text-sm font-semibold">{user.full_name || 'No name set'} {user.id === profile?.id && <span className="ml-1 text-xs text-[var(--anka-muted)]">you</span>}</p>
                <p className="text-xs text-[var(--anka-muted)]">{user.email || 'No email'}</p>
              </div>
              <Field label="Department">
                <select value={department} onChange={event => updateUser(user, { department: event.target.value })} disabled={saving === user.id} className="rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-xs">
                  {DEPARTMENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Role">
                <select value={role} onChange={event => updateUser(user, { role: event.target.value })} disabled={user.id === profile?.id || saving === user.id} className="rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-xs disabled:opacity-50">
                  {ROLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  {role === 'system_owner' && <option value="system_owner">System owner</option>}
                </select>
              </Field>
              {user.id !== profile?.id && <button onClick={() => deactivateUser(user)} disabled={saving === user.id || user.membership?.status === 'revoked'} className="rounded-lg px-3 py-2 text-xs text-[var(--anka-danger)] hover:bg-[var(--anka-danger-soft)] disabled:opacity-50">{user.membership?.status === 'revoked' ? 'Deactivated' : 'Deactivate Anka access'}</button>}
            </article>
          )
        })}
        {!filtered.length && <div className="py-16 text-center text-sm text-[var(--anka-muted)]">No team members found.</div>}
      </main>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs text-[var(--anka-muted)]">{label}</span>{children}</label>
}

function Stat({ label, value, color }) {
  return <div className="workspace-card p-3 text-center"><p className={`text-xl font-bold ${color}`}>{value}</p><p className="mt-0.5 text-xs text-[var(--anka-muted)]">{label}</p></div>
}
