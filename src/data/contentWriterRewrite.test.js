import assert from 'node:assert/strict'
import test from 'node:test'
import { captureWriterSelection, previewWriterReplacement } from './contentWriterRewrite.js'

test('C04 manual rewrite changes only the selected occurrence', () => {
  const body = 'First line. First line.'
  const selection = captureWriterSelection(body, 12, 22)
  assert.deepEqual(previewWriterReplacement(selection, 'Second line', body), {
    before: 'First line', replacement: 'Second line', after: 'First line. Second line.',
  })
  assert.equal(body, 'First line. First line.')
})

test('C04 rewrite refuses stale drafts, empty selections, and unchanged proposals', () => {
  assert.throws(() => captureWriterSelection('Draft', 0, 0), /Select non-empty text/)
  const selection = captureWriterSelection('Draft text', 0, 5)
  assert.throws(() => previewWriterReplacement(selection, 'New', 'Edited text'), /draft text changed/)
  assert.throws(() => previewWriterReplacement(selection, ' ', 'Draft text'), /Replacement text is required/)
  assert.throws(() => previewWriterReplacement(selection, 'Draft', 'Draft text'), /Change the selected text/)
})
