import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const nav = readFileSync(new URL('../config/environmentNav.js', import.meta.url), 'utf8')

test('legacy provider screens are not imported into the active runtime', () => {
  for (const component of ['SphereCreativeStudio', 'SphereWPEngine', 'SphereMarketing', 'SphereFigmaWorkspace']) {
    assert.doesNotMatch(app, new RegExp(`import ${component}`))
  }
})

test('legacy specialist URLs safely redirect to canonical workshops', () => {
  assert.match(app, /path="sphere\/figma" element={<Navigate to="\/sphere\/design"/)
  assert.match(app, /path="sphere\/wp-sites" element={<Navigate to="\/sphere\/delivery"/)
  assert.match(app, /path="sphere\/campaigns" element={<Navigate to="\/sphere\/marketing"/)
})

test('navigation exposes only canonical delivery surfaces', () => {
  for (const path of ['/sphere/figma', '/sphere/assets', '/sphere/wp-sites', '/sphere/campaigns']) {
    assert.doesNotMatch(nav, new RegExp(`path: '${path}'`))
  }
  for (const path of ['/sphere/my-work', '/sphere/projects', '/sphere/content', '/sphere/design', '/sphere/marketing', '/sphere/delivery', '/sphere/clients', '/sphere/portal']) {
    assert.match(nav, new RegExp(`path: '${path}'`))
  }
})
