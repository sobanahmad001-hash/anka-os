import { Link } from 'react-router-dom'
import { navigationRecoveryMessage } from '../data/workshopNavigation.js'

const label = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export default function WorkshopContextShell({
  navigation,
  validation,
  returnTarget,
  projectName,
  children,
}) {
  if (navigation.status === 'empty') return children

  const usable = Boolean(validation.context) && ['ready', 'stale'].includes(validation.status)
  const context = validation.context || navigation
  const recordLabel = context.workRecord
    ? `${label(context.workRecord.kind)} / ${context.workRecord.id}`
    : 'No work record selected'
  const pointers = [
    context.output && `${label(context.output.kind)} / ${context.output.id}`,
    context.draft && `Draft ${label(context.draft.kind)} / ${context.draft.id}`,
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      <aside aria-label="Workshop navigation context" aria-live="polite" className={`rounded-2xl border p-4 ${usable ? 'border-violet-500/25 bg-violet-500/[0.07]' : 'border-amber-500/30 bg-amber-500/[0.08]'}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-300">Shared Workshop context</p>
            <p className="mt-1 truncate text-sm font-medium text-slate-200">{projectName || context.projectId || 'Workspace context'}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{recordLabel}</p>
            {pointers.length > 0 && <p className="mt-1 truncate text-xs text-slate-500">{pointers.join(' / ')}</p>}
            {validation.status === 'stale' && <p role="status" className="mt-2 text-sm text-amber-200">{navigationRecoveryMessage(validation.reason)}</p>}
            {!usable && <p role="alert" className="mt-2 text-sm text-amber-200">{navigationRecoveryMessage(validation.reason)}</p>}
          </div>
          <Link to={returnTarget} className="shrink-0 rounded-xl border border-violet-500/30 px-4 py-2 text-center text-sm font-semibold text-violet-200 hover:bg-violet-500/10 focus:outline-none focus:ring-2 focus:ring-violet-400">Back to work</Link>
        </div>
      </aside>
      {usable ? children : (
        <section role="alert" className="rounded-2xl border border-dashed border-amber-500/30 px-6 py-14 text-center">
          <h2 className="font-semibold text-amber-100">Workshop context not opened</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-amber-200/80">Return to Workspace or choose currently available work. The active organization was not changed.</p>
        </section>
      )}
    </div>
  )
}
