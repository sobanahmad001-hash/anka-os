import WorkshopConversationRail from './WorkshopConversationRail.jsx'
import { useEffect, useId, useRef, useState } from 'react'
import { WorkshopChatHistoryContext } from '../context/WorkshopChatHistoryContext.jsx'
import './designWorkshopPresentation.css'

// Presentation only: each child retains its own store, permissions and saved-thread controls.
export default function WorkshopChatWorkspace({ mode, onModeChange, departmentName, projectName, engagementName, conversationList, onConversationSelect, navigationBusy = false, presentation, compactPrivate = false, compactChat = false, draftDirty, children }) {
  const design = presentation === 'design'
  const compact = compactPrivate || compactChat
  const historyId = useId()
  const [pendingMode, setPendingMode] = useState(null)
  const [pendingConversation, setPendingConversation] = useState(null)
  const alive=useRef(true),current=useRef(null)
  current.current={mode,onModeChange,onConversationSelect,draftDirty,navigationBusy,pendingMode,pendingConversation}
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false}},[])
  const cancel = () => { setPendingMode(null); setPendingConversation(null) }
  const privateMode = mode === 'private'
  const requestMode = next => {
    if (!alive.current || current.current.navigationBusy) return
    if (next === current.current.mode) { cancel(); return }
    if (current.current.draftDirty === false) { current.current.onModeChange(next); cancel(); return }
    setPendingConversation(null); setPendingMode(next)
  }
  const requestConversation = item => {
    if (!alive.current || current.current.navigationBusy) return
    if (current.current.draftDirty === false) { current.current.onConversationSelect(item); cancel(); return }
    setPendingConversation(item); setPendingMode(item.kind === 'private' ? 'private' : 'chat')
  }
  const scopeHeader = <header className={compact ? 'direct-workshop-context' : 'rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        {!compact && <div><h2 className="text-xl font-semibold">Chat</h2>
          <p className="mt-1 text-sm text-[var(--anka-muted)]">Saved conversations for {departmentName}. Choose the context you want to open.</p>
        </div>}
        <label className={compact ? 'flex items-center gap-2 text-xs font-semibold text-[var(--anka-muted)]' : 'grid w-full gap-2 text-xs font-semibold text-[var(--anka-muted)] sm:w-auto'}>{compact ? 'Context' : 'Conversation context'}
          <select aria-label="Conversation context" value={pendingMode || mode} onChange={event => requestMode(event.target.value)} className="max-w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] px-3 py-2 text-sm text-[var(--anka-ink)]">
            <option value="private">Private exploration</option>
            <option value="chat">Project / engagement</option>
          </select>
        </label>
      </div>
      {!compact && <div aria-label="Current conversation scope" className="mt-4 space-y-1 text-sm" role="status">
        <p>Context: {privateMode ? `${departmentName} exploration · no project attached` : engagementName ? `${projectName} · ${engagementName}` : 'Choose an eligible project engagement below'}</p>
        <p className="text-[var(--anka-muted)]">{privateMode ? 'Visibility: only you' : 'Visibility: per conversation — creator-private unless explicitly shared with selected internal teammates'}</p>
      </div>}
      {!compact && <p className="mt-3 text-xs leading-5 text-[var(--anka-muted)]">{conversationList ? 'Saved histories are grouped by authorized project and engagement; private exploration stays separate.' : 'The saved list below belongs only to the current context.'} Private exploration and engagement conversations keep separate histories. Switching context does not share or move messages.</p>}
      {compact && <details className="text-xs text-[var(--anka-muted)]"><summary>Scope</summary><p>Visibility: {privateMode ? 'only you' : 'per conversation; private unless deliberately shared'}. Switching context opens a separate history; it does not share or move these messages.</p></details>}
      {pendingMode && <div role="group" aria-label="Confirm conversation context switch" className="mt-4 rounded-xl border border-[var(--anka-warning)] p-3">
        <p className="text-sm text-[var(--anka-warning)]">Switching may discard unsaved text. Save it first or cancel. Switching closes this view; unsaved text and selections are not transferred or saved automatically.</p>
        {pendingConversation && <p className="mt-2 text-sm">Open: {pendingConversation.row.title} · {pendingConversation.kind === 'private' ? 'Private exploration' : 'Selected engagement'}</p>}
        {navigationBusy && <p role="status" className="mt-2 text-sm text-[var(--anka-warning)]">The current conversation has an operation in progress. Wait for it to finish before switching.</p>}
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={cancel} className="rounded-lg border border-[var(--anka-line)] px-3 py-2 text-sm">Stay in current context</button>
          <button type="button" disabled={navigationBusy} onClick={() => { if (!alive.current || current.current.navigationBusy || current.current.pendingMode!==pendingMode || current.current.pendingConversation!==pendingConversation) return; if (pendingConversation) current.current.onConversationSelect(pendingConversation); else current.current.onModeChange(pendingMode); cancel() }} className="rounded-lg bg-[var(--anka-violet)] text-[var(--anka-on-violet)] px-3 py-2 text-sm disabled:opacity-50">Switch context</button>
        </div>
      </div>}
    </header>
  return <section aria-label="Workshop Chat" className={design ? 'design-workshop mt-6 space-y-4' : 'mt-6 space-y-4'}>
    {!compactChat && scopeHeader}
    {compactChat && conversationList ? <WorkshopConversationRail header={scopeHeader} navigationBusy={navigationBusy} renderHistory={closeAfter => conversationList(item => closeAfter(() => requestConversation(item)))}>{children}</WorkshopConversationRail> : conversationList && !compactPrivate ? <div className={design ? 'design-chat-layout history-open' : 'grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]'}>
      <div id={historyId}>{conversationList(requestConversation)}</div>
      <div className="min-w-0">{children}</div>
    </div> : compactPrivate && conversationList ? <WorkshopChatHistoryContext.Provider value={{ render: conversationList, onOpen: requestConversation }}>{children}</WorkshopChatHistoryContext.Provider> : children}
  </section>
}
