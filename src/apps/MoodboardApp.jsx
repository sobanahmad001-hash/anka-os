import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const ITEM_TYPES = ['image', 'color', 'note', 'link'];
const TYPE_ICONS = { image: '🖼️', color: '🎨', note: '📌', link: '🔗' };

export default function MoodboardApp() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filterProject, setFilterProject] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    item_type: 'note', title: '', content: '', image_url: '', project_id: '',
  });

  useEffect(() => {
    loadItems();
    loadProjects();
  }, []);

  async function loadItems() {
    setLoading(true);
    const { data } = await supabase
      .from('moodboard_items')
      .select('*, profiles:created_by(full_name), projects:project_id(name)')
      .order('created_at', { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, name').order('name');
    setProjects(data || []);
  }

  async function addItem(e) {
    e.preventDefault();
    const { error } = await supabase.from('moodboard_items').insert([{
      ...form,
      created_by: user.id,
      project_id: form.project_id || null,
    }]);
    if (!error) {
      setForm({ item_type: 'note', title: '', content: '', image_url: '', project_id: '' });
      setShowAdd(false);
      loadItems();
    }
  }

  async function deleteItem(id) {
    await supabase.from('moodboard_items').delete().eq('id', id);
    loadItems();
  }

  const filtered = filterProject === 'all' ? items : items.filter((i) => i.project_id === filterProject);

  function renderItem(item) {
    switch (item.item_type) {
      case 'color':
        return (
          <div className="flex flex-col items-center gap-2">
            <div className="w-full h-24 rounded-lg border border-[var(--anka-border)]" style={{ backgroundColor: item.content || '#6c5ce7' }} />
            <span className="text-[10px] text-[var(--anka-text-secondary)] font-mono">{item.content}</span>
          </div>
        );
      case 'image':
        return item.image_url ? (
          <img src={item.image_url} alt={item.title} className="w-full h-32 object-cover rounded-lg" />
        ) : (
          <div className="w-full h-24 bg-[var(--anka-bg-tertiary)] rounded-lg flex items-center justify-center text-2xl">🖼️</div>
        );
      case 'link':
        return (
          <div className="flex items-center gap-2 p-2 bg-[var(--anka-bg-tertiary)] rounded-lg">
            <span className="text-lg">🔗</span>
            <span className="text-xs text-[var(--anka-accent)] truncate">{item.content}</span>
          </div>
        );
      case 'note':
      default:
        return (
          <p className="text-xs text-[var(--anka-text-secondary)] line-clamp-4 whitespace-pre-wrap">{item.content}</p>
        );
    }
  }

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">🎨 Moodboard</h2>
        <div className="flex items-center gap-2">
          <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
            className="px-2 py-1 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-xs focus:outline-none">
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            + Add
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={addItem} className="mb-4 p-3 bg-[var(--anka-bg-secondary)] rounded-lg space-y-2">
          <div className="flex gap-2">
            <select value={form.item_type} onChange={(e) => setForm({ ...form, item_type: e.target.value })}
              className="px-2 py-1.5 bg-[var(--anka-bg-tertiary)] rounded-lg border border-[var(--anka-border)] text-xs">
              {ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
            </select>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (optional)"
              className="flex-1 px-2 py-1.5 bg-[var(--anka-bg-tertiary)] rounded-lg border border-[var(--anka-border)] text-xs focus:outline-none focus:border-[var(--anka-accent)]" />
            <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
              className="px-2 py-1.5 bg-[var(--anka-bg-tertiary)] rounded-lg border border-[var(--anka-border)] text-xs">
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {form.item_type === 'image' && (
            <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="Image URL"
              className="w-full px-2 py-1.5 bg-[var(--anka-bg-tertiary)] rounded-lg border border-[var(--anka-border)] text-xs focus:outline-none focus:border-[var(--anka-accent)]" />
          )}
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder={form.item_type === 'color' ? '#6c5ce7' : form.item_type === 'link' ? 'https://...' : 'Your note...'}
            rows={2} className="w-full px-2 py-1.5 bg-[var(--anka-bg-tertiary)] rounded-lg border border-[var(--anka-border)] text-xs focus:outline-none focus:border-[var(--anka-accent)] resize-none" />
          <button type="submit" className="px-4 py-1.5 bg-[var(--anka-accent)] text-white text-xs rounded-lg hover:brightness-110 transition cursor-pointer">
            Add to Board
          </button>
        </form>
      )}

      {/* Board grid */}
      {loading ? (
        <p className="text-[var(--anka-text-secondary)] text-sm">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[var(--anka-text-secondary)] text-sm">
          No items yet. Add inspiration to your board!
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((item) => (
              <div key={item.id} className="p-3 bg-[var(--anka-bg-secondary)] rounded-lg group relative">
                <button onClick={() => deleteItem(item.id)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 text-white text-[10px] items-center justify-center hidden group-hover:flex cursor-pointer">
                  ×
                </button>
                {item.title && <div className="text-xs font-medium mb-1.5 flex items-center gap-1">{TYPE_ICONS[item.item_type]} {item.title}</div>}
                {renderItem(item)}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-[var(--anka-text-secondary)]">{item.profiles?.full_name}</span>
                  {item.projects?.name && <span className="text-[10px] text-[var(--anka-accent)]">{item.projects.name}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
