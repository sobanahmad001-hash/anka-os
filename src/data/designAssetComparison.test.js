import assert from 'node:assert/strict'
import test from 'node:test'
import { designAssetComparisonModel, designAssetComparisonReducer, initialDesignAssetComparisonState } from './designAssetComparison.js'

const rows = [
  { id: 'asset-a', status: 'ready', sourceType: 'generated', jobId: 'job-a', jobStatus: 'succeeded', modelId: 'model-a', modelName: 'Model A', directionVersionId: 'direction-version-a', directionVersionNumber: 2, createdAt: '2026-09-11T10:00:00.000Z', recorded: { dimensions: null, mimeType: null, name: null, reviewState: null, independentVersion: null } },
  { id: 'asset-b', status: 'ready', sourceType: 'variant', recordedVariantFormat: 'portrait_4x5', jobId: '', jobStatus: '', modelId: 'model-b', modelName: '', directionVersionId: 'direction-version-b', directionVersionNumber: 7, createdAt: '2026-09-11T11:00:00.000Z', recorded: { dimensions: null, mimeType: null, name: null, reviewState: null, independentVersion: null } },
]

test('comparison controller keeps two distinct outputs and resets both on full-context change', () => {
  let state = initialDesignAssetComparisonState('context-a')
  state = designAssetComparisonReducer(state, { type: 'select_slot', slot: 'left', assetId: 'asset-a' })
  state = designAssetComparisonReducer(state, { type: 'select_slot', slot: 'right', assetId: 'asset-b' })
  assert.deepEqual(state, { contextKey: 'context-a', leftAssetId: 'asset-a', rightAssetId: 'asset-b' })
  state = designAssetComparisonReducer(state, { type: 'select_slot', slot: 'left', assetId: 'asset-b' })
  assert.deepEqual(state, { contextKey: 'context-a', leftAssetId: 'asset-b', rightAssetId: '' })
  state = designAssetComparisonReducer(state, { type: 'context_changed', contextKey: 'context-b' })
  assert.deepEqual(state, initialDesignAssetComparisonState('context-b'))
})

test('comparison reports recorded output facts and leaves missing metadata unknown', () => {
  const model = designAssetComparisonModel(rows, { leftAssetId: 'asset-a', rightAssetId: 'asset-b' })
  assert.equal(model.ready, true)
  assert.equal(model.facts.find(fact => fact.key === 'sourceVersion').relationship, 'different')
  assert.equal(model.facts.find(fact => fact.key === 'sourceVersion').leftValue, 'v2 · direction-version-a')
  assert.equal(model.facts.find(fact => fact.key === 'sourceVersion').rightValue, 'v7 · direction-version-b')
  assert.equal(model.facts.find(fact => fact.key === 'dimensions').relationship, 'unknown')
  assert.equal(model.facts.find(fact => fact.key === 'dimensions').leftValue, null)
  assert.equal(model.facts.find(fact => fact.key === 'dimensions').rightValue, null)
  assert.equal(model.facts.some(fact => fact.label.toLowerCase().includes('lineage')), false)
})

test('comparison fails closed for missing or duplicate selections', () => {
  assert.equal(designAssetComparisonModel(rows, { leftAssetId: 'asset-a', rightAssetId: '' }).ready, false)
  assert.equal(designAssetComparisonModel(rows, { leftAssetId: 'asset-a', rightAssetId: 'asset-a' }).ready, false)
  assert.equal(designAssetComparisonModel(rows, { leftAssetId: 'foreign', rightAssetId: 'asset-b' }).left, null)
})
