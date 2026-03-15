import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function UserManagement() {
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteDept, setInviteDept] = useState('')
  const { profile } = useAuth()

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchUsers()
      fetchDepartments()
    }
  }, [profile])

  async function fetchUsers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error) setUsers(data || [])
    setLoading(false)
  }

  async function fetchDepartments() {
    const { data, error } = await supabase
      .from('departments')
      .select('id, name')
      .order('name')

    if (!error) setDepartments(data || [])
  }

  async function inviteUser() {
    if (!inviteEmail || !inviteDept) {
      alert('Email and department required')
      return
    }

    // In production, this would call auth.admin.createUser
    // For now, just log the invite
    console.log('Invite:', { email: inviteEmail, role: inviteRole, department: inviteDept })
    alert(`Invite sent to ${inviteEmail}`)
    setInviteEmail('')
  }

  async function updateUserRole(userId, newRole) {
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId)

    if (!error) fetchUsers()
  }

  async function updateUserDepartment(userId, deptId) {
    const { error } = await supabase
      .from('profiles')
      .update({ department: deptId })
      .eq('id', userId)

    if (!error) fetchUsers()
  }

  if (profile?.role !== 'admin') {
    return <div className="p-6 text-red-600">Access denied. Admin only.</div>
  }

  if (loading) return <div className="p-6">Loading users...</div>

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">👥 User Management</h1>

      {/* Invite Section */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 mb-6">
        <h2 className="text-lg font-bold mb-4">Invite New User</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            type="email"
            placeholder="Email address"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="px-4 py-2 border rounded dark:bg-gray-700 dark:border-gray-600"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="px-4 py-2 border rounded dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <select
            value={inviteDept}
            onChange={(e) => setInviteDept(e.target.value)}
            className="px-4 py-2 border rounded dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="">Select Department</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button
            onClick={inviteUser}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Send Invite
          </button>
        </div>
      </div>

      {/* User List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Role</th>
              <th className="px-4 py-3 text-left">Department</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-4 py-3">{user.full_name || 'N/A'}</td>
                <td className="px-4 py-3">{user.email || 'N/A'}</td>
                <td className="px-4 py-3">
                  <select
                    value={user.role || 'member'}
                    onChange={(e) => updateUserRole(user.id, e.target.value)}
                    className="px-2 py-1 border rounded text-sm dark:bg-gray-700"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={user.department || ''}
                    onChange={(e) => updateUserDepartment(user.id, e.target.value)}
                    className="px-2 py-1 border rounded text-sm dark:bg-gray-700"
                  >
                    <option value="">None</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'
                  }`}>
                    {user.role === 'admin' ? 'Admin' : 'Active'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
