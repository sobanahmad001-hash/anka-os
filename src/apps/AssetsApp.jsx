import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function AssetsApp() {
  const { user, profile } = useAuth();
  const [assets, setAssets] = useState([]);
  const [projects, setProjects] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(true);

  const [uploadForm, setUploadForm] = useState({
    project_id: '',
    tags: '',
  });

  const canManage = ['admin', 'department_head'].includes(profile?.role) || true; // all can upload

  useEffect(() => {
    loadAssets();
    loadProjects();
  }, []);

  async function loadAssets() {
    setLoading(true);
    const { data } = await supabase
      .from('assets')
      .select('*, uploader:profiles!uploaded_by(full_name), project:projects!project_id(name)')
      .order('created_at', { ascending: false });
    if (data) setAssets(data);
    setLoading(false);
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, name').order('name');
    if (data) setProjects(data);
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const filePath = `assets/${user.id}/${Date.now()}-${file.name}`;
    const { error: storageError } = await supabase.storage.from('files').upload(filePath, file);

    if (!storageError) {
      const tags = uploadForm.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      await supabase.from('assets').insert([
        {
          name: file.name,
          file_path: filePath,
          file_type: file.type || file.name.split('.').pop() || '',
          file_size: file.size,
          uploaded_by: user.id,
          project_id: uploadForm.project_id || null,
          tags,
        },
      ]);

      setUploadForm({ project_id: '', tags: '' });
      setShowUpload(false);
      loadAssets();
    }

    setUploading(false);
  }

  async function handleDownload(asset) {
    const { data } = await supabase.storage.from('files').download(asset.file_path);
    if (data) {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = asset.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async function handleDelete(asset) {
    await supabase.storage.from('files').remove([asset.file_path]);
    await supabase.from('assets').delete().eq('id', asset.id);
    loadAssets();
  }

  function formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(type) {
    if (type.includes('image') || /png|jpg|jpeg|gif|svg|webp/.test(type)) return '🖼️';
    if (type.includes('video') || /mp4|mov|avi/.test(type)) return '🎬';
    if (type.includes('audio') || /mp3|wav/.test(type)) return '🎵';
    if (type.includes('pdf')) return '📄';
    if (/fig|sketch|psd|ai|xd/.test(type)) return '🎨';
    if (/zip|rar|7z/.test(type)) return '📦';
    return '📄';
  }

  const allTags = [...new Set(assets.flatMap((a) => a.tags || []))].sort();

  const filtered = assets.filter((a) => {
    const matchProject = filter === 'all' || a.project_id === filter;
    const matchTag = !tagFilter || (a.tags && a.tags.includes(tagFilter));
    return matchProject && matchTag;
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">Asset Library</h3>
          <span className="text-[10px] text-[var(--anka-text-secondary)] bg-[var(--anka-bg-tertiary)] px-2 py-0.5 rounded-full">
            {filtered.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none"
            >
              <option value="">All Tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer"
          >
            + Upload
          </button>
        </div>
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)]/50 space-y-2">
          <div className="flex items-center gap-3">
            <select
              value={uploadForm.project_id}
              onChange={(e) => setUploadForm({ ...uploadForm, project_id: e.target.value })}
              className="text-xs bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg px-2 py-1.5 text-[var(--anka-text-primary)] focus:outline-none flex-1"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              value={uploadForm.tags}
              onChange={(e) => setUploadForm({ ...uploadForm, tags: e.target.value })}
              placeholder="Tags (comma-separated)"
              className="text-xs px-3 py-1.5 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none flex-1"
            />
            <label className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer">
              {uploading ? 'Uploading...' : 'Choose File'}
              <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
          </div>
        </div>
      )}

      {/* Asset grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">
            No assets yet. Upload files to get started.
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((asset) => (
              <div
                key={asset.id}
                className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4 hover:border-[var(--anka-accent)]/40 transition group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{getFileIcon(asset.file_type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{asset.name}</div>
                    <div className="text-[10px] text-[var(--anka-text-secondary)]">
                      {formatSize(asset.file_size)} · {asset.file_type || 'unknown'}
                    </div>
                  </div>
                </div>

                {/* Tags */}
                {asset.tags && asset.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {asset.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-2 py-0.5 bg-[var(--anka-accent)]/10 text-[var(--anka-accent)] rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between text-[10px] text-[var(--anka-text-secondary)]">
                  <span>
                    {asset.uploader?.full_name || 'Unknown'}
                    {asset.project?.name ? ` · ${asset.project.name}` : ''}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={() => handleDownload(asset)}
                      className="px-2 py-0.5 rounded bg-[var(--anka-bg-tertiary)] hover:text-[var(--anka-accent)] transition cursor-pointer"
                    >
                      ↓
                    </button>
                    {(asset.uploaded_by === user.id || ['admin', 'department_head'].includes(profile?.role)) && (
                      <button
                        onClick={() => handleDelete(asset)}
                        className="px-2 py-0.5 rounded bg-[var(--anka-bg-tertiary)] text-red-400 hover:text-red-300 transition cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
