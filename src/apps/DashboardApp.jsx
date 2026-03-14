import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function DashboardApp({ openAppById }) {
  const { user, profile } = useAuth();
  const [stats, setStats] = useState(null);
  const [recentTasks, setRecentTasks] = useState([]);
  const [recentProjects, setRecentProjects] = useState([]);
  const [activity, setActivity] = useState([]);
  const [pinnedApps, setPinnedApps] = useState([]);
  const [timeToday, setTimeToday] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);

    const today = new Date().toISOString().split('T')[0];

    const [tasksRes, projectsRes, notifRes, activityRes, pinnedRes, timeRes] = await Promise.all([
      supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(5),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false),
      supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('pinned_apps')
        .select('app_id, sort_order')
        .eq('user_id', user.id)
        .order('sort_order'),
      supabase
        .from('time_logs')
        .select('duration_minutes')
        .eq('user_id', user.id)
        .gte('start_time', today + 'T00:00:00')
        .not('end_time', 'is', null),
    ]);

    // Get task counts
    const [todoRes, progressRes, doneRes] = await Promise.all([
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'todo'),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'in_progress'),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'done'),
    ]);

    setStats({
      todoCount: todoRes.count || 0,
      inProgressCount: progressRes.count || 0,
      doneCount: doneRes.count || 0,
      unreadNotifications: notifRes.count || 0,
    });

    if (tasksRes.data) setRecentTasks(tasksRes.data);
    if (projectsRes.data) setRecentProjects(projectsRes.data);
    if (activityRes.data) setActivity(activityRes.data);
    if (pinnedRes.data) setPinnedApps(pinnedRes.data.map((p) => p.app_id));
    if (timeRes.data) {
      setTimeToday(timeRes.data.reduce((sum, t) => sum + (t.duration_minutes || 0), 0));
    }
    setLoading(false);
  }

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

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

  const STATUS_COLORS = {
    todo: 'bg-gray-500',
    in_progress: 'bg-yellow-500',
    done: 'bg-green-500',
  };

  const PROJECT_STATUS_COLORS = {
    planning: 'bg-blue-500',
    active: 'bg-green-500',
    on_hold: 'bg-yellow-500',
    completed: 'bg-purple-500',
    archived: 'bg-gray-500',
  };

  const ACTION_ICONS = {
    created_project: '📋',
    completed_task: '✅',
    uploaded_asset: '🖼️',
    added_client: '🤝',
    sent_message: '💬',
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-sm text-[var(--anka-text-secondary)]">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="text-xl font-bold">
          {getGreeting()}, {profile?.full_name?.split(' ')[0] || 'there'} 👋
        </h2>
        <p className="text-sm text-[var(--anka-text-secondary)] mt-1">
          Here's what's happening in your workspace today.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2 flex-wrap">
        {[
          { label: 'New Task', icon: '✅', app: 'tasks' },
          { label: 'New Note', icon: '📝', app: 'notes' },
          { label: 'Team Chat', icon: '💬', app: 'chat' },
          { label: 'Time Tracker', icon: '⏱️', app: 'timetracker' },
          { label: 'AI Assistant', icon: '🤖', app: 'ai' },
        ].map((action) => (
          <button
            key={action.app}
            onClick={() => openAppById && openAppById(action.app)}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg hover:border-[var(--anka-accent)]/30 transition text-xs cursor-pointer"
          >
            <span>{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard
          icon="📝"
          label="To Do"
          value={stats.todoCount}
          color="text-gray-400"
        />
        <StatCard
          icon="⏳"
          label="In Progress"
          value={stats.inProgressCount}
          color="text-yellow-400"
        />
        <StatCard
          icon="✅"
          label="Done"
          value={stats.doneCount}
          color="text-green-400"
        />
        <StatCard
          icon="🔔"
          label="Notifications"
          value={stats.unreadNotifications}
          color="text-[var(--anka-accent)]"
        />
        <StatCard
          icon="⏱️"
          label="Tracked Today"
          value={`${Math.floor(timeToday / 60)}h ${timeToday % 60}m`}
          color="text-cyan-400"
          small
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Recent Tasks */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">
            Recent Tasks
          </h3>
          {recentTasks.length === 0 ? (
            <p className="text-xs text-[var(--anka-text-secondary)]">No tasks yet.</p>
          ) : (
            <div className="space-y-2">
              {recentTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[task.status]}`} />
                  <span className="text-sm flex-1 truncate">{task.title}</span>
                  <span className="text-[10px] text-[var(--anka-text-secondary)]">
                    {timeAgo(task.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Projects */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">
            Active Projects
          </h3>
          {recentProjects.length === 0 ? (
            <p className="text-xs text-[var(--anka-text-secondary)]">No projects yet.</p>
          ) : (
            <div className="space-y-2">
              {recentProjects.map((proj) => (
                <div key={proj.id} className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${PROJECT_STATUS_COLORS[proj.status]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{proj.name}</div>
                    <div className="text-[10px] text-[var(--anka-text-secondary)] capitalize">
                      {proj.department_id} · {proj.status.replace('_', ' ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
        <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">
          Recent Activity
        </h3>
        {activity.length === 0 ? (
          <p className="text-xs text-[var(--anka-text-secondary)]">No activity recorded yet. Activity will appear as you use the workspace.</p>
        ) : (
          <div className="space-y-3">
            {activity.map((a) => (
              <div key={a.id} className="flex items-center gap-3">
                <span className="text-lg">{ACTION_ICONS[a.action] || '📌'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">
                    {a.action.replace(/_/g, ' ')}
                    {a.metadata?.name ? `: ${a.metadata.name}` : ''}
                  </div>
                  <div className="text-[10px] text-[var(--anka-text-secondary)]">
                    {a.entity_type} · {timeAgo(a.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color, small }) {
  return (
    <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-lg">{icon}</span>
        <span className={`${small ? 'text-base' : 'text-2xl'} font-bold ${color}`}>{value}</span>
      </div>
      <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase">{label}</div>
    </div>
  );
}
