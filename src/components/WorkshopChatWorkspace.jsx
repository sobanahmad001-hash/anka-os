import { useId, useState } from 'react'
import './designWorkshopPresentation.css'

// Presentation only: each child retains its own store, permissions and saved-thread controls.
export default function WorkshopChatWorkspace({ mode, onModeChange, departmentName, projectName, engagementName, conversationList, onConversationSelect, navigationBusy = false, presentation, children }) {
  const design = presentation === 'design'
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyId = useId()
  const [pendingMode, setPendingMode] = useState(null)
  const [pendingConversation, setPendingConversation] = useState(null)
  const cancel = () => { setPendingMode(null); setPendingConversation(null) }
  const privateMode = mode === 'private'
  return <section aria-label="Workshop Chat" className={design ? 'design-workshop mt-6 space-y-4' : 'mt-6 space-y-4'}>
    <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-xl font-semibold">Chat</h2>
          <p className="mt-1 text-sm text-slate-400">Saved conversations for {departmentName}. Choose the context you want to open.</p>
        </div>
        {design && conversationList && <button type="button" aria-expanded={historyOpen} aria-controls={historyId} onClick={() => setHistoryOpen(value => !value)}>Conversations</button>}
        <label className="grid w-full gap-2 text-xs font-semibold text-slate-300 sm:w-auto">Conversation context
          <select aria-label="Conversation context" value={pendingMode || mode} onChange={event => { setPendingConversation(null); setPendingMode(event.target.value === mode ? null : event.target.value) }} className="max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
            <option value="private">Private exploration</option>
            <option value="chat">Project / engagement</option>
          </select>
        </label>
      </div>
      <div aria-label="Current conversation scope" className="mt-4 space-y-1 text-sm" role="status">
        <p>Context: {privateMode ? `${departmentName} exploration · no project attached` : engagementName ? `${projectName} · ${engagementName}` : 'Choose an eligible project engagement below'}</p>
        <p className="text-slate-300">{privateMode ? 'Visibility: only you' : 'Visibility: per conversation — creator-private unless explicitly shared with selected internal teammates'}</p>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">{conversationList ? 'The saved list includes private exploration and the explicitly selected engagement only.' : 'The saved list below belongs only to the current context.'} Private exploration and engagement conversations keep separate histories. Switching context does not share or move messages.</p>
      {pendingMode && <div role="group" aria-label="Confirm conversation context switch" className="mt-4 rounded-xl border border-amber-700/50 p-3">
        <p className="text-sm text-amber-200">Switching may discard unsaved text. Save it first or cancel. Switching closes this view; unsaved text and selections are not transferred or saved automatically.</p>
        {pendingConversation && <p className="mt-2 text-sm">Open: {pendingConversation.row.title} · {pendingConversation.kind === 'private' ? 'Private exploration' : 'Selected engagement'}</p>}
        {navigationBusy && <p role="status" className="mt-2 text-sm text-amber-200">The current conversation has an operation in progress. Wait for it to finish before switching.</p>}
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={cancel} className="rounded-lg border border-slate-600 px-3 py-2 text-sm">Stay in current context</button>
          <button type="button" disabled={navigationBusy} onClick={() => { if (navigationBusy) return; if (pendingConversation) onConversationSelect(pendingConversation); else onModeChange(pendingMode); cancel() }} className="rounded-lg bg-violet-600 px-3 py-2 text-sm disabled:opacity-50">Switch context</button>
        </div>
      </div>}
    </header>
    {conversationList ? <div className={design ? `design-chat-layout ${historyOpen ? 'history-open' : ''}` : 'grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]'}>
      <div id={historyId} hidden={design && !historyOpen}>{conversationList(item => { setPendingConversation(item); setPendingMode(item.kind === 'private' ? 'private' : 'chat') })}</div>
      <div className="min-w-0">{children}</div>
    </div> : children}
  </section>
}
