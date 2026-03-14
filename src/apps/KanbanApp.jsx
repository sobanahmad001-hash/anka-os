import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const COLUMNS = [
  { id: 'todo', label: 'To Do', color: 'bg-gray-500', accent: 'border-gray-500' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-yellow-500', accent: 'border-yellow-500' },
  { id: 'in_review', label: 'In Review', color: 'bg-blue-500', accent: 'border-blue-500' },
  { id: 'done', label: 'Done', color: 'bg-green-500', accent: 'border-green-500' },
];

const PRIORITY_BADGE = {
  low: 'bg-gray-500/20 text-gray-400',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-orange-500/20 text-orange-400',
  urgent: 'bg-red-500/20 text-red-400',
};

export default function KanbanApp() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectFilter, setProjectFilter] = useState('');
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [subtaskCounts, setSubtaskCounts] = useState({}); // { taskId: { total, done } }
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', priority: 'medium', status: 'todo', project_id: '', due_date: '' });

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from('tasks')
        .select('*, project:projects!project_id(name)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase.from('projects').select('id, name').order('name'),
    ]);
    if (t) {
      setTasks(t);
      // bulk-load subtask counts
      const ids = t.map((tk) => tk.id);
      if (ids.length > 0) {
        const { data: subs } = await supabase
          .from('subtasks').select('task_id, completed').in('task_id', ids);
        if (subs) {
          const counts = {};
          subs.forEach((s) => {
            if (!counts[s.task_id]) counts[s.task_id] = { total: 0, done: 0 };
            counts[s.task_id].total++;
            if (s.completed) counts[s.task_id].done++;
          });
          setSubtaskCounts(counts);
        }
      }
    }
    if (p) setProjects(p);
  }

  // Tasks filtered by project
  const filtered = projectFilter
    ? tasks.filter((t) => t.project_id === projectFilter)
    : tasks;

  // Group by status column — treat missing 'in_review' as fitting naturally
  function columnTasks(colId) {
    return filtered.filter((t) => {
      if (colId === 'in_review') return t.status === 'in_review';
      return t.status === colId;
    });
  }

  // Drag-and-drop handlers
  function handleDragStart(task) { setDragging(task); }
  function handleDragEnd() { setDragging(null); setDragOver(null); }

  async function handleDrop(colId) {
    if (!dragging || dragging.status === colId) { setDragOver(null); return; }
    // Optimistic update
    setTasks((prev) => prev.map((t) => t.id === dragging.id ? { ...t, status: colId } : t));
    setDragOver(null);
    setDragging(null);
    await supabase.from('tasks').update({ status: colId }).eq('id', dragging.id);
  }

  async function createTask(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const row = {
      title: form.title.trim(),
      priority: form.priority,
      status: form.status,
      user_id: user.id,
      ...(form.project_id ? { project_id: form.project_id } : {}),
      ...(form.due_date ? { due_date: form.due_date } : {}),
    };
    const { data } = await supabase.from('tasks').insert(row).select('*, project:projects!project_id(name)').single();
    if (data) setTasks((prev) => [data, ...prev]);
    setForm({ title: '', priority: 'medium', status: 'todo', project_id: '', due_date: '' });
    setShowCreate(false);
  }

  async function deleteTask(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await supabase.from('tasks').delete().eq('id', id);
  }

  const isPastDue = (d) => d && new Date(d) < new Date() && new Date(d).toDateString() !== new Date().toDateString();

  return (
    <div className="h-full flex flex-col p-3 gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-bold">Kanban Board</h2>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
          className="text-xs px-2 py-1 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]">
          <option value="">All Projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={() => setShowCreate(!showCreate)}
          className="ml-auto text-xs px-3 py-1 rounded-lg bg-[var(--anka-accent)] text-white hover:brightness-110 transition cursor-pointer">
          + New Task
        </button>
      </div>

      {/* Quick create */}
      {showCreate && (
        <form onSubmit={createTask} className="flex gap-2 flex-wrap items-end p-3 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)]">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Task title"
            className="flex-1 min-w-[160px] text-xs px-3 py-1.5 rounded-lg bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]">
            {['low','medium','high','urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]">
            {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]">
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
          <button type="submit" className="text-xs px-3 py-1.5 rounded-lg bg-[var(--anka-accent)] text-white cursor-pointer">Add</button>
        </form>
      )}

      {/* Columns */}
      <div className="flex-1 grid grid-cols-4 gap-3 min-h-0 overflow-hidden">
        {COLUMNS.map((col) => {
          const colTasks = columnTasks(col.id);
          const isDragTarget = dragOver === col.id && dragging?.status !== col.id;
          return (
            <div key={col.id}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => handleDrop(col.id)}
              className={`flex flex-col rounded-xl bg-[var(--anka-bg-secondary)] border transition-all ${
                isDragTarget ? 'border-[var(--anka-accent)] bg-[var(--anka-accent)]/5' : 'border-[var(--anka-border)]'
              }`}>
              {/* Column header */}
              <div className={`flex items-center gap-2 px-3 py-2 border-b-2 ${col.accent}`}>
                <span className={`w-2 h-2 rounded-full ${col.color}`} />
                <span className="text-xs font-semibold">{col.label}</span>
                <span className="text-[10px] text-[var(--anka-text-secondary)] ml-auto bg-[var(--anka-bg-primary)] px-1.5 py-0.5 rounded-full">{colTasks.length}</span>
              </div>
              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {colTasks.map((task) => {
                  const sc = subtaskCounts[task.id];
                  return (
                    <div key={task.id} draggable
                      onDragStart={() => handleDragStart(task)}
                      onDragEnd={handleDragEnd}
                      className="p-2.5 rounded-lg bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] hover:border-[var(--anka-accent)]/40 transition cursor-grab active:cursor-grabbing group">
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-xs font-medium leading-snug flex-1">{task.title}</span>
                        <button onClick={() => deleteTask(task.id)}
                          className="text-[10px] text-[var(--anka-text-secondary)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition cursor-pointer">✕</button>
                      </div>
                      {/* Meta row */}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
                        {task.project?.name && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--anka-accent)]/15 text-[var(--anka-accent)]">{task.project.name}</span>
                        )}
                        {sc && (
                          <span className="text-[9px] text-[var(--anka-text-secondary)]">☑ {sc.done}/{sc.total}</span>
                        )}
                        {task.due_date && (
                          <span className={`text-[9px] ml-auto ${isPastDue(task.due_date) ? 'text-red-400' : 'text-[var(--anka-text-secondary)]'}`}>
                            📅 {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {colTasks.length === 0 && (
                  <p className="text-[10px] text-[var(--anka-text-secondary)] text-center py-6 opacity-60">
                    {dragging ? 'Drop here' : 'No tasks'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
