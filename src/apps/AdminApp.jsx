import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const ROLES = ['admin', 'department_head', 'executive', 'intern'];
const DEPARTMENTS = ['design', 'development', 'marketing'];

const ROLE_LABELS = {
  admin: 'Admin',
  department_head: 'Dept Head',
  executive: 'Executive',
  intern: 'Intern',
};

export default function AdminApp() {
  const { profile } = useAuth();
  const [tab, setTab] = useState('overview');
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [usersRes, projectsRes, auditRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    if (usersRes.data) setUsers(usersRes.data);
    if (projectsRes.data) setProjects(projectsRes.data);
    if (auditRes.data) setAuditLogs(auditRes.data);
    setLoading(false);
  }

  async function updateUser(userId, updates) {
    // Log to audit
    const oldUser = users.find((u) => u.id === userId);
    await supabase.from('audit_logs').insert([{
      actor_id: profile.id,
      action: 'update_user',
      entity_type: 'user',
      entity_id: userId,
      old_values: { role: oldUser?.role, department: oldUser?.department },
      new_values: updates,
    }]);
    await supabase.from('profiles').update(updates).eq('id', userId);
    setEditingUser(null);
    loadData();
  }

  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-3">🔒</div>
          <div className="text-sm text-[var(--anka-text-secondary)]">Admin access required</div>
        </div>
      </div>
    );
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────
  const stats = {
    totalUsers: users.length,
    byDept: DEPARTMENTS.map((d) => ({
      name: d,
      count: users.filter((u) => u.department === d).length,
    })),
    byRole: ROLES.map((r) => ({
      name: ROLE_LABELS[r],
      count: users.filter((u) => u.role === r).length,
    })),
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === 'active').length,
  };

  const TABS = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'users', label: 'Users', icon: '👥' },
    { id: 'projects', label: 'Projects', icon: '📋' },
    { id: 'audit', label: 'Audit Log', icon: '📜' },
  ];

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-48 bg-[var(--anka-bg-secondary)] border-r border-[var(--anka-border)] flex flex-col">
        <div className="p-3 border-b border-[var(--anka-border)]">
          <span className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase">Admin Panel</span>
        </div>
        <div className="flex-1 p-2 space-y-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition cursor-pointer ${
                tab === t.id
                  ? 'bg-[var(--anka-accent)]/15 text-[var(--anka-accent)]'
                  : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--anka-text-secondary)]">Loading...</div>
        ) : tab === 'overview' ? (
          <OverviewTab stats={stats} />
        ) : tab === 'users' ? (
          <UsersTab
            users={users}
            editingUser={editingUser}
            setEditingUser={setEditingUser}
            onUpdateUser={updateUser}
          />
        ) : tab === 'audit' ? (
          <AuditTab logs={auditLogs} users={users} />
        ) : (
          <ProjectsTab projects={projects} />
        )}
      </div>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ stats }) {
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold">Dashboard</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Users" value={stats.totalUsers} icon="👥" />
        <StatCard label="Total Projects" value={stats.totalProjects} icon="📋" />
        <StatCard label="Active Projects" value={stats.activeProjects} icon="🚀" />
        <StatCard
          label="Departments"
          value={DEPARTMENTS.length}
          icon="🏢"
        />
      </div>

      {/* Department breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">Users by Department</h3>
          <div className="space-y-3">
            {stats.byDept.map((d) => (
              <div key={d.name} className="flex items-center gap-3">
                <span className="text-xs capitalize flex-1">{d.name}</span>
                <div className="w-32 h-2 bg-[var(--anka-bg-tertiary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--anka-accent)] rounded-full transition-all"
                    style={{ width: `${stats.totalUsers ? (d.count / stats.totalUsers) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--anka-text-secondary)] w-6 text-right">{d.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">Users by Role</h3>
          <div className="space-y-3">
            {stats.byRole.map((r) => (
              <div key={r.name} className="flex items-center gap-3">
                <span className="text-xs flex-1">{r.name}</span>
                <div className="w-32 h-2 bg-[var(--anka-bg-tertiary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${stats.totalUsers ? (r.count / stats.totalUsers) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--anka-text-secondary)] w-6 text-right">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-lg">{icon}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase mt-1">{label}</div>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────
function UsersTab({ users, editingUser, setEditingUser, onUpdateUser }) {
  const [editRole, setEditRole] = useState('');
  const [editDept, setEditDept] = useState('');

  function startEdit(user) {
    setEditingUser(user.id);
    setEditRole(user.role);
    setEditDept(user.department);
  }

  function cancelEdit() {
    setEditingUser(null);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">User Management</h2>
        <span className="text-xs text-[var(--anka-text-secondary)]">{users.length} users</span>
      </div>

      <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_120px_120px_100px] gap-3 px-4 py-2 border-b border-[var(--anka-border)] text-[10px] font-semibold text-[var(--anka-text-secondary)] uppercase">
          <span>User</span>
          <span>Department</span>
          <span>Role</span>
          <span>Actions</span>
        </div>

        {/* User rows */}
        {users.map((u) => (
          <div
            key={u.id}
            className="grid grid-cols-[1fr_120px_120px_100px] gap-3 px-4 py-3 border-b border-[var(--anka-border)] last:border-0 items-center hover:bg-[var(--anka-bg-tertiary)]/50"
          >
            {/* Name */}
            <div>
              <div className="text-sm font-medium">{u.full_name || 'Unnamed'}</div>
              <div className="text-[10px] text-[var(--anka-text-secondary)]">{u.id.slice(0, 8)}...</div>
            </div>

            {/* Department */}
            {editingUser === u.id ? (
              <select
                value={editDept}
                onChange={(e) => setEditDept(e.target.value)}
                className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded px-2 py-1 text-[var(--anka-text-primary)] focus:outline-none"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <span className="text-xs capitalize text-[var(--anka-text-secondary)]">{u.department}</span>
            )}

            {/* Role */}
            {editingUser === u.id ? (
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded px-2 py-1 text-[var(--anka-text-primary)] focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-[var(--anka-text-secondary)]">{ROLE_LABELS[u.role] || u.role}</span>
            )}

            {/* Actions */}
            {editingUser === u.id ? (
              <div className="flex gap-1">
                <button
                  onClick={() => onUpdateUser(u.id, { role: editRole, department: editDept })}
                  className="text-[10px] px-2 py-1 bg-[var(--anka-accent)] text-white rounded transition cursor-pointer"
                >
                  Save
                </button>
                <button
                  onClick={cancelEdit}
                  className="text-[10px] px-2 py-1 bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)] rounded transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => startEdit(u)}
                className="text-[10px] px-2 py-1 bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)] hover:text-[var(--anka-accent)] rounded transition cursor-pointer"
              >
                Edit
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Projects Tab ─────────────────────────────────────────────────────────────
function ProjectsTab({ projects }) {
  const STATUS_COLORS = {
    planning: 'bg-blue-500',
    active: 'bg-green-500',
    on_hold: 'bg-yellow-500',
    completed: 'bg-purple-500',
    archived: 'bg-gray-500',
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">All Projects</h2>
        <span className="text-xs text-[var(--anka-text-secondary)]">{projects.length} projects</span>
      </div>

      {projects.length === 0 ? (
        <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">No projects yet.</div>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <div key={p.id} className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl px-4 py-3 flex items-center gap-4">
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[p.status]}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-[10px] text-[var(--anka-text-secondary)] capitalize">{p.department_id} · {p.status.replace('_', ' ')}</div>
              </div>
              <div className="text-[10px] text-[var(--anka-text-secondary)] capitalize shrink-0">{p.priority}</div>
              {p.due_date && (
                <div className="text-[10px] text-[var(--anka-text-secondary)] shrink-0">📅 {p.due_date}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────
function AuditTab({ logs, users }) {
  const userMap = {};
  users.forEach((u) => { userMap[u.id] = u.full_name || u.id.slice(0, 8); });

  const ACTION_ICONS = {
    update_user: '👤',
    create_project: '📋',
    delete_project: '🗑️',
    update_project: '✏️',
    login: '🔑',
  };

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Audit Log</h2>
        <span className="text-xs text-[var(--anka-text-secondary)]">{logs.length} entries</span>
      </div>

      {logs.length === 0 ? (
        <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">No audit logs yet.</div>
      ) : (
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl overflow-hidden">
          {logs.map((log, i) => (
            <div
              key={log.id}
              className={`px-4 py-3 flex items-start gap-3 ${
                i !== logs.length - 1 ? 'border-b border-[var(--anka-border)]' : ''
              } hover:bg-[var(--anka-bg-tertiary)]/50`}
            >
              <span className="text-lg mt-0.5">{ACTION_ICONS[log.action] || '📌'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  <span className="font-medium">{userMap[log.actor_id] || 'System'}</span>
                  {' '}
                  <span className="text-[var(--anka-text-secondary)]">
                    {log.action.replace(/_/g, ' ')}
                  </span>
                  {' '}
                  <span className="text-[var(--anka-text-secondary)]">
                    on {log.entity_type}
                  </span>
                </div>
                {log.new_values && (
                  <div className="text-[10px] text-[var(--anka-text-secondary)] mt-1 font-mono">
                    {JSON.stringify(log.new_values)}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-[var(--anka-text-secondary)] shrink-0 mt-0.5">
                {timeAgo(log.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
