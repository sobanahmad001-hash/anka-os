import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_COLORS = {
  running: 'bg-green-500/20 text-green-400',
  stopped: 'bg-gray-500/20 text-gray-400',
};

export default function TimeTrackerApp() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState('tracker'); // tracker | history
  const [loading, setLoading] = useState(true);
  const [activeTimer, setActiveTimer] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);

  // Form
  const [form, setForm] = useState({ description: '', project_id: '', task_id: '', billable: true });

  useEffect(() => {
    loadData();
    return () => clearInterval(intervalRef.current);
  }, []);

  // Tick the timer
  useEffect(() => {
    if (activeTimer) {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - new Date(activeTimer.started_at).getTime()) / 1000));
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
      setElapsed(0);
    }
    return () => clearInterval(intervalRef.current);
  }, [activeTimer]);

  async function loadData() {
    setLoading(true);
    const [logsRes, projRes, taskRes] = await Promise.all([
      supabase.from('time_logs').select('*, projects(name), tasks(title)')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('tasks').select('id, title').eq('user_id', user.id).eq('status', 'in_progress').order('title'),
    ]);
    const allLogs = logsRes.data || [];
    setLogs(allLogs);
    setProjects(projRes.data || []);
    setTasks(taskRes.data || []);

    // Detect running timer (no ended_at)
    const running = allLogs.find((l) => !l.ended_at);
    if (running) {
      setActiveTimer(running);
      setForm({ description: running.description, project_id: running.project_id || '', task_id: running.task_id || '', billable: running.billable });
    }
    setLoading(false);
  }

  async function startTimer(e) {
    e.preventDefault();
    const { data, error } = await supabase.from('time_logs').insert([{
      user_id: user.id,
      description: form.description,
      project_id: form.project_id || null,
      task_id: form.task_id || null,
      billable: form.billable,
      started_at: new Date().toISOString(),
    }]).select().single();
    if (!error && data) {
      setActiveTimer(data);
      loadData();
    }
  }

  async function stopTimer() {
    if (!activeTimer) return;
    await supabase.from('time_logs')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', activeTimer.id);
    setActiveTimer(null);
    setForm({ description: '', project_id: '', task_id: '', billable: true });
    loadData();
  }

  async function deleteLog(id) {
    await supabase.from('time_logs').delete().eq('id', id);
    if (activeTimer?.id === id) { setActiveTimer(null); }
    loadData();
  }

  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatMinutes(min) {
    if (!min) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // Stats
  const today = new Date().toISOString().slice(0, 10);
  const todayLogs = logs.filter((l) => l.started_at?.slice(0, 10) === today && l.ended_at);
  const todayMinutes = todayLogs.reduce((acc, l) => acc + (l.duration_minutes || 0), 0);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStr = weekStart.toISOString().slice(0, 10);
  const weekLogs = logs.filter((l) => l.started_at?.slice(0, 10) >= weekStr && l.ended_at);
  const weekMinutes = weekLogs.reduce((acc, l) => acc + (l.duration_minutes || 0), 0);
  const billableMinutes = weekLogs.filter((l) => l.billable).reduce((acc, l) => acc + (l.duration_minutes || 0), 0);

  // ─── Tracker View ──────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">⏱️ Time Tracker</h2>
        <div className="flex gap-2">
          {['tracker', 'history'].map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 text-xs rounded-full transition cursor-pointer ${view === v ? 'bg-[var(--anka-accent)] text-white' : 'bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)]'}`}
            >{v.charAt(0).toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-3 text-center">
          <div className="text-xs text-[var(--anka-text-secondary)]">Today</div>
          <div className="text-lg font-bold text-[var(--anka-accent)]">{formatMinutes(todayMinutes)}</div>
        </div>
        <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-3 text-center">
          <div className="text-xs text-[var(--anka-text-secondary)]">This Week</div>
          <div className="text-lg font-bold text-[var(--anka-text-primary)]">{formatMinutes(weekMinutes)}</div>
        </div>
        <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-3 text-center">
          <div className="text-xs text-[var(--anka-text-secondary)]">Billable</div>
          <div className="text-lg font-bold text-green-400">{formatMinutes(billableMinutes)}</div>
        </div>
      </div>

      {view === 'tracker' && (
        <>
          {/* Active Timer Display */}
          <div className={`rounded-xl p-5 mb-4 text-center ${activeTimer ? 'bg-green-500/10 border border-green-500/30' : 'bg-[var(--anka-bg-secondary)]'}`}>
            <div className="text-4xl font-mono font-bold mb-2">
              {activeTimer ? formatDuration(elapsed) : '00:00:00'}
            </div>
            {activeTimer && (
              <div className="text-sm text-[var(--anka-text-secondary)]">
                {activeTimer.description || 'No description'}
              </div>
            )}
          </div>

          {/* Start / Stop */}
          {!activeTimer ? (
            <form onSubmit={startTimer} className="space-y-3 mb-4">
              <input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})}
                placeholder="What are you working on?" required
                className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
              <div className="grid grid-cols-2 gap-2">
                <select value={form.project_id} onChange={(e) => setForm({...form, project_id: e.target.value})}
                  className="px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none">
                  <option value="">No project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={form.task_id} onChange={(e) => setForm({...form, task_id: e.target.value})}
                  className="px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none">
                  <option value="">No task</option>
                  {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-[var(--anka-text-secondary)] cursor-pointer">
                  <input type="checkbox" checked={form.billable} onChange={(e) => setForm({...form, billable: e.target.checked})}
                    className="accent-[var(--anka-accent)]" />
                  Billable
                </label>
                <button type="submit"
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition text-sm font-medium cursor-pointer">
                  ▶ Start Timer
                </button>
              </div>
            </form>
          ) : (
            <button onClick={stopTimer}
              className="w-full py-3 bg-red-600 text-white rounded-lg hover:bg-red-500 transition font-medium cursor-pointer mb-4">
              ⏹ Stop Timer
            </button>
          )}

          {/* Recent entries */}
          <div className="flex-1 overflow-y-auto space-y-2">
            <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase tracking-wide mb-2">Recent</h3>
            {todayLogs.length === 0 && <p className="text-xs text-[var(--anka-text-secondary)]">No entries today.</p>}
            {todayLogs.slice(0, 10).map((log) => (
              <div key={log.id} className="flex items-center justify-between bg-[var(--anka-bg-secondary)] rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{log.description || 'Untitled'}</div>
                  <div className="text-xs text-[var(--anka-text-secondary)]">
                    {log.projects?.name || 'No project'} • {formatMinutes(log.duration_minutes)}
                    {log.billable && <span className="ml-1 text-green-400">$</span>}
                  </div>
                </div>
                <button onClick={() => deleteLog(log.id)} className="text-red-400 hover:text-red-300 text-xs ml-2 cursor-pointer">✕</button>
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'history' && (
        <div className="flex-1 overflow-y-auto space-y-2">
          {loading ? <p className="text-sm text-[var(--anka-text-secondary)]">Loading...</p> : (
            <>
              {logs.filter((l) => l.ended_at).length === 0 && <p className="text-sm text-[var(--anka-text-secondary)]">No time entries yet.</p>}
              {logs.filter((l) => l.ended_at).map((log) => (
                <div key={log.id} className="flex items-center justify-between bg-[var(--anka-bg-secondary)] rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{log.description || 'Untitled'}</div>
                    <div className="text-xs text-[var(--anka-text-secondary)]">
                      {log.projects?.name || 'No project'}
                      {log.tasks?.title ? ` • ${log.tasks.title}` : ''}
                      {' • '}{new Date(log.started_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right ml-3">
                    <div className="text-sm font-mono">{formatMinutes(log.duration_minutes)}</div>
                    <div className="flex items-center gap-1 justify-end">
                      {log.billable && <span className="text-green-400 text-xs">$</span>}
                      <button onClick={() => deleteLog(log.id)} className="text-red-400 hover:text-red-300 text-xs cursor-pointer">✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
