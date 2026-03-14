import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { assembleContext } from '../lib/ai-context.js';
import { sendDirectMessage } from '../lib/ai-provider.js';
import { parseActions, executeAction, logAction, ACTION_LABELS, ACTION_COLORS } from '../lib/ai-actions.js';

export default function AiAssistantApp() {
  const { user, profile } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [activeConvo, setActiveConvo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Log behavior: app opened
  useEffect(() => {
    if (user) {
      supabase.from('behavior_logs').insert([{
        user_id: user.id,
        event_type: 'app_open',
        app_id: 'ai_assistant',
        session_id: sessionStorage.getItem('anka_session') || crypto.randomUUID(),
      }]);
    }
  }, [user]);

  async function loadConversations() {
    const { data } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (data) setConversations(data);
  }

  async function loadMessages(convoId) {
    const { data } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', convoId)
      .order('created_at', { ascending: true });
    if (data) {
      // Re-parse actions for display
      const enriched = data.map((m) => {
        if (m.role === 'assistant') {
          const { cleanText, actions } = parseActions(m.content);
          return { ...m, displayText: cleanText, parsedActions: actions };
        }
        return { ...m, displayText: m.content, parsedActions: [] };
      });
      setMessages(enriched);
    }
  }

  async function startNewConversation() {
    const { data, error } = await supabase
      .from('ai_conversations')
      .insert([{ user_id: user.id, title: 'New Conversation' }])
      .select()
      .single();
    if (data) {
      setActiveConvo(data);
      setMessages([]);
      loadConversations();
      inputRef.current?.focus();
    }
  }

  async function selectConversation(convo) {
    setActiveConvo(convo);
    await loadMessages(convo.id);
  }

  const sendMessage = useCallback(async (e) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;
    if (!activeConvo) return;

    const userMsg = input.trim();
    setInput('');
    setError('');
    setLoading(true);

    // Optimistic: add user message to UI
    const userEntry = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMsg,
      displayText: userMsg,
      parsedActions: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userEntry]);

    // Save user message to DB
    await supabase.from('ai_messages').insert([{
      conversation_id: activeConvo.id,
      role: 'user',
      content: userMsg,
    }]);

    try {
      // Assemble context in parallel
      const { systemPrompt, snapshot } = await assembleContext(user.id, profile);

      // Build message history for AI (last 20 messages)
      const historyForAI = messages
        .slice(-20)
        .concat([userEntry])
        .map((m) => ({ role: m.role, content: m.content }));

      // Call AI (provider cascade)
      const aiResponse = await sendDirectMessage(historyForAI, systemPrompt);

      // Parse actions from response
      const { cleanText, actions } = parseActions(aiResponse.content);

      // Save assistant message to DB
      await supabase.from('ai_messages').insert([{
        conversation_id: activeConvo.id,
        role: 'assistant',
        content: aiResponse.content,
        actions: actions,
        token_count: aiResponse.tokenCount || 0,
        provider: aiResponse.provider,
        model: aiResponse.model,
      }]);

      // Log actions to audit
      for (const action of actions) {
        await logAction(user.id, activeConvo.id, action, 'pending', null);
      }

      // Update conversation title if it's the first user message
      if (messages.length === 0) {
        const title = userMsg.slice(0, 60) + (userMsg.length > 60 ? '...' : '');
        await supabase
          .from('ai_conversations')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('id', activeConvo.id);
        setActiveConvo((c) => ({ ...c, title }));
        loadConversations();
      } else {
        await supabase
          .from('ai_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', activeConvo.id);
      }

      // Add assistant message to UI
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: aiResponse.content,
          displayText: cleanText,
          parsedActions: actions,
          provider: aiResponse.provider,
          model: aiResponse.model,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: '',
          displayText: `⚠️ ${err.message}`,
          parsedActions: [],
          created_at: new Date().toISOString(),
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, activeConvo, messages, user, profile]);

  async function handleActionApproval(action, messageId) {
    // Execute the action
    const result = await executeAction(action, user.id);

    // Update action status in messages
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === messageId) {
          return {
            ...m,
            parsedActions: m.parsedActions.map((a) =>
              a.id === action.id
                ? { ...a, status: result.success ? 'executed' : 'failed', result }
                : a,
            ),
          };
        }
        return m;
      }),
    );

    // Log to audit
    await logAction(
      user.id,
      activeConvo?.id,
      action,
      result.success ? 'executed' : 'failed',
      result,
    );
  }

  async function handleActionReject(action, messageId) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === messageId) {
          return {
            ...m,
            parsedActions: m.parsedActions.map((a) =>
              a.id === action.id ? { ...a, status: 'rejected' } : a,
            ),
          };
        }
        return m;
      }),
    );

    await logAction(user.id, activeConvo?.id, action, 'rejected', null);
  }

  async function deleteConversation(convoId) {
    await supabase.from('ai_conversations').delete().eq('id', convoId);
    if (activeConvo?.id === convoId) {
      setActiveConvo(null);
      setMessages([]);
    }
    loadConversations();
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex">
      {/* Sidebar: conversations */}
      {sidebarOpen && (
        <div className="w-56 bg-[var(--anka-bg-secondary)] border-r border-[var(--anka-border)] flex flex-col">
          <div className="p-3 border-b border-[var(--anka-border)] flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase">
              Conversations
            </span>
            <button
              onClick={startNewConversation}
              className="text-[var(--anka-accent)] hover:text-[var(--anka-accent-hover)] text-lg leading-none cursor-pointer"
              title="New conversation"
            >
              +
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-2 px-3 py-2 border-b border-[var(--anka-border)] hover:bg-[var(--anka-bg-tertiary)] transition cursor-pointer group ${
                  activeConvo?.id === c.id
                    ? 'bg-[var(--anka-accent)]/10 text-[var(--anka-accent)]'
                    : 'text-[var(--anka-text-secondary)]'
                }`}
              >
                <button
                  onClick={() => selectConversation(c)}
                  className="flex-1 text-left min-w-0 cursor-pointer"
                >
                  <div className="text-xs font-medium truncate">{c.title}</div>
                  <div className="text-[10px] opacity-60">
                    {new Date(c.updated_at).toLocaleDateString()}
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                  className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition cursor-pointer shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--anka-border)] bg-[var(--anka-bg-secondary)] flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer text-sm"
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">
              {activeConvo ? activeConvo.title : 'Anka AI'}
            </div>
            <div className="text-[10px] text-[var(--anka-text-secondary)]">
              Context-aware workspace assistant
            </div>
          </div>
          {!activeConvo && (
            <button
              onClick={startNewConversation}
              className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer"
            >
              Start Chat
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!activeConvo ? (
            <EmptyState onStart={startNewConversation} profile={profile} />
          ) : messages.length === 0 && !loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-3xl mb-3">🤖</div>
                <div className="text-sm text-[var(--anka-text-secondary)]">
                  Ask me anything about your workspace, tasks, or projects.
                </div>
                <div className="text-[10px] text-[var(--anka-text-secondary)] mt-1">
                  I have full context of your current work state.
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isUser={msg.role === 'user'}
                  profile={profile}
                  onApprove={(action) => handleActionApproval(action, msg.id)}
                  onReject={(action) => handleActionReject(action, msg.id)}
                />
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-[var(--anka-accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full bg-[var(--anka-accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full bg-[var(--anka-accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-[10px] text-[var(--anka-text-secondary)]">
                        Thinking with full context...
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        {activeConvo && (
          <form
            onSubmit={sendMessage}
            className="p-3 border-t border-[var(--anka-border)] flex gap-2"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Anka AI anything..."
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl text-sm text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-5 py-2.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-sm rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>
        )}

        {error && (
          <div className="px-4 pb-2">
            <div className="text-[10px] text-red-400 bg-red-500/10 rounded-lg px-3 py-1.5">
              {error}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({ onStart, profile }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center max-w-md space-y-4">
        <div className="text-5xl">🤖</div>
        <h3 className="text-lg font-semibold">Anka AI Assistant</h3>
        <p className="text-sm text-[var(--anka-text-secondary)]">
          Your context-aware workspace companion. I can see your tasks, projects,
          team activity, and past decisions — and help you work smarter.
        </p>
        <div className="grid grid-cols-2 gap-2 text-left">
          <SuggestionCard emoji="📋" text="What's my priority today?" />
          <SuggestionCard emoji="⚠️" text="Any overdue items?" />
          <SuggestionCard emoji="🎯" text="Create a task for me" />
          <SuggestionCard emoji="📊" text="Summarize project status" />
        </div>
        <button
          onClick={onStart}
          className="px-6 py-3 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-sm font-medium rounded-xl transition cursor-pointer"
        >
          Start a Conversation
        </button>
      </div>
    </div>
  );
}

function SuggestionCard({ emoji, text }) {
  return (
    <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg px-3 py-2 text-xs text-[var(--anka-text-secondary)]">
      <span className="mr-1.5">{emoji}</span>{text}
    </div>
  );
}

function MessageBubble({ msg, isUser, profile, onApprove, onReject }) {
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] space-y-2`}>
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-[var(--anka-accent)] text-white rounded-br-md'
              : msg.isError
                ? 'bg-red-500/10 border border-red-500/30 rounded-bl-md'
                : 'bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-bl-md'
          }`}
        >
          <div className="text-sm whitespace-pre-wrap leading-relaxed">
            {msg.displayText}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span
              className={`text-[9px] ${
                isUser ? 'text-white/50' : 'text-[var(--anka-text-secondary)]'
              }`}
            >
              {formatTime(msg.created_at)}
            </span>
            {msg.provider && (
              <span className="text-[9px] text-[var(--anka-text-secondary)] opacity-50">
                via {msg.provider}
              </span>
            )}
          </div>
        </div>

        {/* Action Cards */}
        {msg.parsedActions?.length > 0 && (
          <div className="space-y-2 pl-2">
            {msg.parsedActions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                onApprove={() => onApprove(action)}
                onReject={() => onReject(action)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ActionCard({ action, onApprove, onReject }) {
  const label = ACTION_LABELS[action.type] || action.type;
  const colorClass = ACTION_COLORS[action.type] || 'border-gray-500/30 bg-gray-500/5';
  const isResolved = ['executed', 'rejected', 'failed'].includes(action.status);

  return (
    <div className={`border rounded-xl p-3 ${colorClass}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold">{label}</span>
        {action.status === 'executed' && (
          <span className="text-[10px] text-green-400 font-medium">✓ Executed</span>
        )}
        {action.status === 'rejected' && (
          <span className="text-[10px] text-red-400 font-medium">✕ Rejected</span>
        )}
        {action.status === 'failed' && (
          <span className="text-[10px] text-red-400 font-medium">⚠ Failed</span>
        )}
      </div>

      {/* Action data preview */}
      <div className="text-xs text-[var(--anka-text-secondary)] space-y-1 mb-2">
        {Object.entries(action.data || {}).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <span className="font-medium capitalize shrink-0">{key.replace(/_/g, ' ')}:</span>
            <span className="truncate">{String(value)}</span>
          </div>
        ))}
      </div>

      {action.reason && (
        <div className="text-[10px] text-[var(--anka-text-secondary)] italic mb-2">
          "{action.reason}"
        </div>
      )}

      {/* Approve / Reject buttons */}
      {!isResolved && (
        <div className="flex gap-2">
          <button
            onClick={onApprove}
            className="flex-1 text-xs py-1.5 bg-[var(--anka-success)] hover:bg-[var(--anka-success)]/80 text-white rounded-lg transition cursor-pointer font-medium"
          >
            ✓ Approve
          </button>
          <button
            onClick={onReject}
            className="flex-1 text-xs py-1.5 bg-[var(--anka-bg-tertiary)] hover:bg-red-500/20 text-[var(--anka-text-secondary)] hover:text-red-400 rounded-lg transition cursor-pointer"
          >
            ✕ Reject
          </button>
        </div>
      )}

      {action.status === 'failed' && action.result?.error && (
        <div className="text-[10px] text-red-400 mt-1">{action.result.error}</div>
      )}
    </div>
  );
}
