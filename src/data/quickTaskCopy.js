export function requireQuickTaskCopyResult(value) {
  if (!value || typeof value.quick_task_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.quick_task_id)
    || !['active', 'preserved', 'expired', 'discarded', 'promoted'].includes(value.state)
    || typeof value.purged !== 'boolean' || typeof value.replayed !== 'boolean') {
    throw new Error('Copy response was incomplete. Retry to recover the original result.')
  }
  return value
}

// Keep the key after an uncertain response: the transaction may have committed.
export function createQuickTaskCopyController({ invoke, organizationId, sourceRequestId, onChange, onAccessError = () => {}, newKey = () => crypto.randomUUID() }) {
  let alive = true
  let pending = false
  let key = null
  let completed = false
  let generation = 0
  return Object.freeze({
    activate() { alive = true },
    dispose() { alive = false; generation += 1 },
    async copy() {
      if (!alive || pending || completed) return
      key ||= newKey()
      pending = true
      const current = generation
      onChange({ busy: true, error: '', result: null })
      try {
        const result = await invoke({ organizationId, sourceRequestId, idempotencyKey: key })
        if (!alive || current !== generation) return
        completed = true
        onChange({ busy: false, error: '', result })
      } catch (error) {
        if (!alive || current !== generation) return
        onChange({ busy: false, error: error.message || 'Copy failed. Retry the same request.', result: null })
        onAccessError(error)
      } finally { pending = false }
    },
    another() {
      if (!alive || pending || !completed) return
      key = null
      completed = false
      onChange({ busy: false, error: '', result: null })
    },
  })
}
