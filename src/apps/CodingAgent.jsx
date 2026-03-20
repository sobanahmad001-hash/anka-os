import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { fetchBranches, fetchCommits, getRepoContents, getFileContent, createOrUpdateFile, createPullRequest, searchCode } from '../lib/github.js'

const AGENT_MODES = {
  explore: 'Explore Repo',
  write: 'Write Code',
  review: 'Review & PR',
  ask: 'Ask Agent',
}

export default function CodingAgent() {
  const { user, profile } = useAuth()
  const [mode, setMode] = useState('ask')
  const [loading, setLoading] = useState(false)
  const [repoLoading, setRepoLoading] = useState(false)

  const [branches, setBranches] = useState([])
  const [commits, setCommits] = useState([])
  const [repoTree, setRepoTree] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [currentPath, setCurrentPath] = useState('')

  const [targetFile, setTargetFile] = useState('')
  const [codeContent, setCodeContent] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [createdPR, setCreatedPR] = useState(null)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [agentWorking, setAgentWorking] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const messagesEndRef = useRef(null)

  useEffect(() => {
    loadRepoData()
    loadProjects()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadRepoData() {
    setRepoLoading(true)
    const [branchData, commitData, treeData] = await Promise.all([
      fetchBranches(),
      fetchCommits('main', 10),
      getRepoContents('')
    ])
    setBranches(branchData || [])
    setCommits(commitData || [])
    setRepoTree(Array.isArray(treeData) ? treeData : [])
    setRepoLoading(false)
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, name, description').order('updated_at', { ascending: false })
    setProjects(data || [])
  }

  async function browseFolder(path) {
    setRepoLoading(true)
    setCurrentPath(path)
    const contents = await getRepoContents(path)
    setRepoTree(Array.isArray(contents) ? contents : [])
    setRepoLoading(false)
  }

  async function openFile(path) {
    setRepoLoading(true)
    const file = await getFileContent(path)
    if (file) {
      setSelectedFile(file)
      setFileContent(file.content)
      setTargetFile(path)
      setCodeContent(file.content)
    }
    setRepoLoading(false)
  }

  async function handleCodeSearch() {
    if (!searchQuery.trim()) return
    setLoading(true)
    const results = await searchCode(searchQuery)
    setSearchResults(results)
    setLoading(false)
  }

  async function createPR() {
    if (!targetFile || !codeContent || !commitMessage || !prTitle) return
    setLoading(true)
    const result = await createOrUpdateFile(
      targetFile, codeContent, commitMessage,
      selectedFile?.sha || null
    )
    if (result?.branch) {
      const pr = await createPullRequest(prTitle, prBody || commitMessage, result.branch)
      if (pr) {
        setCreatedPR(pr)
        addMessage('assistant', `PR created: ${pr.title}\n\nURL: ${pr.html_url}\nBranch: ${result.branch}`)
      } else {
        addMessage('assistant', 'PR creation failed. Check GitHub token permissions.')
      }
    } else {
      addMessage('assistant', 'File update failed. Check GitHub token and repo settings.')
    }
    setLoading(false)
  }

  function addMessage(role, content) {
    setMessages(prev => [...prev, { role, content, ts: new Date().toISOString() }])
  }

  async function sendMessage() {
    if (!input.trim()) return
    const userMsg = input.trim()
    setInput('')
    addMessage('user', userMsg)
    setAgentWorking(true)

    const selectedProject = projects.find(p => p.id === selectedProjectId)
    const recentCommitSummary = commits.slice(0, 3).map(c => `- ${c.message} (${c.author})`).join('\n')
    const branchList = branches.slice(0, 5).map(b => b.name).join(', ')

    const systemPrompt = `You are the Anka Coding Agent — an expert full-stack developer assistant embedded in the Anka OS. You help developers understand codebases, write code, review changes, and create pull requests.

Current repo context:
- Recent commits:\n${recentCommitSummary}
- Active branches: ${branchList}
- Current path: ${currentPath || 'root'}
${selectedProject ? `- Active project: ${selectedProject.name}\n  ${selectedProject.description || ''}` : ''}
${selectedFile ? `- Open file: ${selectedFile.path}` : ''}

You can:
1. Analyze code and suggest improvements
2. Write new code or modify existing files
3. Explain what code does
4. Suggest architecture decisions
5. Review changes before PR

When writing code, be specific about file paths. Format code in triple backtick blocks.
Be concise and actionable. If suggesting file changes, mention the exact file path.`

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
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
          system: systemPrompt,
          messages: [
            ...messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMsg }
          ]
        })
      })
      const data = await response.json()
      const reply = data.content?.[0]?.text || 'No response'
      addMessage('assistant', reply)

      const codeMatch = reply.match(/```(?:jsx?|tsx?|ts|js|python|css)?\n([\s\S]+?)```/)
      const pathMatch = reply.match(/[`']([a-zA-Z0-9/_.-]+\.[a-zA-Z]{2,5})[`']/)
      if (codeMatch && pathMatch && mode === 'ask') {
        setCodeContent(codeMatch[1])
        setTargetFile(pathMatch[1])
        setCommitMessage(`feat: ${userMsg.slice(0, 60)}`)
        setPrTitle(`Agent: ${userMsg.slice(0, 60)}`)
      }
    } catch (e) {
      addMessage('assistant', 'Agent error. Check API connection.')
    }
    setAgentWorking(false)
  }

  const envConfigured = import.meta.env.VITE_GITHUB_TOKEN && import.meta.env.VITE_GITHUB_REPO

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Coding Agent</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {envConfigured
              ? `Connected · ${branches.length} branches · ${commits.length} recent commits`
              : 'GitHub token not configured — add VITE_GITHUB_TOKEN to .env.local'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {projects.length > 0 && (
            <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
              className="bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500">
              <option value="">No project context</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={loadRepoData} className="text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700">Refresh</button>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 px-6 py-3 border-b border-gray-800">
        {Object.entries(AGENT_MODES).map(([key, label]) => (
          <button key={key} onClick={() => setMode(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${mode === key ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex">

        {/* EXPLORE MODE */}
        {mode === 'explore' && (
          <div className="flex-1 flex overflow-hidden">
            <div className="w-64 border-r border-gray-800 overflow-y-auto p-4">
              <div className="flex items-center gap-2 mb-3">
                {currentPath && (
                  <button onClick={() => {
                    const parent = currentPath.split('/').slice(0, -1).join('/')
                    browseFolder(parent)
                  }} className="text-gray-400 hover:text-white text-xs">Back</button>
                )}
                <p className="text-xs text-gray-500 truncate">/{currentPath || 'root'}</p>
              </div>
              {repoLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-500" /></div>
              ) : (
                <div className="space-y-1">
                  {repoTree.map(item => (
                    <button key={item.path} onClick={() => item.type === 'dir' ? browseFolder(item.path) : openFile(item.path)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-2 ${selectedFile?.path === item.path ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}>
                      <span>{item.type === 'dir' ? 'D' : 'F'}</span>
                      <span className="truncate">{item.name}</span>
                    </button>
                  ))}
                  {repoTree.length === 0 && <p className="text-xs text-gray-500 text-center py-4">Empty or no access</p>}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {selectedFile ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-white">{selectedFile.path}</p>
                    <button onClick={() => { setMode('write'); setCodeContent(fileContent) }}
                      className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded-lg">Edit in Write Mode</button>
                  </div>
                  <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap border border-gray-800">
                    {fileContent}
                  </pre>
                </div>
              ) : (
                <div className="h-full flex flex-col">
                  <div className="flex gap-2 mb-4">
                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCodeSearch()}
                      className="flex-1 bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 border border-gray-700"
                      placeholder="Search codebase..." />
                    <button onClick={handleCodeSearch} disabled={loading}
                      className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-2 rounded-lg">Search</button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className="space-y-2">
                      {searchResults.map((r, i) => (
                        <div key={i} onClick={() => openFile(r.path)}
                          className="bg-gray-800 rounded-lg p-3 cursor-pointer hover:border-purple-500/50 border border-gray-700 transition-colors">
                          <p className="text-xs font-medium text-purple-300">{r.path}</p>
                          <p className="text-xs text-gray-400 mt-1 truncate">{r.repository?.full_name}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {!searchResults.length && (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                      <div className="text-center">
                        <p className="text-sm">Select a file to view or search the codebase</p>
                      </div>
                    </div>
                  )}
                  {commits.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs text-gray-400 mb-2 font-medium">Recent Commits</p>
                      <div className="space-y-2">
                        {commits.map((c, i) => (
                          <div key={i} className="bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
                            <p className="text-xs text-white truncate">{c.message}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{c.author} · {new Date(c.date).toLocaleDateString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* WRITE MODE */}
        {mode === 'write' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">File Path</label>
                <input value={targetFile} onChange={e => setTargetFile(e.target.value)}
                  className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 border border-gray-700"
                  placeholder="src/components/MyComponent.jsx" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Commit Message</label>
                <input value={commitMessage} onChange={e => setCommitMessage(e.target.value)}
                  className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 border border-gray-700"
                  placeholder="feat: add new component" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Code</label>
              <textarea value={codeContent} onChange={e => setCodeContent(e.target.value)}
                className="w-full bg-gray-900 text-gray-200 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none border border-gray-700"
                rows={20} placeholder="Write or paste code here..." />
            </div>
            <button onClick={() => setMode('review')} disabled={!targetFile || !codeContent}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm">
              Review and Create PR
            </button>
          </div>
        )}

        {/* REVIEW & PR MODE */}
        {mode === 'review' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">Create Pull Request</h3>

            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">File: <span className="text-purple-300">{targetFile || 'No file selected'}</span></p>
              <p className="text-xs text-gray-400">Commit: <span className="text-white">{commitMessage || 'No message'}</span></p>
              {codeContent && (
                <pre className="mt-3 text-xs text-gray-300 font-mono bg-gray-900 rounded-lg p-3 overflow-x-auto max-h-48 border border-gray-700">
                  {codeContent.slice(0, 500)}{codeContent.length > 500 ? '\n...' : ''}
                </pre>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">PR Title *</label>
                <input value={prTitle} onChange={e => setPrTitle(e.target.value)}
                  className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 border border-gray-700"
                  placeholder="feat: describe what this PR does" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">PR Description</label>
                <textarea value={prBody} onChange={e => setPrBody(e.target.value)}
                  className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none border border-gray-700"
                  rows={4} placeholder="What does this change do? Why is it needed?" />
              </div>
            </div>

            {createdPR && (
              <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-4">
                <p className="text-sm font-medium text-green-300">PR Created Successfully</p>
                <a href={createdPR.html_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 mt-1 block">
                  {createdPR.html_url}
                </a>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={createPR} disabled={loading || !targetFile || !codeContent || !prTitle}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                {loading ? 'Creating PR...' : 'Create Pull Request'}
              </button>
              <button onClick={() => setMode('write')} className="text-gray-400 text-sm hover:text-white px-3">Back to Write</button>
            </div>
          </div>
        )}

        {/* ASK AGENT MODE */}
        {mode === 'ask' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p className="text-sm font-medium text-gray-400">Anka Coding Agent</p>
                  <p className="text-xs mt-1 mb-6">Context-aware · Repo-connected · PR-ready</p>
                  <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
                    {[
                      'Explain the project structure',
                      'How does the auth system work?',
                      'Write a new React component for X',
                      'Review recent changes and suggest improvements',
                    ].map(s => (
                      <button key={s} onClick={() => setInput(s)}
                        className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-left border border-gray-700 transition-colors">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-2xl rounded-xl px-4 py-3 text-sm ${msg.role === 'user' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-200 border border-gray-700'}`}>
                    <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                  </div>
                </div>
              ))}
              {agentWorking && (
                <div className="flex justify-start">
                  <div className="bg-gray-800 rounded-xl px-4 py-3 text-sm text-gray-400 border border-gray-700">
                    <span className="animate-pulse">Agent is working...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-4 border-t border-gray-800">
              <div className="flex gap-2">
                <input value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700"
                  placeholder="Ask about the codebase, request changes, or describe what to build..." />
                <button onClick={sendMessage} disabled={agentWorking || !input.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm transition-colors">Send</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
