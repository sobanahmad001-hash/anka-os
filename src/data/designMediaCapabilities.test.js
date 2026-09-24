import test from 'node:test'
import assert from 'node:assert/strict'
import { describeSeedanceRequest, videoResolutionOptions } from './designMediaCapabilities.js'

const request = { mode: 'explore', prompt: 'A cinematic scene at sunset', resolution: '720p', duration: 5, aspectRatio: '16:9' }
test('pure adapter produces documented payload without dispatch', () => {
  assert.deepEqual(describeSeedanceRequest(request), {
    provider: 'higgsfield', model: 'bytedance/seedance-2.5/text-to-video',
    input: { prompt: request.prompt, resolution: '720p', duration: 5, aspect_ratio: '16:9', output_format: 'mp4', generate_audio: false },
  })
  assert.equal(request.resolution, '720p')
})
test('Production exposes unsupported 1080p and refuses silent downgrade', () => {
  assert.equal(videoResolutionOptions('production').find(item => item.value === '1080p').supported, false)
  for (const resolution of ['1080p', '480p']) assert.throws(() => describeSeedanceRequest({ ...request, mode: 'production', resolution }), /no fallback/)
})
test('Explore is short; Production preserves explicit documented settings', () => {
  assert.throws(() => describeSeedanceRequest({ ...request, duration: 6 }), /5 seconds/)
  const result = describeSeedanceRequest({ ...request, mode: 'production', duration: 30, aspectRatio: '9:16', outputFormat: 'mov', generateAudio: true })
  assert.equal(result.input.duration, 30)
  assert.equal(result.input.generate_audio, true)
  assert.equal(result.input.output_format, 'mov')
})
test('invalid and coerced capability values are refused', () => {
  for (const patch of [{ duration: 3 }, { duration: 31 }, { duration: 4.5 }, { duration: '5' }, { resolution: '' }, { mode: 'google' }, { prompt: ' ' }, { aspectRatio: 'auto' }, { outputFormat: 'gif' }, { generateAudio: 'false' }]) {
    assert.throws(() => describeSeedanceRequest({ ...request, ...patch }))
  }
})
