import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';

export default function AnalyticsApp() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30'); // days

  useEffect(() => { loadStats(); }, [period]);

  async function loadStats() {
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - parseInt(period));
    const sinceISO = since.toISOString();

    // Fire all queries in parallel
    const [
      { count: totalTasks },
      { count: completedTasks },
      { count: totalProjects },
      { count: activeProjects },
      { count: totalClients },
      { count: activeClients },
      { count: totalCampaigns },
      { count: activeCampaigns },
      { count: contentItems },
      { count: publishedContent },
      { count: messagesCount },
      { data: recentActivity },
      { data: tasksByStatus },
      { data: campaignsByStatus },
    ] = await Promise.all([
      supabase.from('tasks').select('*', { count: 'exact', head: true }),
      supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'done'),
      supabase.from('projects').select('*', { count: 'exact', head: true }),
      supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('*', { count: 'exact', head: true }),
      supabase.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('campaigns').select('*', { count: 'exact', head: true }),
      supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('content_items').select('*', { count: 'exact', head: true }),
      supabase.from('content_items').select('*', { count: 'exact', head: true }).eq('status', 'published'),
      supabase.from('messages').select('*', { count: 'exact', head: true }).gte('created_at', sinceISO),
      supabase.from('activity_log').select('action, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('tasks').select('status'),
      supabase.from('campaigns').select('status'),
    ]);

    // Compute distributions
    const taskDist = {};
    (tasksByStatus || []).forEach((t) => { taskDist[t.status] = (taskDist[t.status] || 0) + 1; });

    const campaignDist = {};
    (campaignsByStatus || []).forEach((c) => { campaignDist[c.status] = (campaignDist[c.status] || 0) + 1; });

    setStats({
      totalTasks: totalTasks || 0,
      completedTasks: completedTasks || 0,
      totalProjects: totalProjects || 0,
      activeProjects: activeProjects || 0,
      totalClients: totalClients || 0,
      activeClients: activeClients || 0,
      totalCampaigns: totalCampaigns || 0,
      activeCampaigns: activeCampaigns || 0,
      contentItems: contentItems || 0,
      publishedContent: publishedContent || 0,
      messagesCount: messagesCount || 0,
      recentActivity: recentActivity || [],
      taskDist,
      campaignDist,
    });
    setLoading(false);
  }

  function StatCard({ label, value, sub, color }) {
    return (
      <div className="p-3 bg-[var(--anka-bg-secondary)] rounded-lg">
        <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${color || 'text-[var(--anka-text-primary)]'}`}>{value}</div>
        {sub && <div className="text-[10px] text-[var(--anka-text-secondary)] mt-0.5">{sub}</div>}
      </div>
    );
  }

  function MiniBar({ data, colors }) {
    const total = Object.values(data).reduce((a, b) => a + b, 0);
    if (total === 0) return <div className="text-xs text-[var(--anka-text-secondary)]">No data</div>;
    return (
      <div className="space-y-1.5">
        {Object.entries(data).map(([key, count]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] w-20 text-right text-[var(--anka-text-secondary)]">{key}</span>
            <div className="flex-1 h-3 bg-[var(--anka-bg-tertiary)] rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${colors[key] || 'bg-[var(--anka-accent)]'}`}
                style={{ width: `${(count / total) * 100}%` }} />
            </div>
            <span className="text-[10px] text-[var(--anka-text-secondary)] w-6">{count}</span>
          </div>
        ))}
      </div>
    );
  }

  const TASK_COLORS = { todo: 'bg-gray-500', in_progress: 'bg-yellow-500', done: 'bg-green-500' };
  const CAMPAIGN_COLORS = { draft: 'bg-gray-500', active: 'bg-green-500', paused: 'bg-yellow-500', completed: 'bg-blue-500', cancelled: 'bg-red-500' };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">📈 Analytics</h2>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}
          className="px-2 py-1 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-xs focus:outline-none">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {loading || !stats ? (
        <p className="text-[var(--anka-text-secondary)] text-sm">Loading analytics...</p>
      ) : (
        <div className="space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Tasks" value={stats.totalTasks} sub={`${stats.completedTasks} completed`} color="text-blue-400" />
            <StatCard label="Projects" value={stats.totalProjects} sub={`${stats.activeProjects} active`} color="text-green-400" />
            <StatCard label="Clients" value={stats.totalClients} sub={`${stats.activeClients} active`} color="text-purple-400" />
            <StatCard label="Messages" value={stats.messagesCount} sub={`last ${period} days`} color="text-orange-400" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Campaigns" value={stats.totalCampaigns} sub={`${stats.activeCampaigns} active`} color="text-pink-400" />
            <StatCard label="Content" value={stats.contentItems} sub={`${stats.publishedContent} published`} color="text-cyan-400" />
            <StatCard label="Task Completion" value={stats.totalTasks > 0 ? `${Math.round((stats.completedTasks / stats.totalTasks) * 100)}%` : '—'} color="text-emerald-400" />
          </div>

          {/* Distribution Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-[var(--anka-bg-secondary)] rounded-lg">
              <h3 className="text-xs font-semibold mb-2 text-[var(--anka-text-secondary)]">Tasks by Status</h3>
              <MiniBar data={stats.taskDist} colors={TASK_COLORS} />
            </div>
            <div className="p-3 bg-[var(--anka-bg-secondary)] rounded-lg">
              <h3 className="text-xs font-semibold mb-2 text-[var(--anka-text-secondary)]">Campaigns by Status</h3>
              <MiniBar data={stats.campaignDist} colors={CAMPAIGN_COLORS} />
            </div>
          </div>

          {/* Recent Activity */}
          <div className="p-3 bg-[var(--anka-bg-secondary)] rounded-lg">
            <h3 className="text-xs font-semibold mb-2 text-[var(--anka-text-secondary)]">Recent Activity</h3>
            {stats.recentActivity.length === 0 ? (
              <p className="text-xs text-[var(--anka-text-secondary)]">No recent activity</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {stats.recentActivity.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--anka-text-primary)]">{a.action}</span>
                    <span className="text-[var(--anka-text-secondary)]">{new Date(a.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
