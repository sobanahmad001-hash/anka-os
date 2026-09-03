import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { quickTasks } from '../data/quickTasksRepository.js'
import { createQuickTaskCopyController } from '../data/quickTaskCopy.js'

function CopyAction({ organizationId, sourceRequestId, signal, onAccessError }) {
  const [state, setState] = useState({ busy: false, error: '', result: null })
  const controller = useMemo(() => createQuickTaskCopyController({
    invoke: quickTasks.copyGeneralRequest, organizationId, sourceRequestId,
    onChange: setState, onAccessError,
  }), [organizationId, sourceRequestId, onAccessError])
  useEffect(() => {
    controller.activate()
    const dispose = () => controller.dispose()
    if (signal?.aborted) dispose()
    signal?.addEventListener('abort', dispose)
    return () => { dispose(); signal?.removeEventListener('abort', dispose) }
  }, [controller, signal])
  return <div className="mt-4 border-t border-slate-800 pt-4">
    <p className="text-xs text-slate-400">Create a private Quick Task copy. This operational request and its handoffs stay unchanged.</p>
    {state.result ? <>
      <p role="status" className="mt-2 text-sm text-emerald-300">{state.result.purged
        ? 'The original copy was purged. Retrying did not recreate it.'
        : 'Your private copy is available in Quick Tasks.'}</p>
      <button type="button" onClick={() => controller.another()} className="mt-2 text-sm text-amber-300">Prepare another copy</button>
    </> : <button type="button" disabled={state.busy} onClick={() => controller.copy()} className="mt-2 text-sm text-amber-300 disabled:opacity-50">
      {state.busy ? 'Copying…' : state.error ? 'Retry copy' : 'Copy to Quick Tasks'}
    </button>}
    {state.error && <p role="alert" className="mt-2 text-sm text-red-300">{state.error}</p>}
  </div>
}

export default function GeneralRequestQuickTaskCopy({ request }) {
  const { user } = useAuth()
  const scope = useOrganization()
  const ready = user?.id && !scope.loading && !scope.error && !scope.selectionRequired
    && scope.activeMembership && scope.activeOrganization?.status === 'active'
    && scope.activeOrganizationId === request.organization_id && !scope.requestSignal?.aborted
  if (!ready) return <button type="button" disabled className="mt-4 text-sm text-slate-500">Select an active organization to copy</button>
  return <CopyAction key={`${user.id}:${scope.activeOrganizationId}:${scope.scopeRevision}:${request.id}`}
    organizationId={scope.activeOrganizationId} sourceRequestId={request.id}
    signal={scope.requestSignal} onAccessError={scope.handleOrganizationAccessError} />
}
