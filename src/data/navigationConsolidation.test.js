import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  environmentNav,
  isNavigationItemActive,
  visibleEnvironmentItems,
} from '../config/environmentNav.js'

const sphere = environmentNav.find((environment) => environment.key === 'sphere')
const links = sphere.items.filter((item) => item.path)
const activeLabels = (pathname) => links
  .filter((item) => isNavigationItemActive(item, pathname))
  .map((item) => item.label)

test('primary navigation has one Workshop entry per production department', () => {
  assert.deepEqual(
    sphere.items.filter((item) => item.isHeader).map((item) => item.label),
    ['Workspace', 'Workshops', 'Delivery & Support'],
  )
  assert.deepEqual(
    links.filter((item) => item.path.startsWith('/sphere/content')).map((item) => item.label),
    ['Content Workshop'],
  )
  assert.deepEqual(
    links.filter((item) => item.path.startsWith('/sphere/design')).map((item) => item.label),
    ['Design Workshop'],
  )
  assert.deepEqual(
    links.filter((item) => item.path.startsWith('/sphere/marketing')).map((item) => item.label),
    ['Marketing Workshop'],
  )
})

test('specialist URLs highlight exactly their parent Workshop', () => {
  for (const [pathname, label] of [
    ['/sphere/content/studio', 'Content Workshop'],
    ['/sphere/content/requests/request-1/figma-handoff', 'Content Workshop'],
    ['/sphere/design/workshop', 'Design Workshop'],
    ['/sphere/design/systems', 'Design Workshop'],
    ['/sphere/marketing/studio', 'Marketing Workshop'],
    ['/sphere/marketing/seo', 'Marketing Workshop'],
  ]) {
    assert.deepEqual(activeLabels(pathname), [label], pathname)
  }
  assert.deepEqual(activeLabels('/sphere/workspace'), ['Home'])
  assert.deepEqual(activeLabels('/sphere/portfolio'), ['Portfolio'])
  assert.deepEqual(activeLabels('/sphere/workspace/projects/project-1'), ['Home'])
  assert.deepEqual(activeLabels('/sphere/workspace/items/project_task/task-1'), ['My Work'])
})

test('desktop and mobile share unchanged department and admin visibility rules', () => {
  const signedOut = visibleEnvironmentItems(sphere, {}).filter((item) => item.path).map((item) => item.label)
  assert.ok(signedOut.includes('Home'))
  assert.ok(!signedOut.some((label) => label.endsWith('Workshop') || label === 'Development'))

  const contentMember = visibleEnvironmentItems(sphere, {
    role: 'member',
    department: 'content',
    aiAssistance: false,
  }).filter((item) => item.path).map((item) => item.label)
  assert.ok(contentMember.includes('Content Workshop'))
  assert.ok(contentMember.includes('Sphere Events'))
  assert.ok(!contentMember.includes('Design Workshop'))
  assert.ok(!contentMember.includes('Marketing Workshop'))
  assert.ok(!contentMember.includes('Development'))

  const admin = visibleEnvironmentItems(sphere, {
    role: 'admin',
    department: null,
    aiAssistance: false,
  }).filter((item) => item.path).map((item) => item.label)
  for (const label of ['Content Workshop', 'Design Workshop', 'Marketing Workshop', 'Development']) {
    assert.ok(admin.includes(label))
  }

  const adminEnvironment = environmentNav.find((environment) => environment.key === 'admin')
  assert.equal(visibleEnvironmentItems(adminEnvironment, { role: 'member' }).length, 0)
  assert.ok(visibleEnvironmentItems(adminEnvironment, { role: 'admin' }).length > 0)
})

test('specialist tools remain routed inside their parent Workshops with safe return links', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const workshop = readFileSync(new URL('../apps/DepartmentWorkshop.jsx', import.meta.url), 'utf8')
  const sidebar = readFileSync(new URL('../components/Sidebar.jsx', import.meta.url), 'utf8')
  const mobile = readFileSync(new URL('../components/Header.jsx', import.meta.url), 'utf8')

  for (const route of [
    'sphere/content/studio',
    'sphere/design/workshop',
    'sphere/design/systems',
    'sphere/marketing/studio',
    'sphere/marketing/seo',
  ]) assert.match(app, new RegExp('path="' + route.replaceAll('/', '\\/') + '"'))

  for (const label of ['Content Studio', 'Design Workshop', 'Design Systems', 'Marketing Studio', 'Technical SEO']) {
    assert.match(workshop, new RegExp("name: '" + label + "'"))
  }
  assert.match(workshop, /appendWorkshopNavigation\(item\.path/)
  assert.match(workshop, /role="tablist"/)
  assert.match(workshop, /aria-selected=/)
  assert.match(sidebar, /visibleEnvironmentItems/)
  assert.match(sidebar, /isNavigationItemActive/)
  assert.match(mobile, /visibleEnvironmentItems/)
  assert.match(mobile, /isNavigationItemActive/)

  for (const file of ['ContentStudio', 'DesignWorkshop', 'DesignSystems', 'MarketingStudio', 'TechnicalSeoTracking']) {
    const source = readFileSync(new URL('../apps/' + file + '.jsx', import.meta.url), 'utf8')
    assert.match(source, /Back to (Content|Design|Marketing) Workshop/)
  }
})
