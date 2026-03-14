import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import CommentsPanel from '../components/CommentsPanel.jsx';

const STATUS_OPTIONS = ['planning', 'active', 'on_hold', 'completed', 'archived'];
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];

const STATUS_COLORS = {
  planning: 'bg-blue-500',
  active: 'bg-green-500',
  on_hold: 'bg-yellow-500',
  completed: 'bg-purple-500',
  archived: 'bg-gray-500',
};

const PRIORITY_COLORS = {
  low: 'text-gray-400',
  medium: 'text-blue-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
};

export default function ProjectsApp() {
  const { user, profile } = useAuth();
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState({});
  const [projectTasks, setProjectTasks] = useState([]);
  const [view, setView] = useState('list'); // list | detail | create
  const [selectedProject, setSelectedProject] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  // Create form state
  const [form, setForm] = useState({
    name: '',
    description: '',
    department_id: profile?.department || 'development',
    priority: 'medium',
    start_date: '',
    due_date: '',
  });

  const canManage = ['admin', 'department_head', 'executive'].includes(profile?.role);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    const { data } = await supabase
      .from('projects')
      .select('*, owner:profiles!owner_id(full_name, department)')
      .order('created_at', { ascending: false });
    if (data) setProjects(data);
    setLoading(false);
  }

  async function loadMembers(projectId) {
    const { data } = await supabase
      .from('project_members')
      .select('*, user:profiles!user_id(full_name, department, role)')
      .eq('project_id', projectId);
    if (data) setMembers((prev) => ({ ...prev, [projectId]: data }));
  }

  async function createProject(e) {
    e.preventDefault();
    const { error } = await supabase.from('projects').insert([
      {
        ...form,
        owner_id: user.id,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      },
    ]);
    if (!error) {
      setView('list');
      setForm({ name: '', description: '', department_id: profile?.department || 'development', priority: 'medium', start_date: '', due_date: '' });
      loadProjects();
    }
  }

  async function updateStatus(projectId, status) {
    await supabase.from('projects').update({ status, updated_at: new Date().toISOString() }).eq('id', projectId);
    loadProjects();
    if (selectedProject?.id === projectId) {
      setSelectedProject((p) => ({ ...p, status }));
    }
  }

  function openDetail(project) {
    setSelectedProject(project);
    setView('detail');
    loadMembers(project.id);
    loadProjectTasks(project.id);
  }

  async function loadProjectTasks(projectId) {
    const { data } = await supabase
      .from('tasks')
      .select('id, title, status, priority, assigned_to, assignee:profiles!assigned_to(full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (data) setProjectTasks(data);
  }

  const filtered = filter === 'all' ? projects : projects.filter((p) => p.status === filter);

  // ─── List View ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">Projects</h3>
            <span className="text-[10px] text-[var(--anka-text-secondary)] bg-[var(--anka-bg-tertiary)] px-2 py-0.5 rounded-full">
              {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Status filter */}
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none"
            >
              <option value="all">All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
            {canManage && (
              <button
                onClick={() => setView('create')}
                className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer"
              >
                + New Project
              </button>
            )}
          </div>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">
              No projects yet.{canManage ? ' Create one to get started.' : ''}
            </div>
          ) : (
            filtered.map((project) => (
              <button
                key={project.id}
                onClick={() => openDetail(project)}
                className="w-full text-left bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4 hover:border-[var(--anka-accent)]/40 transition cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{project.name}</div>
                    <div className="text-xs text-[var(--anka-text-secondary)] truncate mt-0.5">
                      {project.description || 'No description'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className={`text-[10px] font-semibold uppercase ${PRIORITY_COLORS[project.priority]}`}>
                      {project.priority}
                    </span>
                    <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[project.status]}`} />
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-[var(--anka-text-secondary)]">
                  <span className="capitalize">📂 {project.department_id}</span>
                  <span>👤 {project.owner?.full_name || 'Unassigned'}</span>
                  {project.due_date && <span>📅 {project.due_date}</span>}
                  <span className="capitalize px-2 py-0.5 rounded-full bg-[var(--anka-bg-tertiary)]">
                    {project.status.replace('_', ' ')}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-[var(--anka-bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--anka-accent)] rounded-full transition-all"
                      style={{ width: `${project.progress || 0}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--anka-text-secondary)] tabular-nums">{project.progress || 0}%</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // ─── Create View ────────────────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center gap-3">
          <button onClick={() => setView('list')} className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">←</button>
          <h3 className="text-sm font-semibold">New Project</h3>
        </div>
        <form onSubmit={createProject} className="flex-1 overflow-y-auto p-6 max-w-lg space-y-4">
          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Project Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
              placeholder="e.g., Website Redesign"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)] resize-none"
              placeholder="Brief project description..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Department</label>
              <select
                value={form.department_id}
                onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none"
              >
                <option value="design">Design</option>
                <option value="development">Development</option>
                <option value="marketing">Marketing</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Start Date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Due Date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-2.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-sm font-medium rounded-lg transition cursor-pointer"
          >
            Create Project
          </button>
        </form>
      </div>
    );
  }

  // ─── Detail View ────────────────────────────────────────────────────────────
  const proj = selectedProject;
  const projMembers = members[proj?.id] || [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center gap-3">
        <button onClick={() => { setView('list'); setSelectedProject(null); }} className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">←</button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{proj?.name}</h3>
          <span className="text-[10px] text-[var(--anka-text-secondary)] capitalize">{proj?.department_id} · {proj?.status?.replace('_', ' ')}</span>
        </div>
        {canManage && (
          <select
            value={proj?.status}
            onChange={(e) => updateStatus(proj.id, e.target.value)}
            className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1 text-[var(--anka-text-primary)] focus:outline-none"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Progress */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase text-[var(--anka-text-secondary)] font-semibold">Progress</div>
            <span className="text-sm font-semibold text-[var(--anka-accent)]">{proj?.progress || 0}%</span>
          </div>
          <div className="h-2 bg-[var(--anka-bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--anka-accent)] rounded-full transition-all"
              style={{ width: `${proj?.progress || 0}%` }}
            />
          </div>
          <div className="text-[10px] text-[var(--anka-text-secondary)] mt-1">
            {projectTasks.filter((t) => t.status === 'done').length} of {projectTasks.length} tasks completed
          </div>
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="Priority" value={proj?.priority} />
          <InfoCard label="Owner" value={proj?.owner?.full_name || '—'} />
          <InfoCard label="Start" value={proj?.start_date || '—'} />
          <InfoCard label="Due" value={proj?.due_date || '—'} />
        </div>

        {/* Description */}
        {proj?.description && (
          <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
            <div className="text-[10px] uppercase text-[var(--anka-text-secondary)] font-semibold mb-2">Description</div>
            <p className="text-sm text-[var(--anka-text-secondary)] leading-relaxed">{proj.description}</p>
          </div>
        )}

        {/* Members */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <div className="text-[10px] uppercase text-[var(--anka-text-secondary)] font-semibold mb-3">
            Team ({projMembers.length})
          </div>
          {projMembers.length === 0 ? (
            <div className="text-xs text-[var(--anka-text-secondary)]">No members assigned yet.</div>
          ) : (
            <div className="space-y-2">
              {projMembers.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-[var(--anka-accent)]/20 flex items-center justify-center text-[10px] font-bold text-[var(--anka-accent)]">
                    {m.user?.full_name?.charAt(0) || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{m.user?.full_name}</div>
                    <div className="text-[10px] text-[var(--anka-text-secondary)] capitalize">{m.role} · {m.user?.department}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Linked Tasks */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <div className="text-[10px] uppercase text-[var(--anka-text-secondary)] font-semibold mb-3">
            Tasks ({projectTasks.length})
          </div>
          {projectTasks.length === 0 ? (
            <div className="text-xs text-[var(--anka-text-secondary)]">No tasks linked to this project yet.</div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {projectTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2 py-1 px-2 rounded-lg bg-[var(--anka-bg-tertiary)]">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    task.status === 'done' ? 'bg-green-500' : task.status === 'in_progress' ? 'bg-yellow-500' : 'bg-gray-500'
                  }`} />
                  <span className={`text-xs flex-1 truncate ${task.status === 'done' ? 'line-through text-[var(--anka-text-secondary)]' : ''}`}>
                    {task.title}
                  </span>
                  {task.assignee && (
                    <span className="text-[10px] text-[var(--anka-text-secondary)]">{task.assignee.full_name}</span>
                  )}
                  <span className={`text-[10px] font-semibold uppercase ${PRIORITY_COLORS[task.priority]}`}>
                    {task.priority}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comments */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <CommentsPanel entityType="project" entityId={proj?.id} />
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase text-[var(--anka-text-secondary)] font-semibold">{label}</div>
      <div className="text-sm capitalize mt-1">{value}</div>
    </div>
  );
}
