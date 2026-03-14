import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '✅', '💯'];

export default function ChatApp() {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState({}); // { messageId: [{ emoji, user_id, id }] }
  const [input, setInput] = useState('');
  const [reactingTo, setReactingTo] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    loadMessages();

    const channel = supabase
      .channel('chat-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          setMessages((prev) => [...prev, payload.new]);
        },
      )
      .subscribe();

    const reactionChannel = supabase
      .channel('chat-reactions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        () => { loadReactionsForAll(); },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(reactionChannel);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) {
      setMessages(data);
      // Load reactions for all messages
      const msgIds = data.map((m) => m.id);
      if (msgIds.length > 0) {
        const { data: rxns } = await supabase
          .from('message_reactions')
          .select('*')
          .in('message_id', msgIds);
        if (rxns) {
          const map = {};
          rxns.forEach((r) => {
            if (!map[r.message_id]) map[r.message_id] = [];
            map[r.message_id].push(r);
          });
          setReactions(map);
        }
      }
    }
  }

  async function loadReactionsForAll() {
    const msgIds = messages.map((m) => m.id);
    if (msgIds.length === 0) return;
    const { data: rxns } = await supabase
      .from('message_reactions')
      .select('*')
      .in('message_id', msgIds);
    if (rxns) {
      const map = {};
      rxns.forEach((r) => {
        if (!map[r.message_id]) map[r.message_id] = [];
        map[r.message_id].push(r);
      });
      setReactions(map);
    }
  }

  async function toggleReaction(messageId, emoji) {
    const existing = (reactions[messageId] || []).find((r) => r.user_id === user.id && r.emoji === emoji);
    if (existing) {
      await supabase.from('message_reactions').delete().eq('id', existing.id);
    } else {
      await supabase.from('message_reactions').insert({ message_id: messageId, user_id: user.id, emoji });
    }
    setReactingTo(null);
    loadReactionsForAll();
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim()) return;

    const msg = input.trim();
    setInput('');

    await supabase.from('messages').insert([
      {
        content: msg,
        user_id: user.id,
        sender_name: profile?.full_name || 'Unknown',
        department: profile?.department || null,
      },
    ]);
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Group reactions by emoji for a message
  function groupedReactions(messageId) {
    const rxns = reactions[messageId] || [];
    const groups = {};
    rxns.forEach((r) => {
      if (!groups[r.emoji]) groups[r.emoji] = [];
      groups[r.emoji].push(r.user_id);
    });
    return groups;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)]">
        <div className="text-sm font-semibold">Team Chat</div>
        <div className="text-[10px] text-[var(--anka-text-secondary)]">All departments</div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => {
          const isMe = msg.user_id === user.id;
          const grpRxns = groupedReactions(msg.id);
          const hasReactions = Object.keys(grpRxns).length > 0;
          return (
            <div
              key={msg.id}
              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
            >
              <div className="relative group max-w-[70%]">
                <div
                  className={`rounded-2xl px-4 py-2 ${
                    isMe
                      ? 'bg-[var(--anka-accent)] text-white rounded-br-md'
                      : 'bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-bl-md'
                  }`}
                >
                  {!isMe && (
                    <div className="text-[10px] font-semibold text-[var(--anka-accent)] mb-1">
                      {msg.sender_name}
                    </div>
                  )}
                  <div className="text-sm">{msg.content}</div>
                  <div
                    className={`text-[9px] mt-1 ${
                      isMe ? 'text-white/60' : 'text-[var(--anka-text-secondary)]'
                    }`}
                  >
                    {formatTime(msg.created_at)}
                  </div>
                </div>

                {/* Reaction button trigger */}
                <button onClick={() => setReactingTo(reactingTo === msg.id ? null : msg.id)}
                  className={`absolute -bottom-1 ${isMe ? 'left-0' : 'right-0'} text-[10px] w-5 h-5 rounded-full bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer hover:border-[var(--anka-accent)]`}>
                  😀
                </button>

                {/* Emoji picker */}
                {reactingTo === msg.id && (
                  <div className={`absolute bottom-6 ${isMe ? 'left-0' : 'right-0'} z-20 flex gap-0.5 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl px-2 py-1.5 shadow-lg`}>
                    {QUICK_EMOJIS.map((e) => (
                      <button key={e} onClick={() => toggleReaction(msg.id, e)}
                        className="text-sm hover:scale-125 transition cursor-pointer px-0.5">{e}</button>
                    ))}
                  </div>
                )}

                {/* Reaction badges */}
                {hasReactions && (
                  <div className={`flex gap-1 mt-1 flex-wrap ${isMe ? 'justify-end' : 'justify-start'}`}>
                    {Object.entries(grpRxns).map(([emoji, users]) => {
                      const iMine = users.includes(user.id);
                      return (
                        <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)}
                          className={`text-[10px] px-1.5 py-0.5 rounded-full border transition cursor-pointer ${
                            iMine ? 'border-[var(--anka-accent)] bg-[var(--anka-accent)]/10' : 'border-[var(--anka-border)] bg-[var(--anka-bg-secondary)]'
                          }`}>
                          {emoji} {users.length}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={sendMessage}
        className="p-3 border-t border-[var(--anka-border)] flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-4 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-full text-sm text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)]"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-sm rounded-full transition cursor-pointer"
        >
          Send
        </button>
      </form>
    </div>
  );
}
