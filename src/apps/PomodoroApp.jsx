import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const MODES = {
  focus: { label: 'Focus', duration: 25, color: '#e17055' },
  short_break: { label: 'Short Break', duration: 5, color: '#00b894' },
  long_break: { label: 'Long Break', duration: 15, color: '#0984e3' },
};

export default function PomodoroApp() {
  const { user } = useAuth();
  const [mode, setMode] = useState('focus');
  const [timeLeft, setTimeLeft] = useState(MODES.focus.duration * 60);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [todayStats, setTodayStats] = useState({ focus: 0, breaks: 0, completed: 0 });
  const [tasks, setTasks] = useState([]);
  const [linkedTask, setLinkedTask] = useState('');
  const intervalRef = useRef(null);
  const startTimeRef = useRef(null);

  useEffect(() => {
    loadSessions();
    loadTasks();
  }, []);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            completeSession();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  async function loadSessions() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('pomodoro_sessions')
      .select('*')
      .eq('user_id', user.id)
      .gte('started_at', todayStart.toISOString())
      .order('started_at', { ascending: false });
    if (data) {
      setSessions(data);
      const focus = data.filter((s) => s.type === 'focus' && s.completed).reduce((a, s) => a + s.duration_minutes, 0);
      const breaks = data.filter((s) => s.type !== 'focus' && s.completed).reduce((a, s) => a + s.duration_minutes, 0);
      const completed = data.filter((s) => s.type === 'focus' && s.completed).length;
      setTodayStats({ focus, breaks, completed });
    }
  }

  async function loadTasks() {
    const { data } = await supabase.from('tasks').select('id, title')
      .eq('user_id', user.id).in('status', ['todo', 'in_progress']).order('created_at', { ascending: false }).limit(20);
    if (data) setTasks(data);
  }

  function switchMode(m) {
    if (running) return;
    setMode(m);
    setTimeLeft(MODES[m].duration * 60);
  }

  function start() {
    startTimeRef.current = new Date();
    setRunning(true);
  }

  function pause() {
    clearInterval(intervalRef.current);
    setRunning(false);
  }

  function reset() {
    clearInterval(intervalRef.current);
    setRunning(false);
    setTimeLeft(MODES[mode].duration * 60);
  }

  async function completeSession() {
    await supabase.from('pomodoro_sessions').insert({
      user_id: user.id,
      type: mode,
      duration_minutes: MODES[mode].duration,
      started_at: startTimeRef.current?.toISOString() || new Date().toISOString(),
      completed: true,
      task_id: linkedTask || null,
    });
    // Auto-switch to break after focus
    if (mode === 'focus') {
      const nextBreak = (todayStats.completed + 1) % 4 === 0 ? 'long_break' : 'short_break';
      setMode(nextBreak);
      setTimeLeft(MODES[nextBreak].duration * 60);
    } else {
      setMode('focus');
      setTimeLeft(MODES.focus.duration * 60);
    }
    loadSessions();
  }

  const mm = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const ss = String(timeLeft % 60).padStart(2, '0');
  const progress = 1 - timeLeft / (MODES[mode].duration * 60);
  const circumference = 2 * Math.PI * 90;

  return (
    <div className="h-full flex flex-col items-center p-6 gap-4">
      {/* Mode tabs */}
      <div className="flex gap-1 bg-[var(--anka-bg-secondary)] rounded-xl p-1">
        {Object.entries(MODES).map(([key, m]) => (
          <button key={key} onClick={() => switchMode(key)}
            className={`text-xs px-4 py-1.5 rounded-lg transition cursor-pointer ${
              mode === key ? 'text-white font-semibold' : 'text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)]'
            }`}
            style={mode === key ? { backgroundColor: m.color } : {}}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Timer circle */}
      <div className="relative w-52 h-52 flex items-center justify-center">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="90" fill="none" stroke="var(--anka-border)" strokeWidth="6" />
          <circle cx="100" cy="100" r="90" fill="none"
            stroke={MODES[mode].color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            className="transition-all duration-1000" />
        </svg>
        <div className="text-center z-10">
          <div className="text-4xl font-bold tracking-wider" style={{ color: MODES[mode].color }}>
            {mm}:{ss}
          </div>
          <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase tracking-widest mt-1">
            {MODES[mode].label}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        {!running ? (
          <button onClick={start}
            className="px-6 py-2 rounded-xl text-white text-sm font-semibold transition cursor-pointer hover:brightness-110"
            style={{ backgroundColor: MODES[mode].color }}>
            {timeLeft < MODES[mode].duration * 60 ? 'Resume' : 'Start'}
          </button>
        ) : (
          <button onClick={pause}
            className="px-6 py-2 rounded-xl bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-sm transition cursor-pointer">
            Pause
          </button>
        )}
        <button onClick={reset}
          className="px-4 py-2 rounded-xl bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-xs text-[var(--anka-text-secondary)] transition cursor-pointer hover:text-[var(--anka-text-primary)]">
          Reset
        </button>
      </div>

      {/* Link to task */}
      <select value={linkedTask} onChange={(e) => setLinkedTask(e.target.value)}
        className="text-xs px-3 py-1.5 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)] max-w-xs">
        <option value="">No linked task</option>
        {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>

      {/* Today stats */}
      <div className="w-full max-w-sm grid grid-cols-3 gap-2 mt-auto">
        <StatBox label="Focus Time" value={`${todayStats.focus}m`} color="#e17055" />
        <StatBox label="Break Time" value={`${todayStats.breaks}m`} color="#00b894" />
        <StatBox label="Sessions" value={todayStats.completed} color="#0984e3" />
      </div>

      {/* Recent sessions */}
      {sessions.length > 0 && (
        <div className="w-full max-w-sm">
          <h4 className="text-[10px] font-bold text-[var(--anka-text-secondary)] uppercase tracking-wider mb-1.5">Today's Sessions</h4>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {sessions.slice(0, 8).map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: MODES[s.type]?.color || '#666' }} />
                <span className="text-[var(--anka-text-secondary)]">{MODES[s.type]?.label}</span>
                <span className="text-[var(--anka-text-secondary)]">{s.duration_minutes}m</span>
                <span className="ml-auto text-[var(--anka-text-secondary)]">
                  {new Date(s.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {s.completed && <span className="text-green-400">✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div className="text-center p-2.5 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)]">
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
      <div className="text-[9px] text-[var(--anka-text-secondary)] uppercase">{label}</div>
    </div>
  );
}
