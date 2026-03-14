import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Global search overlay — Cmd+K style.
 * Searches across tasks, projects, notes, wiki, clients, campaigns.
 */
export default function GlobalSearch({ onClose, onOpenApp }) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query.trim()), 250);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function search(q) {
    setLoading(true);
    setSelectedIdx(0);
    const pattern = `%${q}%`;

    const [tasksRes, projRes, notesRes, wikiRes, clientsRes, campaignsRes] = await Promise.all([
      supabase.from('tasks').select('id, title, status').eq('user_id', user.id).ilike('title', pattern).limit(5),
      supabase.from('projects').select('id, name, status').ilike('name', pattern).limit(5),
      supabase.from('notes').select('id, title').eq('user_id', user.id).ilike('title', pattern).limit(5),
      supabase.from('wiki_pages').select('id, title, icon').ilike('title', pattern).limit(5),
      supabase.from('clients').select('id, name, company').or(`name.ilike.${pattern},company.ilike.${pattern}`).limit(5),
      supabase.from('campaigns').select('id, name, status').ilike('name', pattern).limit(5),
    ]);

    const merged = [
      ...(tasksRes.data || []).map((t) => ({ type: 'task', icon: '✅', label: t.title, sub: t.status, app: 'tasks', id: t.id })),
      ...(projRes.data || []).map((p) => ({ type: 'project', icon: '📋', label: p.name, sub: p.status, app: 'projects', id: p.id })),
      ...(notesRes.data || []).map((n) => ({ type: 'note', icon: '📝', label: n.title || 'Untitled', sub: 'note', app: 'notes', id: n.id })),
      ...(wikiRes.data || []).map((w) => ({ type: 'wiki', icon: w.icon || '📖', label: w.title, sub: 'wiki', app: 'wiki', id: w.id })),
      ...(clientsRes.data || []).map((c) => ({ type: 'client', icon: '🤝', label: c.name, sub: c.company || 'client', app: 'clients', id: c.id })),
      ...(campaignsRes.data || []).map((c) => ({ type: 'campaign', icon: '📊', label: c.name, sub: c.status, app: 'campaigns', id: c.id })),
    ];
    setResults(merged);
    setLoading(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault();
      selectResult(results[selectedIdx]);
    }
  }

  function selectResult(result) {
    if (onOpenApp) onOpenApp(result.app);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--anka-border)]">
          <span className="text-[var(--anka-text-secondary)]">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, projects, notes, wiki, clients..."
            className="flex-1 bg-transparent text-sm text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none"
          />
          <kbd className="text-[10px] text-[var(--anka-text-secondary)] bg-[var(--anka-bg-tertiary)] px-1.5 py-0.5 rounded border border-[var(--anka-border)]">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && <div className="px-4 py-3 text-xs text-[var(--anka-text-secondary)]">Searching...</div>}
          {!loading && query && results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[var(--anka-text-secondary)]">No results found.</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => selectResult(r)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition cursor-pointer ${
                i === selectedIdx ? 'bg-[var(--anka-accent)]/10' : 'hover:bg-[var(--anka-bg-tertiary)]'
              }`}
            >
              <span className="text-lg">{r.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.label}</div>
                <div className="text-[10px] text-[var(--anka-text-secondary)] capitalize">{r.type} · {r.sub}</div>
              </div>
              <span className="text-xs text-[var(--anka-text-secondary)]">↵</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-[var(--anka-border)] flex gap-4 text-[10px] text-[var(--anka-text-secondary)]">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>ESC Close</span>
          </div>
        )}
      </div>
    </div>
  );
}
