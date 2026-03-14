import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_OPTIONS = ['lead', 'active', 'inactive', 'churned'];

const STATUS_COLORS = {
  lead: 'bg-blue-500',
  active: 'bg-green-500',
  inactive: 'bg-yellow-500',
  churned: 'bg-red-500',
};

export default function ClientsApp() {
  const { user, profile } = useAuth();
  const [clients, setClients] = useState([]);
  const [view, setView] = useState('list');
  const [selectedClient, setSelectedClient] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    industry: '',
    status: 'lead',
    notes: '',
  });

  const canManage = ['admin', 'department_head', 'executive'].includes(profile?.role);

  useEffect(() => {
    loadClients();
  }, []);

  async function loadClients() {
    setLoading(true);
    const { data } = await supabase
      .from('clients')
      .select('*, owner:profiles!owner_id(full_name)')
      .order('created_at', { ascending: false });
    if (data) setClients(data);
    setLoading(false);
  }

  async function createClient(e) {
    e.preventDefault();
    const { error } = await supabase.from('clients').insert([
      { ...form, owner_id: user.id },
    ]);
    if (!error) {
      setView('list');
      setForm({ name: '', email: '', company: '', industry: '', status: 'lead', notes: '' });
      loadClients();
    }
  }

  async function updateClientStatus(clientId, status) {
    await supabase
      .from('clients')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', clientId);
    loadClients();
    if (selectedClient?.id === clientId) {
      setSelectedClient((c) => ({ ...c, status }));
    }
  }

  async function deleteClient(clientId) {
    await supabase.from('clients').delete().eq('id', clientId);
    setView('list');
    setSelectedClient(null);
    loadClients();
  }

  const filtered = clients.filter((c) => {
    const matchStatus = filter === 'all' || c.status === filter;
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.company.toLowerCase().includes(search.toLowerCase()) ||
      (c.email && c.email.toLowerCase().includes(search.toLowerCase()));
    return matchStatus && matchSearch;
  });

  // ─── List View ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">Clients</h3>
            <span className="text-[10px] text-[var(--anka-text-secondary)] bg-[var(--anka-bg-tertiary)] px-2 py-0.5 rounded-full">
              {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="text-xs px-3 py-1.5 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)] w-40"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none"
            >
              <option value="all">All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            {canManage && (
              <button
                onClick={() => setView('create')}
                className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer"
              >
                + New Client
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">
              No clients found.{canManage ? ' Add one to get started.' : ''}
            </div>
          ) : (
            filtered.map((client) => (
              <button
                key={client.id}
                onClick={() => {
                  setSelectedClient(client);
                  setView('detail');
                }}
                className="w-full text-left bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4 hover:border-[var(--anka-accent)]/40 transition cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{client.name}</div>
                    <div className="text-xs text-[var(--anka-text-secondary)] truncate mt-0.5">
                      {client.company || 'No company'}
                      {client.industry ? ` · ${client.industry}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[client.status]}`} />
                    <span className="text-[10px] capitalize text-[var(--anka-text-secondary)]">
                      {client.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-[var(--anka-text-secondary)]">
                  {client.email && <span>✉️ {client.email}</span>}
                  <span>👤 {client.owner?.full_name || 'Unassigned'}</span>
                  <span className="ml-auto">{new Date(client.created_at).toLocaleDateString()}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // ─── Create View ────────────────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center gap-3">
          <button onClick={() => setView('list')} className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">←</button>
          <h3 className="text-sm font-semibold">New Client</h3>
        </div>
        <form onSubmit={createClient} className="flex-1 overflow-y-auto p-6 max-w-lg space-y-4">
          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Client Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
              placeholder="e.g., Acme Corp"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
                placeholder="client@company.com"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Company</label>
              <input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
                placeholder="Company name"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Industry</label>
              <input
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
                placeholder="e.g., Technology"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)] resize-none"
              placeholder="Any notes about this client..."
            />
          </div>
          <button
            type="submit"
            className="w-full py-2.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-sm font-medium rounded-lg transition cursor-pointer"
          >
            Add Client
          </button>
        </form>
      </div>
    );
  }

  // ─── Detail View ────────────────────────────────────────────────────────────
  const client = selectedClient;

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center gap-3">
        <button
          onClick={() => { setView('list'); setSelectedClient(null); }}
          className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{client?.name}</h3>
          <span className="text-[10px] text-[var(--anka-text-secondary)]">
            {client?.company}
            {client?.industry ? ` · ${client.industry}` : ''}
          </span>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <select
              value={client?.status}
              onChange={(e) => updateClientStatus(client.id, e.target.value)}
              className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1 text-[var(--anka-text-primary)] focus:outline-none"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <button
              onClick={() => deleteClient(client.id)}
              className="text-xs px-2 py-1 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition cursor-pointer"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <DetailCard label="Email" value={client?.email || '—'} />
          <DetailCard label="Company" value={client?.company || '—'} />
          <DetailCard label="Industry" value={client?.industry || '—'} />
          <DetailCard label="Status" value={client?.status} />
          <DetailCard label="Owner" value={client?.owner?.full_name || '—'} />
          <DetailCard label="Added" value={client?.created_at ? new Date(client.created_at).toLocaleDateString() : '—'} />
        </div>

        {client?.notes && (
          <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
            <div className="text-[10px] uppercase text-[var(--anka-text-secondary)] font-semibold mb-2">Notes</div>
            <p className="text-sm text-[var(--anka-text-secondary)] leading-relaxed whitespace-pre-wrap">{client.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailCard({ label, value }) {
  return (
    <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase text-[var(--anka-text-secondary)] font-semibold">{label}</div>
      <div className="text-sm capitalize mt-1">{value}</div>
    </div>
  );
}
