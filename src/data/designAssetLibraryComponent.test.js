import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('asset library renders its read-only empty state, filters and keyboard controls', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: DesignAssetLibrary } = await server.ssrLoadModule('/src/components/DesignAssetLibrary.jsx')
  const markup = renderToStaticMarkup(createElement(DesignAssetLibrary, {
    contextKey: 'engagement-a',
    workspace: { engagement: { id: 'engagement-a' }, mediaAssets: [], imageGenerationJobs: [], directionVersions: [], experimentalDirectionVersions: [], directions: [], sessions: [], models: [], variants: [], mediaUrlExpiresIn: 300 },
    onClose: () => {},
    onFocusSource: () => {},
  }))

  assert.match(markup, /Design S05 · Read-only/)
  assert.match(markup, /No generated assets yet/)
  assert.match(markup, /All statuses/)
  assert.match(markup, /All sources/)
  assert.match(markup, /Any date/)
  assert.match(markup, /aria-pressed="true"/)
  assert.doesNotMatch(markup, /Upload asset|Approve asset|Archive asset|Generate image/)
})
