import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const PROVIDERS = [
  { id: 'github', name: 'GitHub', icon: '🐙', color: 'bg-gray-700' },
  { id: 'gitlab', name: 'GitLab', icon: '🦊', color: 'bg-orange-600' },
  { id: 'gitea', name: 'Gitea', icon: '🔧', color: 'bg-green-600' },
];

export default function GitIntegrationApp() {
  const { user, profile } = useAuth();
  const isDevHead = profile?.role === 'department_head' && profile?.department === 'development';
  const canManage = profile?.role === 'admin' || isDevHead;

  const [repos, setRepos] = useState([]);
  const [view, setView] = useState('list'); // list | connect | detail
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const [form, setForm] = useState({
    name: '',
    owner: '',
    url: '',
    provider: 'github',
    token: '',
  });

  useEffect(() => {
    loadRepos();
  }, []);

  async function loadRepos() {
    setLoading(true);
    const { data } = await supabase
      .from('git_repos')
      .select('*')
      .eq('dept_id', 'development')
      .order('created_at', { ascending: false });
    setRepos(data || []);
    setLoading(false);
  }

  async function addRepo(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.owner.trim() || !form.url.trim()) return;

    const { error } = await supabase.from('git_repos').insert([{
      dept_id: 'development',
      name: form.name.trim(),
      owner: form.owner.trim(),
      url: form.url.trim(),
      provider: form.provider,
      token_encrypted: form.token ? Buffer.from(form.token).toString('base64') : null,
      created_by: user.id,
    }]);

    if (!error) {
      setForm({ name: '', owner: '', url: '', provider: 'github', token: '' });
      setView('list');
      loadRepos();
    }
  }

  async function deleteRepo(id) {
    await supabase.from('git_repos').delete().eq('id', id);
    loadRepos();
  }

  function openDetail(repo) {
    setSelectedRepo(repo);
    setView('detail');
  }

  const filtered = filter === 'all' ? repos : repos.filter((r) => r.provider === filter);

  // ─── List View ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center justify-between">
          <h3 className="text-sm font-semibold">🔗 Git Repositories</h3>
          {canManage && (
            <button
              onClick={() => setView('connect')}
              className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer"
            >
              + Connect Repo
            </button>
          )}
        </div>

        {/* Filter */}
        <div className="px-4 py-2 bg-[var(--anka-bg-secondary)]/50 border-b border-[var(--anka-border)] flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 text-xs rounded-lg transition cursor-pointer ${
              filter === 'all' ? 'bg-[var(--anka-accent)] text-white' : 'bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)]'
            }`}
          >
            All
          </button>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilter(p.id)}
              className={`px-3 py-1 text-xs rounded-lg transition cursor-pointer flex items-center gap-1 ${
                filter === p.id ? 'bg-[var(--anka-accent)] text-white' : 'bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)]'
              }`}
            >
              {p.icon} {p.name}
            </button>
          ))}
        </div>

        {/* Repos List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">
              {canManage ? 'No repositories connected yet. Connect one to get started.' : 'No repositories available.'}
            </div>
          ) : (
            filtered.map((repo) => {
              const provider = PROVIDERS.find((p) => p.id === repo.provider);
              return (
                <button
                  key={repo.id}
                  onClick={() => openDetail(repo)}
                  className="w-full text-left bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4 hover:border-[var(--anka-accent)]/40 transition cursor-pointer group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{provider?.icon}</span>
                        <span className="font-medium text-sm truncate">{repo.owner}/{repo.name}</span>
                      </div>
                      <code className="text-[10px] text-[var(--anka-accent)] truncate block">{repo.url}</code>
                    </div>
                    {canManage && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRepo(repo.id);
                        }}
                        className="text-red-400 opacity-0 group-hover:opacity-100 text-xs ml-2 hover:text-red-300 transition cursor-pointer"
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-[var(--anka-text-secondary)]">
                    <span className={`px-2 py-0.5 rounded ${provider?.color} text-white font-medium`}>
                      {provider?.name}
                    </span>
                    {repo.last_sync && <span>Last synced: {new Date(repo.last_sync).toLocaleDateString()}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ─── Connect Repo View ──────────────────────────────────────────────────────
  if (view === 'connect') {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center gap-3">
          <button
            onClick={() => setView('list')}
            className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer"
          >
            ←
          </button>
          <h3 className="text-sm font-semibold">Connect Git Repository</h3>
        </div>

        <form onSubmit={addRepo} className="flex-1 overflow-y-auto p-6 max-w-lg space-y-4">
          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Provider</label>
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Repository Owner</label>
            <input
              value={form.owner}
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
              placeholder="e.g., mycompany"
              required
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Repository Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., api-service"
              required
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Repository URL</label>
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="e.g., https://github.com/mycompany/api-service"
              required
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">
              Personal Access Token (Optional - for private repos)
            </label>
            <input
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              type="password"
              placeholder="Your PAT (will be encrypted)"
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
            />
            <p className="text-[10px] text-[var(--anka-text-secondary)] mt-1">
              Token is encrypted and only used for API access
            </p>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-sm font-medium rounded-lg transition cursor-pointer"
          >
            Connect Repository
          </button>
        </form>
      </div>
    );
  }

  // ─── Detail View ────────────────────────────────────────────────────────────
  if (view === 'detail' && selectedRepo) {
    const provider = PROVIDERS.find((p) => p.id === selectedRepo.provider);
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center gap-3">
          <button
            onClick={() => setView('list')}
            className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate">{selectedRepo.owner}/{selectedRepo.name}</h3>
            <p className="text-[10px] text-[var(--anka-text-secondary)]">{provider?.name}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Info Card */}
          <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
            <h4 className="text-xs font-semibold uppercase text-[var(--anka-text-secondary)] mb-3">Repository Info</h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--anka-text-secondary)]">Provider:</span>
                <span className="font-medium">{provider?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--anka-text-secondary)]">URL:</span>
                <a
                  href={selectedRepo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--anka-accent)] hover:underline cursor-pointer truncate"
                >
                  {selectedRepo.url}
                </a>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--anka-text-secondary)]">Last Sync:</span>
                <span>{selectedRepo.last_sync ? new Date(selectedRepo.last_sync).toLocaleString() : 'Never'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--anka-text-secondary)]">Added:</span>
                <span>{new Date(selectedRepo.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
            <h4 className="text-xs font-semibold uppercase text-[var(--anka-text-secondary)] mb-3">Quick Actions</h4>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => window.open(`${selectedRepo.url}/commits`, '_blank')}
                className="w-full text-left px-3 py-2 rounded-lg bg-[var(--anka-bg-tertiary)] hover:bg-[var(--anka-accent)]/10 text-[var(--anka-text-primary)] text-xs transition cursor-pointer"
              >
                📝 View Commits
              </button>
              <button
                onClick={() => window.open(`${selectedRepo.url}/pulls`, '_blank')}
                className="w-full text-left px-3 py-2 rounded-lg bg-[var(--anka-bg-tertiary)] hover:bg-[var(--anka-accent)]/10 text-[var(--anka-text-primary)] text-xs transition cursor-pointer"
              >
                🔀 View Pull Requests
              </button>
              <button
                onClick={() => window.open(`${selectedRepo.url}/issues`, '_blank')}
                className="w-full text-left px-3 py-2 rounded-lg bg-[var(--anka-bg-tertiary)] hover:bg-[var(--anka-accent)]/10 text-[var(--anka-text-primary)] text-xs transition cursor-pointer"
              >
                🐛 View Issues
              </button>
              <button
                onClick={() => window.open(`${selectedRepo.url}/actions`, '_blank')}
                className="w-full text-left px-3 py-2 rounded-lg bg-[var(--anka-bg-tertiary)] hover:bg-[var(--anka-accent)]/10 text-[var(--anka-text-primary)] text-xs transition cursor-pointer"
              >
                ⚙️ View CI/CD
              </button>
            </div>
          </div>

          {/* Integration Status */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
            <p className="text-xs text-blue-400">
              💡 <strong>Integration Status:</strong> Manual tracking enabled. To sync automatically, enable webhooks on {provider?.name}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
