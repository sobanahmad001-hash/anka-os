import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function FileManagerApp() {
  const { user } = useAuth();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadFiles();
  }, []);

  async function loadFiles() {
    const { data } = await supabase.storage
      .from('files')
      .list(`${user.id}/`, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
    if (data) setFiles(data);
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const filePath = `${user.id}/${Date.now()}-${file.name}`;
    await supabase.storage.from('files').upload(filePath, file);
    await loadFiles();
    setUploading(false);
  }

  async function handleDownload(fileName) {
    const { data } = await supabase.storage
      .from('files')
      .download(`${user.id}/${fileName}`);
    if (data) {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async function handleDelete(fileName) {
    await supabase.storage.from('files').remove([`${user.id}/${fileName}`]);
    loadFiles();
  }

  function formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(name) {
    const ext = name.split('.').pop()?.toLowerCase();
    const icons = {
      pdf: '📄', doc: '📄', docx: '📄',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
      mp4: '🎬', mov: '🎬', avi: '🎬',
      mp3: '🎵', wav: '🎵',
      zip: '📦', rar: '📦',
      js: '💻', ts: '💻', py: '💻', html: '💻', css: '💻',
      fig: '🎨', sketch: '🎨', psd: '🎨',
    };
    return icons[ext] || '📄';
  }

  return (
    <div className="h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">My Files</h3>
        <label className="px-4 py-2 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs font-medium rounded-lg transition cursor-pointer">
          {uploading ? 'Uploading...' : 'Upload File'}
          <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">
            No files yet. Upload something!
          </div>
        ) : (
          <div className="space-y-1">
            {files.map((file) => (
              <div
                key={file.name}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--anka-bg-secondary)] group"
              >
                <span className="text-xl">{getFileIcon(file.name)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{file.name.replace(/^\d+-/, '')}</div>
                  <div className="text-[10px] text-[var(--anka-text-secondary)]">
                    {formatSize(file.metadata?.size)}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={() => handleDownload(file.name)}
                    className="text-xs px-2 py-1 rounded bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)] hover:text-[var(--anka-accent)] transition cursor-pointer"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => handleDelete(file.name)}
                    className="text-xs px-2 py-1 rounded bg-[var(--anka-bg-tertiary)] text-red-400 hover:text-red-300 transition cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
