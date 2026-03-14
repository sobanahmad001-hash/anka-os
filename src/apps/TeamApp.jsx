import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const ROLE_BADGE = {
  admin: 'bg-red-500/20 text-red-400',
  department_head: 'bg-purple-500/20 text-purple-400',
  executive: 'bg-blue-500/20 text-blue-400',
  member: 'bg-green-500/20 text-green-400',
  intern: 'bg-gray-500/20 text-gray-400',
};

const DEPT_ICON = {
  design: '🎨',
  development: '💻',
  marketing: '📈',
};

export default function TeamApp() {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [statuses, setStatuses] = useState({}); // { userId: { status, last_seen } }
  const [announcements, setAnnouncements] = useState([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [view, setView] = useState('directory'); // directory | announcements
  const [announcementForm, setAnnouncementForm] = useState({ title: '', body: '', priority: 'normal' });
  const [showAnnounceForm, setShowAnnounceForm] = useState(false);
  const [myProfile, setMyProfile] = useState(null);

  useEffect(() => {
    loadAll();
    // Realtime for announcements
    const ch = supabase.channel('team-announce')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_announcements' },
        (payload) => setAnnouncements((prev) => [payload.new, ...prev]))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  async function loadAll() {
    const [{ data: profiles }, { data: statusData }, { data: ann }] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('user_status').select('*'),
      supabase.from('team_announcements').select('*, author:profiles!author_id(full_name, avatar_url)').order('created_at', { ascending: false }).limit(30),
    ]);
    if (profiles) {
      setMembers(profiles);
      const me = profiles.find((p) => p.id === user.id);
      if (me) setMyProfile(me);
    }
    if (statusData) {
      const map = {};
      statusData.forEach((s) => {
        map[s.user_id] = s;
      });
      setStatuses(map);
    }
    if (ann) setAnnouncements(ann);
  }

  function isOnline(userId) {
    const s = statuses[userId];
    if (!s) return false;
    if (s.status === 'offline') return false;
    // Consider online if last_seen within 5 minutes
    if (s.last_seen) {
      return (Date.now() - new Date(s.last_seen).getTime()) < 5 * 60 * 1000;
    }
    return s.status === 'online';
  }

  function statusLabel(userId) {
    const s = statuses[userId];
    if (!s) return 'offline';
    if (s.status === 'online' && isOnline(userId)) return 'online';
    if (s.status === 'away') return 'away';
    if (s.status === 'busy') return 'busy';
    return 'offline';
  }

  const STATUS_DOT = {
    online: 'bg-green-400',
    away: 'bg-yellow-400',
    busy: 'bg-red-400',
    offline: 'bg-gray-500',
  };

  // Filter members
  const filtered = members.filter((m) => {
    const q = search.toLowerCase();
    const nameMatch = !q || m.full_name?.toLowerCase().includes(q) || m.department?.toLowerCase().includes(q);
    const deptMatch = !deptFilter || m.department === deptFilter;
    return nameMatch && deptMatch;
  });

  // Group by department
  const grouped = {};
  filtered.forEach((m) => {
    const dept = m.department || 'other';
    if (!grouped[dept]) grouped[dept] = [];
    grouped[dept].push(m);
  });

  const canAnnounce = myProfile && (myProfile.role === 'admin' || myProfile.role === 'department_head');

  async function postAnnouncement(e) {
    e.preventDefault();
    if (!announcementForm.title.trim()) return;
    await supabase.from('team_announcements').insert({
      author_id: user.id,
      title: announcementForm.title.trim(),
      body: announcementForm.body.trim(),
      priority: announcementForm.priority,
    });
    setAnnouncementForm({ title: '', body: '', priority: 'normal' });
    setShowAnnounceForm(false);
  }

  const PRIORITY_COLORS = { low: 'border-gray-500', normal: 'border-blue-500', high: 'border-orange-500', urgent: 'border-red-500' };

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold">Team</h2>
        <div className="flex gap-1 ml-3">
          {['directory', 'announcements'].map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`text-[10px] px-2.5 py-1 rounded-full transition cursor-pointer ${
                view === v ? 'bg-[var(--anka-accent)] text-white' : 'bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)]'
              }`}>{v === 'directory' ? '👥 Directory' : '📢 Announcements'}</button>
          ))}
        </div>
        <span className="text-[10px] text-[var(--anka-text-secondary)] ml-auto">
          {Object.values(statuses).filter((s) => s.status === 'online').length} online of {members.length}
        </span>
      </div>

      {view === 'directory' && (
        <>
          {/* Search + filter */}
          <div className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team..."
              className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]">
              <option value="">All Depts</option>
              <option value="design">🎨 Design</option>
              <option value="development">💻 Development</option>
              <option value="marketing">📈 Marketing</option>
            </select>
          </div>

          {/* Member grid grouped by department */}
          <div className="flex-1 overflow-y-auto space-y-4">
            {Object.keys(grouped).sort().map((dept) => (
              <div key={dept}>
                <h3 className="text-[10px] font-bold text-[var(--anka-text-secondary)] uppercase tracking-wider mb-2">
                  {DEPT_ICON[dept] || '📌'} {dept} ({grouped[dept].length})
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {grouped[dept].map((m) => {
                    const sl = statusLabel(m.id);
                    return (
                      <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] hover:border-[var(--anka-accent)]/30 transition">
                        {/* Avatar */}
                        <div className="relative flex-shrink-0">
                          <div className="w-9 h-9 rounded-full bg-[var(--anka-accent)]/20 flex items-center justify-center text-sm">
                            {m.avatar_url
                              ? <img src={m.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                              : m.full_name?.charAt(0) || '?'}
                          </div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--anka-bg-secondary)] ${STATUS_DOT[sl]}`} />
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {m.full_name || 'Unknown'}
                            {m.id === user.id && <span className="text-[9px] text-[var(--anka-accent)] ml-1">(you)</span>}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${ROLE_BADGE[m.role] || ROLE_BADGE.member}`}>{m.role}</span>
                            <span className="text-[9px] text-[var(--anka-text-secondary)] capitalize">{sl}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-[var(--anka-text-secondary)] text-center py-8">No team members found</p>
            )}
          </div>
        </>
      )}

      {view === 'announcements' && (
        <>
          {canAnnounce && (
            <div>
              <button onClick={() => setShowAnnounceForm(!showAnnounceForm)}
                className="text-xs px-3 py-1 rounded-lg bg-[var(--anka-accent)] text-white hover:brightness-110 transition cursor-pointer">
                + New Announcement
              </button>
              {showAnnounceForm && (
                <form onSubmit={postAnnouncement} className="mt-2 p-3 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] space-y-2">
                  <input value={announcementForm.title} onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                    placeholder="Announcement title"
                    className="w-full text-xs px-3 py-1.5 rounded-lg bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
                  <textarea value={announcementForm.body} onChange={(e) => setAnnouncementForm({ ...announcementForm, body: e.target.value })}
                    placeholder="Details (optional)" rows={3}
                    className="w-full text-xs px-3 py-1.5 rounded-lg bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)] resize-none" />
                  <div className="flex gap-2">
                    <select value={announcementForm.priority} onChange={(e) => setAnnouncementForm({ ...announcementForm, priority: e.target.value })}
                      className="text-xs px-2 py-1.5 rounded-lg bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]">
                      {['low','normal','high','urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <button type="submit" className="text-xs px-3 py-1.5 rounded-lg bg-[var(--anka-accent)] text-white cursor-pointer">Post</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Announcement list */}
          <div className="flex-1 overflow-y-auto space-y-2">
            {announcements.length === 0 && (
              <p className="text-xs text-[var(--anka-text-secondary)] text-center py-8">No announcements yet</p>
            )}
            {announcements.map((a) => (
              <div key={a.id} className={`p-3 rounded-lg bg-[var(--anka-bg-secondary)] border-l-3 ${PRIORITY_COLORS[a.priority] || 'border-blue-500'} border border-[var(--anka-border)]`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold">{a.pinned && '📌 '}{a.title}</h4>
                    {a.body && <p className="text-[11px] text-[var(--anka-text-secondary)] mt-1 whitespace-pre-wrap">{a.body}</p>}
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    a.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                    a.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-[var(--anka-bg-primary)] text-[var(--anka-text-secondary)]'
                  }`}>{a.priority}</span>
                </div>
                <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--anka-text-secondary)]">
                  <span>{a.author?.full_name || 'Unknown'}</span>
                  <span>·</span>
                  <span>{new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
