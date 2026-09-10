import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDesignAssetRows, designAssetAccessState, designAssetLibraryReducer, designAssetSourceFocus, filterDesignAssetRows, initialDesignAssetLibraryState } from './designAssetLibrary.js'

const now = Date.parse('2026-09-11T12:00:00.000Z')
const workspace = () => ({
  sessions: [{ id: 'session-a', output_goal: 'Launch assets' }], directions: [{ id: 'direction-a', session_id: 'session-a' }],
  directionVersions: [{ id: 'version-a', direction_id: 'direction-a', version_number: 3, content: { title: 'Quiet confidence' } }], experimentalDirectionVersions: [],
  models: [{ id: 'model-a', display_name: 'Approved image model' }],
  imageGenerationJobs: [{ id: 'job-a', direction_version_id: 'version-a', media_asset_id: 'asset-a', model_registry_id: 'model-a', status: 'succeeded' }],
  variants: [{ id: 'variant-b', source_direction_version_id: 'version-a', design_media_asset_id: 'asset-b', variant_format: 'portrait_4x5' }],
  mediaAssets: [
    { id: 'asset-b', design_direction_version_id: 'version-a', media_type: 'image', status: 'failed', prompt: 'Variant', created_at: '2026-08-01T00:00:00.000Z' },
    { id: 'asset-a', design_direction_version_id: 'version-a', media_type: 'image', status: 'ready', prompt: 'Hero', signed_url: 'https://signed.invalid/a', created_at: '2026-09-11T11:00:00.000Z' },
  ],
})

test('builds deterministic provenance only from already-loaded authorized workspace rows', () => {
  const rows = buildDesignAssetRows(workspace())
  assert.deepEqual(rows.map(row => row.id), ['asset-a', 'asset-b'])
  assert.equal(rows[0].jobId, 'job-a')
  assert.equal(rows[0].modelName, 'Approved image model')
  assert.equal(rows[0].directionVersionId, 'version-a')
  assert.equal(rows[0].sessionId, 'session-a')
  assert.deepEqual(rows[0].recorded, { dimensions: null, mimeType: null, name: null, reviewState: null, independentVersion: null })
  assert.equal(rows[1].sourceType, 'variant')
  assert.equal(rows[1].recordedVariantFormat, 'portrait_4x5')
  assert.equal(rows[1].jobId, '')
})

test('does not call an output generated when no durable job or variant provenance is loaded', () => {
  const data = workspace()
  data.mediaAssets.push({ id: 'asset-c', design_direction_version_id: 'version-a', media_type: 'video', status: 'unavailable', prompt: 'Video', created_at: '2026-09-10T00:00:00.000Z' })
  const row = buildDesignAssetRows(data).find(item => item.id === 'asset-c')
  assert.equal(row.sourceType, 'recorded')
  assert.equal(row.jobId, '')
})

test('filters status, durable source and date without changing or widening the source rows', () => {
  const rows = buildDesignAssetRows(workspace())
  assert.deepEqual(filterDesignAssetRows(rows, { status: 'ready', source: 'all', date: 'all' }, now).map(row => row.id), ['asset-a'])
  assert.deepEqual(filterDesignAssetRows(rows, { status: 'all', source: 'variant', date: 'all' }, now).map(row => row.id), ['asset-b'])
  assert.deepEqual(filterDesignAssetRows(rows, { status: 'all', source: 'all', date: 'day' }, now).map(row => row.id), ['asset-a'])
  assert.equal(rows.length, 2)
})

test('controller resets selected asset, filters and view when the work context changes', () => {
  let state = initialDesignAssetLibraryState('engagement-a')
  state = designAssetLibraryReducer(state, { type: 'set_view', view: 'list' })
  state = designAssetLibraryReducer(state, { type: 'set_filter', name: 'status', value: 'ready' })
  state = designAssetLibraryReducer(state, { type: 'select', assetId: 'asset-a' })
  assert.equal(designAssetLibraryReducer(state, { type: 'context_changed', contextKey: 'engagement-a' }), state)
  state = designAssetLibraryReducer(state, { type: 'context_changed', contextKey: 'engagement-b' })
  assert.deepEqual(state, initialDesignAssetLibraryState('engagement-b'))
})

test('signed access is limited to ready images and becomes unusable before server expiry', () => {
  const row = buildDesignAssetRows(workspace())[0]
  assert.equal(designAssetAccessState(row, { issuedAt: now, expiresInSeconds: 300, now: now + 294000 }).canOpen, true)
  assert.equal(designAssetAccessState(row, { issuedAt: now, expiresInSeconds: 300, now: now + 295000 }).status, 'expired')
  assert.equal(designAssetAccessState({ ...row, status: 'failed' }, { issuedAt: now, expiresInSeconds: 300, now }).canOpen, false)
  assert.equal(designAssetAccessState({ ...row, previewUrl: '' }, { issuedAt: now, expiresInSeconds: 300, now }).status, 'missing')
})

test('source focus uses exact existing session, immutable direction version and job identities', () => {
  const row = buildDesignAssetRows(workspace())[0]
  assert.deepEqual(designAssetSourceFocus(row), { sessionId: 'session-a', directionVersionId: 'version-a', jobId: 'job-a' })
  assert.equal(designAssetSourceFocus({ ...row, sessionId: '' }), null)
})
