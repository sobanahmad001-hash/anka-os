import assert from 'node:assert/strict'
import test from 'node:test'

import {
  contentVersionComparisonModel,
  contentVersionComparisonReducer,
  initialContentVersionComparisonState,
} from './contentVersionComparison.js'

const versions = [
  {
    id: 'v2', artifact_id: 'artifact-a', version_number: 2, created_at: '2026-09-13T02:00:00Z',
    content_checksum: 'b'.repeat(64), change_summary: 'Updated headline', data_classification: 'internal',
    ai_use_allowed: false,
    content: {
      headline: 'New headline',
      source_manifest: { artifact_version_id: 'source-v2' },
      sections: [{ heading: 'Intro', body: 'New body' }],
      summary: 'Added summary',
    },
  },
  {
    id: 'v1', artifact_id: 'artifact-a', version_number: 1, created_at: '2026-09-12T02:00:00Z',
    content_checksum: 'a'.repeat(64), change_summary: 'Initial', data_classification: 'internal',
    ai_use_allowed: false,
    content: {
      headline: 'Old headline',
      source_manifest: { artifact_version_id: 'source-v1' },
      sections: [{ heading: 'Intro', body: 'Old body' }],
      retired_note: 'Remove later',
    },
  },
]

test('B06b comparison controller defaults to two exact versions and resets on artifact context change', () => {
  let state = initialContentVersionComparisonState('artifact-a', versions, 'v2')
  assert.deepEqual(state, { contextKey: 'artifact-a', leftVersionId: 'v1', rightVersionId: 'v2' })
  state = contentVersionComparisonReducer(state, { type: 'select_slot', slot: 'left', versionId: 'v2' })
  assert.deepEqual(state, { contextKey: 'artifact-a', leftVersionId: 'v2', rightVersionId: '' })
  state = contentVersionComparisonReducer(state, {
    type: 'sync_context', contextKey: 'artifact-b',
    versions: [{ id: 'v9', artifact_id: 'artifact-b', version_number: 9 }],
    preferredVersionId: 'v9',
  })
  assert.deepEqual(state, { contextKey: 'artifact-b', leftVersionId: '', rightVersionId: 'v9' })
})

test('B06b comparison reports exact metadata, source, changed, added, removed and unchanged fields', () => {
  const model = contentVersionComparisonModel(versions, { leftVersionId: 'v1', rightVersionId: 'v2' })
  assert.equal(model.ready, true)
  assert.equal(model.left.id, 'v1')
  assert.equal(model.right.id, 'v2')
  assert.equal(model.metadata.find(item => item.key === 'version_id').relationship, 'changed')
  assert.equal(model.metadata.find(item => item.key === 'sources').leftValue, 'source_manifest.artifact_version_id = source-v1')
  assert.equal(model.metadata.find(item => item.key === 'sources').rightValue, 'source_manifest.artifact_version_id = source-v2')
  assert.equal(model.content.find(item => item.path === 'headline').relationship, 'changed')
  assert.equal(model.content.find(item => item.path === 'summary').relationship, 'added')
  assert.equal(model.content.find(item => item.path === 'retired_note').relationship, 'removed')
  assert.equal(model.content.find(item => item.path === 'sections[0].heading').relationship, 'same')
  assert.deepEqual(model.summary, { changed: 3, added: 1, removed: 1, same: 1 })
})

test('B06b comparison fails closed for missing, duplicate, inaccessible and cross-artifact selections', () => {
  assert.equal(contentVersionComparisonModel(versions, { leftVersionId: 'v1', rightVersionId: '' }).ready, false)
  assert.equal(contentVersionComparisonModel(versions, { leftVersionId: 'v1', rightVersionId: 'v1' }).ready, false)
  assert.equal(contentVersionComparisonModel(versions, { leftVersionId: 'foreign', rightVersionId: 'v2' }).ready, false)
  const mixed = [...versions, { id: 'other-v1', artifact_id: 'artifact-b', version_number: 1, content: {} }]
  assert.equal(contentVersionComparisonModel(mixed, { leftVersionId: 'v1', rightVersionId: 'other-v1' }).ready, false)
})

test('B06b sync removes a version that is no longer in the authorized snapshot', () => {
  const state = contentVersionComparisonReducer(
    { contextKey: 'artifact-a', leftVersionId: 'v1', rightVersionId: 'v2' },
    { type: 'sync_context', contextKey: 'artifact-a', versions: [versions[0]], preferredVersionId: 'v2' },
  )
  assert.deepEqual(state, { contextKey: 'artifact-a', leftVersionId: '', rightVersionId: 'v2' })
})

test('B06b comparison preserves JSON type identity and exposes types in displayed values', () => {
  const typedVersions = [
    { id: 'typed-b', artifact_id: 'typed', version_number: 2, content: { number: '1', boolean: 'true', nullable: 'null', array: '[]', object: '{}' } },
    { id: 'typed-a', artifact_id: 'typed', version_number: 1, content: { number: 1, boolean: true, nullable: null, array: [], object: {} } },
  ]
  const model = contentVersionComparisonModel(typedVersions, { leftVersionId: 'typed-a', rightVersionId: 'typed-b' })
  assert.deepEqual(model.summary, { changed: 5, added: 0, removed: 0, same: 0 })
  assert.match(model.content.find(item => item.path === 'number').leftValue, /^Number\n1$/)
  assert.match(model.content.find(item => item.path === 'number').rightValue, /^String\n"1"$/)
  assert.match(model.content.find(item => item.path === 'nullable').leftValue, /^Null\nnull$/)
  assert.match(model.content.find(item => item.path === 'array').leftValue, /^Array\n\[\]$/)
  assert.match(model.content.find(item => item.path === 'object').leftValue, /^Object\n\{\}$/)
})

test('B06b comparison keeps structured path identity separate from unambiguous display labels', () => {
  const collisionVersions = [
    { id: 'collision-b', artifact_id: 'collision', version_number: 2, content: { a: { b: 'NEW' }, 'a.b': 'literal', list: ['NEW'], 'list[0]': 'literal' } },
    { id: 'collision-a', artifact_id: 'collision', version_number: 1, content: { a: { b: 'OLD' }, 'a.b': 'literal', list: ['OLD'], 'list[0]': 'literal' } },
  ]
  const model = contentVersionComparisonModel(collisionVersions, { leftVersionId: 'collision-a', rightVersionId: 'collision-b' })
  assert.equal(model.content.length, 4)
  assert.deepEqual(model.content.filter(item => item.relationship === 'changed').map(item => item.path), ['a.b', 'list[0]'])
  assert.deepEqual(model.content.filter(item => item.relationship === 'same').map(item => item.path), ['["a.b"]', '["list[0]"]'])
  assert.equal(new Set(model.content.map(item => item.identity)).size, 4)
})
