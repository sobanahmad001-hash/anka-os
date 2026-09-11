import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'

import { WebsiteArchitecturePathAlert, WebsitePageRecordActions } from '../components/WebsitePageStructureControls.js'

import {
  CONTENT_ARTIFACT_FORMS,
  addWebsiteChild,
  duplicateWebsitePage,
  serializeContentArtifact,
  websiteArchitecturePathErrors,
} from './contentStudio.js'

const websitePagesField = CONTENT_ARTIFACT_FORMS.website_architecture.fields[0]
const ui = readFileSync(new URL('../apps/ContentStudio.jsx', import.meta.url), 'utf8')
const server = readFileSync(new URL('../../supabase/functions/_shared/contentArtifacts.ts', import.meta.url), 'utf8')

function page(overrides = {}) {
  return {
    page_key: 'page:home', slug: 'home', title: 'Home', parent_page_key: '',
    page_type: 'hub', purpose: 'Orient visitors', ...overrides,
  }
}

test('B03b adds a child with fresh identity, selected parent, and deterministic appended order', () => {
  const existing = [page(), page({ page_key: 'page:services', slug: 'services', title: 'Services' })]
  const next = addWebsiteChild(existing, websitePagesField, 'page:home')
  assert.equal(next.length, 3)
  assert.deepEqual(existing.map(item => item.page_key), ['page:home', 'page:services'])
  assert.match(next[2].page_key, /^page:/)
  assert.notEqual(next[2].page_key, 'page:home')
  assert.equal(next[2].parent_page_key, 'page:home')
  assert.equal(next[2].slug, '')

  next[2] = { ...next[2], slug: 'about', title: 'About', page_type: 'supporting', purpose: 'Explain' }
  assert.deepEqual(serializeContentArtifact('website_architecture', { pages: next }).pages.map(item => item.position), [1000, 2000, 3000])
})

test('B03b duplicate copies editable brief data but never identity or proposed path', () => {
  const source = page({ title: 'Services', slug: 'services', page_type: 'service' })
  const next = duplicateWebsitePage([source], websitePagesField, source.page_key)
  const duplicate = next[1]
  assert.notEqual(duplicate.page_key, source.page_key)
  assert.equal(duplicate.slug, '')
  assert.equal(duplicate.title, source.title)
  assert.equal(duplicate.parent_page_key, source.parent_page_key)
  assert.equal(duplicate.page_type, source.page_type)
  assert.equal(duplicate.purpose, source.purpose)
  assert.equal('id' in duplicate, false)
  assert.equal('approval' in duplicate, false)
  assert.equal('version_number' in duplicate, false)

  const resolved = { ...duplicate, slug: 'services-copy' }
  const moved = serializeContentArtifact('website_architecture', { pages: [resolved, source] }).pages
  assert.deepEqual(moved.map(item => [item.page_key, item.slug, item.parent_page_key, item.position]), [
    [resolved.page_key, 'services-copy', null, 1000],
    ['page:home', 'services', null, 2000],
  ])
})

test('B03b blocks blank and normalized duplicate paths before persistence', () => {
  const blank = page({ page_key: 'page:blank', slug: '' })
  const collision = page({ page_key: 'page:collision', slug: ' /HOME/ ' })
  const errors = websiteArchitecturePathErrors([page(), blank, collision])
  assert.match(errors.get('page:blank'), /new unique proposed path/)
  assert.match(errors.get('page:home'), /unique proposed path/)
  assert.match(errors.get('page:collision'), /unique proposed path/)
  assert.match(ui, /disabled=\{saving \|\| pathErrors\.size > 0\}/)
})

test('B03b renders Add child, Duplicate, move state, and path conflict feedback', () => {
  const actions = renderToStaticMarkup(createElement(WebsitePageRecordActions, {
    label: 'Home', buttonClassName: 'button', canMoveEarlier: false, canMoveLater: true,
    onAddChild() {}, onDuplicate() {}, onMoveEarlier() {}, onMoveLater() {},
  }))
  assert.match(actions, />Add child<\/button>/)
  assert.match(actions, />Duplicate<\/button>/)
  assert.match(actions, /aria-label="Move Home earlier" disabled=""/)
  assert.match(actions, /aria-label="Move Home later"/)
  const alert = renderToStaticMarkup(createElement(WebsiteArchitecturePathAlert, { hasErrors: true }))
  assert.match(alert, /role="alert"/)
  assert.match(alert, /Resolve every proposed path before saving/)
  assert.equal(renderToStaticMarkup(createElement(WebsiteArchitecturePathAlert, { hasErrors: false })), '')
  assert.match(ui, /field\.recordType === 'website_page'/)
  assert.match(ui, /onAddChild=\{\(\) => onChange\(addWebsiteChild/)
  assert.match(ui, /onDuplicate=\{\(\) => onChange\(duplicateWebsitePage/)
})

test('B03b preserves B03a server hierarchy, identity, and immutable history boundaries', () => {
  assert.match(server, /Website page paths must be unique after normalization/)
  assert.match(server, /ancestor cycle/)
  assert.match(server, /Stable page key .* cannot be changed/)
  assert.doesNotMatch(ui, /updateArtifactVersion|overwriteArtifactVersion/)
  assert.match(ui, /saved as a new immutable version/)
})
