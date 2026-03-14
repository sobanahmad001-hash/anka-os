import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Reusable Comments component.
 * Usage: <CommentsPanel entityType="task" entityId={taskId} />
 */
export default function CommentsPanel({ entityType, entityId }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (entityId) loadComments();
  }, [entityId]);

  useEffect(() => {
    if (!entityId) return;
    const channel = supabase.channel(`comments-${entityType}-${entityId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'comments',
        filter: `entity_id=eq.${entityId}`,
      }, (payload) => {
        // Fetch the full comment with profile
        loadComments();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [entityId, entityType]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  async function loadComments() {
    setLoading(true);
    const { data } = await supabase.from('comments')
      .select('*, profiles:user_id(full_name)')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true });
    setComments(data || []);
    setLoading(false);
  }

  async function addComment(e) {
    e.preventDefault();
    if (!input.trim()) return;
    await supabase.from('comments').insert([{
      user_id: user.id,
      entity_type: entityType,
      entity_id: entityId,
      content: input.trim(),
    }]);
    setInput('');
    loadComments();
  }

  async function deleteComment(id) {
    await supabase.from('comments').delete().eq('id', id);
    loadComments();
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="text-[10px] uppercase text-[var(--anka-text-secondary)] font-semibold mb-2">
        💬 Comments ({comments.length})
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 mb-2 max-h-48">
        {loading && <p className="text-xs text-[var(--anka-text-secondary)]">Loading...</p>}
        {!loading && comments.length === 0 && (
          <p className="text-xs text-[var(--anka-text-secondary)]">No comments yet.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="group">
            <div className="flex items-center gap-2 mb-0.5">
              <div className="w-5 h-5 rounded-full bg-[var(--anka-accent)]/20 flex items-center justify-center text-[8px] font-bold text-[var(--anka-accent)]">
                {c.profiles?.full_name?.charAt(0) || '?'}
              </div>
              <span className="text-xs font-medium">{c.profiles?.full_name || 'Unknown'}</span>
              <span className="text-[10px] text-[var(--anka-text-secondary)]">{timeAgo(c.created_at)}</span>
              {c.user_id === user.id && (
                <button onClick={() => deleteComment(c.id)}
                  className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100 ml-auto cursor-pointer">✕</button>
              )}
            </div>
            <p className="text-xs text-[var(--anka-text-secondary)] pl-7 whitespace-pre-wrap">{c.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={addComment} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Add a comment..."
          className="flex-1 px-2 py-1.5 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-xs focus:outline-none focus:border-[var(--anka-accent)]" />
        <button type="submit"
          className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-xs rounded-lg hover:brightness-110 transition cursor-pointer">
          Send
        </button>
      </form>
    </div>
  );
}
