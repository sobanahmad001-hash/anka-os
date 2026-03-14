import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function NotesApp() {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (data) setNotes(data);
  }

  async function saveNote() {
    setSaving(true);
    if (activeNote) {
      await supabase
        .from('notes')
        .update({ title, content, updated_at: new Date().toISOString() })
        .eq('id', activeNote.id);
    } else {
      const { data } = await supabase
        .from('notes')
        .insert([{ title, content, user_id: user.id }])
        .select()
        .single();
      if (data) setActiveNote(data);
    }
    await loadNotes();
    setSaving(false);
  }

  function selectNote(note) {
    setActiveNote(note);
    setTitle(note.title);
    setContent(note.content);
  }

  function newNote() {
    setActiveNote(null);
    setTitle('');
    setContent('');
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 bg-[var(--anka-bg-secondary)] border-r border-[var(--anka-border)] flex flex-col">
        <div className="p-3 border-b border-[var(--anka-border)] flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase">Notes</span>
          <button onClick={newNote} className="text-[var(--anka-accent)] hover:text-[var(--anka-accent-hover)] text-lg leading-none cursor-pointer">+</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notes.map((n) => (
            <button
              key={n.id}
              onClick={() => selectNote(n)}
              className={`w-full text-left px-3 py-2 text-sm border-b border-[var(--anka-border)] hover:bg-[var(--anka-bg-tertiary)] transition cursor-pointer ${
                activeNote?.id === n.id ? 'bg-[var(--anka-accent)]/10 text-[var(--anka-accent)]' : 'text-[var(--anka-text-secondary)]'
              }`}
            >
              <div className="font-medium truncate">{n.title || 'Untitled'}</div>
              <div className="text-[10px] opacity-60 truncate">{n.content?.slice(0, 50)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title..."
          className="text-lg font-semibold bg-transparent border-none outline-none text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)]/40 mb-3"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Start writing..."
          className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)]/40 resize-none leading-relaxed"
        />
        <div className="flex justify-end pt-3 border-t border-[var(--anka-border)]">
          <button
            onClick={saveNote}
            disabled={saving}
            className="px-4 py-2 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs font-medium rounded-lg transition disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
