import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const PIPELINE_STATUSES = {
  success: { color: 'bg-green-500', label: 'Success', icon: '✓' },
  running: { color: 'bg-blue-500', label: 'Running', icon: '▶' },
  failed: { color: 'bg-red-500', label: 'Failed', icon: '✕' },
  cancelled: { color: 'bg-gray-500', label: 'Cancelled', icon: '⊘' },
  pending: { color: 'bg-yellow-500', label: 'Pending', icon: '⟳' },
};

const JOB_STATUSES = {
  success: { color: 'bg-green-500', label: 'Success' },
  running: { color: 'bg-blue-500', label: 'Running' },
  failed: { color: 'bg-red-500', label: 'Failed' },
  skipped: { color: 'bg-gray-500', label: 'Skipped' },
  pending: { color: 'bg-yellow-500', label: 'Pending' },
};

const DEPLOYMENT_STATUSES = {
  success: { color: 'bg-green-500', label: 'Success', icon: '✓' },
  in_progress: { color: 'bg-blue-500', label: 'In Progress', icon: '▶' },
  failed: { color: 'bg-red-500', label: 'Failed', icon: '✕' },
  rolled_back: { color: 'bg-orange-500', label: 'Rolled Back', icon: '⟲' },
};

export default function CIPipelineDashboardApp() {
  const { user, profile } = useAuth();

  const [pipelines, setPipelines] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [repos, setRepos] = useState([]);
  const [selectedPipeline, setSelectedPipeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

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

    // Load pipelines
    const { data: pipelineData } = await supabase
      .from('ci_pipelines')
      .select('*')
      .eq('dept_id', 'development')
      .order('created_at', { ascending: false })
      .limit(50);
    setPipelines(pipelineData || []);

    // Load deployments
    const { data: deploymentData } = await supabase
      .from('deployments')
      .select('*')
      .eq('dept_id', 'development')
      .order('deployed_at', { ascending: false })
      .limit(20);
    setDeployments(deploymentData || []);

    setLoading(false);
  }

  async function loadJobsForPipeline(pipelineId) {
    const { data } = await supabase
      .from('pipeline_jobs')
      .select('*')
      .eq('pipeline_id', pipelineId)
      .order('created_at');
    setJobs(data || []);
  }

  function openPipelineDetail(pipeline) {
    setSelectedPipeline(pipeline);
    loadJobsForPipeline(pipeline.id);
  }

  const getRepoName = (repoId) => {
    const repo = repos.find((r) => r.id === repoId);
    return repo ? `${repo.owner}/${repo.name}` : 'Unknown';
  };

  const branches = [...new Set(pipelines.map((p) => p.branch))];
  const statuses = Object.keys(PIPELINE_STATUSES);

  const filtered = pipelines.filter((p) => {
    const branchMatch = filterBranch === 'all' || p.branch === filterBranch;
    const statusMatch = filterStatus === 'all' || p.status === filterStatus;
    return branchMatch && statusMatch;
  });

  if (!selectedPipeline) {
    // ─── Pipeline List View ────────────────────────────────────────────────────
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)]">
          <h3 className="text-sm font-semibold">⚙️ CI/CD Pipelines</h3>
        </div>

        {/* Filters */}
        <div className="px-4 py-3 bg-[var(--anka-bg-secondary)]/50 border-b border-[var(--anka-border)] space-y-2">
          <div>
            <label className="block text-xs text-[var(--anka-text-secondary)] mb-1">Branch</label>
            <select
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              className="w-full px-2 py-1.5 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-xs text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
            >
              <option value="all">All Branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

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
              {statuses.map((s) => {
                const info = PIPELINE_STATUSES[s];
                return (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`px-2 py-1 text-xs rounded-lg transition cursor-pointer flex items-center gap-1 ${
                      filterStatus === s
                        ? 'bg-[var(--anka-accent)] text-white'
                        : `${info.color} text-white opacity-60`
                    }`}
                  >
                    {info.icon} {info.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Pipelines List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-[var(--anka-text-secondary)] text-sm mt-20">
              No pipelines found.
            </div>
          ) : (
            filtered.map((pipeline) => {
              const statusInfo = PIPELINE_STATUSES[pipeline.status] || PIPELINE_STATUSES.pending;
              const completionTime = pipeline.completed_at
                ? `${Math.round((new Date(pipeline.completed_at) - new Date(pipeline.created_at)) / 1000)}s`
                : 'running...';

              return (
                <button
                  key={pipeline.id}
                  onClick={() => openPipelineDetail(pipeline)}
                  className="w-full text-left bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4 hover:border-[var(--anka-accent)]/40 transition cursor-pointer group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${statusInfo.color}`}>
                          {statusInfo.icon} {statusInfo.label}
                        </span>
                        <span className="text-xs text-[var(--anka-text-secondary)]">#{pipeline.pipeline_number}</span>
                      </div>
                      <p className="font-mono text-xs text-[var(--anka-accent)] truncate">
                        {pipeline.commit_sha.substring(0, 8)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-[var(--anka-text-secondary)]">
                    <span>📦 {getRepoName(pipeline.repo_id)}</span>
                    <span>•</span>
                    <span>🌿 {pipeline.branch}</span>
                    <span>•</span>
                    <span>{completionTime}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Deployments Summary */}
        <div className="px-4 py-3 border-t border-[var(--anka-border)] bg-[var(--anka-bg-secondary)]/50 max-h-32 overflow-y-auto">
          <h4 className="text-xs font-semibold text-[var(--anka-text-secondary)] mb-2">Recent Deployments</h4>
          <div className="space-y-1">
            {deployments.slice(0, 3).map((dep) => {
              const depStatus = DEPLOYMENT_STATUSES[dep.status] || DEPLOYMENT_STATUSES.in_progress;
              return (
                <div key={dep.id} className="flex items-center gap-2 text-xs">
                  <span className={`${depStatus.color} text-white px-1.5 py-0.5 rounded text-[9px] font-medium`}>
                    {depStatus.icon}
                  </span>
                  <span className="text-[var(--anka-text-secondary)] flex-1 truncate">{dep.env_type || 'Unknown'}</span>
                  <span className="text-[10px] text-[var(--anka-text-secondary)]">
                    {new Date(dep.deployed_at).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─── Pipeline Detail View ──────────────────────────────────────────────────
  const pipelineStatus = PIPELINE_STATUSES[selectedPipeline.status] || PIPELINE_STATUSES.pending;
  const completionTime = selectedPipeline.completed_at
    ? `${Math.round((new Date(selectedPipeline.completed_at) - new Date(selectedPipeline.created_at)) / 1000)}s`
    : 'still running...';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center gap-3">
        <button
          onClick={() => {
            setSelectedPipeline(null);
            setJobs([]);
          }}
          className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">Pipeline #{selectedPipeline.pipeline_number}</h3>
          <p className="text-[10px] text-[var(--anka-text-secondary)]">
            {getRepoName(selectedPipeline.repo_id)} • {selectedPipeline.branch}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Pipeline Info */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold uppercase text-[var(--anka-text-secondary)]">Status</h4>
            <span className={`px-3 py-1 rounded text-xs font-medium text-white ${pipelineStatus.color}`}>
              {pipelineStatus.icon} {pipelineStatus.label}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--anka-text-secondary)]">Commit:</span>
              <code className="font-mono text-[var(--anka-accent)]">{selectedPipeline.commit_sha}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--anka-text-secondary)]">Duration:</span>
              <span>{completionTime}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--anka-text-secondary)]">Started:</span>
              <span>{new Date(selectedPipeline.created_at).toLocaleString()}</span>
            </div>
            {selectedPipeline.completed_at && (
              <div className="flex justify-between">
                <span className="text-[var(--anka-text-secondary)]">Completed:</span>
                <span>{new Date(selectedPipeline.completed_at).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Jobs */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <h4 className="text-xs font-semibold uppercase text-[var(--anka-text-secondary)] mb-3">
            Pipeline Jobs ({jobs.length})
          </h4>

          {jobs.length === 0 ? (
            <p className="text-xs text-[var(--anka-text-secondary)]">No jobs found</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => {
                const jobStatus = JOB_STATUSES[job.status] || JOB_STATUSES.pending;
                return (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--anka-bg-tertiary)] hover:bg-[var(--anka-bg-tertiary)]/70 transition group"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`${jobStatus.color} text-white text-xs px-2 py-1 rounded font-medium flex-shrink-0`}>
                        ●
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-[var(--anka-text-primary)] truncate">
                          {job.job_number}. {job.name}
                        </p>
                        <p className="text-[10px] text-[var(--anka-text-secondary)]">{jobStatus.label}</p>
                      </div>
                    </div>
                    {job.log_url && (
                      <a
                        href={job.log_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--anka-accent)] hover:underline text-xs ml-2 opacity-0 group-hover:opacity-100 transition cursor-pointer whitespace-nowrap"
                      >
                        [ Logs ]
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Related Deployments */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <h4 className="text-xs font-semibold uppercase text-[var(--anka-text-secondary)] mb-3">
            Recent Deployments
          </h4>

          {deployments.length === 0 ? (
            <p className="text-xs text-[var(--anka-text-secondary)]">No deployments found</p>
          ) : (
            <div className="space-y-2">
              {deployments.slice(0, 5).map((dep) => {
                const depStatus = DEPLOYMENT_STATUSES[dep.status] || DEPLOYMENT_STATUSES.in_progress;
                return (
                  <div key={dep.id} className="flex items-center justify-between p-2 rounded-lg bg-[var(--anka-bg-tertiary)]">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`${depStatus.color} text-white text-xs px-1.5 py-0.5 rounded font-medium`}>
                        {depStatus.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-[var(--anka-text-primary)]">{dep.env_type || 'Unknown'}</p>
                        <p className="text-[10px] text-[var(--anka-text-secondary)]">v{dep.version}</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-[var(--anka-text-secondary)] ml-2 whitespace-nowrap">
                      {new Date(dep.deployed_at).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4">
          <h4 className="text-xs font-semibold uppercase text-[var(--anka-text-secondary)] mb-3">Actions</h4>
          <button
            onClick={() => window.open(`https://github.com/search?q=${selectedPipeline.commit_sha}`, '_blank')}
            className="w-full py-2 px-3 rounded-lg text-xs font-medium bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white transition cursor-pointer"
          >
            🔍 View Commit
          </button>
        </div>
      </div>
    </div>
  );
}
