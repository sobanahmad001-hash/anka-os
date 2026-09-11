import { createElement } from 'react'

export function WebsitePageRecordActions({
  label,
  buttonClassName,
  canMoveEarlier,
  canMoveLater,
  onAddChild,
  onDuplicate,
  onMoveEarlier,
  onMoveLater,
}) {
  return createElement('div', { className: 'flex flex-wrap items-center justify-end gap-2' },
    createElement('button', { type: 'button', onClick: onAddChild, className: buttonClassName }, 'Add child'),
    createElement('button', { type: 'button', onClick: onDuplicate, className: buttonClassName }, 'Duplicate'),
    createElement('button', {
      type: 'button', 'aria-label': `Move ${label} earlier`, disabled: !canMoveEarlier,
      onClick: onMoveEarlier, className: buttonClassName,
    }, '↑'),
    createElement('button', {
      type: 'button', 'aria-label': `Move ${label} later`, disabled: !canMoveLater,
      onClick: onMoveLater, className: buttonClassName,
    }, '↓'),
  )
}

export function WebsiteArchitecturePathAlert({ hasErrors }) {
  if (!hasErrors) return null
  return createElement('p', {
    role: 'alert',
    className: 'mt-4 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200',
  }, 'Resolve every proposed path before saving this Website architecture version.')
}
