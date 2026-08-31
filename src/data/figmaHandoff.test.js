import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import { figmaHandoffPath, recentBrandRequests, requestReferenceAssets } from './figmaHandoff.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../App.jsx')
const page = read('../apps/FigmaHandoff.jsx')
const repository = read('./figmaHandoffRepository.js')
const contentRepository = read('./contentRequestsRepository.js')
const contentPanel = read('../components/ContentRequestPanel.jsx')
const generalPanel = read('../components/GeneralContentRequestsPanel.jsx')
const edge = read('../../supabase/functions/content-studio/index.ts')

test('CP3 handoff path is stable and remains inside the protected route tree', () => {
  assert.equal(figmaHandoffPath('request 1'), '/sphere/content/requests/request%201/figma-handoff')
  assert.match(app, /<ProtectedRoute>[\s\S]*<Layout \/>[\s\S]*path="sphere\/content\/requests\/:requestId\/figma-handoff"/)
  assert.match(page, /Authenticated designer reference/)
})

test('CP3 uses only existing brand fields and explicitly reports the visual identity gap', () => {
  assert.match(repository, /brands'\)\.select\('id, name, description, website_url, status'\)/)
  assert.match(page, /Colors, fonts, and logos are not recorded in the current brand schema/)
  assert.match(page, /Unbranded request/)
  assert.doesNotMatch(repository, /primary_color|secondary_color|font_family|logo_url/)
})

test('CP3 reads scoped event, recent request, and media context through existing RLS tables', () => {
  for (const table of ['content_requests', 'brands', 'external_events', 'design_media_assets', 'content_request_assets']) {
    assert.match(repository, new RegExp(`from\\('${table}'\\)`))
  }
  assert.match(repository, /eq\('organization_id', request\.organization_id\)/)
  assert.match(repository, /sign_media_assets/)
  const request = { id: 'current', brand_id: 'brand-1' }
  assert.deepEqual(recentBrandRequests(request, [
    request,
    { id: 'past-1', brand_id: 'brand-1' },
    { id: 'other', brand_id: 'brand-2' },
  ]), [{ id: 'past-1', brand_id: 'brand-1' }])
  assert.deepEqual(requestReferenceAssets({ id: 'past-1' }, [
    { id: 'asset-1', content_request_id: 'past-1' },
    { id: 'asset-2', content_request_id: 'past-2' },
  ]), [{ id: 'asset-1', content_request_id: 'past-1' }])
})

test('CP3 stores the canonical URL in the existing exact-one-target table', () => {
  assert.match(edge, /ensureFigmaHandoff[\s\S]*from\('content_request_assets'\)\.insert/)
  assert.match(edge, /figma_handoff_url: figmaHandoffUrl\(request\.id\)/)
  assert.match(edge, /request\.output_path !== 'figma_handoff'/)
  assert.match(contentRepository, /ensure_figma_handoff/)
  assert.match(contentPanel, /Open authenticated Figma reference/)
  assert.match(generalPanel, /ensureFigmaHandoff\(result\.request\.id\)/)
  assert.match(generalPanel, /Open authenticated Figma reference/)
})

test('CP3 adds no migration and contains no Figma API or plugin implementation', () => {
  const migrations = readdirSync(new URL('../../supabase/migrations/', import.meta.url))
    .filter(name => /cp3|figma_handoff/i.test(name))
  assert.deepEqual(migrations, [])
  const sources = [app, page, repository, contentRepository, contentPanel, generalPanel, edge].join('\n')
  assert.doesNotMatch(sources, /api\.figma\.com|figma\.create|figma plugin/i)
})
