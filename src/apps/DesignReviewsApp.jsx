import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_OPTIONS = ['pending', 'in_review', 'changes_requested', 'approved', 'rejected'];

const STATUS_COLORS = {
  pending: 'bg-gray-500/20 text-gray-400',
  in_review: 'bg-blue-500/20 text-blue-400',
  changes_requested: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
};

const STATUS_ICONS = {
  pending: '⏳', in_review: '👀', changes_requested: '🔄', approved: '✅', rejected: '❌',
};

export default function DesignReviewsApp() {
  const { user, profile } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [projects, setProjects] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [view, setView] = useState('list'); // list | create | detail
  const [selected, setSelected] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    title: '', description: '', asset_url: '', project_id: '', reviewer_id: '',
  });

  useEffect(() => {
    loadReviews();
    loadProjects();
    loadTeam();
  }, []);

  async function loadReviews() {
    setLoading(true);
    const { data } = await supabase
      .from('design_reviews')
      .select('*, profiles:created_by(full_name), reviewer:reviewer_id(full_name), projects:project_id(name)')
      .order('created_at', { ascending: false });
    setReviews(data || []);
    setLoading(false);
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, name').order('name');
    setProjects(data || []);
  }

  async function loadTeam() {
    const { data } = await supabase.from('profiles').select('id, full_name').order('full_name');
    setTeamMembers(data || []);
  }

  async function loadComments(reviewId) {
    const { data } = await supabase
      .from('review_comments')
      .select('*, profiles:user_id(full_name)')
      .eq('review_id', reviewId)
      .order('created_at', { ascending: true });
    setComments(data || []);
  }

  async function createReview(e) {
    e.preventDefault();
    const { error } = await supabase.from('design_reviews').insert([{
      ...form,
      created_by: user.id,
      project_id: form.project_id || null,
      reviewer_id: form.reviewer_id || null,
    }]);
    if (!error) {
      setForm({ title: '', description: '', asset_url: '', project_id: '', reviewer_id: '' });
      setView('list');
      loadReviews();
    }
  }

  async function updateStatus(id, status) {
    const update = { status, updated_at: new Date().toISOString() };
    if (status === 'approved' || status === 'rejected') {
      update.reviewed_at = new Date().toISOString();
    }
    await supabase.from('design_reviews').update(update).eq('id', id);
    loadReviews();
    if (selected?.id === id) setSelected({ ...selected, status });
  }

  async function addComment(e) {
    e.preventDefault();
    if (!newComment.trim() || !selected) return;
    await supabase.from('review_comments').insert([{
      review_id: selected.id,
      user_id: user.id,
      content: newComment.trim(),
    }]);
    setNewComment('');
    loadComments(selected.id);
  }

  async function deleteReview(id) {
    await supabase.from('design_reviews').delete().eq('id', id);
    setView('list');
    setSelected(null);
    loadReviews();
  }

  function openDetail(review) {
    setSelected(review);
    setView('detail');
    loadComments(review.id);
  }

  const filtered = filter === 'all' ? reviews : reviews.filter((r) => r.status === filter);

  // ─── List View ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">💡 Design Reviews</h2>
          <button onClick={() => setView('create')} className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            + New Review
          </button>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {['all', ...STATUS_OPTIONS].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 text-xs rounded-full whitespace-nowrap transition cursor-pointer ${filter === s ? 'bg-[var(--anka-accent)] text-white' : 'bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)]'}`}>
              {s === 'all' ? 'All' : `${STATUS_ICONS[s]} ${s.replace('_', ' ')}`}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-[var(--anka-text-secondary)] text-sm">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-[var(--anka-text-secondary)] text-sm mt-8 text-center">No reviews yet.</p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2">
            {filtered.map((r) => (
              <div key={r.id} onClick={() => openDetail(r)}
                className="p-3 bg-[var(--anka-bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--anka-bg-tertiary)] transition"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{r.title}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>
                    {STATUS_ICONS[r.status]} {r.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-xs text-[var(--anka-text-secondary)] flex items-center gap-3">
                  <span>By {r.profiles?.full_name || 'Unknown'}</span>
                  {r.reviewer?.full_name && <span>→ {r.reviewer.full_name}</span>}
                  {r.projects?.name && <span>📋 {r.projects.name}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Create View ────────────────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full overflow-y-auto p-4">
        <button onClick={() => setView('list')} className="text-[var(--anka-text-secondary)] text-sm mb-4 hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        <h2 className="text-lg font-bold mb-4">New Design Review</h2>
        <form onSubmit={createReview} className="space-y-3 max-w-md">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Review title" required
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description / context" rows={3}
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)] resize-none" />
          <input value={form.asset_url} onChange={(e) => setForm({ ...form, asset_url: e.target.value })} placeholder="Asset URL (Figma, image link, etc.)"
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]">
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={form.reviewer_id} onChange={(e) => setForm({ ...form, reviewer_id: e.target.value })}
              className="px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]">
              <option value="">Assign reviewer</option>
              {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>
          <button type="submit" className="w-full py-2 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            Submit for Review
          </button>
        </form>
      </div>
    );
  }

  // ─── Detail View ────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    return (
      <div className="h-full flex flex-col p-4">
        <button onClick={() => setView('list')} className="text-[var(--anka-text-secondary)] text-sm mb-4 hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold">{selected.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>
                {STATUS_ICONS[selected.status]} {selected.status.replace('_', ' ')}
              </span>
              {selected.reviewer?.full_name && <span className="text-xs text-[var(--anka-text-secondary)]">Reviewer: {selected.reviewer.full_name}</span>}
            </div>
          </div>
          <button onClick={() => deleteReview(selected.id)} className="text-red-400 text-xs hover:text-red-300 cursor-pointer">Delete</button>
        </div>

        {selected.description && <p className="text-sm text-[var(--anka-text-secondary)] mb-3">{selected.description}</p>}
        {selected.asset_url && (
          <a href={selected.asset_url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-[var(--anka-accent)] hover:underline mb-3 block">
            🔗 View Asset
          </a>
        )}

        {/* Status actions */}
        <div className="flex flex-wrap gap-2 mb-4">
          {STATUS_OPTIONS.filter((s) => s !== selected.status).map((s) => (
            <button key={s} onClick={() => updateStatus(selected.id, s)}
              className={`px-3 py-1 text-xs rounded-full cursor-pointer transition ${STATUS_COLORS[s]} hover:brightness-110`}>
              → {s.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Comments */}
        <div className="flex-1 flex flex-col border-t border-[var(--anka-border)] pt-3">
          <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] mb-2">Feedback ({comments.length})</h3>
          <div className="flex-1 overflow-y-auto space-y-2 mb-3">
            {comments.map((c) => (
              <div key={c.id} className="p-2 bg-[var(--anka-bg-secondary)] rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">{c.profiles?.full_name || 'Unknown'}</span>
                  <span className="text-[10px] text-[var(--anka-text-secondary)]">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                <p className="text-xs text-[var(--anka-text-secondary)]">{c.content}</p>
              </div>
            ))}
            {comments.length === 0 && <p className="text-xs text-[var(--anka-text-secondary)]">No feedback yet.</p>}
          </div>
          <form onSubmit={addComment} className="flex gap-2">
            <input value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Add feedback..."
              className="flex-1 px-3 py-2 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
            <button type="submit" className="px-4 py-2 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 cursor-pointer">Send</button>
          </form>
        </div>
      </div>
    );
  }

  return null;
}
