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
    todo: 'var(--anka-text-tertiary)',
    in_progress: 'var(--anka-warning)',
    done: 'var(--anka-success)',
  };

  const PROJECT_STATUS_COLORS = {
    planning: '#60a5fa',
    active: 'var(--anka-success)',
    on_hold: 'var(--anka-warning)',
    completed: 'var(--anka-accent)',
    archived: 'var(--anka-text-tertiary)',
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
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--anka-accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'anka-spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 13, color: 'var(--anka-text-tertiary)' }}>Loading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="anka-fade-in" style={{ height: '100%', overflowY: 'auto', padding: 28 }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Greeting */}
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.3 }}>
            {getGreeting()}, {profile?.full_name?.split(' ')[0] || 'there'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--anka-text-tertiary)', marginTop: 4 }}>
            Here's what's happening in your workspace today.
          </p>
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
              className="cursor-pointer"
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px',
                borderRadius: 10, border: '1px solid var(--anka-border)', background: 'var(--anka-bg-surface)',
                color: 'inherit', fontSize: 12, fontWeight: 500, transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--anka-border-accent)'; e.currentTarget.style.background = 'var(--anka-accent-soft)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--anka-border)'; e.currentTarget.style.background = 'var(--anka-bg-surface)'; }}
            >
              <span style={{ fontSize: 14 }}>{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <StatCard icon="📝" label="To Do" value={stats.todoCount} color="var(--anka-text-secondary)" />
          <StatCard icon="⏳" label="In Progress" value={stats.inProgressCount} color="var(--anka-warning)" />
          <StatCard icon="✅" label="Done" value={stats.doneCount} color="var(--anka-success)" />
          <StatCard icon="🔔" label="Notifications" value={stats.unreadNotifications} color="var(--anka-accent)" />
          <StatCard icon="⏱️" label="Tracked Today" value={`${Math.floor(timeToday / 60)}h ${timeToday % 60}m`} color="#60a5fa" small />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Recent Tasks */}
          <div style={{ borderRadius: 14, border: '1px solid var(--anka-border)', background: 'var(--anka-bg-elevated)', padding: 20 }}>
            <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--anka-text-tertiary)', marginBottom: 16 }}>
              Recent Tasks
            </h3>
            {recentTasks.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--anka-text-tertiary)' }}>No tasks yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recentTasks.map((task) => (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: STATUS_COLORS[task.status] || 'var(--anka-text-tertiary)' }} />
                    <span style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                    <span style={{ fontSize: 10, color: 'var(--anka-text-tertiary)', flexShrink: 0 }}>{timeAgo(task.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Projects */}
          <div style={{ borderRadius: 14, border: '1px solid var(--anka-border)', background: 'var(--anka-bg-elevated)', padding: 20 }}>
            <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--anka-text-tertiary)', marginBottom: 16 }}>
              Active Projects
            </h3>
            {recentProjects.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--anka-text-tertiary)' }}>No projects yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recentProjects.map((proj) => (
                  <div key={proj.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: PROJECT_STATUS_COLORS[proj.status] || 'var(--anka-text-tertiary)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proj.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--anka-text-tertiary)', textTransform: 'capitalize' }}>
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
        <div style={{ borderRadius: 14, border: '1px solid var(--anka-border)', background: 'var(--anka-bg-elevated)', padding: 20 }}>
          <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--anka-text-tertiary)', marginBottom: 16 }}>
            Recent Activity
          </h3>
          {activity.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--anka-text-tertiary)' }}>
              No activity recorded yet. Activity will appear as you use the workspace.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activity.map((a) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{ACTION_ICONS[a.action] || '📌'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.action.replace(/_/g, ' ')}
                      {a.metadata?.name ? `: ${a.metadata.name}` : ''}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--anka-text-tertiary)' }}>
                      {a.entity_type} · {timeAgo(a.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color, small }) {
  return (
    <div style={{
      borderRadius: 14, border: '1px solid var(--anka-border)', background: 'var(--anka-bg-elevated)',
      padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: small ? 16 : 24, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</span>
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--anka-text-tertiary)' }}>{label}</div>
    </div>
  );
}
