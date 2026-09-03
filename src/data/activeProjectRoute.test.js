import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appUrl = new URL('../App.jsx', import.meta.url)
const projectScreenUrl = new URL('../apps/OperatingSpine.jsx', import.meta.url)

test('engagement compatibility uses Operating Spine while projects open Portfolio Workspace', async () => {
  const [appSource, projectSource] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(projectScreenUrl, 'utf8'),
  ])

  assert.match(appSource, /path="sphere\/engagements" element={<OperatingSpine initialView="engagements" \/>}/)
  assert.match(appSource, /path="sphere\/projects" element={<Navigate to="\/sphere\/workspace" replace \/>}/)
  assert.doesNotMatch(projectSource, /\.from\s*\(/)
  assert.doesNotMatch(projectSource, /as_/)
  assert.match(projectSource, /operatingSpine\.composeEngagement/)
  assert.match(projectSource, /Client → Brand → Engagement/)
  assert.match(projectSource, /Partial journeys supported/)
  assert.match(projectSource, /Service Catalogue/)
})
