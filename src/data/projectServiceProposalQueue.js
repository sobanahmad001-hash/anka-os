import { canShowAuthorityAdministration } from './authorityAdministration.js'

// Read generations and display metadata are deliberately not authorization identity.
export function projectServiceProposalContextKey({ organizationId, project, membership, actorId }) {
  return JSON.stringify([organizationId, project.id, actorId, membership?.id,
    membership?.organizationId, membership?.role, membership?.status, membership?.member_kind,
    [...new Set([membership?.departmentId, ...(membership?.departmentIds || [])].filter(Boolean))].sort()])
}

export async function canManageProjectServices({ organizationId, projectId, actorId, membership, hasOwnManagerBinding, signal }) {
  if (!actorId || membership?.organizationId !== organizationId) return false
  if (canShowAuthorityAdministration(membership)) return true
  return hasOwnManagerBinding(organizationId, projectId, actorId, { signal })
}

// Keep successful item results even if either refresh fails. A refreshed read signal
// may stop dispatch, but cannot erase the outcome of an already dispatched command.
export async function submitProjectServiceProposals({ queue, refresh, onChanged, onError, onSaving,
  isCurrent, canDispatch = isCurrent, onResult, ...options }) {
  onSaving(true)
  let changed = false
  try {
    await queue.submit({ ...options, isCurrent, canDispatch, onResult: (id, result) => {
      if (result.status === 'succeeded') changed = true
      onResult(id, result)
    } })
    if (changed && canDispatch()) {
      try { await refresh() } catch (cause) {
        if (isCurrent()) onError(`Proposals saved, but service scope could not be refreshed: ${cause.message}`)
      }
      if (canDispatch()) await onChanged?.()
    }
  } catch (cause) {
    if (isCurrent()) onError(cause.message)
  } finally {
    if (isCurrent()) onSaving(false)
  }
}

// Each attempted proposal owns one immutable command, including its idempotency key.
// Retain failed commands even when the transport cannot tell whether the save committed.
export function createProjectServiceProposalQueue() {
  const commands = new Map()
  const succeeded = new Set()
  let running = false
  return {
    succeeded,
    async submit({ items, organizationId, projectId, change, isCurrent, canDispatch = isCurrent, onResult,
      createRequestId = () => globalThis.crypto?.randomUUID?.() }) {
      if (running || !isCurrent() || !canDispatch()) return
      running = true
      try {
        for (const item of items) {
          if (!isCurrent() || !canDispatch()) break
          if (succeeded.has(item.serviceId)) continue
          let command = commands.get(item.serviceId)
          if (!command) {
            const requestId = createRequestId()
            if (!requestId) throw new Error('A secure request ID is unavailable.')
            command = Object.freeze({ organizationId, projectId, requestId, action: 'add',
              serviceId: item.serviceId, scopeStatement: item.scopeStatement, exclusions: item.exclusions,
              quantity: Number(item.quantity), ownerId: item.ownerId,
              startDate: item.startDate, targetDate: item.targetDate })
            commands.set(item.serviceId, command)
          }
          onResult(item.serviceId, { status: 'saving' })
          if (!isCurrent() || !canDispatch()) break
          try {
            await change(command)
            succeeded.add(item.serviceId)
          } catch (error) {
            if (isCurrent()) onResult(item.serviceId, { status: 'failed', error })
            continue
          }
          if (isCurrent()) onResult(item.serviceId, { status: 'succeeded' })
        }
      } finally { running = false }
    },
  }
}
