import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import CommentsPanel from '../components/CommentsPanel.jsx';

const STATUSES = ['todo', 'in_progress', 'done'];
const STATUS_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
const STATUS_COLORS = {
  todo: 'bg-gray-500',
  in_progress: 'bg-yellow-500',
  done: 'bg-green-500',
};
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];
const PRIORITY_COLORS = {
  low: 'text-gray-400',
  medium: 'text-blue-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
};
const DEPARTMENTS = ['design', 'development', 'marketing'];

export default function TasksApp() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const isHead = profile?.role === 'department_head';
  const canAssign = isAdmin || isHead;

  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedTask, setExpandedTask] = useState(null);
  const [subtasks, setSubtasks] = useState({});
  const [newSubtask, setNewSubtask] = useState({});
  const [filterView, setFilterView] = useState('all'); // 'all' | 'mine' | 'assigned'
  const [filterDept, setFilterDept] = useState('all'); // admin only: filter by department
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    due_date: '',
    project_id: '',
    assigned_to: '',
  });

  useEffect(() => {
    loadTasks();
    loadProjects();
    if (canAssign) loadTeamMembers();
  }, []);

  async function loadTasks() {
    // RLS handles visibility — just fetch all accessible tasks
    let query = supabase
      .from('tasks')
      .select('*, project:projects!project_id(name), assignee:profiles!assigned_to(full_name), assigner:profiles!assigned_by(full_name)')
      .order('created_at', { ascending: false });

    const { data } = await query;
    if (data) {
      setTasks(data);
      const taskIds = data.map((t) => t.id);
      if (taskIds.length > 0) {
        const { data: subs } = await supabase
          .from('subtasks')
          .select('*')
          .in('task_id', taskIds)
          .order('sort_order');
        if (subs) {
          const grouped = {};
          subs.forEach((s) => {
            if (!grouped[s.task_id]) grouped[s.task_id] = [];
            grouped[s.task_id].push(s);
          });
          setSubtasks(grouped);
        }
      }
    }
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, name').order('name');
    if (data) setProjects(data);
  }

  async function loadTeamMembers() {
    let query = supabase.from('profiles').select('id, full_name, department, role');
    if (!isAdmin) {
      query = query.eq('department', profile?.department);
    }
    const { data } = await query.order('full_name');
    if (data) setTeamMembers(data.filter((m) => m.id !== user.id));
  }

  async function addTask(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const taskData = {
      title: form.title.trim(),
      description: form.description,
      priority: form.priority,
      due_date: form.due_date || null,
      project_id: form.project_id || null,
      user_id: form.assigned_to || user.id,
      assigned_to: form.assigned_to || null,
      assigned_by: form.assigned_to ? user.id : null,
      department: profile?.department,
      status: 'todo',
    };
    await supabase.from('tasks').insert([taskData]);
    setForm({ title: '', description: '', priority: 'medium', due_date: '', project_id: '', assigned_to: '' });
    setShowCreate(false);
    loadTasks();
  }

  async function updateStatus(taskId, status) {
    await supabase.from('tasks').update({ status }).eq('id', taskId);
    loadTasks();
  }

  async function deleteTask(taskId) {
    await supabase.from('tasks').delete().eq('id', taskId);
    loadTasks();
  }

  function isOverdue(dueDate) {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date(new Date().toDateString());
  }

  async function addSubtask(taskId) {
    const text = (newSubtask[taskId] || '').trim();
    if (!text) return;
    const existing = subtasks[taskId] || [];
    await supabase.from('subtasks').insert([{
      task_id: taskId,
      title: text,
      sort_order: existing.length,
    }]);
    setNewSubtask((p) => ({ ...p, [taskId]: '' }));
    loadTasks();
  }

  async function toggleSubtask(subtaskId, completed) {
    await supabase.from('subtasks').update({ completed: !completed }).eq('id', subtaskId);
    loadTasks();
  }

  async function deleteSubtask(subtaskId) {
    await supabase.from('subtasks').delete().eq('id', subtaskId);
    loadTasks();
  }

  // Client-side filtering (RLS handles access; this filters the view)
  const filteredTasks = tasks.filter((t) => {
    if (filterView === 'mine' && t.user_id !== user.id) return false;
    if (filterView === 'assigned' && t.assigned_to !== user.id) return false;
    if (isAdmin && filterDept !== 'all' && t.department !== filterDept) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Tasks</h3>
        <div className="flex items-center gap-2">
          {/* View filter */}
          <select
            value={filterView}
            onChange={(e) => setFilterView(e.target.value)}
            className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none"
          >
            <option value="all">{isAdmin ? 'All Tasks' : isHead ? 'Department Tasks' : 'All My Tasks'}</option>
            {(isAdmin || isHead) && <option value="mine">Created by Me</option>}
            <option value="assigned">Assigned to Me</option>
          </select>
          {/* Admin department filter */}
          {isAdmin && (
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none"
            >
              <option value="all">All Depts</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer"
          >
            + New Task
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={addTask} className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)]/50 space-y-2">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Task title..."
            required
            className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)]"
          />
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)]"
          />
          <div className="flex gap-2 flex-wrap">
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
            <select
              value={form.project_id}
              onChange={(e) => setForm({ ...form, project_id: e.target.value })}
              className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none flex-1"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {canAssign && (
              <select
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none"
              >
                <option value="">Assign to self</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>
                ))}
              </select>
            )}
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none"
            />
            <button
              type="submit"
              className="px-4 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer"
            >
              Add
            </button>
          </div>
        </form>
      )}

      {/* Kanban columns */}
      <div className="flex-1 grid grid-cols-3 gap-3 overflow-hidden p-4">
        {STATUSES.map((status) => (
          <div
            key={status}
            className="flex flex-col bg-[var(--anka-bg-secondary)] rounded-xl border border-[var(--anka-border)] overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-[var(--anka-border)] flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
              <span className="text-xs font-semibold uppercase text-[var(--anka-text-secondary)]">
                {STATUS_LABELS[status]}
              </span>
              <span className="text-[10px] text-[var(--anka-text-secondary)] ml-auto">
                {filteredTasks.filter((t) => t.status === status).length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {filteredTasks
                .filter((t) => t.status === status)
                .map((task) => (
                  <div
                    key={task.id}
                    className="bg-[var(--anka-bg-tertiary)] rounded-lg p-3 group"
                  >
                    <div className="flex items-start justify-between mb-1">
                      <div className="text-sm font-medium flex-1">{task.title}</div>
                      <span className={`text-[10px] font-semibold uppercase ml-2 shrink-0 ${PRIORITY_COLORS[task.priority] || ''}`}>
                        {task.priority || ''}
                      </span>
                    </div>
                    {task.description && (
                      <div className="text-[11px] text-[var(--anka-text-secondary)] mb-2 line-clamp-2">{task.description}</div>
                    )}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {task.assignee && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded">
                          👤 {task.assignee.full_name}
                        </span>
                      )}
                      {task.assigner && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">
                          ↳ by {task.assigner.full_name}
                        </span>
                      )}
                      {task.project && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-[var(--anka-accent)]/10 text-[var(--anka-accent)] rounded">
                          📋 {task.project.name}
                        </span>
                      )}
                      {task.due_date && (
                        <span className={`text-[10px] ${isOverdue(task.due_date) && status !== 'done' ? 'text-red-400' : 'text-[var(--anka-text-secondary)]'}`}>
                          📅 {task.due_date}
                        </span>
                      )}
                      {(subtasks[task.id]?.length > 0) && (
                        <span className="text-[10px] text-[var(--anka-text-secondary)]">
                          ☑ {subtasks[task.id].filter((s) => s.completed).length}/{subtasks[task.id].length}
                        </span>
                      )}
                      {task.department && (isAdmin || isHead) && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)] rounded capitalize ml-auto">
                          {task.department}
                        </span>
                      )}
                    </div>
                    {/* Subtasks checklist */}
                    {subtasks[task.id]?.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {subtasks[task.id].map((sub) => (
                          <div key={sub.id} className="flex items-center gap-1.5 group/sub">
                            <button
                              onClick={() => toggleSubtask(sub.id, sub.completed)}
                              className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 cursor-pointer transition ${
                                sub.completed
                                  ? 'bg-[var(--anka-accent)] border-[var(--anka-accent)] text-white'
                                  : 'border-[var(--anka-border)] hover:border-[var(--anka-accent)]'
                              }`}
                            >
                              {sub.completed && <span className="text-[8px]">✓</span>}
                            </button>
                            <span className={`text-[11px] flex-1 truncate ${sub.completed ? 'line-through text-[var(--anka-text-secondary)]' : ''}`}>
                              {sub.title}
                            </span>
                            <button
                              onClick={() => deleteSubtask(sub.id)}
                              className="text-[9px] text-red-400 opacity-0 group-hover/sub:opacity-100 cursor-pointer"
                            >✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Add subtask inline */}
                    <div className="flex gap-1 mb-2">
                      <input
                        value={newSubtask[task.id] || ''}
                        onChange={(e) => setNewSubtask((p) => ({ ...p, [task.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSubtask(task.id))}
                        placeholder="+ subtask"
                        className="flex-1 px-2 py-0.5 bg-transparent border-b border-transparent hover:border-[var(--anka-border)] focus:border-[var(--anka-accent)] text-[10px] text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)]/50 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      {STATUSES.filter((s) => s !== status).map((s) => (
                        <button
                          key={s}
                          onClick={() => updateStatus(task.id, s)}
                          className="text-[10px] px-2 py-0.5 rounded bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)] hover:text-[var(--anka-accent)] transition cursor-pointer"
                        >
                          → {STATUS_LABELS[s]}
                        </button>
                      ))}
                      <button
                        onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                        className="text-[10px] px-2 py-0.5 rounded bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)] hover:text-[var(--anka-accent)] transition cursor-pointer"
                        title="Comments"
                      >
                        💬
                      </button>
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="text-[10px] px-2 py-0.5 rounded bg-[var(--anka-bg-secondary)] text-red-400 hover:text-red-300 transition ml-auto opacity-0 group-hover:opacity-100 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                    {expandedTask === task.id && (
                      <div className="mt-2 border-t border-[var(--anka-border)] pt-2">
                        <CommentsPanel entityType="task" entityId={task.id} />
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
