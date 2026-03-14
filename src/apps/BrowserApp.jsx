import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function BrowserApp() {
  const { user } = useAuth();
  const [url, setUrl] = useState('https://ankastudio.com');
  const [inputUrl, setInputUrl] = useState(url);
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [bmForm, setBmForm] = useState({ title: '', folder: 'General' });

  useEffect(() => { loadBookmarks(); }, []);

  async function loadBookmarks() {
    const { data } = await supabase.from('bookmarks')
      .select('*').eq('user_id', user.id).order('position');
    setBookmarks(data || []);
  }

  function navigate(e) {
    e.preventDefault();
    let target = inputUrl.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = `https://${target}`;
    }
    setUrl(target);
    setInputUrl(target);
  }

  async function addBookmark(e) {
    e.preventDefault();
    await supabase.from('bookmarks').insert([{
      user_id: user.id,
      title: bmForm.title || new URL(url).hostname,
      url,
      folder: bmForm.folder || 'General',
    }]);
    setBmForm({ title: '', folder: 'General' });
    loadBookmarks();
  }

  async function removeBookmark(id) {
    await supabase.from('bookmarks').delete().eq('id', id);
    loadBookmarks();
  }

  function goToBookmark(bm) {
    setUrl(bm.url);
    setInputUrl(bm.url);
    setShowBookmarks(false);
  }

  const folders = [...new Set(bookmarks.map((b) => b.folder))];

  return (
    <div className="h-full flex flex-col">
      {/* URL bar */}
      <form
        onSubmit={navigate}
        className="flex items-center gap-2 px-3 py-2 bg-[var(--anka-bg-secondary)] border-b border-[var(--anka-border)]"
      >
        <button
          type="button"
          onClick={() => { setUrl('https://ankastudio.com'); setInputUrl('https://ankastudio.com'); }}
          className="text-xs px-2 py-1 rounded hover:bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)] transition cursor-pointer"
          title="Home"
        >
          🏠
        </button>
        <button
          type="button"
          onClick={() => setShowBookmarks(!showBookmarks)}
          className={`text-xs px-2 py-1 rounded hover:bg-[var(--anka-bg-tertiary)] transition cursor-pointer ${showBookmarks ? 'text-[var(--anka-accent)]' : 'text-[var(--anka-text-secondary)]'}`}
          title="Bookmarks"
        >
          ⭐
        </button>
        <input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          className="flex-1 px-3 py-1.5 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-xs text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
          placeholder="Enter URL..."
        />
        <button
          type="submit"
          className="text-xs px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white rounded-lg transition cursor-pointer"
        >
          Go
        </button>
      </form>

      {/* Bookmarks panel */}
      {showBookmarks && (
        <div className="bg-[var(--anka-bg-secondary)] border-b border-[var(--anka-border)] p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase">Bookmarks</h3>
            <form onSubmit={addBookmark} className="flex gap-1">
              <input value={bmForm.title} onChange={(e) => setBmForm({...bmForm, title: e.target.value})}
                placeholder="Title" className="px-2 py-1 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded text-xs w-24 focus:outline-none" />
              <input value={bmForm.folder} onChange={(e) => setBmForm({...bmForm, folder: e.target.value})}
                placeholder="Folder" className="px-2 py-1 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded text-xs w-20 focus:outline-none" />
              <button type="submit" className="px-2 py-1 bg-[var(--anka-accent)] text-white rounded text-xs cursor-pointer hover:brightness-110">+ Add</button>
            </form>
          </div>
          {bookmarks.length === 0 && <p className="text-xs text-[var(--anka-text-secondary)]">No bookmarks. Add the current page above.</p>}
          {folders.map((folder) => (
            <div key={folder} className="mb-2">
              <div className="text-xs font-medium text-[var(--anka-text-secondary)] mb-1">📁 {folder}</div>
              <div className="flex flex-wrap gap-1">
                {bookmarks.filter((b) => b.folder === folder).map((bm) => (
                  <div key={bm.id} className="flex items-center gap-1 bg-[var(--anka-bg-tertiary)] rounded px-2 py-1 group">
                    <button onClick={() => goToBookmark(bm)} className="text-xs text-[var(--anka-text-primary)] hover:text-[var(--anka-accent)] cursor-pointer truncate max-w-32">
                      {bm.title}
                    </button>
                    <button onClick={() => removeBookmark(bm.id)} className="text-xs text-red-400 opacity-0 group-hover:opacity-100 cursor-pointer">✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Iframe */}
      <iframe
        src={url}
        className="flex-1 w-full border-none bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Browser"
      />
    </div>
  );
}
