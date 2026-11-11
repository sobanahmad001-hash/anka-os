import assert from 'node:assert/strict'
import test from 'node:test'
import { scanChunk } from '../../supabase/functions/website-discovery/scan.js'

const origin = 'https://inventory.example'
const tasks = Array.from({ length: 25 }, (_, id) => ({
  id,
  kind: 'page',
  url: origin + '/page-' + id,
  wp_id: id + 1,
}))
const page = { status: 200, type: 'text/html', text: '<title>Page</title>' }

test('a checkpoint processes at most twenty queued reads and retains their identities', async () => {
  const rows = await scanChunk({ origin, tasks, blocked: [] }, async () => page)
  assert.deepEqual(rows.map(row => row.id), tasks.slice(0, 20).map(task => task.id))
  assert.equal(rows[19].meta.wpId, tasks[19].wp_id)
})

test('one interrupted read is recoverable without replaying successful reads', async () => {
  const queue = tasks.slice(0, 3)
  const rows = await scanChunk({ origin, tasks: queue, blocked: [] }, async url => {
    if (url.pathname === '/page-1') throw Error('Interrupted synthetic read')
    return page
  })
  assert.deepEqual(rows.map(row => row.state), ['read', 'failed', 'read'])
  const recovered = await scanChunk({ origin, tasks: [queue[1]], blocked: [] }, async () => page)
  assert.deepEqual(recovered.map(row => [row.id, row.state]), [[1, 'read']])
})

test('saved exclusions skip reads and the time budget leaves later requests queued', async () => {
  let time = 0
  const fetched = []
  const rows = await scanChunk({ origin, tasks, blocked: ['/page-0'] }, async url => {
    fetched.push(url.pathname)
    time += 33000
    return page
  }, () => time)
  assert.deepEqual(fetched, ['/page-1'])
  assert.deepEqual(rows.map(row => row.state), ['excluded', 'read'])
})
