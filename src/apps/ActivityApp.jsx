import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const TYPE_META = {
  task_created: { icon: '✅', label: 'Task' },
  task_updated: { icon: '✅', label: 'Task' },
  project_created: { icon: '📋', label: 'Project' },
  project_updated: { icon: '📋', label: 'Project' },
  note_created: { icon: '📝', label: 'Note' },
  message_sent: { icon: '💬', label: 'Chat' },
  file_uploaded: { icon: '📁', label: 'File' },
  campaign_created: { icon: '📊', label: 'Campaign' },
  content_created: { icon: '✏️', label: 'Content' },
  invoice_created: { icon: '🧾', label: 'Invoice' },
  client_created: { icon: '🤝', label: 'Client' },
  review_created: { icon: '💡', label: 'Review' },
  wiki_created: { icon: '📖', label: 'Wiki' },
  login: { icon: '🔑', label: 'Auth' },
  default: { icon: '📌', label: 'Activity' },
};

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(date).toLocaleDateString();
}

function dateLabel(dateStr) {
  const d = new Date(dateStr);
  const t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Today';
  const y = new Date(t); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function ActivityApp() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => { loadLogs(); }, [typeFilter, page]);

  async function loadLogs() {
    setLoading(true);
    let q = supabase
      .from('activity_log')
      .select('*, profile:profiles!user_id(full_name, avatar_url)')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (typeFilter) q = q.eq('action', typeFilter);
    const { data } = await q;
    if (data) setLogs(data);
    setLoading(false);
  }

  // Group logs by date
  const grouped = {};
  logs.forEach((l) => {
    const key = new Date(l.created_at).toDateString();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(l);
  });

  // Get unique action types from current data for filter
  const actionTypes = [...new Set(logs.map((l) => l.action))];

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold">Activity Timeline</h2>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          className="text-xs px-2 py-1 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]">
          <option value="">All Activity</option>
          {actionTypes.map((a) => (
            <option key={a} value={a}>{(TYPE_META[a] || TYPE_META.default).label} — {a}</option>
          ))}
        </select>
        <button onClick={loadLogs} className="text-xs text-[var(--anka-text-secondary)] hover:text-[var(--anka-accent)] transition cursor-pointer ml-auto">↻ Refresh</button>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {loading && logs.length === 0 && (
          <p className="text-xs text-[var(--anka-text-secondary)] text-center py-8">Loading...</p>
        )}
        {!loading && logs.length === 0 && (
          <p className="text-xs text-[var(--anka-text-secondary)] text-center py-8">No activity yet</p>
        )}
        {Object.keys(grouped).map((dateKey) => (
          <div key={dateKey}>
            <h3 className="text-[10px] font-bold text-[var(--anka-text-secondary)] uppercase tracking-wider mb-2 sticky top-0 bg-[var(--anka-bg-primary)] py-1 z-10">
              {dateLabel(grouped[dateKey][0].created_at)}
            </h3>
            <div className="space-y-1 pl-3 border-l-2 border-[var(--anka-border)]">
              {grouped[dateKey].map((log) => {
                const meta = TYPE_META[log.action] || TYPE_META.default;
                return (
                  <div key={log.id} className="flex items-start gap-2.5 py-1.5 relative group">
                    {/* Timeline dot */}
                    <span className="absolute -left-[19px] top-2.5 w-2.5 h-2.5 rounded-full bg-[var(--anka-bg-secondary)] border-2 border-[var(--anka-accent)] group-hover:bg-[var(--anka-accent)] transition" />
                    <span className="text-sm flex-shrink-0">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-snug">
                        <span className="font-medium">{log.profile?.full_name || 'Unknown'}</span>
                        <span className="text-[var(--anka-text-secondary)]"> — {log.action?.replace(/_/g, ' ')}</span>
                      </p>
                      {log.entity_type && (
                        <p className="text-[10px] text-[var(--anka-text-secondary)] truncate">
                          {log.entity_type}{log.details ? `: ${typeof log.details === 'string' ? log.details : JSON.stringify(log.details).slice(0, 80)}` : ''}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-[var(--anka-text-secondary)] flex-shrink-0 whitespace-nowrap">{timeAgo(log.created_at)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--anka-border)]">
        <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
          className="text-xs px-3 py-1 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] disabled:opacity-30 cursor-pointer disabled:cursor-default">← Newer</button>
        <span className="text-[10px] text-[var(--anka-text-secondary)]">Page {page + 1}</span>
        <button onClick={() => { if (logs.length === PAGE_SIZE) setPage(page + 1); }} disabled={logs.length < PAGE_SIZE}
          className="text-xs px-3 py-1 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] disabled:opacity-30 cursor-pointer disabled:cursor-default">Older →</button>
      </div>
    </div>
  );
}
