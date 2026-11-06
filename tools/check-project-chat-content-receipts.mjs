import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { URL, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createProjectChatActionRepository } from '../src/data/projectChatActionRepository.js'

const ADAPTER_SHA256 = 'b1031156e9be1543517dee6bccd7e2ea37aadb143f133fbab967ea91ba9691fe'
const CASES = ['ordinary_save', 'stage_save', 'approved_handoff', 'historical_recovery']
const FOREIGN = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const clone = value => structuredClone(value)
const sameScope = i => ({ organizationId: i.organizationId, projectId: i.projectId, conversationId: i.conversationId })
const argsFor = i => ({ p_organization_id: i.organizationId, p_project_id: i.projectId, p_conversation_id: i.conversationId, p_source_message_id: i.sourceMessageId, p_request_id: i.requestId })

// All transport is intercepted. This harness never instantiates a Supabase client or opens a network connection.
function intercepted(row, { receipt = row.receipt, readOnly = false } = {}) {
  const calls = []
  const client = {
    async rpc(name, args) {
      calls.push({ name, args: clone(args) })
      if (name === 'apply_project_chat_content_action') {
        assert.equal(readOnly, false, 'Recovery/list must never invoke apply')
        assert.deepEqual(args, { ...argsFor(row.identity), p_action: row.action })
        return { data: clone(receipt), error: null }
      }
      if (name === 'recover_project_chat_content_action') {
        assert.deepEqual(args, argsFor(row.identity))
        return { data: { status: 'recorded', receipt: clone(receipt) }, error: null }
      }
      if (name === 'read_project_chat_content_actions') {
        assert.deepEqual(args, { p_organization_id: row.identity.organizationId, p_project_id: row.identity.projectId, p_conversation_id: row.identity.conversationId, p_limit: 25, p_offset: 0 })
        return { data: { items: [clone(receipt)], limit: 25, offset: 0, has_more: false }, error: null }
      }
      throw Error('Unexpected RPC in composition harness: ' + name)
    },
  }
  return { calls, api: createProjectChatActionRepository(client) }
}

export async function checkNativeReceiptComposition(bundle) {
  const adapter = readFileSync(new URL('../src/data/projectChatActionRepository.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  assert.equal(hash(adapter), ADAPTER_SHA256, 'Adapter must remain exact frozen8717a8c source')
  assert.equal(bundle?.version, 1)
  assert.ok(bundle.provenance && typeof bundle.provenance === 'object' && !Array.isArray(bundle.provenance), 'Native runner provenance required; fixture-only run is not acceptance')
  assert.ok(Array.isArray(bundle.cases) && bundle.cases.length === CASES.length, 'Export all four actual native cases')
  assert.deepEqual([...bundle.cases.map(row => row.name)].sort(), [...CASES].sort())
  const results = []
  for (const row of bundle.cases) {
    assert.ok(row.identity && row.receipt, 'Actual native identity and receipt required')
    const before = clone(row)
    assert.ok(Object.hasOwn(row.receipt, 'selection'), 'Original selection must survive native export')
    if (row.name === 'ordinary_save') {
      assert.equal(row.receipt.kind, 'save_content'); assert.equal(row.receipt.selection, null)
    } else if (row.name !== 'historical_recovery') {
      assert.notEqual(row.receipt.selection, null)
      if (row.name === 'stage_save') assert.equal(row.receipt.kind, 'save_content')
      if (row.name === 'approved_handoff') assert.equal(row.receipt.kind, 'handoff_design')
    }
    const passed = []
    if (row.name !== 'historical_recovery') {
      assert.ok(row.action, 'Export the exact original action, never reconstruct from current composer')
      const instance = intercepted(row), proposal = await instance.api.prepare(row.identity, row.action)
      assert.deepEqual(await instance.api.confirm(proposal), row.receipt)
      assert.equal(instance.calls.length, 1)
      passed.push('actual native receipt passes frozen confirm with exact original identity/action')

      const changedProposal = clone(proposal)
      changedProposal.sha256 = changedProposal.sha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64)
      const noDispatch = intercepted(row)
      await assert.rejects(noDispatch.api.confirm(changedProposal))
      assert.equal(noDispatch.calls.length, 0)
      passed.push('tampered proposal digest fails before dispatch')

      if (row.receipt.selection !== null) {
        for (const mutate of [r => r.selection = null, r => r.selection.context_sha256 = r.selection.context_sha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64), r => r.selection.partition.id = FOREIGN]) {
          const bad = clone(row.receipt); mutate(bad)
          const rejected = intercepted(row, { receipt: bad })
          await assert.rejects(rejected.api.confirm(proposal), error => error.outcome === 'unknown')
          assert.equal(rejected.calls.length, 1)
        }
        passed.push('changed original material digest, partition and stage-to-null receipt fail closed')
      }
    }
    const reads = intercepted(row, { readOnly: true })
    assert.deepEqual(await reads.api.recover(row.identity), { status: 'recorded', receipt: row.receipt })
    assert.deepEqual((await reads.api.list(sameScope(row.identity))).items, [row.receipt])
    assert.deepEqual(reads.calls.map(call => call.name), ['recover_project_chat_content_action', 'read_project_chat_content_actions'])
    passed.push('historical recovery and list retain exact receipt/selection without mutation or refresh')
    for (const mutate of [r => r.project_id = FOREIGN, r => r.conversation_id = FOREIGN, r => delete r.selection,
      r => r.selection = { ...(r.selection || {}), project_id: FOREIGN }]) {
      const bad = clone(row.receipt); mutate(bad)
      const rejected = intercepted(row, { receipt: bad, readOnly: true })
      await assert.rejects(rejected.api.recover(row.identity))
      await assert.rejects(rejected.api.list(sameScope(row.identity)))
      assert.deepEqual(rejected.calls.map(call => call.name), ['recover_project_chat_content_action', 'read_project_chat_content_actions'])
    }
    passed.push('foreign Chat/project and missing/foreign selection reject on both read paths')
    assert.deepEqual(row, before, 'Composition must not mutate original native evidence')
    results.push({ name: row.name, status: 'passed', checks: passed })
  }
  return { version: 1, status: 'passed', adapter_commit: '8717a8c3a3008ef994783b6978188f33dc8c66e0', adapter_sha256: ADAPTER_SHA256,
    input_sha256: hash(JSON.stringify(bundle)), cases: results,
    boundary: 'Exported native receipt JSON through frozen client adapter with intercepted transport. No live RPC/provider/UI/deployment calls. Provenance originates with native runner, not this harness; fixture-only data is not acceptance.' }
}

async function main() {
  const args = process.argv.slice(2), fileIndex = args.indexOf('--receipts'), reportIndex = args.indexOf('--report')
  assert.ok(fileIndex >= 0 && args[fileIndex + 1], 'Usage: node tools/check-project-chat-content-receipts.mjs --receipts NATIVE_JSON [--report REPORT_JSON]')
  const bytes = readFileSync(resolve(args[fileIndex + 1]))
  const result = await checkNativeReceiptComposition(JSON.parse(bytes.toString('utf8')))
  result.input_file_sha256 = hash(bytes)
  if (reportIndex >= 0) {
    assert.ok(args[reportIndex + 1], '--report requires a path')
    writeFileSync(resolve(args[reportIndex + 1]), JSON.stringify(result, null, 2) + '\n')
  }
  console.log(JSON.stringify({ status: result.status, cases: result.cases.map(c => c.name), input_file_sha256: result.input_file_sha256, boundary: result.boundary }, null, 2))
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
