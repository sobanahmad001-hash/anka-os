import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const LANGUAGES = [
  'text', 'javascript', 'typescript', 'python', 'html', 'css', 'json',
  'sql', 'bash', 'markdown', 'jsx', 'go', 'rust', 'java', 'csharp', 'php', 'ruby', 'yaml', 'xml', 'other',
];

const LANG_COLORS = {
  javascript: '#f7df1e', typescript: '#3178c6', python: '#3776ab', html: '#e34c26',
  css: '#1572b6', json: '#292929', sql: '#e38c00', bash: '#4eaa25', markdown: '#083fa1',
  jsx: '#61dafb', go: '#00add8', rust: '#dea584', java: '#b07219', csharp: '#178600',
  php: '#777bb4', ruby: '#cc342d', yaml: '#cb171e', xml: '#f16529',
};

export default function SnippetsApp() {
  const { user } = useAuth();
  const [snippets, setSnippets] = useState([]);
  const [view, setView] = useState('list'); // list | create | detail
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [copied, setCopied] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', content: '', language: 'javascript', is_shared: false });

  useEffect(() => { loadSnippets(); }, []);

  async function loadSnippets() {
    const { data } = await supabase
      .from('snippets')
      .select('*')
      .or(`user_id.eq.${user.id},is_shared.eq.true`)
      .order('updated_at', { ascending: false });
    if (data) setSnippets(data);
  }

  async function createSnippet(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    await supabase.from('snippets').insert({
      user_id: user.id,
      title: form.title.trim(),
      description: form.description.trim(),
      content: form.content,
      language: form.language,
      is_shared: form.is_shared,
    });
    setForm({ title: '', description: '', content: '', language: 'javascript', is_shared: false });
    setView('list');
    loadSnippets();
  }

  async function deleteSnippet(id) {
    await supabase.from('snippets').delete().eq('id', id);
    setView('list');
    setSelected(null);
    loadSnippets();
  }

  async function copySnippet(snippet) {
    await navigator.clipboard.writeText(snippet.content);
    setCopied(snippet.id);
    setTimeout(() => setCopied(null), 2000);
    // Increment copy count
    await supabase.from('snippets').update({ copy_count: (snippet.copy_count || 0) + 1 }).eq('id', snippet.id);
  }

  const filtered = snippets.filter((s) => {
    const q = search.toLowerCase();
    const textMatch = !q || s.title.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q) || s.content.toLowerCase().includes(q);
    const langMatch = !langFilter || s.language === langFilter;
    return textMatch && langMatch;
  });

  // List view
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col p-4 gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold">Snippets</h2>
          <span className="text-[10px] text-[var(--anka-text-secondary)] bg-[var(--anka-bg-secondary)] px-2 py-0.5 rounded-full">{filtered.length}</span>
          <button onClick={() => setView('create')}
            className="ml-auto text-xs px-3 py-1 rounded-lg bg-[var(--anka-accent)] text-white hover:brightness-110 transition cursor-pointer">
            + New Snippet
          </button>
        </div>

        <div className="flex gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search snippets..."
            className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
          <select value={langFilter} onChange={(e) => setLangFilter(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]">
            <option value="">All Languages</option>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {filtered.length === 0 && (
            <p className="text-xs text-[var(--anka-text-secondary)] text-center py-8">No snippets yet</p>
          )}
          {filtered.map((s) => (
            <div key={s.id} onClick={() => { setSelected(s); setView('detail'); }}
              className="p-3 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] hover:border-[var(--anka-accent)]/40 transition cursor-pointer group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: LANG_COLORS[s.language] || '#666' }} />
                    <span className="text-xs font-medium truncate">{s.title}</span>
                  </div>
                  {s.description && <p className="text-[10px] text-[var(--anka-text-secondary)] truncate mt-0.5 pl-4">{s.description}</p>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--anka-bg-primary)] text-[var(--anka-text-secondary)]">{s.language}</span>
                  {s.is_shared && <span className="text-[9px] text-[var(--anka-accent)]">shared</span>}
                  <button onClick={(e) => { e.stopPropagation(); copySnippet(s); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--anka-bg-primary)] text-[var(--anka-text-secondary)] hover:text-[var(--anka-accent)] opacity-0 group-hover:opacity-100 transition cursor-pointer">
                    {copied === s.id ? '✓' : '📋'}
                  </button>
                </div>
              </div>
              <pre className="mt-2 text-[10px] text-[var(--anka-text-secondary)] font-mono bg-[var(--anka-bg-primary)] rounded p-2 overflow-hidden max-h-16 leading-relaxed">
                {s.content.slice(0, 200)}{s.content.length > 200 ? '...' : ''}
              </pre>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Create view
  if (view === 'create') {
    return (
      <div className="h-full flex flex-col p-4 gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setView('list')} className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">←</button>
          <h2 className="text-sm font-bold">New Snippet</h2>
        </div>
        <form onSubmit={createSnippet} className="flex-1 flex flex-col gap-3 overflow-y-auto">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Snippet title"
            className="text-xs px-3 py-2 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description (optional)"
            className="text-xs px-3 py-2 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
          <div className="flex gap-2">
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}
              className="text-xs px-2 py-1.5 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]">
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-[var(--anka-text-secondary)]">
              <input type="checkbox" checked={form.is_shared} onChange={(e) => setForm({ ...form, is_shared: e.target.checked })} />
              Share with team
            </label>
          </div>
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="Paste your code/text here..."
            className="flex-1 min-h-[200px] text-xs px-3 py-2 rounded-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)] font-mono resize-none" />
          <button type="submit" className="text-xs px-4 py-2 rounded-lg bg-[var(--anka-accent)] text-white cursor-pointer hover:brightness-110 transition">Save Snippet</button>
        </form>
      </div>
    );
  }

  // Detail view
  if (view === 'detail' && selected) {
    const isOwner = selected.user_id === user.id;
    return (
      <div className="h-full flex flex-col p-4 gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => { setView('list'); setSelected(null); }} className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">←</button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold truncate">{selected.title}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: LANG_COLORS[selected.language] || '#666' }} />
              <span className="text-[10px] text-[var(--anka-text-secondary)]">{selected.language}</span>
              {selected.is_shared && <span className="text-[10px] text-[var(--anka-accent)]">shared</span>}
              <span className="text-[10px] text-[var(--anka-text-secondary)]">📋 {selected.copy_count} copies</span>
            </div>
          </div>
          <button onClick={() => copySnippet(selected)}
            className="text-xs px-3 py-1 rounded-lg bg-[var(--anka-accent)] text-white cursor-pointer hover:brightness-110 transition">
            {copied === selected.id ? '✓ Copied' : 'Copy'}
          </button>
          {isOwner && (
            <button onClick={() => deleteSnippet(selected.id)}
              className="text-xs px-3 py-1 rounded-lg bg-red-500/20 text-red-400 cursor-pointer hover:bg-red-500/30 transition">Delete</button>
          )}
        </div>
        {selected.description && (
          <p className="text-xs text-[var(--anka-text-secondary)]">{selected.description}</p>
        )}
        <pre className="flex-1 text-xs font-mono bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg p-4 overflow-auto whitespace-pre-wrap leading-relaxed">
          {selected.content}
        </pre>
      </div>
    );
  }

  return null;
}
