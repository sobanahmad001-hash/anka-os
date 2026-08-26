import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appUrl = new URL('../App.jsx', import.meta.url)
const projectScreenUrl = new URL('../apps/CanonicalProjects.jsx', import.meta.url)

test('active project route uses the canonical project workspace', async () => {
  const [appSource, projectSource] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(projectScreenUrl, 'utf8'),
  ])

  assert.match(appSource, /path="sphere\/projects" element={<CanonicalProjects \/>}/)
  assert.doesNotMatch(appSource, /import AnkaSphereProjects/)
  assert.doesNotMatch(projectSource, /\.from\s*\(/)
  assert.doesNotMatch(projectSource, /as_/)
  assert.match(projectSource, /delivery\.createWorkstreams/)
  assert.match(projectSource, /Living Project Record/)
  assert.match(projectSource, /STATUS_FILTERS/)
  assert.match(projectSource, /searchQuery/)
  assert.match(projectSource, /featureFlags\.clientApprovals/)
})
