import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { websiteSitemapPreview } from './contentArchitectureReview.js'
import { websitePageBriefComplete } from './contentStudio.js'

const priorPages = [
  { page_key: 'page:home', slug: 'home', title: 'Home', parent_page_key: null, position: 1000, page_type: 'hub', purpose: 'Orient' },
  { page_key: 'page:service', slug: 'services', title: 'Services', parent_page_key: 'page:home', position: 2000, page_type: 'service', purpose: 'Explain services' },
]
const current = { id: 'architecture-v2', artifact_id: 'architecture-a', content: { pages: priorPages } }
const workspace = {
  artifacts: [
    { id: 'copy-a', artifact_type: 'content' },
    { id: 'keywords-a', artifact_type: 'keyword_strategy' },
  ],
  versions: [
    { id: 'copy-v1', artifact_id: 'copy-a', version_number: 1, content: { source_architecture_version_id: 'architecture-v2', output_type: 'website_page_copy', target_page_key: 'page:service' } },
    { id: 'keywords-v1', artifact_id: 'keywords-a', version_number: 1, content: { source_architecture_version_id: 'architecture-v2', keywords: [{ target_kind: 'page', target_page_key: 'page:service' }] } },
  ],
  contentTasks: [{ id: 'task-a', linked_page_key: 'page:service' }],
}

test('C02 preview keeps stable page identity and exposes removed-page downstream impact', () => {
  const review = websiteSitemapPreview({ pages: [
    { ...priorPages[0], title: 'Welcome', slug: 'welcome' },
    { page_key: 'page:new', slug: 'about', title: 'About', parent_page_key: 'page:home', page_type: 'supporting', purpose: 'Context' },
  ] }, current, workspace)
  assert.deepEqual(review.changed.map(item => [item.key, item.kind]), [
    ['page:home', 'changed'], ['page:new', 'added'], ['page:service', 'removed'],
  ])
  assert.deepEqual(review.affected.find(item => item.key === 'page:service').dependents.sort(), [
    'content task', 'keyword target', 'saved page copy',
  ])
  assert.deepEqual(review.tree.map(item => [item.title, item.depth]), [['Welcome', 0], ['About', 1]])
  assert.equal(review.errors.length, 0)
  assert.equal(review.pages[0].page_key, 'page:home')
  assert.equal(priorPages[0].slug, 'home')
})

test('C02 impact follows older exact versions of the same architecture root only', () => {
  const older = {
    ...workspace,
    versions: [
      { id: 'architecture-v1', artifact_id: 'architecture-a', version_number: 1, content: { pages: priorPages } },
      { id: 'architecture-other-v1', artifact_id: 'architecture-other', version_number: 1, content: { pages: priorPages } },
      { ...workspace.versions[0], content: { ...workspace.versions[0].content, source_architecture_version_id: 'architecture-v1' } },
      { ...workspace.versions[1], content: { ...workspace.versions[1].content, source_architecture_version_id: 'architecture-other-v1' } },
    ],
  }
  const review = websiteSitemapPreview({ pages: [priorPages[0]] }, current, older)
  assert.deepEqual(review.affected.find(item => item.key === 'page:service').dependents.sort(), ['content task', 'saved page copy'])
})

test('C02 preview rejects orphan/cyclic draft hierarchies and never guesses a tree', () => {
  const orphan = websiteSitemapPreview({ pages: [{ ...priorPages[0], parent_page_key: 'page:missing' }] }, current)
  assert.match(orphan.errors[0], /Parent page is missing/)
  assert.deepEqual(orphan.tree, [])
  const cycle = websiteSitemapPreview({ pages: [
    { ...priorPages[0], parent_page_key: 'page:service' },
    { ...priorPages[1], parent_page_key: 'page:home' },
  ] }, current)
  assert.match(cycle.errors[0], /cycle/)
  assert.deepEqual(cycle.tree, [])
})

test('C02 preview identity invalidates after page edits or a newer source version', () => {
  const first = websiteSitemapPreview({ pages: priorPages }, current)
  const edited = websiteSitemapPreview({ pages: [{ ...priorPages[0], purpose: 'Changed goal' }, priorPages[1]] }, current)
  const newer = websiteSitemapPreview({ pages: priorPages }, { ...current, id: 'architecture-v3' })
  assert.notEqual(first.signature, edited.signature)
  assert.notEqual(first.signature, newer.signature)
  assert.equal(first.changed.length, 0)
})

test('C02 save requires a fresh reviewed preview of the supported sitemap contract', () => {
  const ui = readFileSync(new URL('../apps/ContentStudio.jsx', import.meta.url), 'utf8')
  assert.match(ui, /outlinePreview\?\.signature === currentOutline.signature/)
  assert.match(ui, /Apply reviewed structure draft/)
  assert.match(ui, /Linked work needs manual source-change review/)
  assert.match(ui, /Page brief schema v2/)
})

test('C02a v2 preserves section order, exact links, and invalidates preview for brief edits', () => {
  const section = { section_key: 'section:11111111-1111-4111-8111-111111111111', heading: 'Proof', purpose: 'Build trust', cta: null }
  const base = { schema_version: 2, pages: [{ ...priorPages[0], audience: 'Operators', sections: [section],
    conversion_action: { kind: 'none', text: null }, source_version_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    keyword_strategy_version_id: null }] }
  const first = websiteSitemapPreview(base, current)
  const changed = websiteSitemapPreview({ ...base, pages: [{ ...base.pages[0], sections: [{ ...section, heading: 'Evidence' }] }] }, current)
  assert.equal(first.pages[0].sections[0].position, 1000)
  assert.deepEqual(first.pages[0].source_version_ids, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
  assert.ok(first.changed[0].fields.includes('sections'))
  assert.notEqual(first.signature, changed.signature)
})

test('C02a brief readiness requires real action text or an explicit none choice', () => {
  const base = { audience: 'Operators', sections: [{ heading: 'Intro', purpose: 'Orient' }] }
  assert.equal(websitePageBriefComplete({ ...base, conversion_action: { kind: 'action', text: ' ' } }), false)
  assert.equal(websitePageBriefComplete({ ...base, conversion_action: { kind: 'action', text: 'Book a call' } }), true)
  assert.equal(websitePageBriefComplete({ ...base, conversion_action: { kind: 'none', text: null } }), true)
  assert.equal(websitePageBriefComplete({ ...base, conversion_action: null }), false)
})
