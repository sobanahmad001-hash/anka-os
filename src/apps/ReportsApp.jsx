import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const REPORT_TYPES = ['summary', 'time', 'tasks', 'projects', 'team', 'custom'];

export default function ReportsApp() {
  const { user, profile } = useAuth();
  const [reports, setReports] = useState([]);
  const [view, setView] = useState('list'); // list | create | detail | generate
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState(null);

  const [form, setForm] = useState({
    title: '', description: '', report_type: 'summary',
    date_range_start: '', date_range_end: '', is_shared: false,
  });

  useEffect(() => { loadReports(); }, []);

  async function loadReports() {
    setLoading(true);
    const { data } = await supabase.from('reports')
      .select('*, profiles:created_by(full_name)')
      .order('created_at', { ascending: false });
    setReports(data || []);
    setLoading(false);
  }

  async function createReport(e) {
    e.preventDefault();
    const { error } = await supabase.from('reports').insert([{
      ...form,
      created_by: user.id,
      date_range_start: form.date_range_start || null,
      date_range_end: form.date_range_end || null,
    }]);
    if (!error) {
      setForm({ title: '', description: '', report_type: 'summary', date_range_start: '', date_range_end: '', is_shared: false });
      setView('list');
      loadReports();
    }
  }

  async function deleteReport(id) {
    await supabase.from('reports').delete().eq('id', id);
    setView('list'); setSelected(null);
    loadReports();
  }

  async function generateReport(report) {
    setGenerating(true);
    setGeneratedData(null);
    const start = report.date_range_start || '2020-01-01';
    const end = report.date_range_end || new Date().toISOString().slice(0, 10);

    const results = {};

    if (['summary', 'tasks', 'custom'].includes(report.report_type)) {
      const { data, count } = await supabase.from('tasks')
        .select('status', { count: 'exact' })
        .gte('created_at', start).lte('created_at', end + 'T23:59:59');
      const grouped = {};
      (data || []).forEach((t) => { grouped[t.status] = (grouped[t.status] || 0) + 1; });
      results.tasks = { total: count || (data || []).length, byStatus: grouped };
    }

    if (['summary', 'projects', 'custom'].includes(report.report_type)) {
      const { data } = await supabase.from('projects').select('status')
        .gte('created_at', start).lte('created_at', end + 'T23:59:59');
      const grouped = {};
      (data || []).forEach((p) => { grouped[p.status] = (grouped[p.status] || 0) + 1; });
      results.projects = { total: (data || []).length, byStatus: grouped };
    }

    if (['summary', 'time', 'custom'].includes(report.report_type)) {
      const { data } = await supabase.from('time_logs').select('duration_minutes, billable')
        .gte('started_at', start).lte('started_at', end + 'T23:59:59')
        .not('ended_at', 'is', null);
      const totalMin = (data || []).reduce((a, r) => a + (r.duration_minutes || 0), 0);
      const billableMin = (data || []).filter((r) => r.billable).reduce((a, r) => a + (r.duration_minutes || 0), 0);
      results.time = { totalHours: (totalMin / 60).toFixed(1), billableHours: (billableMin / 60).toFixed(1), entries: (data || []).length };
    }

    if (['summary', 'team', 'custom'].includes(report.report_type)) {
      const { data } = await supabase.from('profiles').select('department, role');
      const byDept = {};
      (data || []).forEach((p) => { byDept[p.department] = (byDept[p.department] || 0) + 1; });
      results.team = { total: (data || []).length, byDepartment: byDept };
    }

    // Save snapshot
    await supabase.from('reports').update({ snapshot: results, updated_at: new Date().toISOString() }).eq('id', report.id);

    setGeneratedData(results);
    setGenerating(false);
  }

  // ─── List ──────────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">📊 Reports</h2>
          <button onClick={() => setView('create')} className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            + New Report
          </button>
        </div>

        {loading ? <p className="text-sm text-[var(--anka-text-secondary)]">Loading...</p> : (
          <div className="flex-1 overflow-y-auto space-y-2">
            {reports.length === 0 && <p className="text-sm text-[var(--anka-text-secondary)]">No reports yet. Create one to get started.</p>}
            {reports.map((r) => (
              <div key={r.id} onClick={() => { setSelected(r); setGeneratedData(r.snapshot); setView('detail'); }}
                className="bg-[var(--anka-bg-secondary)] rounded-lg p-4 hover:bg-[var(--anka-bg-tertiary)] transition cursor-pointer">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-medium text-sm">{r.title}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--anka-accent)]/20 text-[var(--anka-accent)]">
                    {r.report_type}
                  </span>
                </div>
                <p className="text-xs text-[var(--anka-text-secondary)] line-clamp-1">{r.description || 'No description'}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-[var(--anka-text-secondary)]">
                  <span>By {r.profiles?.full_name || 'Unknown'}</span>
                  {r.is_shared && <span className="text-green-400">🔗 Shared</span>}
                  {r.date_range_start && <span>{r.date_range_start} → {r.date_range_end || 'now'}</span>}
                  {r.snapshot && <span className="text-yellow-400">📄 Has data</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Create ────────────────────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">New Report</h2>
          <button onClick={() => setView('list')} className="text-sm text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        </div>
        <form onSubmit={createReport} className="space-y-3 max-w-lg">
          <input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})}
            placeholder="Report title" required
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          <textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})}
            placeholder="Description (optional)" rows={3}
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--anka-accent)] resize-none" />
          <select value={form.report_type} onChange={(e) => setForm({...form, report_type: e.target.value})}
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none">
            {REPORT_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-[var(--anka-text-secondary)] block mb-1">Start Date</label>
              <input type="date" value={form.date_range_start} onChange={(e) => setForm({...form, date_range_start: e.target.value})}
                className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-[var(--anka-text-secondary)] block mb-1">End Date</label>
              <input type="date" value={form.date_range_end} onChange={(e) => setForm({...form, date_range_end: e.target.value})}
                className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--anka-text-secondary)] cursor-pointer">
            <input type="checkbox" checked={form.is_shared} onChange={(e) => setForm({...form, is_shared: e.target.checked})}
              className="accent-[var(--anka-accent)]" />
            Share with team
          </label>
          <button type="submit" className="w-full py-2 bg-[var(--anka-accent)] text-white rounded-lg hover:brightness-110 transition cursor-pointer text-sm">
            Create Report
          </button>
        </form>
      </div>
    );
  }

  // ─── Detail ────────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    return (
      <div className="h-full flex flex-col p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => { setView('list'); setSelected(null); setGeneratedData(null); }}
            className="text-sm text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
          <div className="flex gap-2">
            <button onClick={() => generateReport(selected)} disabled={generating}
              className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer disabled:opacity-50">
              {generating ? 'Generating...' : '🔄 Generate'}
            </button>
            <button onClick={() => deleteReport(selected.id)}
              className="px-3 py-1.5 bg-red-600/20 text-red-400 text-sm rounded-lg hover:bg-red-600/30 transition cursor-pointer">
              Delete
            </button>
          </div>
        </div>

        <h2 className="text-lg font-bold mb-1">{selected.title}</h2>
        <p className="text-sm text-[var(--anka-text-secondary)] mb-1">{selected.description}</p>
        <div className="flex gap-3 text-xs text-[var(--anka-text-secondary)] mb-4">
          <span className="px-2 py-0.5 rounded-full bg-[var(--anka-accent)]/20 text-[var(--anka-accent)]">{selected.report_type}</span>
          {selected.date_range_start && <span>{selected.date_range_start} → {selected.date_range_end || 'now'}</span>}
          {selected.is_shared && <span className="text-green-400">🔗 Shared</span>}
        </div>

        {/* Generated Data */}
        {!generatedData && !generating && (
          <div className="flex-1 flex items-center justify-center text-[var(--anka-text-secondary)] text-sm">
            Click "Generate" to pull the latest data.
          </div>
        )}

        {generatedData && (
          <div className="space-y-4">
            {generatedData.tasks && (
              <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-4">
                <h3 className="font-semibold text-sm mb-3">📋 Tasks</h3>
                <div className="text-2xl font-bold text-[var(--anka-accent)] mb-2">{generatedData.tasks.total}</div>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(generatedData.tasks.byStatus || {}).map(([status, count]) => (
                    <div key={status} className="text-center bg-[var(--anka-bg-tertiary)] rounded p-2">
                      <div className="text-lg font-bold">{count}</div>
                      <div className="text-xs text-[var(--anka-text-secondary)]">{status}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {generatedData.projects && (
              <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-4">
                <h3 className="font-semibold text-sm mb-3">🗂️ Projects</h3>
                <div className="text-2xl font-bold text-[var(--anka-accent)] mb-2">{generatedData.projects.total}</div>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(generatedData.projects.byStatus || {}).map(([status, count]) => (
                    <div key={status} className="text-center bg-[var(--anka-bg-tertiary)] rounded p-2">
                      <div className="text-lg font-bold">{count}</div>
                      <div className="text-xs text-[var(--anka-text-secondary)]">{status}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {generatedData.time && (
              <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-4">
                <h3 className="font-semibold text-sm mb-3">⏱️ Time</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[var(--anka-accent)]">{generatedData.time.totalHours}h</div>
                    <div className="text-xs text-[var(--anka-text-secondary)]">Total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">{generatedData.time.billableHours}h</div>
                    <div className="text-xs text-[var(--anka-text-secondary)]">Billable</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{generatedData.time.entries}</div>
                    <div className="text-xs text-[var(--anka-text-secondary)]">Entries</div>
                  </div>
                </div>
              </div>
            )}

            {generatedData.team && (
              <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-4">
                <h3 className="font-semibold text-sm mb-3">👥 Team</h3>
                <div className="text-2xl font-bold text-[var(--anka-accent)] mb-2">{generatedData.team.total} members</div>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(generatedData.team.byDepartment || {}).map(([dept, count]) => (
                    <div key={dept} className="text-center bg-[var(--anka-bg-tertiary)] rounded p-2">
                      <div className="text-lg font-bold">{count}</div>
                      <div className="text-xs text-[var(--anka-text-secondary)]">{dept}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
