import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

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
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center"
      style={{ paddingTop: '18vh' }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />

      {/* Search panel */}
      <div
        className="anka-glass-heavy anka-scale-in"
        style={{
          position: 'relative', width: '100%', maxWidth: 560,
          borderRadius: 16, border: '1px solid var(--anka-border)',
          boxShadow: 'var(--anka-shadow-xl), var(--anka-shadow-glow)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--anka-border-subtle)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, projects, notes, wiki, clients..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 14, color: 'var(--anka-text-primary)', letterSpacing: '-0.01em',
            }}
          />
          <kbd style={{
            fontSize: 10, color: 'var(--anka-text-tertiary)', background: 'var(--anka-bg-surface)',
            padding: '3px 8px', borderRadius: 6, border: '1px solid var(--anka-border)',
          }}>
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: '16px 18px', fontSize: 12, color: 'var(--anka-text-tertiary)' }}>
              Searching...
            </div>
          )}
          {!loading && query && results.length === 0 && (
            <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 13, color: 'var(--anka-text-tertiary)' }}>
              No results found
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => selectResult(r)}
              className="cursor-pointer"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px',
                textAlign: 'left', border: 'none', color: 'inherit',
                background: i === selectedIdx ? 'var(--anka-accent-muted)' : 'transparent',
                transition: 'all 0.1s ease',
              }}
              onMouseEnter={(e) => { setSelectedIdx(i); e.currentTarget.style.background = 'var(--anka-accent-muted)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{r.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                <div style={{ fontSize: 11, color: 'var(--anka-text-tertiary)', textTransform: 'capitalize', marginTop: 1 }}>{r.type} · {r.sub}</div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--anka-text-tertiary)' }}>↵</span>
            </button>
          ))}
        </div>

        {/* Footer hints */}
        {results.length > 0 && (
          <div style={{ padding: '8px 18px', borderTop: '1px solid var(--anka-border-subtle)', display: 'flex', gap: 16, fontSize: 10, color: 'var(--anka-text-tertiary)' }}>
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>ESC Close</span>
          </div>
        )}
      </div>
    </div>
  );
}
