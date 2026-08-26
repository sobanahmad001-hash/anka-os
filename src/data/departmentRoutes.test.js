import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appUrl = new URL('../App.jsx', import.meta.url)
const workshopUrl = new URL('../apps/DepartmentWorkshop.jsx', import.meta.url)
const navigationUrl = new URL('../config/environmentNav.js', import.meta.url)

test('all four department routes use one canonical workshop', async () => {
  const [appSource, workshopSource, navigationSource] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(workshopUrl, 'utf8'),
    readFile(navigationUrl, 'utf8'),
  ])

  for (const [path, department] of [
    ['content', 'content'],
    ['design', 'design'],
    ['marketing', 'marketing'],
    ['delivery', 'development'],
  ]) {
    assert.match(
      appSource,
      new RegExp(`path="sphere/${path}" element={<DepartmentWorkshop departmentId="${department}" \\/>}`)
    )
  }

  assert.doesNotMatch(workshopSource, /\.from\s*\(/)
  assert.doesNotMatch(workshopSource, /as_/)
  assert.match(workshopSource, /delivery\.getDepartmentWorkspace/)
  assert.match(navigationSource, /Content Workshop/)
  assert.match(navigationSource, /Design Workshop/)
  assert.match(navigationSource, /Marketing Workshop/)
  assert.match(navigationSource, /Development Studio/)
})
