import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  environmentNav,
  getEnvironmentFromPath,
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
    ['Workspace', 'Workshops', 'Delivery & Support', 'Tools'],
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
  assert.equal(getEnvironmentFromPath('/assistant'), 'sphere')
  assert.deepEqual(activeLabels('/sphere/portfolio'), ['Projects'])
  assert.deepEqual(activeLabels('/sphere/workspace/projects/project-1'), ['Projects'])
  assert.deepEqual(activeLabels('/sphere/workspace/items/project_task/task-1'), ['My Work'])
})

test('desktop and mobile use effective organization membership for navigation', () => {
  const paths = (environment, access) => visibleEnvironmentItems(environment, access)
    .filter(item => item.path).map(item => item.path)
  const content = { organizationId: 'org-a', role: 'contributor', departmentId: 'content',
    department_memberships: [{ department_id: 'design', status: 'active' }],
    contributor_designations: [{ designation: 'executive', status: 'active' }] }
  const contentPaths = paths(sphere, { activeMembership: content, aiAssistance: true })
  assert.ok(contentPaths.includes('/sphere/content'))
  assert.ok(contentPaths.includes('/assistant'))
  assert.ok(!contentPaths.includes('/sphere/design'))
  assert.ok(!contentPaths.includes('/users'))
  assert.deepEqual(paths(sphere, {}), [])

  const leader = { organizationId: 'org-a', role: 'system_owner', departmentId: null }
  const leaderPaths = paths(sphere, { activeMembership: leader })
  for (const path of ['/sphere/content', '/sphere/design', '/sphere/marketing',
    '/sphere/delivery', '/users', '/settings']) assert.ok(leaderPaths.includes(path))
  assert.ok(!paths(sphere, { activeMembership: leader, aiAssistance: false }).includes('/assistant'))

  const adminEnvironment = environmentNav.find(environment => environment.key === 'admin')
  assert.deepEqual(paths(adminEnvironment, { activeMembership: content }), [])
  assert.deepEqual(paths(adminEnvironment, { activeMembership: leader }), ['/users', '/settings'])
  assert.ok(paths(adminEnvironment, { activeMembership: content, profileRole: 'admin' })
    .includes('/admin/living-product-document'))
  assert.ok(!paths(adminEnvironment, { activeMembership: content, profileRole: 'admin' }).includes('/settings'))
  assert.ok(!paths(adminEnvironment, { activeMembership: content, profileRole: 'member' })
    .includes('/admin/living-product-document'))
})

test('specialist tools remain routed inside their parent Workshops with safe return links', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const workshop = readFileSync(new URL('../apps/DepartmentWorkshop.jsx', import.meta.url), 'utf8')
  const workshopTabs = readFileSync(new URL('../components/WorkshopTabs.jsx', import.meta.url), 'utf8')
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
  assert.match(workshopTabs, /role="tablist"/)
  assert.match(workshopTabs, /aria-selected=/)
  assert.match(workshopTabs, /tabIndex=/)
  assert.match(sidebar, /visibleEnvironmentItems/)
  assert.match(sidebar, /isNavigationItemActive/)
  assert.match(mobile, /visibleEnvironmentItems/)
  assert.match(mobile, /isNavigationItemActive/)
  assert.match(sidebar, /activeMembership/)
  assert.match(mobile, /activeMembership/)

  for (const file of ['ContentStudio', 'DesignWorkshop', 'DesignSystems', 'MarketingStudio', 'TechnicalSeoTracking']) {
    const source = readFileSync(new URL('../apps/' + file + '.jsx', import.meta.url), 'utf8')
    assert.match(source, /Back to (Content|Design|Marketing) Workshop/)
  }
})
