import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

const MODES = {
  chat: { label: '💬 Chat', desc: 'Ask anything about your OS' },
  standup: { label: '☀️ Standup', desc: 'What needs attention today' },
  brief: { label: '📄 Brief', desc: 'Generate SOPs, strategies, briefs' },
  search: { label: '🔍 Search', desc: 'Find anything across the OS' },
  execute: { label: '⚡ Execute', desc: 'Create tasks, update projects' },
}

const BRIEF_TYPES = [
  'SOP — Standard Operating Procedure',
  'Marketing Strategy',
  'Content Brief',
  'Project Brief',
  'SEO Strategy',
  'Social Media Strategy',
  'Campaign Brief',
  'Onboarding Guide',
  'Client Proposal',
]

export default function AnkaAssistant() {
  const { user, profile } = useAuth()
  const [mode, setMode] = useState('chat')
  const [threads, setThreads] = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  // OS context
  const [osContext, setOsContext] = useState(null)
  const [contextLoading, setContextLoading] = useState(false)

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)

  // Brief
  const [briefType, setBriefType] = useState('')
  const [briefContext, setBriefContext] = useState('')
  const [briefOutput, setBriefOutput] = useState('')
  const [generatingBrief, setGeneratingBrief] = useState(false)

  // Execute
  const [executePrompt, setExecutePrompt] = useState('')
  const [executeResult, setExecuteResult] = useState(null)
  const [executing, setExecuting] = useState(false)

  const messagesEndRef = useRef(null)

  useEffect(() => {
    fetchThreads()
    fetchOSContext()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (activeThread) fetchMessages(activeThread)
  }, [activeThread])

  async function fetchOSContext() {
    setContextLoading(true)
    try {
      const [projectsRes, tasksRes, clientsRes, membersRes] = await Promise.all([
        supabase.from('as_projects').select('id, name, status, current_phase, as_clients(name)').order('updated_at', { ascending: false }).limit(20),
        supabase.from('as_tasks').select('id, title, status, phase, priority, assigned_to, project_id').eq('status', 'todo').order('created_at', { ascending: false }).limit(50),
        supabase.from('as_clients').select('id, name, company').order('name').limit(20),
        supabase.from('profiles').select('id, full_name, email, department, role').order('full_name'),
      ])

      const myTasks = (tasksRes.data || []).filter(t => t.assigned_to === user?.id)
      const blockedTasks = (tasksRes.data || []).filter(t => t.status === 'blocked')
      const activeProjects = (projectsRes.data || []).filter(p => p.status === 'active')
      const pendingHandoffs = (projectsRes.data || []).filter(p => p.status === 'pending_handoff')

      setOsContext({
        projects: projectsRes.data || [],
        activeProjects,
        pendingHandoffs,
        myTasks,
        blockedTasks,
        clients: clientsRes.data || [],
        members: membersRes.data || [],
        user: profile,
        summary: {
          totalProjects: projectsRes.data?.length || 0,
          activeProjects: activeProjects.length,
          pendingHandoffs: pendingHandoffs.length,
          myTaskCount: myTasks.length,
          blockedCount: blockedTasks.length,
          totalClients: clientsRes.data?.length || 0,
        }
      })
    } catch (err) {
      console.error('Context fetch error:', err)
    }
    setContextLoading(false)
  }

  async function fetchThreads() {
    const { data } = await supabase.from('as_assistant_threads')
      .select('*').eq('user_id', user?.id)
      .order('updated_at', { ascending: false }).limit(20)
    setThreads(data || [])
    if (data?.length && !activeThread) setActiveThread(data[0].id)
  }

  async function fetchMessages(threadId) {
    const { data } = await supabase.from('as_assistant_messages')
      .select('*').eq('thread_id', threadId)
      .order('created_at')
    setMessages(data || [])
  }

  async function newThread() {
    const { data } = await supabase.from('as_assistant_threads').insert({
      user_id: user?.id, title: 'New conversation'
    }).select().single()
    if (data) {
      setThreads(prev => [data, ...prev])
      setActiveThread(data.id)
      setMessages([])
    }
  }

  async function sendMessage() {
    if (!input.trim()) return
    const msg = input.trim()
    setInput('')
    setLoading(true)

    let threadId = activeThread
    if (!threadId) {
      const { data } = await supabase.from('as_assistant_threads').insert({
        user_id: user?.id, title: msg.slice(0, 50)
      }).select().single()
      if (data) {
        threadId = data.id
        setActiveThread(data.id)
        setThreads(prev => [data, ...prev])
      }
    }

    // Save user message
    await supabase.from('as_assistant_messages').insert({
      thread_id: threadId, user_id: user?.id, role: 'user', content: msg
    })
    setMessages(prev => [...prev, { role: 'user', content: msg, created_at: new Date().toISOString() }])

    // Build system prompt with OS context
    const contextStr = osContext ? `
ANKA OS CONTEXT — Live data as of right now:
User: ${osContext.user?.full_name || 'Unknown'} (${osContext.user?.role}, ${osContext.user?.department} dept)

PROJECTS (${osContext.summary.totalProjects} total, ${osContext.summary.activeProjects} active):
${osContext.activeProjects.slice(0, 10).map(p => `- ${p.name} | Phase: ${p.current_phase} | Client: ${p.as_clients?.name || 'none'} | Status: ${p.status}`).join('\n')}
${osContext.pendingHandoffs.length > 0 ? `\nPENDING HANDOFFS (${osContext.pendingHandoffs.length}):\n${osContext.pendingHandoffs.map(p => `- ${p.name} waiting approval`).join('\n')}` : ''}

MY TASKS (${osContext.myTasks.length}):
${osContext.myTasks.slice(0, 10).map(t => `- ${t.title} | ${t.priority} priority | ${t.phase}`).join('\n')}

BLOCKED TASKS (${osContext.blockedTasks.length}):
${osContext.blockedTasks.slice(0, 5).map(t => `- ${t.title}`).join('\n')}

CLIENTS (${osContext.summary.totalClients}): ${osContext.clients.map(c => c.name).join(', ')}
TEAM: ${osContext.members.map(m => `${m.full_name || m.email} (${m.department})`).join(', ')}
` : 'OS context loading...'

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          system: `You are Anka, the AI assistant built into Anka OS — an internal operating system for a digital agency called Anka Sphere. You have full context of the workspace.

${contextStr}

You can:
- Answer questions about projects, tasks, clients, team
- Provide strategic advice on marketing, development, design work
- Summarise status, blockers, priorities
- Draft content, SOPs, briefs, emails
- Suggest next actions

Be direct, specific, and reference actual data from the OS context when relevant. When you don't have specific data, say so.`,
          messages: [
            ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: msg }
          ]
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
      const reply = data.content?.[0]?.text || 'No response'

      await supabase.from('as_assistant_messages').insert({
        thread_id: threadId, user_id: user?.id, role: 'assistant', content: reply
      })
      setMessages(prev => [...prev, { role: 'assistant', content: reply, created_at: new Date().toISOString() }])

      // Update thread title from first message
      if (messages.length === 0) {
        await supabase.from('as_assistant_threads').update({
          title: msg.slice(0, 60), updated_at: new Date().toISOString()
        }).eq('id', threadId)
        setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: msg.slice(0, 60) } : t))
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    }
    setLoading(false)
  }

  async function generateStandup() {
    setLoading(true)
    setMode('standup')
    if (!osContext) { setLoading(false); return }

    const prompt = `Generate a concise daily standup briefing for ${osContext.user?.full_name || 'the user'} based on this OS data:

Active projects: ${osContext.activeProjects.map(p => `${p.name} (${p.current_phase})`).join(', ')}
My tasks today: ${osContext.myTasks.map(t => `${t.title} [${t.priority}]`).join(', ') || 'none'}
Blocked: ${osContext.blockedTasks.map(t => t.title).join(', ') || 'none'}
Pending handoffs needing approval: ${osContext.pendingHandoffs.map(p => p.name).join(', ') || 'none'}

Format as:
🎯 FOCUS TODAY (top 3 priorities)
⚠️ BLOCKERS (anything stuck)
✅ PENDING APPROVALS (handoffs waiting)
📊 PROJECT PULSE (one line per active project)`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      const data = await res.json()
      setMessages([{ role: 'assistant', content: data.content?.[0]?.text || 'No standup data', created_at: new Date().toISOString() }])
    } catch (err) {
      setMessages([{ role: 'assistant', content: 'Error generating standup.' }])
    }
    setLoading(false)
  }

  async function generateBrief() {
    if (!briefType) return
    setGeneratingBrief(true)
    setBriefOutput('')
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: `You are a senior strategist at a digital agency. Generate professional, detailed, actionable documents. Use proper headings and structure.`,
          messages: [{
            role: 'user',
            content: `Generate a complete ${briefType} document.
${briefContext ? `Context: ${briefContext}` : ''}
${osContext ? `Agency context: Working with clients including ${osContext.clients.slice(0, 3).map(c => c.name).join(', ')}` : ''}

Make it comprehensive, professional, and immediately usable.`
          }]
        })
      })
      const data = await res.json()
      setBriefOutput(data.content?.[0]?.text || 'No output')
    } catch (err) {
      setBriefOutput('Error: ' + err.message)
    }
    setGeneratingBrief(false)
  }

  async function searchOS() {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchResults(null)
    const q = searchQuery.toLowerCase()
    try {
      const [projectsRes, tasksRes, clientsRes, contentRes, seoRes] = await Promise.all([
        supabase.from('as_projects').select('id, name, status, current_phase').ilike('name', `%${q}%`).limit(5),
        supabase.from('as_tasks').select('id, title, status, project_id').ilike('title', `%${q}%`).limit(10),
        supabase.from('as_clients').select('id, name, company').or(`name.ilike.%${q}%,company.ilike.%${q}%`).limit(5),
        supabase.from('as_content_tracker').select('id, title, status, content_type').ilike('title', `%${q}%`).limit(5),
        supabase.from('as_seo_tracker').select('id, page_name, primary_keyword, project_id').or(`page_name.ilike.%${q}%,primary_keyword.ilike.%${q}%`).limit(5),
      ])
      setSearchResults({
        projects: projectsRes.data || [],
        tasks: tasksRes.data || [],
        clients: clientsRes.data || [],
        content: contentRes.data || [],
        seo: seoRes.data || [],
        total: (projectsRes.data?.length || 0) + (tasksRes.data?.length || 0) + (clientsRes.data?.length || 0) + (contentRes.data?.length || 0) + (seoRes.data?.length || 0)
      })
    } catch (err) {
      setSearchResults({ error: err.message })
    }
    setSearching(false)
  }

  async function executeAction() {
    if (!executePrompt.trim()) return
    setExecuting(true)
    setExecuteResult(null)

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system: `You are Anka OS execute mode. The user wants to perform an action in the OS.
Analyse their request and respond ONLY with a JSON object:
{
  "action": "create_task" | "update_project_status" | "log_content" | "unsupported",
  "params": { ... relevant params ... },
  "confirmation": "Human readable description of what will happen",
  "unsupported_reason": "If unsupported, explain why"
}

Available projects: ${osContext?.activeProjects.map(p => `${p.id}:${p.name}`).join(', ')}`,
          messages: [{ role: 'user', content: executePrompt }]
        })
      })
      const data = await res.json()
      const text = data.content?.[0]?.text || '{}'
      const action = JSON.parse(text.replace(/```json|```/g, '').trim())

      if (action.action === 'create_task' && action.params?.title && action.params?.project_id) {
        const { error } = await supabase.from('as_tasks').insert({
          title: action.params.title,
          project_id: action.params.project_id,
          phase: action.params.phase || 'product_modeling',
          priority: action.params.priority || 'medium',
          status: 'todo',
          user_id: user?.id,
          assigned_to: user?.id
        })
        setExecuteResult({ success: !error, message: error ? error.message : `✅ Task created: "${action.params.title}"` })
      } else if (action.action === 'unsupported') {
        setExecuteResult({ success: false, message: action.unsupported_reason || 'Action not supported yet' })
      } else {
        setExecuteResult({ success: true, message: `✅ ${action.confirmation}` })
      }
    } catch (err) {
      setExecuteResult({ success: false, message: 'Parse error: ' + err.message })
    }
    setExecuting(false)
  }

  return (
    <div className="flex h-full bg-gray-950 text-white">
      {/* Sidebar — threads */}
      <div className="w-56 border-r border-gray-800 flex flex-col bg-gray-900">
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 bg-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">A</span>
            </div>
            <span className="text-sm font-semibold text-white">Anka</span>
          </div>
          <button onClick={newThread}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-2 rounded-lg">
            + New conversation
          </button>
        </div>

        {/* Mode switcher */}
        <div className="p-3 border-b border-gray-800 space-y-1">
          {Object.entries(MODES).map(([key, m]) => (
            <button key={key} onClick={() => setMode(key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${mode === key ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Thread history */}
        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-xs text-gray-600 uppercase tracking-wide mb-2">History</p>
          {threads.map(t => (
            <button key={t.id} onClick={() => { setActiveThread(t.id); setMode('chat') }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs mb-1 transition-colors truncate ${activeThread === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              {t.title || 'New conversation'}
            </button>
          ))}
        </div>

        {/* Context status */}
        <div className="p-3 border-t border-gray-800">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${osContext ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
            <span className="text-xs text-gray-500">
              {osContext ? `${osContext.summary.totalProjects} projects loaded` : 'Loading context...'}
            </span>
          </div>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* CHAT MODE */}
        {mode === 'chat' && (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <div className="w-16 h-16 bg-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <span className="text-white text-2xl font-bold">A</span>
                  </div>
                  <p className="text-lg font-medium text-gray-400">Anka Assistant</p>
                  <p className="text-sm mt-1 mb-6">Context-aware · Knows your OS · Ready to help</p>
                  <div className="grid grid-cols-2 gap-2 max-w-lg mx-auto">
                    {[
                      "What's the status of all active projects?",
                      "Which tasks are blocked right now?",
                      "Summarise what REL needs this week",
                      "Who has the most tasks assigned?",
                      "What handoffs are pending approval?",
                      "Write a client update email for REL",
                    ].map(s => (
                      <button key={s} onClick={() => setInput(s)}
                        className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2.5 rounded-lg text-left border border-gray-700 transition-colors">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'assistant' && (
                    <div className="w-7 h-7 bg-purple-600 rounded-full flex items-center justify-center text-xs font-bold text-white mr-2 flex-shrink-0 mt-1">A</div>
                  )}
                  <div className={`max-w-2xl rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-purple-600 text-white rounded-br-sm' : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-bl-sm'}`}>
                    <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
                    <p className="text-xs opacity-40 mt-1">{m.created_at ? new Date(m.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 bg-purple-600 rounded-full flex items-center justify-center text-xs font-bold text-white mr-2 flex-shrink-0">A</div>
                  <div className="bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3 border border-gray-700">
                    <div className="flex gap-1">
                      {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-4 border-t border-gray-800">
              <div className="flex gap-3">
                <input value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  className="flex-1 bg-gray-800 text-white rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700"
                  placeholder="Ask Anka anything about your projects, team, or clients..." />
                <button onClick={sendMessage} disabled={loading || !input.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-3 rounded-2xl text-sm transition-colors">→</button>
              </div>
            </div>
          </>
        )}

        {/* STANDUP MODE */}
        {mode === 'standup' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Daily Standup</h2>
                  <p className="text-sm text-gray-400 mt-0.5">{new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                </div>
                <button onClick={generateStandup} disabled={loading || contextLoading}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm">
                  {loading ? '⏳ Generating...' : '☀️ Generate Standup'}
                </button>
              </div>

              {/* Quick stats */}
              {osContext && (
                <div className="grid grid-cols-4 gap-3 mb-6">
                  {[
                    { label: 'My tasks', value: osContext.summary.myTaskCount, color: 'text-white' },
                    { label: 'Blocked', value: osContext.summary.blockedCount, color: osContext.summary.blockedCount > 0 ? 'text-red-400' : 'text-gray-500' },
                    { label: 'Handoffs', value: osContext.summary.pendingHandoffs, color: osContext.summary.pendingHandoffs > 0 ? 'text-yellow-400' : 'text-gray-500' },
                    { label: 'Active projects', value: osContext.summary.activeProjects, color: 'text-green-400' },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center">
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {messages.length > 0 && (
                <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-200 leading-relaxed">{messages[0]?.content}</pre>
                </div>
              )}

              {!messages.length && !loading && (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-3">☀️</p>
                  <p className="text-sm">Click Generate Standup to see your daily briefing</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* BRIEF MODE */}
        {mode === 'brief' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-5">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">Brief Generator</h2>
                <p className="text-sm text-gray-400">Generate SOPs, strategies, and briefs instantly</p>
              </div>

              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-2">Document Type</label>
                  <div className="flex flex-wrap gap-2">
                    {BRIEF_TYPES.map(t => (
                      <button key={t} onClick={() => setBriefType(t)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${briefType === t ? 'bg-purple-600 text-white border-purple-500' : 'bg-gray-700 text-gray-300 border-gray-600 hover:border-gray-500'}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Additional Context (optional)</label>
                  <textarea value={briefContext} onChange={e => setBriefContext(e.target.value)}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none" rows={3}
                    placeholder="Add specific details, client name, goals, constraints..." />
                </div>
                <button onClick={generateBrief} disabled={!briefType || generatingBrief}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  {generatingBrief ? '⏳ Generating...' : '📄 Generate Brief'}
                </button>
              </div>

              {briefOutput && (
                <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-white">{briefType}</p>
                    <button onClick={() => navigator.clipboard.writeText(briefOutput)}
                      className="text-xs text-blue-400 hover:text-blue-300">Copy</button>
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-200 leading-relaxed">{briefOutput}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SEARCH MODE */}
        {mode === 'search' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-5">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">Search Anka OS</h2>
                <p className="text-sm text-gray-400">Find projects, tasks, clients, content, keywords</p>
              </div>

              <div className="flex gap-3">
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchOS()}
                  className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700"
                  placeholder="Search for anything — projects, tasks, clients, keywords..." />
                <button onClick={searchOS} disabled={searching || !searchQuery.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-3 rounded-xl text-sm">
                  {searching ? '⏳' : '🔍'}
                </button>
              </div>

              {searchResults && !searchResults.error && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-400">{searchResults.total} results for "{searchQuery}"</p>

                  {searchResults.projects.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Projects ({searchResults.projects.length})</p>
                      {searchResults.projects.map(p => (
                        <div key={p.id} className="bg-gray-800 rounded-lg px-4 py-3 mb-2 border border-gray-700">
                          <p className="text-sm font-medium text-white">{p.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{p.current_phase} · {p.status}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.tasks.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Tasks ({searchResults.tasks.length})</p>
                      {searchResults.tasks.map(t => (
                        <div key={t.id} className="bg-gray-800 rounded-lg px-4 py-3 mb-2 border border-gray-700 flex items-center justify-between">
                          <p className="text-sm text-white">{t.title}</p>
                          <span className="text-xs text-gray-500 capitalize">{t.status}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.clients.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Clients ({searchResults.clients.length})</p>
                      {searchResults.clients.map(c => (
                        <div key={c.id} className="bg-gray-800 rounded-lg px-4 py-3 mb-2 border border-gray-700">
                          <p className="text-sm font-medium text-white">{c.name}</p>
                          {c.company && <p className="text-xs text-gray-400">{c.company}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.content.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Content ({searchResults.content.length})</p>
                      {searchResults.content.map(c => (
                        <div key={c.id} className="bg-gray-800 rounded-lg px-4 py-3 mb-2 border border-gray-700 flex items-center justify-between">
                          <p className="text-sm text-white">{c.title}</p>
                          <span className="text-xs text-gray-500 capitalize">{c.content_type} · {c.status}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.seo.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">SEO Pages ({searchResults.seo.length})</p>
                      {searchResults.seo.map(s => (
                        <div key={s.id} className="bg-gray-800 rounded-lg px-4 py-3 mb-2 border border-gray-700">
                          <p className="text-sm font-medium text-white">{s.page_name}</p>
                          {s.primary_keyword && <p className="text-xs text-gray-400">Keyword: {s.primary_keyword}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.total === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <p className="text-4xl mb-3">🔍</p>
                      <p className="text-sm">No results found for "{searchQuery}"</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* EXECUTE MODE */}
        {mode === 'execute' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-5">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">Execute</h2>
                <p className="text-sm text-gray-400">Tell Anka what to do in the OS — create tasks, update projects</p>
              </div>

              <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-3">
                <p className="text-xs text-yellow-300">⚡ Execute mode takes real actions in your OS. Review the confirmation before proceeding.</p>
              </div>

              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-2">What should Anka do?</label>
                  <textarea value={executePrompt} onChange={e => setExecutePrompt(e.target.value)}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none" rows={4}
                    placeholder="e.g. Create a task called 'Review homepage design' in the REL project with high priority..." />
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Create a task for homepage review in product modeling",
                    "Create a high priority task for SEO audit",
                    "Add a task to fix mobile layout",
                  ].map(s => (
                    <button key={s} onClick={() => setExecutePrompt(s)}
                      className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-600">
                      {s}
                    </button>
                  ))}
                </div>
                <button onClick={executeAction} disabled={!executePrompt.trim() || executing}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  {executing ? '⏳ Executing...' : '⚡ Execute'}
                </button>
              </div>

              {executeResult && (
                <div className={`rounded-xl p-4 border ${executeResult.success ? 'bg-green-900/30 border-green-700/50' : 'bg-red-900/30 border-red-700/50'}`}>
                  <p className={`text-sm font-medium ${executeResult.success ? 'text-green-300' : 'text-red-300'}`}>
                    {executeResult.message}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
