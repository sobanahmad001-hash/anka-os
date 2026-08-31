import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import { blogLinksForMonth, contentCalendarPath, relatedRecord, workshopSessionPath } from './contentDesignEventLinking.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const contentRepository = read('./contentStudioRepository.js')
const designRepository = read('./designWorkshopRepository.js')
const externalRepository = read('./externalEventsRepository.js')
const contentUi = read('../apps/ContentStudio.jsx')
const designUi = read('../apps/DesignWorkshop.jsx')
const eventsUi = read('../apps/ExternalEvents.jsx')
const designFunction = read('../../supabase/functions/design-workshop/index.ts')

test('Content blog calendar is a filtered view over MK1 relations, not a parallel structure', () => {
  assert.match(contentRepository, /from\('content_event_links'\)/)
  assert.match(contentRepository, /eq\('content_type', 'blog'\)/)
  assert.match(contentRepository, /external_events!inner/)
  assert.match(contentUi, /Blog calendar/)
  assert.match(contentUi, /does not maintain a separate blog-calendar table/)
})

test('blog calendar helpers preserve joined event dates and stable navigation', () => {
  const links = [{ id: 'a', external_events: [{ start_date: '2026-09-10' }] }, { id: 'b', external_events: { start_date: '2026-10-02' } }]
  assert.equal(relatedRecord(links[0].external_events).start_date, '2026-09-10')
  assert.deepEqual(blogLinksForMonth(links, '2026-09').map(link => link.id), ['a'])
  assert.equal(contentCalendarPath('brand 1', 'link/1'), '/sphere/content/studio?brand=brand+1&eventLink=link%2F1&tab=calendar')
})

test('linked Design sessions reuse the session UUID as the event-link identity', () => {
  assert.match(designFunction, /designEventLink\(session\.id, externalEventId, actorId\)/)
  assert.match(designFunction, /content_type: 'design_asset'/)
  assert.match(designFunction, /linked_work_item_id: null/)
  assert.match(designFunction, /status: 'in_progress'/)
  assert.match(designUi, /External event \(optional\)/)
  assert.match(designRepository, /from\('external_events'\)/)
})

test('event detail resolves and links the exact Workshop session while preserving all content types', () => {
  assert.match(externalRepository, /from\('design_workshop_sessions'\)/)
  assert.match(externalRepository, /design_workshop_session/)
  assert.match(eventsUi, /Open actual Workshop session/)
  assert.match(eventsUi, /EVENT_LINK_STATUSES/)
  assert.equal(workshopSessionPath({ id: 'session-1', engagement_id: 'engagement-1' }), '/sphere/design/workshop?engagement=engagement-1&session=session-1')
  assert.equal(workshopSessionPath(null), null)
})

test('follow-up adds no migration and does not alter MK1 schema or policy SQL', () => {
  const migrations = readdirSync(new URL('../../supabase/migrations/', import.meta.url))
  assert.equal(migrations.some(name => /content_design_event|event_linking/i.test(name)), false)
  assert.doesNotMatch(`${contentRepository}\n${designRepository}\n${externalRepository}`, /\.insert\(['"](?:external_events|content_event_links)['"]\)/)
})
