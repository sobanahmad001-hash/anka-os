import { useEffect, useId, useRef } from 'react'

// Presentation only: command ownership and pending-state decisions stay with the caller.
export default function WorkspaceDialog({ title, onClose, busy = false, wide = false, children }) {
  const titleId = useId()
  const panel = useRef(null)
  const current = useRef({ onClose, busy })
  current.current = { onClose, busy }
  useEffect(() => {
    const previous = document.activeElement
    const node = panel.current
    const focusable = () => [...node.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter(item => !item.disabled && item.tabIndex >= 0 && item.getClientRects().length)
    const focusFirst = () => (focusable()[0] || node).focus()
    focusFirst()
    const keydown = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (!current.current.busy) current.current.onClose()
      }
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1)
        if (!first) { event.preventDefault(); node.focus(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    const containFocus = event => { if (!node.contains(event.target)) focusFirst() }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', containFocus)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4">
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} className={`max-h-[90dvh] w-full min-w-0 overflow-y-auto workspace-card p-4 shadow-2xl sm:p-6 ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
      <div className="mb-5 flex items-start justify-between gap-4"><h2 id={titleId} className="min-w-0 break-words text-lg font-semibold">{title}</h2><button type="button" disabled={busy} onClick={() => { if (!current.current.busy) current.current.onClose() }} className="workspace-button shrink-0 disabled:opacity-50">Close</button></div>
      {busy && <p role="status" className="mb-3 text-sm text-[var(--anka-muted)]">Saving changes. Keep this window open until the result is confirmed.</p>}
      {children}
    </div>
  </div>
}
