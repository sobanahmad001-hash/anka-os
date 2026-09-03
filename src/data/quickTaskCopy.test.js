import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createQuickTaskCopyController, requireQuickTaskCopyResult } from './quickTaskCopy.js'

test('incomplete success responses remain retryable instead of reporting a copy', () => {
  for (const value of [null, undefined, {}, { quick_task_id: 'bad' }]) {
    assert.throws(() => requireQuickTaskCopyResult(value), /Retry/)
  }
  const result = { quick_task_id: '11111111-1111-4111-8111-111111111111', state: 'discarded', purged: true, replayed: true }
  assert.equal(requireQuickTaskCopyResult(result), result)
})

function fixture(invoke) {
  const states = [], calls = [], errors = []
  let keys = 0
  const controller = createQuickTaskCopyController({
    organizationId: 'org', sourceRequestId: 'source',
    invoke: input => { calls.push(input); return invoke(input) },
    onChange: state => states.push(state), onAccessError: error => errors.push(error),
    newKey: () => 'key-' + ++keys,
  })
  return { controller, states, calls, errors }
}

test('copy ignores double submits and requires deliberate repeat intent', async () => {
  let resolve
  const f = fixture(() => new Promise(done => { resolve = done }))
  const first = f.controller.copy()
  await f.controller.copy()
  assert.equal(f.calls.length, 1)
  resolve({ quick_task_id: 'one' })
  await first
  await f.controller.copy()
  assert.equal(f.calls.length, 1)
  f.controller.another()
  const second = f.controller.copy()
  assert.equal(f.calls[1].idempotencyKey, 'key-2')
  resolve({ quick_task_id: 'two' })
  await second
})

test('uncertain failure keeps key; access status reaches existing handling', async () => {
  let attempt = 0
  const f = fixture(async () => {
    if (!attempt++) throw Object.assign(new Error('uncertain'), { status: 403 })
    return { quick_task_id: 'one', replayed: true }
  })
  await f.controller.copy()
  f.controller.another()
  await f.controller.copy()
  assert.equal(f.calls[0].idempotencyKey, f.calls[1].idempotencyKey)
  assert.equal(f.errors[0].status, 403)
})

test('organization/user disposal suppresses late success and late error', async () => {
  for (const fail of [false, true]) {
    let resolve, reject
    const f = fixture(() => new Promise((ok, no) => { resolve = ok; reject = no }))
    const result = f.controller.copy()
    f.controller.dispose()
    fail ? reject(new Error('late')) : resolve({ quick_task_id: 'old' })
    await result
    assert.equal(f.states.length, 1)
    assert.equal(f.errors.length, 0)
    await f.controller.copy()
    assert.equal(f.calls.length, 1)
  }
})

test('StrictMode setup-cleanup-setup remains usable; purged replay requires fresh intent', async () => {
  const f = fixture(async () => ({ purged: true, replayed: true }))
  f.controller.dispose(); f.controller.activate()
  await f.controller.copy()
  assert.equal(f.states.at(-1).result.purged, true)
  await f.controller.copy()
  assert.equal(f.calls.length, 1)
})

test('copy endpoint is a single RPC and rejects arbitrary payload; WCH is independent', () => {
  const source = readFileSync(new URL('../../supabase/functions/quick-tasks/index.ts', import.meta.url), 'utf8')
  const action = source.slice(source.indexOf('export async function copyGeneralRequest'), source.indexOf('export async function handleRequest'))
  assert.match(action, /copy_general_request_to_quick_task/)
  assert.doesNotMatch(action, /fetch\(|save_work_item|promote_quick_task|\.from\(/)
  const ui = readFileSync(new URL('../components/GeneralRequestQuickTaskCopy.jsx', import.meta.url), 'utf8')
  assert.match(ui, /requestSignal/)
  assert.match(ui, /scopeRevision/)
  assert.match(ui, /scope\.activeOrganizationId === request\.organization_id/)
  assert.doesNotMatch(ui, /navigate\(|ensureFigmaHandoff|generateImage/)
})

test('copy transaction has only sandbox writes and retains no purgeable payload in its ledger', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260903173419_qts5_general_request_copy.sql', import.meta.url), 'utf8')
  const writes = [...sql.matchAll(/insert into public\.([a-z_]+)/g)].map(match => match[1])
  assert.deepEqual(writes, ['quick_tasks', 'quick_task_revisions', 'quick_task_lifecycle_events', 'quick_task_request_copies'])
  assert.doesNotMatch(sql, /\b(?:update|delete from) public\./)
  assert.doesNotMatch(sql, /save_work_item|promote_quick_task|http_post|cron\.schedule/)
  const ledger = sql.slice(sql.indexOf('create table'), sql.indexOf('create index'))
  assert.doesNotMatch(ledger, /content_sha256|revision_id|brief|format|output_path|brand_id|url/i)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /char_length\(v_notes\) > 50000/)
})
