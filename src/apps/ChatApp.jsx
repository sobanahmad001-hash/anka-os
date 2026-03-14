import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ChatApp() {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
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

    return () => {
      supabase.removeChannel(channel);
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
    if (data) setMessages(data);
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
          return (
            <div
              key={msg.id}
              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-2 ${
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
