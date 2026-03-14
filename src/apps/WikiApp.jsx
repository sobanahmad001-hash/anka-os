import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function WikiApp() {
  const { user, profile } = useAuth();
  const [pages, setPages] = useState([]);
  const [view, setView] = useState('list'); // list | create | detail | edit
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [form, setForm] = useState({
    title: '', content: '', icon: '📄', tags: '', department: '', parent_id: '', is_published: true,
  });

  const canAdmin = ['admin', 'department_head'].includes(profile?.role);

  useEffect(() => { loadPages(); }, []);

  async function loadPages() {
    setLoading(true);
    const { data } = await supabase.from('wiki_pages')
      .select('*, profiles:created_by(full_name)')
      .order('updated_at', { ascending: false });
    setPages(data || []);
    setLoading(false);
  }

  async function createPage(e) {
    e.preventDefault();
    const { error } = await supabase.from('wiki_pages').insert([{
      title: form.title,
      content: form.content,
      icon: form.icon || '📄',
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      department: form.department || null,
      parent_id: form.parent_id || null,
      is_published: form.is_published,
      slug: form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      created_by: user.id,
    }]);
    if (!error) {
      resetForm();
      setView('list');
      loadPages();
    }
  }

  async function updatePage(e) {
    e.preventDefault();
    await supabase.from('wiki_pages').update({
      title: form.title,
      content: form.content,
      icon: form.icon,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      department: form.department || null,
      is_published: form.is_published,
      slug: form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      updated_at: new Date().toISOString(),
    }).eq('id', selected.id);
    loadPages();
    setView('list');
    setSelected(null);
    resetForm();
  }

  async function deletePage(id) {
    await supabase.from('wiki_pages').delete().eq('id', id);
    setView('list'); setSelected(null);
    loadPages();
  }

  function resetForm() {
    setForm({ title: '', content: '', icon: '📄', tags: '', department: '', parent_id: '', is_published: true });
  }

  function openDetail(page) {
    setSelected(page);
    setView('detail');
  }

  function startEdit(page) {
    setSelected(page);
    setForm({
      title: page.title,
      content: page.content,
      icon: page.icon || '📄',
      tags: (page.tags || []).join(', '),
      department: page.department || '',
      parent_id: page.parent_id || '',
      is_published: page.is_published,
    });
    setView('edit');
  }

  const filtered = pages.filter((p) =>
    !search || p.title.toLowerCase().includes(search.toLowerCase())
    || (p.tags || []).some((t) => t.toLowerCase().includes(search.toLowerCase()))
    || (p.content || '').toLowerCase().includes(search.toLowerCase())
  );

  // Group by parent
  const rootPages = filtered.filter((p) => !p.parent_id);
  const childPages = filtered.filter((p) => p.parent_id);

  // ─── List View ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">📖 Wiki</h2>
          <button onClick={() => { resetForm(); setView('create'); }}
            className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            + New Page
          </button>
        </div>

        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search wiki..."
          className="w-full px-3 py-2 mb-4 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--anka-accent)]" />

        {loading ? <p className="text-sm text-[var(--anka-text-secondary)]">Loading...</p> : (
          <div className="flex-1 overflow-y-auto space-y-2">
            {rootPages.length === 0 && <p className="text-sm text-[var(--anka-text-secondary)]">No pages yet. Start documenting!</p>}
            {rootPages.map((page) => (
              <div key={page.id}>
                <PageCard page={page} onClick={() => openDetail(page)} />
                {/* Children */}
                {childPages.filter((c) => c.parent_id === page.id).map((child) => (
                  <div key={child.id} className="ml-6 mt-1">
                    <PageCard page={child} onClick={() => openDetail(child)} />
                  </div>
                ))}
              </div>
            ))}
            {/* Orphan children (parent not in filtered) */}
            {childPages.filter((c) => !rootPages.some((r) => r.id === c.parent_id)).map((page) => (
              <PageCard key={page.id} page={page} onClick={() => openDetail(page)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Create / Edit View ────────────────────────────────────────────────────
  if (view === 'create' || view === 'edit') {
    const isEdit = view === 'edit';
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{isEdit ? 'Edit Page' : 'New Page'}</h2>
          <button onClick={() => { setView('list'); resetForm(); setSelected(null); }}
            className="text-sm text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        </div>
        <form onSubmit={isEdit ? updatePage : createPage} className="flex-1 flex flex-col space-y-3 overflow-hidden">
          <div className="flex gap-2">
            <input value={form.icon} onChange={(e) => setForm({...form, icon: e.target.value})}
              className="w-14 px-2 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-center text-lg focus:outline-none"
              maxLength={4} />
            <input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})}
              placeholder="Page title" required
              className="flex-1 px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          </div>
          <textarea value={form.content} onChange={(e) => setForm({...form, content: e.target.value})}
            placeholder="Write your content here... (Markdown supported)"
            className="flex-1 px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--anka-accent)] resize-none font-mono" />
          <div className="grid grid-cols-3 gap-2">
            <input value={form.tags} onChange={(e) => setForm({...form, tags: e.target.value})}
              placeholder="Tags (comma separated)"
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none" />
            <select value={form.department} onChange={(e) => setForm({...form, department: e.target.value})}
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none">
              <option value="">All departments</option>
              <option value="design">Design</option>
              <option value="development">Development</option>
              <option value="marketing">Marketing</option>
            </select>
            {!isEdit && (
              <select value={form.parent_id} onChange={(e) => setForm({...form, parent_id: e.target.value})}
                className="px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none">
                <option value="">No parent (root page)</option>
                {pages.filter((p) => !p.parent_id).map((p) => (
                  <option key={p.id} value={p.id}>{p.icon} {p.title}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-[var(--anka-text-secondary)] cursor-pointer">
              <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({...form, is_published: e.target.checked})}
                className="accent-[var(--anka-accent)]" />
              Published
            </label>
            <button type="submit"
              className="px-6 py-2 bg-[var(--anka-accent)] text-white rounded-lg hover:brightness-110 transition text-sm cursor-pointer">
              {isEdit ? 'Save Changes' : 'Create Page'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ─── Detail View ───────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    const canEdit = selected.created_by === user.id || canAdmin;
    return (
      <div className="h-full flex flex-col p-4 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => { setView('list'); setSelected(null); }}
            className="text-sm text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
          <div className="flex gap-2">
            {canEdit && (
              <>
                <button onClick={() => startEdit(selected)}
                  className="px-3 py-1.5 bg-[var(--anka-bg-secondary)] text-[var(--anka-text-primary)] text-sm rounded-lg hover:bg-[var(--anka-bg-tertiary)] transition cursor-pointer">
                  ✏️ Edit
                </button>
                <button onClick={() => deletePage(selected.id)}
                  className="px-3 py-1.5 bg-red-600/20 text-red-400 text-sm rounded-lg hover:bg-red-600/30 transition cursor-pointer">
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{selected.icon || '📄'}</span>
            <h1 className="text-xl font-bold">{selected.title}</h1>
          </div>
          <div className="flex gap-3 text-xs text-[var(--anka-text-secondary)] mb-4">
            <span>By {selected.profiles?.full_name || 'Unknown'}</span>
            <span>Updated {new Date(selected.updated_at).toLocaleDateString()}</span>
            {selected.department && <span className="capitalize px-2 py-0.5 rounded-full bg-[var(--anka-accent)]/10 text-[var(--anka-accent)]">{selected.department}</span>}
            {!selected.is_published && <span className="text-yellow-400">Draft</span>}
          </div>
          {(selected.tags || []).length > 0 && (
            <div className="flex gap-1 mb-4 flex-wrap">
              {selected.tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)]">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-5 text-sm leading-relaxed whitespace-pre-wrap">
            {selected.content || 'No content yet.'}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function PageCard({ page, onClick }) {
  return (
    <button onClick={onClick}
      className="w-full text-left bg-[var(--anka-bg-secondary)] rounded-lg p-3 hover:bg-[var(--anka-bg-tertiary)] transition cursor-pointer">
      <div className="flex items-center gap-2 mb-1">
        <span>{page.icon || '📄'}</span>
        <h3 className="font-medium text-sm truncate flex-1">{page.title}</h3>
        {!page.is_published && <span className="text-xs text-yellow-400">Draft</span>}
        {page.department && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--anka-accent)]/10 text-[var(--anka-accent)] capitalize">
            {page.department}
          </span>
        )}
      </div>
      <div className="text-xs text-[var(--anka-text-secondary)] line-clamp-1">
        {page.content?.slice(0, 120) || 'Empty page'}
      </div>
      <div className="flex gap-2 mt-1 text-[10px] text-[var(--anka-text-secondary)]">
        <span>{page.profiles?.full_name || 'Unknown'}</span>
        <span>·</span>
        <span>{new Date(page.updated_at).toLocaleDateString()}</span>
        {(page.tags || []).length > 0 && <span>· {page.tags.join(', ')}</span>}
      </div>
    </button>
  );
}
