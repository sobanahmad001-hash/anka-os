import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const PR_STATUSES = [
  { id: 'draft', label: 'Draft', color: 'bg-gray-500', icon: '📋' },
  { id: 'review', label: 'In Review', color: 'bg-yellow-500', icon: '👀' },
  { id: 'approved', label: 'Approved', color: 'bg-green-500', icon: '✅' },
  { id: 'changes-requested', label: 'Changes Requested', color: 'bg-red-500', icon: '❌' },
  { id: 'merged', label: 'Merged', color: 'bg-purple-600', icon: '🔀' },
];

const CHECK_STATUSES = {
  success: { color: 'bg-green-500', icon: '✓' },
  pending: { color: 'bg-yellow-500', icon: '⟳' },
  failure: { color: 'bg-red-500', icon: '✕' },
  skipped: { color: 'bg-gray-500', icon: '—' },
};

export default function PullRequestDashboardApp() {
  const { user, profile } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.department === 'development';

  const [prs, setPRs] = useState([]);
  const [repos, setRepos] = useState([]);
  const [selectedPR, setSelectedPR] = useState(null);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRepo, setFilterRepo] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    // Load repos
    const { data: repoData } = await supabase
      .from('git_repos')
      .select('id, name, owner')
      .eq('dept_id', 'development')
      .order('name');
    setRepos(repoData || []);

    // Load PRs
    const { data: prData } = await supabase
      .from('pull_requests')
      .select('*')
      .eq('dept_id', 'development')
      .order('created_at', { ascending: false });
    setPRs(prData || []);

    setLoading(false);
  }

  async function loadChecksForPR(prId) {
    const { data } = await supabase
      .from('review_checks')
      .select('*')
      .eq('pr_id', prId)
      .order('created_at');
    setChecks(data || []);
  }

  function openPRDetail(pr) {
    setSelectedPR(pr);
    loadChecksForPR(pr.id);
  }

  async function updatePRStatus(prId, newStatus) {
    await supabase
      .from('pull_requests')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', prId);

    setSelectedPR((prev) => (prev ? { ...prev, status: newStatus } : null));
    loadData();
  }

  const filtered = prs.filter((pr) => {
    const statusMatch = filterStatus === 'all' || pr.status === filterStatus;
    const repoMatch = filterRepo === 'all' || pr.repo_id === filterRepo;
    return statusMatch && repoMatch;
  });

  const getRepoName = (repoId) => {
    const repo = repos.find((r) => r.id === repoId);
    return repo ? `${repo.owner}/${repo.name}` : 'Unknown Repo';
  };

  const getPRStatusBadge = (status) => {
    const badge = PR_STATUSES.find((s) => s.id === status);
    return badge || PR_STATUSES[0];
  };

  if (!selectedPR) {
    // ─── PR List View ──────────────────────────────────────────────────────────
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)]">
          <h3 className="text-sm font-semibold">🔀 Pull Requests</h3>
        </div>

        {/* Filters */}
        <div className="px-4 py-3 bg-[var(--anka-bg-secondary)]/50 border-b border-[var(--anka-border)] space-y-2">
          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Status</label>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-2 py-1 text-xs rounded-lg transition cursor-pointer ${
                  filterStatus === 'all'
                    ? 'bg-[var(--anka-accent)] text-white'
                    : 'bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)]'
                }`}
              >
                All
              </button>
              {PR_STATUSES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setFilterStatus(s.id)}
                  className={`px-2 py-1 text-xs rounded-lg transition cursor-pointer flex items-center gap-1 ${
                    filterStatus === s.id
                      ? 'bg-[var(--anka-accent)] text-white'
                      : `${s.color} text-white opacity-60`
                  }`}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Repository</label>
            <select
              value={filterRepo}
              onChange={(e) => setFilterRepo(e.target.value)}
              className="w-full px-2 py-1.5 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-xs text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
            >
              <option value="all">All Repositories</option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.owner}/{repo.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* PR List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">
              No pull requests found.
            </div>
          ) : (
            filtered.map((pr) => {
              const badge = getPRStatusBadge(pr.status);
              return (
                <button
                  key={pr.id}
                  onClick={() => openPRDetail(pr)}
                  className="w-full text-left bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4 hover:border-[var(--anka-accent)]/40 transition cursor-pointer group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${badge.color}`}>
                          {badge.icon} {badge.label}
                        </span>
                        <span className="text-xs text-[var(--anka-text-secondary)]">#{pr.pr_number}</span>
                      </div>
                      <p className="font-medium text-sm mb-1 truncate group-hover:text-[var(--anka-accent)] transition">
                        {pr.title}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-[var(--anka-text-secondary)]">
                        <span>📦 {getRepoName(pr.repo_id)}</span>
                        <span>•</span>
                        <span>👤 {pr.author || 'Unknown'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Merged indicator */}
                  {pr.merged_at && (
                    <div className="text-[10px] text-green-400 mt-1">
                      Merged {new Date(pr.merged_at).toLocaleDateString()}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ─── PR Detail View ────────────────────────────────────────────────────────
  const badge = getPRStatusBadge(selectedPR.status);
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center gap-3">
        <button
          onClick={() => {
            setSelectedPR(null);
            setChecks([]);
          }}
          className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">PR #{selectedPR.pr_number}</h3>
          <p className="text-[10px] text-[var(--anka-text-secondary)]">{getRepoName(selectedPR.repo_id)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* PR Info */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <div className="flex items-start justify-between mb-3">
            <h4 className="font-medium text-sm flex-1">{selectedPR.title}</h4>
            <span className={`px-3 py-1 rounded text-xs font-medium text-white whitespace-nowrap ml-2 ${badge.color}`}>
              {badge.icon} {badge.label}
            </span>
          </div>

          <div className="space-y-2 text-xs text-[var(--anka-text-secondary)]">
            <div className="flex justify-between">
              <span>Author:</span>
              <span className="text-[var(--anka-text-primary)] font-medium">{selectedPR.author}</span>
            </div>
            <div className="flex justify-between">
              <span>Created:</span>
              <span>{new Date(selectedPR.created_at).toLocaleString()}</span>
            </div>
            {selectedPR.merged_at && (
              <div className="flex justify-between text-green-400">
                <span>Merged:</span>
                <span>{new Date(selectedPR.merged_at).toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Description */}
          {selectedPR.description && (
            <div className="mt-3 pt-3 border-t border-[var(--anka-border)]">
              <p className="text-[11px] text-[var(--anka-text-secondary)] whitespace-pre-wrap">
                {selectedPR.description}
              </p>
            </div>
          )}
        </div>

        {/* CI Checks */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <h4 className="text-xs font-semibold uppercase text-[var(--anka-text-secondary)] mb-3">
            Status Checks ({checks.length})
          </h4>

          {checks.length === 0 ? (
            <p className="text-xs text-[var(--anka-text-secondary)]">No checks found</p>
          ) : (
            <div className="space-y-2">
              {checks.map((check) => {
                const statusInfo = CHECK_STATUSES[check.status] || CHECK_STATUSES.pending;
                return (
                  <div
                    key={check.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-[var(--anka-bg-tertiary)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`${statusInfo.color} text-white text-xs px-2 py-0.5 rounded font-medium`}>
                        {statusInfo.icon}
                      </span>
                      <span className="text-xs text-[var(--anka-text-primary)] truncate font-medium">
                        {check.check_name}
                      </span>
                    </div>
                    {check.details && (
                      <span className="text-[10px] text-[var(--anka-text-secondary)] ml-2 truncate">
                        {check.details}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Status Actions */}
        {canManage && selectedPR.status !== 'merged' && (
          <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
            <h4 className="text-xs font-semibold uppercase text-[var(--anka-text-secondary)] mb-3">
              Update Status
            </h4>
            <div className="space-y-2">
              {PR_STATUSES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => updatePRStatus(selectedPR.id, s.id)}
                  disabled={s.id === selectedPR.status}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-medium transition cursor-pointer ${
                    s.id === selectedPR.status
                      ? `${s.color} text-white opacity-50 cursor-not-allowed`
                      : `${s.color} text-white hover:opacity-90`
                  }`}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Linked Task */}
        {selectedPR.linked_task_id && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
            <p className="text-xs text-blue-400">
              🔗 <strong>Linked Task:</strong> This PR is linked to a task. Update the task status when this PR is merged.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
