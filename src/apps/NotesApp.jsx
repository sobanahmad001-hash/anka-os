import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const FOLDER_COLORS = ['#6c5ce7', '#00b894', '#e17055', '#0984e3', '#fdcb6e', '#e84393', '#00cec9', '#636e72'];

export default function NotesApp() {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null); // null = all, 'none' = unfiled, uuid = folder
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#6c5ce7');

  useEffect(() => {
    loadNotes();
    loadFolders();
  }, []);

  async function loadNotes() {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (data) setNotes(data);
  }

  async function loadFolders() {
    const { data } = await supabase
      .from('note_folders')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order');
    if (data) setFolders(data);
  }

  async function saveNote() {
    setSaving(true);
    const folderId = activeFolder && activeFolder !== 'none' ? activeFolder : null;
    if (activeNote) {
      await supabase
        .from('notes')
        .update({ title, content, folder_id: folderId, updated_at: new Date().toISOString() })
        .eq('id', activeNote.id);
    } else {
      const { data } = await supabase
        .from('notes')
        .insert([{ title, content, user_id: user.id, folder_id: folderId }])
        .select()
        .single();
      if (data) setActiveNote(data);
    }
    await loadNotes();
    setSaving(false);
  }

  async function deleteNote() {
    if (!activeNote) return;
    await supabase.from('notes').delete().eq('id', activeNote.id);
    setActiveNote(null);
    setTitle('');
    setContent('');
    loadNotes();
  }

  async function createFolder(e) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await supabase.from('note_folders').insert({
      user_id: user.id,
      name: newFolderName.trim(),
      color: newFolderColor,
      sort_order: folders.length,
    });
    setNewFolderName('');
    setShowNewFolder(false);
    loadFolders();
  }

  async function deleteFolder(folderId) {
    // Unfiled all notes in folder first
    await supabase.from('notes').update({ folder_id: null }).eq('folder_id', folderId);
    await supabase.from('note_folders').delete().eq('id', folderId);
    if (activeFolder === folderId) setActiveFolder(null);
    loadFolders();
    loadNotes();
  }

  async function moveToFolder(noteId, folderId) {
    await supabase.from('notes').update({ folder_id: folderId || null }).eq('id', noteId);
    if (activeNote?.id === noteId) setActiveNote((n) => ({ ...n, folder_id: folderId || null }));
    loadNotes();
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

  // Filter notes by folder
  const filteredNotes = activeFolder === null
    ? notes
    : activeFolder === 'none'
    ? notes.filter((n) => !n.folder_id)
    : notes.filter((n) => n.folder_id === activeFolder);

  const activeFolderObj = folders.find((f) => f.id === activeFolder);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 bg-[var(--anka-bg-secondary)] border-r border-[var(--anka-border)] flex flex-col">
        {/* Folders section */}
        <div className="p-2 border-b border-[var(--anka-border)]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-bold text-[var(--anka-text-secondary)] uppercase tracking-wider">Folders</span>
            <button onClick={() => setShowNewFolder(!showNewFolder)} className="text-[10px] text-[var(--anka-accent)] cursor-pointer">+</button>
          </div>
          <button onClick={() => setActiveFolder(null)}
            className={`w-full text-left text-[11px] px-2 py-1 rounded transition cursor-pointer ${
              activeFolder === null ? 'bg-[var(--anka-accent)]/10 text-[var(--anka-accent)]' : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
            }`}>📁 All Notes ({notes.length})</button>
          <button onClick={() => setActiveFolder('none')}
            className={`w-full text-left text-[11px] px-2 py-1 rounded transition cursor-pointer ${
              activeFolder === 'none' ? 'bg-[var(--anka-accent)]/10 text-[var(--anka-accent)]' : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
            }`}>📄 Unfiled ({notes.filter((n) => !n.folder_id).length})</button>
          {folders.map((f) => {
            const count = notes.filter((n) => n.folder_id === f.id).length;
            return (
              <div key={f.id} className="flex items-center group">
                <button onClick={() => setActiveFolder(f.id)}
                  className={`flex-1 text-left text-[11px] px-2 py-1 rounded transition cursor-pointer truncate ${
                    activeFolder === f.id ? 'bg-[var(--anka-accent)]/10 text-[var(--anka-accent)]' : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
                  }`}>
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: f.color }} />
                  {f.name} ({count})
                </button>
                <button onClick={() => deleteFolder(f.id)}
                  className="text-[9px] text-[var(--anka-text-secondary)] opacity-0 group-hover:opacity-100 hover:text-red-400 px-1 cursor-pointer">✕</button>
              </div>
            );
          })}
          {showNewFolder && (
            <form onSubmit={createFolder} className="mt-1 flex gap-1">
              <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Folder name"
                className="flex-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--anka-bg-primary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
              <div className="flex gap-0.5">
                {FOLDER_COLORS.slice(0, 4).map((c) => (
                  <button key={c} type="button" onClick={() => setNewFolderColor(c)}
                    className={`w-3 h-3 rounded-full cursor-pointer ${newFolderColor === c ? 'ring-1 ring-white' : ''}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
              <button type="submit" className="text-[10px] text-[var(--anka-accent)] cursor-pointer">✓</button>
            </form>
          )}
        </div>

        {/* Notes list */}
        <div className="p-2 border-b border-[var(--anka-border)] flex items-center justify-between">
          <span className="text-[9px] font-bold text-[var(--anka-text-secondary)] uppercase tracking-wider">
            {activeFolderObj ? activeFolderObj.name : activeFolder === 'none' ? 'Unfiled' : 'All Notes'}
          </span>
          <button onClick={newNote} className="text-[var(--anka-accent)] hover:text-[var(--anka-accent-hover)] text-lg leading-none cursor-pointer">+</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredNotes.map((n) => (
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
          {filteredNotes.length === 0 && (
            <p className="text-[10px] text-[var(--anka-text-secondary)] text-center py-4 opacity-60">No notes</p>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title..."
          className="text-lg font-semibold bg-transparent border-none outline-none text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)]/40 mb-1"
        />
        {/* Folder selector for current note */}
        <div className="flex items-center gap-2 mb-3">
          <select value={activeNote?.folder_id || ''} onChange={(e) => {
            const fid = e.target.value;
            if (activeNote) moveToFolder(activeNote.id, fid || null);
          }}
            className="text-[10px] px-2 py-0.5 rounded bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-secondary)]">
            <option value="">No folder</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {activeNote && (
            <button onClick={deleteNote}
              className="text-[10px] text-red-400/60 hover:text-red-400 transition cursor-pointer ml-auto">Delete note</button>
          )}
        </div>
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
