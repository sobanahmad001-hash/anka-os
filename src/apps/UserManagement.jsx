import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Card from '../components/Card'
import StatCard from '../components/StatCard'
import EmptyState from '../components/EmptyState'
import Badge from '../components/Badge'

function normalizeDepartmentName(value) {
  if (!value) return 'Unassigned'
  return String(value)
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCase(value) {
  return normalizeDepartmentName(value)
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function inferEnvironmentFit(user) {
  const role = String(user?.role || '').toLowerCase()
  const department = String(user?.department || '').toLowerCase()

  if (role === 'admin') return 'Admin'
  if (department.includes('design') || department.includes('creative')) return 'Design'
  if (
    department.includes('marketing') ||
    department.includes('content') ||
    department.includes('growth')
  ) {
    return 'Marketing'
  }
  if (
    department.includes('engineering') ||
    department.includes('development') ||
    department.includes('product') ||
    department.includes('tech')
  ) {
    return 'Development'
  }

  return 'Shared Core'
}

function badgeVariantForEnvironment(environment) {
  if (environment === 'Admin') return 'danger'
  if (environment === 'Development') return 'default'
  if (environment === 'Design') return 'warning'
  if (environment === 'Marketing') return 'success'
  return 'default'
}

export default function UserManagement() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteDept, setInviteDept] = useState('')

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchData()
    }
  }, [profile])

  async function fetchData() {
    setLoading(true)

    try {
      const [usersResult, departmentsResult] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('departments').select('id, name').order('name'),
      ])

      if (!usersResult.error) setUsers(usersResult.data || [])
      if (!departmentsResult.error) setDepartments(departmentsResult.data || [])
    } catch (error) {
      console.error('Failed to load user management data:', error)
      setUsers([])
      setDepartments([])
    } finally {
      setLoading(false)
    }
  }

  async function inviteUser() {
    if (!inviteEmail || !inviteDept) {
      alert('Email and department required')
      return
    }

    console.log('Invite:', {
      email: inviteEmail,
      role: inviteRole,
      department: inviteDept,
    })

    alert(`Invite prepared for ${inviteEmail}`)
    setInviteEmail('')
    setInviteRole('member')
    setInviteDept('')
  }

  async function updateUserRole(userId, newRole) {
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId)

    if (!error) fetchData()
  }

  async function updateUserDepartment(userId, deptId) {
    const { error } = await supabase
      .from('profiles')
      .update({ department: deptId })
      .eq('id', userId)

    if (!error) fetchData()
  }

  const derived = useMemo(() => {
    const adminCount = users.filter((user) => user.role === 'admin').length
    const memberCount = users.filter((user) => user.role !== 'admin').length
    const departmentCount =
      departments.length ||
      new Set(users.map((user) => normalizeDepartmentName(user.department))).size

    const environmentCounts = users.reduce((acc, user) => {
      const env = inferEnvironmentFit(user)
      acc[env] = (acc[env] || 0) + 1
      return acc
    }, {})

    return {
      adminCount,
      memberCount,
      departmentCount,
      environmentCounts,
    }
  }, [users, departments])

  if (!profile) return null

  if (profile.role !== 'admin') {
    return <Navigate to="/dev-dashboard" replace />
  }

  if (loading) {
    return <div className="p-6">Loading people and access data...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">People & Access</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Administrative control over roles, departments, and environment alignment.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-800">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Admin Scope
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            Roles, departments, and invite flow
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            This surface will later connect to deeper permissions and rules.
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total People"
          value={users.length}
          change="Across org structure"
          trend="up"
          icon="👥"
          color="blue"
        />
        <StatCard
          label="Admins"
          value={derived.adminCount}
          change={derived.adminCount > 2 ? 'Review concentration' : 'Lean control'}
          trend={derived.adminCount > 2 ? 'down' : 'up'}
          icon="🛡️"
          color="purple"
        />
        <StatCard
          label="Members"
          value={derived.memberCount}
          change="Execution capacity"
          trend="up"
          icon="🧠"
          color="green"
        />
        <StatCard
          label="Departments"
          value={derived.departmentCount}
          change="Org distribution"
          trend="up"
          icon="🏛️"
          color="yellow"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
        <Card
          title="Invite & Assign"
          subtitle="A transitional admin flow for bringing people into the organization."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Email address
              </label>
              <input
                type="email"
                placeholder="name@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-700 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Role
              </label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-700 dark:text-white"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Department
              </label>
              <select
                value={inviteDept}
                onChange={(e) => setInviteDept(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 dark:bg-gray-700 dark:text-white"
              >
                <option value="">Select Department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Invite flow is placeholder-backed for now and should later connect to managed auth provisioning.
            </p>

            <button
              onClick={inviteUser}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-white font-medium hover:bg-blue-700 transition-colors"
            >
              Prepare Invite
            </button>
          </div>
        </Card>

        <Card
          title="Environment Alignment"
          subtitle="A temporary but useful view of where people most naturally fit in the operating system."
        >
          {Object.keys(derived.environmentCounts).length === 0 ? (
            <EmptyState
              icon="🧭"
              title="No people available"
              description="Environment alignment will appear once users are present in profiles."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(derived.environmentCounts).map(([environment, count]) => (
                <div
                  key={environment}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {environment}
                    </div>
                    <Badge variant={badgeVariantForEnvironment(environment)}>
                      {count}
                    </Badge>
                  </div>

                  <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    {environment === 'Admin' && 'Oversight and governance access'}
                    {environment === 'Development' && 'Technical execution context'}
                    {environment === 'Design' && 'Creative execution context'}
                    {environment === 'Marketing' && 'Campaign and content context'}
                    {environment === 'Shared Core' && 'Cross-environment project context'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="People Directory"
        subtitle="Administrative visibility into role, department, and likely environment fit."
      >
        {users.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No users found"
            description="User records will appear here once profiles are available."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                  <th className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Name</th>
                  <th className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Email</th>
                  <th className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Role</th>
                  <th className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Department</th>
                  <th className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Environment Fit</th>
                  <th className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const environmentFit = inferEnvironmentFit(user)
                  const departmentName =
                    departments.find((department) => department.id === user.department)?.name ||
                    titleCase(user.department)

                  return (
                    <tr
                      key={user.id}
                      className="border-b border-gray-200 dark:border-gray-800 last:border-b-0"
                    >
                      <td className="px-4 py-4 text-sm text-gray-900 dark:text-white">
                        {user.full_name || 'Unnamed user'}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {user.email || 'No email'}
                      </td>
                      <td className="px-4 py-4">
                        <select
                          value={user.role || 'member'}
                          onChange={(e) => updateUserRole(user.id, e.target.value)}
                          className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-700 dark:text-white"
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-4">
                        <select
                          value={user.department || ''}
                          onChange={(e) => updateUserDepartment(user.id, e.target.value)}
                          className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-700 dark:text-white"
                        >
                          <option value="">None</option>
                          {departments.map((department) => (
                            <option key={department.id} value={department.id}>
                              {department.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={badgeVariantForEnvironment(environmentFit)}>
                          {environmentFit}
                        </Badge>
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={user.role === 'admin' ? 'danger' : 'success'}>
                          {user.role === 'admin' ? 'Admin access' : 'Active'}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
