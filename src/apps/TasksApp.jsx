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

export default function TasksApp() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedTask, setExpandedTask] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    due_date: '',
    project_id: '',
  });

  useEffect(() => {
    loadTasks();
    loadProjects();
  }, []);

  async function loadTasks() {
    const { data } = await supabase
      .from('tasks')
      .select('*, project:projects!project_id(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setTasks(data);
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, name').order('name');
    if (data) setProjects(data);
  }

  async function addTask(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    await supabase.from('tasks').insert([{
      title: form.title.trim(),
      description: form.description,
      priority: form.priority,
      due_date: form.due_date || null,
      project_id: form.project_id || null,
      user_id: user.id,
      status: 'todo',
    }]);
    setForm({ title: '', description: '', priority: 'medium', due_date: '', project_id: '' });
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center justify-between">
        <h3 className="text-sm font-semibold">Tasks</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer"
        >
          + New Task
        </button>
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
          <div className="flex gap-2">
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
                {tasks.filter((t) => t.status === status).length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {tasks
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
