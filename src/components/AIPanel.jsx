import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { buildAIContext, detectIntent } from '../lib/ai-context'
import { sendAiMessage } from '../lib/ai-provider'
import { executeAction } from '../lib/ai-actions'

export default function AIPanel() {
  const { user, profile } = useAuth()
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
    setMessages(prev => [...prev, userMessage])
    
    // Detect intent from message
    const intent = detectIntent(input)
    console.log('🧠 Detected intent:', intent)
    
    setInput('')
    setLoading(true)

    try {
      // Build rich context with real data
      const context = await buildAIContext(location.pathname, profile)
      context.detectedIntent = intent
      context.recentMessages = messages.slice(-5)

      const response = await sendAiMessage([...messages, userMessage], context)
      
      // Check if response contains an action proposal
      const actionMatch = response.match ? response.match(/\[ANKA_ACTION\](.*?)\[\/ANKA_ACTION\]/s) : null
      
      if (actionMatch) {
        const actionData = JSON.parse(actionMatch[1])
        setPendingAction(actionData)
        
        // Show AI message without the action block
        const cleanResponse = response.replace(/\[ANKA_ACTION\].*?\[\/ANKA_ACTION\]/s, '').trim()
        setMessages(prev => [...prev, { role: 'assistant', content: cleanResponse }])
      } else {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: response.content || response.message || response 
        }])
      }
      
      if (response.action) {
        setPendingAction(response.action)
      }
    } catch (error) {
      console.error('AI error:', error)
      setMessages(prev => [...prev, { 
        role: 'system', 
        content: `❌ Error: ${error.message}` 
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleApproveAction = async () => {
    if (!pendingAction) return
    
    setLoading(true)
    
    try {
      const result = await executeAction(pendingAction)
      
      setMessages(prev => [...prev, { 
        role: 'system', 
        content: `✅ ${pendingAction.description}\n\nCreated: ${JSON.stringify(result.data, null, 2)}` 
      }])
      setPendingAction(null)
    } catch (error) {
      console.error('Action execution error:', error)
      setMessages(prev => [...prev, { 
        role: 'system', 
        content: `❌ Action failed: ${error.message}` 
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleRejectAction = () => {
    setMessages(prev => [...prev, { 
      role: 'system', 
      content: '❌ Action rejected' 
    }])
    setPendingAction(null)
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-blue-50 to-white dark:from-gray-800 dark:to-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-white">AI Assistant</h3>
        <p className="text-xs text-gray-500">Context-aware team actions</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 text-sm mt-8">
            <div className="text-2xl mb-2">🤖</div>
            <p>Ask me to create tasks, projects, or log decisions</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                msg.role === 'user' 
                  ? 'bg-blue-500 text-white'
                  : msg.role === 'system'
                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
              }`}>
                {msg.content}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-lg">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Pending Action */}
      {pendingAction && (
        <div className="px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
            Confirm action?
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleApproveAction}
              disabled={loading}
              className="flex-1 px-2 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              ✓ Approve
            </button>
            <button
              onClick={handleRejectAction}
              disabled={loading}
              className="flex-1 px-2 py-1 text-sm bg-gray-300 dark:bg-gray-700 text-gray-900 dark:text-white rounded hover:bg-gray-400 disabled:opacity-50"
            >
              ✗ Reject
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
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
            placeholder="Ask me to..."
            disabled={loading}
            className="flex-1 px-3 py-2 text-sm text-black dark:text-white border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSendMessage}
            disabled={loading || !input.trim()}
            className="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
