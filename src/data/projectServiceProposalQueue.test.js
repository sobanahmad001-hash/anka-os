import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { canManageProjectServices, createProjectServiceProposalQueue, projectServiceProposalContextKey, submitProjectServiceProposals } from './projectServiceProposalQueue.js'

const items = ['design', 'content', 'development'].map((serviceId, index) => ({ serviceId,
  unit: `unit-${index}`, recurrence: `period-${index}`, scopeStatement: `Scope ${index}`, exclusions: `Excluded ${index}`, quantity: index + 1,
  ownerId: `owner-${index}`, startDate: '2026-10-01', targetDate: `2026-10-0${index + 2}` }))
const options = overrides => {
  let id = 0
  return { items, organizationId: 'org', projectId: 'project', isCurrent: () => true,
    createRequestId: () => `request-${++id}`, onResult: () => {}, ...overrides }
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('multiple services dispatch sequentially with separate values and only add actions', async () => {
  const queue = createProjectServiceProposalQueue()
  const first = deferred()
  const calls = []
  const saving = queue.submit(options({ change: async command => {
    calls.push(command)
    if (calls.length === 1) await first.promise
  } }))
  assert.equal(calls.length, 1)
  first.resolve()
  await saving
  assert.equal(calls.length, 3)
  for (const [index, call] of calls.entries()) {
    assert.deepEqual(call, { ...items[index], organizationId: 'org', projectId: 'project',
      requestId: `request-${index + 1}`, action: 'add' })
    assert.ok(Object.isFrozen(call))
  }
  assert.ok(calls.every(call => call.action !== 'activate'))
})

test('partial failure continues, retains original payload and request ID on repeated uncertain retries', async () => {
  const queue = createProjectServiceProposalQueue()
  const calls = []
  const results = []
  let fail = true
  const submitOptions = options({ change: async command => {
    calls.push(command)
    if (command.serviceId === 'content' && fail) throw new Error('Response lost after possible commit')
  }, onResult: (id, result) => results.push([id, result.status]) })
  await queue.submit(submitOptions)
  assert.deepEqual(results, [['design', 'saving'], ['design', 'succeeded'], ['content', 'saving'],
    ['content', 'failed'], ['development', 'saving'], ['development', 'succeeded']])
  assert.deepEqual([...queue.succeeded], ['design', 'development'])
  const original = calls[1]
  const edited = items.map(item => ({ ...item, quantity: 999, scopeStatement: 'Changed', unit: 'edited unit', recurrence: 'edited recurrence' }))
  await queue.submit({ ...submitOptions, items: edited })
  assert.equal(calls[3], original)
  fail = false
  await queue.submit({ ...submitOptions, items: edited })
  assert.equal(calls[4], original)
  await queue.submit(submitOptions)
  assert.equal(calls.length, 5)
  assert.equal(queue.succeeded.size, 3)
})

for (const outcome of ['success', 'failure']) {
  test(`stale project context stops further dispatch after in-flight ${outcome}`, async () => {
    const queue = createProjectServiceProposalQueue()
    const pending = deferred()
    let currentProject = 'project'
    const calls = []
    const results = []
    const saving = queue.submit(options({ isCurrent: () => currentProject === 'project',
      onResult: (id, result) => results.push([id, result.status]),
      change: async command => { calls.push(command); await pending.promise; if (outcome === 'failure') throw new Error('Failed') },
    }))
    currentProject = 'another-project'
    pending.resolve()
    await saving
    assert.equal(calls.length, 1)
    assert.deepEqual(results, [['design', 'saving']])
  })
}

test('component submission helper preserves partial failure through snapshot and workspace refresh', async () => {
  const queue = createProjectServiceProposalQueue()
  const calls = []
  const forms = new Map(items.map(item => [item.serviceId, item]))
  const results = new Map()
  const errors = []
  const saving = []
  let refreshes = 0
  let workspaceRefreshes = 0
  let fail = true
  const submitOptions = options({ queue, change: async command => {
    calls.push(command)
    if (command.serviceId === 'content' && fail) throw new Error('Response lost')
  }, refresh: async () => { refreshes++; throw new Error('Snapshot unavailable') },
  onChanged: async () => { workspaceRefreshes++ }, onError: error => errors.push(error),
  onSaving: value => saving.push(value), onResult: (id, result) => {
    results.set(id, result)
    if (result.status === 'succeeded') {
      assert.ok(queue.succeeded.has(id))
      forms.delete(id)
    }
  } })
  await submitProjectServiceProposals(submitOptions)
  assert.equal(refreshes, 1)
  assert.equal(workspaceRefreshes, 1)
  assert.match(errors[0], /Proposals saved.*Snapshot unavailable/)
  assert.deepEqual(saving, [true, false])
  assert.deepEqual([...forms.keys()], ['content'])
  assert.deepEqual([...results.values()].map(result => result.status), ['succeeded', 'failed', 'succeeded'])
  const failedCommand = calls[1]
  fail = false
  await submitProjectServiceProposals({ ...submitOptions, items: [...forms.values()] })
  assert.equal(calls.length, 4)
  assert.equal(calls[3], failedCommand)
  assert.equal(forms.size, 0)
})

test('onChanged signal refresh preserves a failed selection and frozen retry command', async () => {
  const queue = createProjectServiceProposalQueue()
  const forms = new Map(items.map(item => [item.serviceId, item]))
  const controller = new AbortController()
  const calls = []
  const saving = []
  const submitOptions = options({ queue, canDispatch: () => !controller.signal.aborted,
    change: async command => { calls.push(command); if (command.serviceId === 'content') throw new Error('Uncertain') },
    onResult: (id, result) => { if (result.status === 'succeeded') forms.delete(id) },
    onSaving: value => saving.push(value), onError: assert.fail, refresh: async () => {},
    onChanged: () => controller.abort(),
  })
  await submitProjectServiceProposals(submitOptions)
  assert.deepEqual([...forms.keys()], ['content'])
  assert.deepEqual(saving, [true, false])
  await queue.submit({ ...submitOptions, items: [...forms.values()], canDispatch: () => true })
  assert.equal(calls.length, 4)
  assert.equal(calls[3], calls[1])
})

test('workspace refresh rejection retains successful results and releases saving', async () => {
  const queue = createProjectServiceProposalQueue()
  const saving = []
  const errors = []
  await submitProjectServiceProposals(options({ queue, change: async () => {},
    refresh: async () => {}, onChanged: async () => { throw new Error('Workspace unavailable') },
    onSaving: value => saving.push(value), onError: error => errors.push(error),
  }))
  assert.equal(queue.succeeded.size, items.length)
  assert.deepEqual(saving, [true, false])
  assert.deepEqual(errors, ['Workspace unavailable'])
})

for (const outcome of ['success', 'failure']) {
  test(`signal refresh during ${outcome} stops siblings, preserves outcome and releases saving`, async () => {
    const queue = createProjectServiceProposalQueue()
    const pending = deferred()
    const controller = new AbortController()
    const calls = []
    const results = []
    const saving = []
    const submission = submitProjectServiceProposals(options({ queue,
      canDispatch: () => !controller.signal.aborted,
      change: async command => {
        calls.push(command)
        await pending.promise
        if (outcome === 'failure') throw new Error('Uncertain')
      }, onResult: (id, result) => results.push([id, result.status]),
      onSaving: value => saving.push(value), onError: assert.fail, refresh: assert.fail, onChanged: assert.fail,
    }))
    controller.abort()
    pending.resolve()
    await submission
    assert.equal(calls.length, 1)
    assert.deepEqual(saving, [true, false])
    assert.deepEqual(results, [['design', 'saving'], ['design', outcome === 'success' ? 'succeeded' : 'failed']])
    await queue.submit(options({ change: async command => calls.push(command) }))
    if (outcome === 'failure') assert.equal(calls[1], calls[0])
    assert.equal(calls.length, outcome === 'success' ? 3 : 4)
  })
}

test('only organization, project, actor and effective membership fields change the reset key', () => {
  const context = { organizationId: 'org', project: { id: 'project' }, actorId: 'actor',
    membership: { id: 'membership', organizationId: 'org', role: 'contributor', departmentIds: ['design', 'content'] } }
  const key = projectServiceProposalContextKey(context)
  assert.equal(projectServiceProposalContextKey({ ...context, scopeRevision: 2, requestSignal: new AbortController().signal,
    project: { ...context.project, name: 'Refreshed', status: 'active' },
    membership: { ...context.membership, organization: { name: 'Renamed' }, departmentIds: ['content', 'design'] } }), key)
  for (const change of [{ organizationId: 'other' }, { project: { id: 'other' } }, { actorId: 'other' },
    { membership: { ...context.membership, role: 'operations_admin' } },
    { membership: { ...context.membership, departmentIds: ['development'] } }]) {
    assert.notEqual(projectServiceProposalContextKey({ ...context, ...change }), key)
  }
})

test('manager and role denial never authorize a proposal dispatch', async () => {
  let bindingChecks = 0
  const context = { organizationId: 'org', projectId: 'project', actorId: 'actor',
    membership: { organizationId: 'org', role: 'contributor' },
    hasOwnManagerBinding: async () => { bindingChecks++; return false } }
  const allowed = await canManageProjectServices(context)
  assert.equal(allowed, false)
  assert.equal(bindingChecks, 1)
  await createProjectServiceProposalQueue().submit(options({ canDispatch: () => allowed, change: assert.fail }))
  assert.equal(await canManageProjectServices({ ...context, membership: { organizationId: 'other', role: 'operations_admin' } }), false)
  assert.equal(await canManageProjectServices({ ...context, membership: { organizationId: 'org', role: 'operations_admin' } }), true)
  assert.equal(await canManageProjectServices({ ...context, hasOwnManagerBinding: async () => true }), true)
})

test('overlapping submissions cannot duplicate dispatch and stale initial context dispatches nothing', async () => {
  const queue = createProjectServiceProposalQueue()
  const pending = deferred()
  let calls = 0
  const submitOptions = options({ items: items.slice(0, 1), change: async () => { calls++; await pending.promise } })
  await queue.submit({ ...submitOptions, isCurrent: () => false })
  assert.equal(calls, 0)
  const saving = queue.submit(submitOptions)
  await queue.submit(submitOptions)
  assert.equal(calls, 1)
  pending.resolve()
  await saving
})

test('panel wires context resets, frozen retry fields, independent results and explicit activation', () => {
  const panel = readFileSync(new URL('../apps/ProjectServiceScopePanel.jsx', import.meta.url), 'utf8')
  assert.match(panel, /projectServiceProposalContextKey\(\{ ...props, actorId: user\?\.id \}\)/)
  assert.match(panel, /ServiceScopePanel key=\{contextKey\}/)
  assert.match(panel, /useLayoutEffect\([\s\S]*?context.mounted = false; context.revision \+= 1/)
  assert.match(panel, /!queue.succeeded.has\(service.id\)/)
  assert.match(panel, /disabled=\{saving \|\| Boolean\(results\[form.serviceId\]\)\}/)
  assert.match(panel, /Partial success is possible/)
  assert.match(panel, /onClick=\{\(\) => run\('activate', scope\)\}/)
  assert.doesNotMatch(panel.slice(panel.indexOf('const submitProposals'), panel.indexOf('const beginReview')), /activate|run\(/)
})
