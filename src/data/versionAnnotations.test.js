import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260825110000_version_review_annotations.sql', import.meta.url), 'utf8')
const portal = readFileSync(new URL('../apps/AnkaSpherePortal.jsx', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./deliveryRepository.js', import.meta.url), 'utf8')

test('review anchors support sections, pages, frames, timecodes, and normalized coordinates', () => {
  assert.match(migration, /add column if not exists anchor jsonb/)
  for (const kind of ['section', 'page', 'frame', 'timecode', 'coordinate']) {
    assert.match(migration, new RegExp(`'${kind}'`))
  }
  assert.match(migration, /between 0 and 1/)
  assert.match(migration, /anchor \? 'seconds'/)
})

test('client feedback is linked to the exact released version', () => {
  assert.match(portal, /entityId: feedbackTarget\.source_id/)
  assert.match(portal, /entityType: 'deliverable_version'/)
  assert.match(portal, /anchor: \{ kind: 'section', label:/)
  assert.match(portal, /Comment on version/)
  assert.match(repository, /anchor: input\.anchor \|\| \{\}/)
})

test('version comments remain separate from tracked revision requests', () => {
  assert.match(portal, /Use a revision request when the comment requires a tracked change/)
  assert.match(portal, /submitClientRevision/)
  assert.match(repository, /target_deliverable_version_id: input\.deliverableVersionId/)
})
