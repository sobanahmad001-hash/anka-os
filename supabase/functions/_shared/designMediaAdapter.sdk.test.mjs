// Run with Node 24+ and the path to an EXISTING SDK package.json installation.
// Uses mock credentials and replaces Axios transport before creating a client.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createDesignMediaAdapter } from './designMediaAdapter.ts'

const requireSdk = createRequire(resolve(process.argv[2]))
assert.equal(requireSdk('./package.json').version, '0.2.6')
const axios = requireSdk('axios')
const original = axios.defaults.adapter
let submissions = 0
let fail = false
axios.defaults.adapter = async config => {
  submissions++
  assert.equal(config.method, 'post')
  assert.equal(config.baseURL, 'https://api.higgsfield.ai')
  assert.equal(config.url, '/bytedance/seedance-2.5/text-to-video')
  assert.equal(config.headers.Authorization, 'Key offline:placeholder')
  assert.equal(JSON.parse(config.data).resolution, '720p')
  if (fail) throw new axios.AxiosError('mock network loss', 'ECONNRESET', config)
  return { data: { status: 'queued', request_id: 'offline-1', status_url: 'https://api.higgsfield.ai/requests/offline-1/status' }, status: 200, statusText: 'OK', headers: {}, config }
}
try {
  const { createHiggsfieldClient } = requireSdk('./dist/v2/index.js')
  const adapter = createDesignMediaAdapter(createHiggsfieldClient, 'offline:placeholder')
  const input = { prompt: 'Offline fixture', duration: 5, resolution: '720p', aspect_ratio: '16:9', output_format: 'mp4', generate_audio: false }
  assert.deepEqual(await adapter.submit(input), { state: 'pending', requestId: 'offline-1', statusUrl: 'https://api.higgsfield.ai/requests/offline-1/status' })
  assert.equal(submissions, 1, 'No automatic polling')
  fail = true
  await assert.rejects(() => adapter.submit(input), /outcome unknown/)
  assert.equal(submissions, 2, 'No automatic resubmission after network loss')
  console.log('Official SDK 0.2.6 offline transport: queued receipt, no polling, zero retries PASS')
} finally {
  axios.defaults.adapter = original
}
