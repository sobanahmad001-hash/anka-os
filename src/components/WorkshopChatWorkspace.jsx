import { useState } from 'react'

// Presentation only: each child retains its own store, permissions and saved-thread controls.
export default function WorkshopChatWorkspace({ mode, onModeChange, departmentName, projectName, engagementName, children }) {
  const [pendingMode, setPendingMode] = useState(null)
  const privateMode = mode === 'private'
  return <section aria-label="Workshop Chat" className="mt-6 space-y-4">
    <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-xl font-semibold">Chat</h2>
          <p className="mt-1 text-sm text-slate-400">Saved conversations for {departmentName}. Choose the context you want to open.</p>
        </div>
        <label className="grid w-full gap-2 text-xs font-semibold text-slate-300 sm:w-auto">Conversation context
          <select aria-label="Conversation context" value={pendingMode || mode} onChange={event => setPendingMode(event.target.value === mode ? null : event.target.value)} className="max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
            <option value="private">Private exploration</option>
            <option value="chat">Project / engagement</option>
          </select>
        </label>
      </div>
      <div aria-label="Current conversation scope" className="mt-4 space-y-1 text-sm" role="status">
        <p>Context: {privateMode ? `${departmentName} exploration · no project attached` : engagementName ? `${projectName} · ${engagementName}` : 'Choose an eligible project engagement below'}</p>
        <p className="text-slate-300">{privateMode ? 'Visibility: only you' : 'Visibility: per conversation — creator-private unless explicitly shared with selected internal teammates'}</p>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">The saved list below belongs only to the current context. Private exploration and engagement conversations keep separate histories. Switching context does not share or move messages. Use the existing conversation controls to see yours or shared-with-you threads.</p>
      {pendingMode && <div role="group" aria-label="Confirm conversation context switch" className="mt-4 rounded-xl border border-amber-700/50 p-3">
        <p className="text-sm text-amber-200">Switching may discard unsaved text. Save it first or cancel. Switching closes this view; unsaved text and selections are not transferred or saved automatically.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={() => setPendingMode(null)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm">Stay in current context</button>
          <button type="button" onClick={() => { onModeChange(pendingMode); setPendingMode(null) }} className="rounded-lg bg-violet-600 px-3 py-2 text-sm">Switch context</button>
        </div>
      </div>}
    </header>
    {children}
  </section>
}
