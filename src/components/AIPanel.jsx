import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { buildAIContext, detectIntent } from '../lib/ai-context'
import { sendAiMessage } from '../lib/ai-provider'
import { executeAction } from '../lib/ai-actions'

export default function AIPanel({
  title = 'Anka AI',
  subtitle = 'Environment-aware support for tasks, blockers, docs, and project actions',
  placeholder = 'Ask Anka AI to help with tasks, blockers, docs, or execution flow...',
  compact = false,
}) {
  const { profile } = useAuth()
  const location = useLocation()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = async () => {
    if (!input.trim()) return

    const userMessage = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])

    const intent = detectIntent(input)
    setInput('')
    setLoading(true)

    try {
      const context = await buildAIContext(location.pathname, profile)
      context.detectedIntent = intent
      context.recentMessages = messages.slice(-5)

      const response = await sendAiMessage([...messages, userMessage], context)
      const rawText = response?.content || response?.message || response || ''

      const actionMatch =
        typeof rawText === 'string'
          ? rawText.match(/\[ANKA_ACTION\](.*?)\[\/ANKA_ACTION\]/s)
          : null

      if (actionMatch) {
        const actionData = JSON.parse(actionMatch[1])
        setPendingAction(actionData)

        const cleanResponse = rawText.replace(/\[ANKA_ACTION\].*?\[\/ANKA_ACTION\]/s, '').trim()
        setMessages((prev) => [...prev, { role: 'assistant', content: cleanResponse }])
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: rawText,
          },
        ])
      }

      if (response?.action) {
        setPendingAction(response.action)
      }
    } catch (error) {
      console.error('AI error:', error)
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `Error: ${error.message}`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleApproveAction = async () => {
    if (!pendingAction) return

    setLoading(true)

    try {
      const result = await executeAction(pendingAction)
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `${pendingAction.description}\n\nCreated: ${JSON.stringify(result.data, null, 2)}`,
        },
      ])
      setPendingAction(null)
    } catch (error) {
      console.error('Action execution error:', error)
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `Action failed: ${error.message}`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleRejectAction = () => {
    setMessages((prev) => [
      ...prev,
      {
        role: 'system',
        content: 'Action rejected',
      },
    ])
    setPendingAction(null)
  }

  return (
    <div className="flex flex-col h-full rounded-2xl border border-[var(--anka-border)] bg-[var(--anka-surface)] overflow-hidden shadow-[0_12px_32px_rgba(20,32,51,0.06)]">
      <div className="px-5 py-4 border-b border-[var(--anka-border)] bg-[var(--anka-surface-soft)]">
        <h3 className="font-semibold tracking-tight text-[var(--anka-ink)]">{title}</h3>
        <p className="text-xs text-[var(--anka-muted)] mt-1">{subtitle}</p>
      </div>

      <div className={`flex-1 overflow-y-auto px-4 py-4 space-y-3 ${compact ? 'min-h-[340px]' : 'min-h-[420px]'}`}>
        {messages.length === 0 ? (
          <div className="text-sm text-[var(--anka-muted)] mt-2 space-y-3">
            <div className="inline-flex items-center rounded-full border border-[var(--anka-border)] px-3 py-1 text-xs text-blue-700 dark:text-blue-200 bg-[var(--anka-accent-soft)]">
              Anka AI is aware of this environment
            </div>
            <div className="space-y-2">
              <p>Try asking:</p>
              <div className="space-y-2">
                <div className="rounded-xl bg-[var(--anka-surface-soft)] px-3 py-2">Create a task for login bug triage</div>
                <div className="rounded-xl bg-[var(--anka-surface-soft)] px-3 py-2">Summarize blocked work in this environment</div>
                <div className="rounded-xl bg-[var(--anka-surface-soft)] px-3 py-2">Suggest next steps for the API docs cleanup</div>
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-6 ${
                  msg.role === 'user'
                    ? 'bg-[var(--anka-accent)] text-white'
                    : msg.role === 'system'
                    ? 'bg-[color:rgba(245,158,11,0.12)] text-amber-900 dark:text-amber-200 border border-[color:rgba(245,158,11,0.18)]'
                    : 'bg-[var(--anka-surface-soft)] text-[var(--anka-ink)]'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-[var(--anka-surface-soft)] px-4 py-3 rounded-2xl">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-[var(--anka-muted)] rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-[var(--anka-muted)] rounded-full animate-bounce delay-100"></div>
                <div className="w-2 h-2 bg-[var(--anka-muted)] rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {pendingAction && (
        <div className="px-4 py-3 border-t border-[var(--anka-border)] bg-[color:rgba(245,158,11,0.08)]">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-3">
            Confirm proposed action
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleApproveAction}
              disabled={loading}
              className="flex-1 rounded-xl px-3 py-2 text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={handleRejectAction}
              disabled={loading}
              className="flex-1 rounded-xl px-3 py-2 text-sm bg-[var(--anka-surface-soft)] text-[var(--anka-ink)] hover:opacity-90 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-4 border-t border-[var(--anka-border)]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder={placeholder}
            disabled={loading}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm text-[var(--anka-ink)] border border-[var(--anka-border)] bg-[var(--anka-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--anka-accent)] disabled:opacity-50"
          />
          <button
            onClick={handleSendMessage}
            disabled={loading || !input.trim()}
            className="rounded-xl px-4 py-2.5 text-sm bg-[var(--anka-accent)] text-white hover:opacity-95 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
