import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const METHOD_COLORS = {
  GET: 'bg-green-500/20 text-green-400',
  POST: 'bg-blue-500/20 text-blue-400',
  PUT: 'bg-yellow-500/20 text-yellow-400',
  PATCH: 'bg-orange-500/20 text-orange-400',
  DELETE: 'bg-red-500/20 text-red-400',
  WS: 'bg-purple-500/20 text-purple-400',
};

export default function ApiDocsApp() {
  const { user } = useAuth();
  const [docs, setDocs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState('list'); // list | create | detail | edit
  const [selected, setSelected] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    title: '', content: '', method: 'GET', endpoint: '', category: 'general', project_id: '',
  });

  useEffect(() => {
    loadDocs();
    loadProjects();
  }, []);

  async function loadDocs() {
    setLoading(true);
    const { data } = await supabase
      .from('api_docs')
      .select('*, profiles:created_by(full_name), projects:project_id(name)')
      .order('category')
      .order('title');
    setDocs(data || []);
    setLoading(false);
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, name').order('name');
    setProjects(data || []);
  }

  async function createDoc(e) {
    e.preventDefault();
    const { error } = await supabase.from('api_docs').insert([{
      ...form,
      created_by: user.id,
      project_id: form.project_id || null,
    }]);
    if (!error) {
      setForm({ title: '', content: '', method: 'GET', endpoint: '', category: 'general', project_id: '' });
      setView('list');
      loadDocs();
    }
  }

  async function updateDoc(e) {
    e.preventDefault();
    if (!selected) return;
    const { error } = await supabase.from('api_docs').update({
      title: form.title,
      content: form.content,
      method: form.method,
      endpoint: form.endpoint,
      category: form.category,
      project_id: form.project_id || null,
      updated_at: new Date().toISOString(),
    }).eq('id', selected.id);
    if (!error) {
      setView('list');
      setSelected(null);
      loadDocs();
    }
  }

  async function deleteDoc(id) {
    await supabase.from('api_docs').delete().eq('id', id);
    setView('list');
    setSelected(null);
    loadDocs();
  }

  function startEdit(doc) {
    setSelected(doc);
    setForm({
      title: doc.title, content: doc.content, method: doc.method,
      endpoint: doc.endpoint, category: doc.category, project_id: doc.project_id || '',
    });
    setView('edit');
  }

  // Derive categories
  const categories = [...new Set(docs.map((d) => d.category))].sort();

  const filtered = docs.filter((d) => {
    if (filterCategory !== 'all' && d.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return d.title.toLowerCase().includes(q) || d.endpoint.toLowerCase().includes(q);
    }
    return true;
  });

  // Group by category
  const grouped = {};
  filtered.forEach((d) => {
    if (!grouped[d.category]) grouped[d.category] = [];
    grouped[d.category].push(d);
  });

  // ─── List View ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">📚 API Docs</h2>
          <button onClick={() => { setForm({ title: '', content: '', method: 'GET', endpoint: '', category: 'general', project_id: '' }); setView('create'); }}
            className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            + New Doc
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search endpoints..."
            className="flex-1 px-3 py-1.5 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-xs focus:outline-none focus:border-[var(--anka-accent)]" />
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
            className="px-2 py-1.5 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-xs focus:outline-none">
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {loading ? (
          <p className="text-[var(--anka-text-secondary)] text-sm">Loading...</p>
        ) : Object.keys(grouped).length === 0 ? (
          <p className="text-[var(--anka-text-secondary)] text-sm mt-8 text-center">No docs yet. Create your first endpoint documentation.</p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4">
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase tracking-wider mb-2">{cat}</h3>
                <div className="space-y-1">
                  {items.map((doc) => (
                    <div key={doc.id} onClick={() => { setSelected(doc); setView('detail'); }}
                      className="flex items-center gap-3 p-2.5 bg-[var(--anka-bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--anka-bg-tertiary)] transition"
                    >
                      <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${METHOD_COLORS[doc.method]}`}>
                        {doc.method}
                      </span>
                      <code className="text-xs text-[var(--anka-accent)] flex-1 font-mono truncate">{doc.endpoint || '—'}</code>
                      <span className="text-xs text-[var(--anka-text-secondary)] truncate max-w-40">{doc.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Create / Edit View ─────────────────────────────────────────────────────
  if (view === 'create' || view === 'edit') {
    const isEdit = view === 'edit';
    return (
      <div className="h-full overflow-y-auto p-4">
        <button onClick={() => setView('list')} className="text-[var(--anka-text-secondary)] text-sm mb-4 hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        <h2 className="text-lg font-bold mb-4">{isEdit ? 'Edit Doc' : 'New API Doc'}</h2>
        <form onSubmit={isEdit ? updateDoc : createDoc} className="space-y-3 max-w-lg">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (e.g. Get User Profile)" required
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          <div className="flex gap-2">
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm font-mono focus:outline-none focus:border-[var(--anka-accent)]">
              {Object.keys(METHOD_COLORS).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder="/api/v1/users/:id"
              className="flex-1 px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm font-mono focus:outline-none focus:border-[var(--anka-accent)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category (e.g. auth, users)"
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
            <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]">
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Documentation content (supports markdown)..." rows={12}
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm font-mono focus:outline-none focus:border-[var(--anka-accent)] resize-none" />
          <button type="submit" className="w-full py-2 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            {isEdit ? 'Save Changes' : 'Create Doc'}
          </button>
        </form>
      </div>
    );
  }

  // ─── Detail View ────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setView('list')} className="text-[var(--anka-text-secondary)] text-sm hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
          <div className="flex-1" />
          <button onClick={() => startEdit(selected)} className="text-xs text-[var(--anka-accent)] hover:underline cursor-pointer">Edit</button>
          <button onClick={() => deleteDoc(selected.id)} className="text-red-400 text-xs hover:text-red-300 cursor-pointer">Delete</button>
        </div>

        <div className="flex items-center gap-3 mb-2">
          <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${METHOD_COLORS[selected.method]}`}>{selected.method}</span>
          <code className="text-sm text-[var(--anka-accent)] font-mono">{selected.endpoint || '—'}</code>
        </div>

        <h2 className="text-lg font-bold mb-1">{selected.title}</h2>
        <div className="flex items-center gap-3 text-xs text-[var(--anka-text-secondary)] mb-4">
          <span>Category: {selected.category}</span>
          {selected.projects?.name && <span>📋 {selected.projects.name}</span>}
          <span>By {selected.profiles?.full_name || 'Unknown'}</span>
        </div>

        {selected.content ? (
          <pre className="p-4 bg-[var(--anka-bg-secondary)] rounded-lg text-sm whitespace-pre-wrap font-mono overflow-y-auto max-h-[60vh]">
            {selected.content}
          </pre>
        ) : (
          <p className="text-sm text-[var(--anka-text-secondary)]">No documentation content yet.</p>
        )}
      </div>
    );
  }

  return null;
}
