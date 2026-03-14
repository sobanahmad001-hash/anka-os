import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const TYPE_ICONS = {
  task_assigned: '✅',
  project_update: '📋',
  mention: '💬',
  comment: '💬',
  deadline: '⏰',
  system: '🔔',
  review: '💡',
  invoice: '🧾',
};

const TYPE_LABELS = {
  task_assigned: 'Task',
  project_update: 'Project',
  mention: 'Mention',
  comment: 'Comment',
  deadline: 'Deadline',
  system: 'System',
  review: 'Review',
  invoice: 'Invoice',
};

export default function NotificationsApp() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | unread | read
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    loadNotifications();

    const channel = supabase
      .channel('notif-center')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications((prev) => [payload.new, ...prev]);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  async function loadNotifications() {
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (data) setNotifications(data);
    setLoading(false);
  }

  async function markAsRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  async function clearRead() {
    await supabase.from('notifications').delete().eq('user_id', user.id).eq('read', true);
    setNotifications((prev) => prev.filter((n) => !n.read));
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Group by date
  function groupByDate(items) {
    const groups = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    items.forEach((n) => {
      const dateStr = new Date(n.created_at).toDateString();
      let label;
      if (dateStr === today) label = 'Today';
      else if (dateStr === yesterday) label = 'Yesterday';
      else label = new Date(n.created_at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      if (!groups[label]) groups[label] = [];
      groups[label].push(n);
    });
    return groups;
  }

  // Apply filters
  const filtered = notifications.filter((n) => {
    if (filter === 'unread' && n.read) return false;
    if (filter === 'read' && !n.read) return false;
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;
  const grouped = groupByDate(filtered);
  const types = [...new Set(notifications.map((n) => n.type).filter(Boolean))];

  if (loading) {
    return <div className="h-full flex items-center justify-center text-sm text-[var(--anka-text-secondary)]">Loading notifications...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[var(--anka-border)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {unreadCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 bg-[var(--anka-accent)]/15 text-[var(--anka-accent)] rounded-full font-medium">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-[10px] text-[var(--anka-accent)] hover:text-[var(--anka-accent-hover)] cursor-pointer">
              Mark all read
            </button>
          )}
          {notifications.some((n) => n.read) && (
            <button onClick={clearRead} className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer">
              Clear read
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="px-5 py-2 border-b border-[var(--anka-border)] flex gap-2 flex-wrap items-center">
        <div className="flex gap-1 mr-2">
          {['all', 'unread', 'read'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-[10px] transition cursor-pointer capitalize ${
                filter === f ? 'bg-[var(--anka-accent)]/15 text-[var(--anka-accent)]' : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {types.length > 1 && (
          <div className="flex gap-1 border-l border-[var(--anka-border)] pl-2">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2 py-1 rounded-lg text-[10px] transition cursor-pointer ${
                typeFilter === 'all' ? 'bg-[var(--anka-accent)]/15 text-[var(--anka-accent)]' : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
              }`}
            >All types</button>
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2 py-1 rounded-lg text-[10px] transition cursor-pointer ${
                  typeFilter === t ? 'bg-[var(--anka-accent)]/15 text-[var(--anka-accent)]' : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
                }`}
              >
                {TYPE_ICONS[t] || '🔔'} {TYPE_LABELS[t] || t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-3xl mb-2">🔔</div>
            <div className="text-sm text-[var(--anka-text-secondary)]">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </div>
          </div>
        ) : (
          Object.entries(grouped).map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <div className="px-5 py-1.5 text-[10px] font-semibold text-[var(--anka-text-secondary)] uppercase bg-[var(--anka-bg-primary)] sticky top-0">
                {dateLabel}
              </div>
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.read && markAsRead(n.id)}
                  className={`w-full text-left px-5 py-3 flex items-start gap-3 border-b border-[var(--anka-border)] last:border-0 hover:bg-[var(--anka-bg-tertiary)]/50 transition cursor-pointer ${
                    !n.read ? 'bg-[var(--anka-accent)]/5' : ''
                  }`}
                >
                  <span className="text-lg mt-0.5">{TYPE_ICONS[n.type] || '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium truncate">{n.title}</div>
                      <span className="text-[9px] text-[var(--anka-text-secondary)] shrink-0">{timeAgo(n.created_at)}</span>
                    </div>
                    {n.body && <div className="text-[11px] text-[var(--anka-text-secondary)] mt-0.5 line-clamp-2">{n.body}</div>}
                    {n.type && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-[var(--anka-bg-tertiary)] rounded text-[var(--anka-text-secondary)] capitalize mt-1 inline-block">
                        {TYPE_LABELS[n.type] || n.type}
                      </span>
                    )}
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-[var(--anka-accent)] shrink-0 mt-2" />}
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t border-[var(--anka-border)] text-[10px] text-[var(--anka-text-secondary)]">
        {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
        {filter !== 'all' ? ` (${filter})` : ''}
      </div>
    </div>
  );
}
