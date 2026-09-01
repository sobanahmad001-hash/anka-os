import test from 'node:test'
import assert from 'node:assert/strict'

import { groupQueueEntriesByDate, queueEntriesForMonth,
  serializeContentQueueEntry } from './contentQueue.js'

test('CP4 serializes a brand plan without creating request-shaped fields', () => {
  assert.deepEqual(serializeContentQueueEntry({
    brand_id: ' brand-1 ', planned_date: '2026-09-03', format: 'carousel',
    brief_template: ' September plan ', linked_event_id: '',
  }), {
    brand_id: 'brand-1', planned_date: '2026-09-03', format: 'carousel',
    brief_template: 'September plan', linked_event_id: null,
  })
})

test('CP4 calendar stays per-brand, per-month, and grouped by planned date', () => {
  const entries = [
    { id: '3', brand_id: 'b1', planned_date: '2026-10-01', created_at: '2026-09-01T03:00:00Z' },
    { id: '2', brand_id: 'b2', planned_date: '2026-09-02', created_at: '2026-09-01T02:00:00Z' },
    { id: '1', brand_id: 'b1', planned_date: '2026-09-02', created_at: '2026-09-01T01:00:00Z' },
  ]
  const visible = queueEntriesForMonth(entries, '2026-09', 'b1')
  assert.deepEqual(visible.map(item => item.id), ['1'])
  assert.deepEqual([...groupQueueEntriesByDate(visible).keys()], ['2026-09-02'])
})
