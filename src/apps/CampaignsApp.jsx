import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_OPTIONS = ['draft', 'active', 'paused', 'completed', 'cancelled'];
const CHANNEL_OPTIONS = ['email', 'social', 'paid_ads', 'content', 'event', 'other'];

const STATUS_COLORS = {
  draft: 'bg-gray-500/20 text-gray-400',
  active: 'bg-green-500/20 text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-blue-500/20 text-blue-400',
  cancelled: 'bg-red-500/20 text-red-400',
};

const CHANNEL_ICONS = {
  email: '📧', social: '📱', paid_ads: '💰', content: '📝', event: '🎪', other: '📌',
};

export default function CampaignsApp() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [view, setView] = useState('list'); // list | create | detail
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  // Form state
  const [form, setForm] = useState({
    name: '', description: '', status: 'draft', channel: 'other',
    budget: '', target_audience: '', start_date: '', end_date: '',
  });

  useEffect(() => { loadCampaigns(); }, []);

  async function loadCampaigns() {
    setLoading(true);
    const { data } = await supabase
      .from('campaigns')
      .select('*, profiles:created_by(full_name)')
      .order('created_at', { ascending: false });
    setCampaigns(data || []);
    setLoading(false);
  }

  async function createCampaign(e) {
    e.preventDefault();
    const { error } = await supabase.from('campaigns').insert([{
      ...form,
      budget: parseFloat(form.budget) || 0,
      created_by: user.id,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    }]);
    if (!error) {
      setForm({ name: '', description: '', status: 'draft', channel: 'other', budget: '', target_audience: '', start_date: '', end_date: '' });
      setView('list');
      loadCampaigns();
    }
  }

  async function updateStatus(id, status) {
    await supabase.from('campaigns').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    loadCampaigns();
    if (selected?.id === id) setSelected({ ...selected, status });
  }

  async function deleteCampaign(id) {
    await supabase.from('campaigns').delete().eq('id', id);
    setView('list');
    setSelected(null);
    loadCampaigns();
  }

  const filtered = filter === 'all' ? campaigns : campaigns.filter((c) => c.status === filter);

  // ─── List View ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">📊 Campaigns</h2>
          <button onClick={() => setView('create')} className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            + New Campaign
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {['all', ...STATUS_OPTIONS].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 text-xs rounded-full whitespace-nowrap transition cursor-pointer ${filter === s ? 'bg-[var(--anka-accent)] text-white' : 'bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)]'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-[var(--anka-text-secondary)] text-sm">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-[var(--anka-text-secondary)] text-sm mt-8 text-center">No campaigns yet. Create one to get started.</p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2">
            {filtered.map((c) => (
              <div key={c.id} onClick={() => { setSelected(c); setView('detail'); }}
                className="p-3 bg-[var(--anka-bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--anka-bg-tertiary)] transition"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span>{CHANNEL_ICONS[c.channel] || '📌'}</span>
                    <span className="font-medium text-sm">{c.name}</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status]}`}>
                    {c.status}
                  </span>
                </div>
                <div className="text-xs text-[var(--anka-text-secondary)] flex items-center gap-3">
                  {c.budget > 0 && <span>Budget: ${Number(c.budget).toLocaleString()}</span>}
                  {c.start_date && <span>{c.start_date} → {c.end_date || '...'}</span>}
                  <span>{c.profiles?.full_name || 'Unknown'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Create View ────────────────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full overflow-y-auto p-4">
        <button onClick={() => setView('list')} className="text-[var(--anka-text-secondary)] text-sm mb-4 hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        <h2 className="text-lg font-bold mb-4">New Campaign</h2>
        <form onSubmit={createCampaign} className="space-y-3 max-w-md">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Campaign name" required
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" rows={3}
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)] resize-none" />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]">
              {CHANNEL_OPTIONS.map((ch) => <option key={ch} value={ch}>{CHANNEL_ICONS[ch]} {ch.replace('_', ' ')}</option>)}
            </select>
            <input value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="Budget ($)" type="number" min="0" step="0.01"
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          </div>
          <input value={form.target_audience} onChange={(e) => setForm({ ...form, target_audience: e.target.value })} placeholder="Target audience"
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-[var(--anka-text-secondary)]">Start
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
            </label>
            <label className="text-xs text-[var(--anka-text-secondary)]">End
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
            </label>
          </div>
          <button type="submit" className="w-full py-2 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            Create Campaign
          </button>
        </form>
      </div>
    );
  }

  // ─── Detail View ────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    const progress = selected.budget > 0 ? Math.min((selected.spent / selected.budget) * 100, 100) : 0;
    return (
      <div className="h-full overflow-y-auto p-4">
        <button onClick={() => setView('list')} className="text-[var(--anka-text-secondary)] text-sm mb-4 hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              {CHANNEL_ICONS[selected.channel]} {selected.name}
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
          </div>
          <button onClick={() => deleteCampaign(selected.id)} className="text-red-400 text-xs hover:text-red-300 cursor-pointer">Delete</button>
        </div>

        {selected.description && <p className="text-sm text-[var(--anka-text-secondary)] mb-4">{selected.description}</p>}
        {selected.target_audience && <p className="text-xs text-[var(--anka-text-secondary)] mb-3">🎯 {selected.target_audience}</p>}

        {/* Budget bar */}
        {selected.budget > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-[var(--anka-text-secondary)] mb-1">
              <span>Budget</span>
              <span>${Number(selected.spent || 0).toLocaleString()} / ${Number(selected.budget).toLocaleString()}</span>
            </div>
            <div className="h-2 bg-[var(--anka-bg-secondary)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--anka-accent)] rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Dates */}
        {(selected.start_date || selected.end_date) && (
          <p className="text-xs text-[var(--anka-text-secondary)] mb-4">
            📅 {selected.start_date || '?'} → {selected.end_date || 'ongoing'}
          </p>
        )}

        {/* Status actions */}
        <div className="flex flex-wrap gap-2 mt-4">
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
