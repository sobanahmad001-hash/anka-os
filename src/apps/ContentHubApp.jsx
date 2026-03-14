import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const TYPE_OPTIONS = ['blog', 'social', 'email', 'video', 'infographic', 'other'];
const STATUS_OPTIONS = ['idea', 'drafting', 'review', 'approved', 'published', 'archived'];

const STATUS_COLORS = {
  idea: 'bg-purple-500/20 text-purple-400',
  drafting: 'bg-yellow-500/20 text-yellow-400',
  review: 'bg-blue-500/20 text-blue-400',
  approved: 'bg-green-500/20 text-green-400',
  published: 'bg-emerald-500/20 text-emerald-400',
  archived: 'bg-gray-500/20 text-gray-400',
};

const TYPE_ICONS = {
  blog: '📝', social: '📱', email: '📧', video: '🎬', infographic: '📊', other: '📄',
};

export default function ContentHubApp() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [view, setView] = useState('board'); // board | create | detail
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    title: '', body: '', content_type: 'blog', status: 'idea',
    platform: '', publish_date: '', campaign_id: '',
  });

  useEffect(() => {
    loadContent();
    loadCampaigns();
  }, []);

  async function loadContent() {
    setLoading(true);
    const { data } = await supabase
      .from('content_items')
      .select('*, profiles:created_by(full_name), campaigns:campaign_id(name)')
      .order('created_at', { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  async function loadCampaigns() {
    const { data } = await supabase.from('campaigns').select('id, name').order('name');
    setCampaigns(data || []);
  }

  async function createItem(e) {
    e.preventDefault();
    const { error } = await supabase.from('content_items').insert([{
      ...form,
      created_by: user.id,
      campaign_id: form.campaign_id || null,
      publish_date: form.publish_date || null,
    }]);
    if (!error) {
      setForm({ title: '', body: '', content_type: 'blog', status: 'idea', platform: '', publish_date: '', campaign_id: '' });
      setView('board');
      loadContent();
    }
  }

  async function updateStatus(id, status) {
    await supabase.from('content_items').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    loadContent();
    if (selected?.id === id) setSelected({ ...selected, status });
  }

  async function deleteItem(id) {
    await supabase.from('content_items').delete().eq('id', id);
    setView('board');
    setSelected(null);
    loadContent();
  }

  // ─── Board View (Kanban-style columns) ───────────────────────────────────
  if (view === 'board') {
    const columns = STATUS_OPTIONS.map((s) => ({
      status: s,
      items: items.filter((i) => i.status === s),
    }));

    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">✏️ Content Hub</h2>
          <button onClick={() => setView('create')} className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            + New Content
          </button>
        </div>

        {loading ? (
          <p className="text-[var(--anka-text-secondary)] text-sm">Loading...</p>
        ) : (
          <div className="flex-1 overflow-x-auto">
            <div className="flex gap-3 h-full min-w-max">
              {columns.map((col) => (
                <div key={col.status} className="w-56 flex-shrink-0 flex flex-col">
                  <div className="flex items-center gap-2 mb-2 px-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[col.status]}`}>
                      {col.status}
                    </span>
                    <span className="text-[10px] text-[var(--anka-text-secondary)]">{col.items.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {col.items.map((item) => (
                      <div key={item.id} onClick={() => { setSelected(item); setView('detail'); }}
                        className="p-2.5 bg-[var(--anka-bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--anka-bg-tertiary)] transition"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-sm">{TYPE_ICONS[item.content_type]}</span>
                          <span className="text-xs font-medium truncate">{item.title}</span>
                        </div>
                        <div className="text-[10px] text-[var(--anka-text-secondary)] flex items-center gap-2">
                          {item.platform && <span>{item.platform}</span>}
                          {item.campaigns?.name && <span>📊 {item.campaigns.name}</span>}
                        </div>
                        {item.publish_date && (
                          <div className="text-[10px] text-[var(--anka-text-secondary)] mt-1">📅 {item.publish_date}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Create View ────────────────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full overflow-y-auto p-4">
        <button onClick={() => setView('board')} className="text-[var(--anka-text-secondary)] text-sm mb-4 hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        <h2 className="text-lg font-bold mb-4">New Content</h2>
        <form onSubmit={createItem} className="space-y-3 max-w-md">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Content title" required
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Content body / draft..." rows={6}
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)] resize-none" />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.content_type} onChange={(e) => setForm({ ...form, content_type: e.target.value })}
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]">
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
            </select>
            <input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} placeholder="Platform (e.g. twitter)"
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-[var(--anka-text-secondary)]">Publish date
              <input type="date" value={form.publish_date} onChange={(e) => setForm({ ...form, publish_date: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
            </label>
            <label className="text-xs text-[var(--anka-text-secondary)]">Campaign
              <select value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]">
                <option value="">None</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <button type="submit" className="w-full py-2 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            Create Content
          </button>
        </form>
      </div>
    );
  }

  // ─── Detail View ────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <button onClick={() => setView('board')} className="text-[var(--anka-text-secondary)] text-sm mb-4 hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            {TYPE_ICONS[selected.content_type]} {selected.title}
          </h2>
          <button onClick={() => deleteItem(selected.id)} className="text-red-400 text-xs hover:text-red-300 cursor-pointer">Delete</button>
        </div>
        <div className="flex items-center gap-2 mb-4">
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
          {selected.platform && <span className="text-xs text-[var(--anka-text-secondary)]">📍 {selected.platform}</span>}
          {selected.publish_date && <span className="text-xs text-[var(--anka-text-secondary)]">📅 {selected.publish_date}</span>}
          {selected.campaigns?.name && <span className="text-xs text-[var(--anka-text-secondary)]">📊 {selected.campaigns.name}</span>}
        </div>

        {selected.body && (
          <div className="p-3 bg-[var(--anka-bg-secondary)] rounded-lg text-sm whitespace-pre-wrap mb-4 max-h-60 overflow-y-auto">
            {selected.body}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.filter((s) => s !== selected.status).map((s) => (
            <button key={s} onClick={() => updateStatus(selected.id, s)}
              className={`px-3 py-1 text-xs rounded-full cursor-pointer transition ${STATUS_COLORS[s]} hover:brightness-110`}>
              → {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
