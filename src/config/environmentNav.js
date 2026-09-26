const ORGANIZATION_ADMIN_ROLES = new Set(['system_owner', 'operations_admin'])
const ALL_DEPARTMENT_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])

export const environmentNav = [
  {
    key: 'admin',
    label: 'Administration',
    basePath: '/admin',
    description: 'Central hub',
    items: [
      { label: 'Overview', path: '/admin', legacyAdmin: true },
      { label: 'Users', path: '/users', organizationAdmin: true, legacyAdminFallback: true },
      { label: 'Connectors', path: '/settings', organizationAdmin: true },
      { label: 'Product Document', path: '/admin/living-product-document', legacyAdmin: true },
    ],
  },
  {
    key: 'sphere',
    label: 'Anka Sphere',
    basePath: '/sphere/workspace',
    description: 'Client delivery',
    items: [
      { label: 'Workspace', path: null, isHeader: true },
      { label: 'Home', path: '/sphere/workspace' },
      { label: 'My Work', path: '/sphere/my-work', activePrefixes: ['/sphere/workspace/items'] },
      { label: 'Projects', path: '/sphere/portfolio', activePrefixes: ['/sphere/workspace/projects', '/sphere/internal', '/sphere/engagements'] },
      { label: 'Clients', path: '/sphere/clients', activePrefixes: ['/sphere/clients'] },
      { label: 'Workshops', path: null, isHeader: true },
      { label: 'Content Workshop', path: '/sphere/content', dept: 'content', activePrefixes: ['/sphere/content'] },
      { label: 'Design Workshop', path: '/sphere/design', dept: 'design', activePrefixes: ['/sphere/design'] },
      { label: 'Marketing Workshop', path: '/sphere/marketing', dept: 'marketing', activePrefixes: ['/sphere/marketing'] },
      { label: 'Coordination', path: null, isHeader: true },
      { label: 'Reviews & Delivery', path: '/sphere/reviews' },
      { label: 'Planning', path: '/sphere/planning', activePrefixes: ['/sphere/events'] },
      { label: 'Reports', path: '/sphere/reports' },
      { label: 'Development delivery', path: '/sphere/delivery', dept: 'development', activePrefixes: ['/sphere/delivery'] },
      { label: 'Client Portal', path: '/sphere/portal' },
      { label: 'Tools', path: null, isHeader: true },
      { label: 'Assistant', path: '/assistant' },
      { label: 'Administration', path: '/settings', organizationAdmin: true },
    ],
  },
]

export function getEnvironmentFromPath(pathname) {
  if (!pathname) return 'sphere'
  if (pathname.startsWith('/admin') || pathname === '/users' || pathname === '/settings') return 'admin'
  return 'sphere'
}

function normalizedPath(pathname) {
  const value = String(pathname || '/').split(/[?#]/, 1)[0].replace(/\/+$/, '')
  return value || '/'
}

export function isNavigationItemActive(item, pathname) {
  if (!item?.path) return false
  const current = normalizedPath(pathname)
  if (current === normalizedPath(item.path)) return true
  return (item.activePrefixes || []).some((prefix) => {
    const parent = normalizedPath(prefix)
    return current === parent || current.startsWith(`${parent}/`)
  })
}

export function isNavigationItemVisible(item, {
  environmentKey, activeMembership, profileRole, aiAssistance = true,
} = {}) {
  if (!activeMembership?.organizationId) return false
  if (item.path === '/assistant' && !aiAssistance) return false
  if (item.legacyAdmin) return profileRole === 'admin'
  if (item.organizationAdmin) {
    return ORGANIZATION_ADMIN_ROLES.has(activeMembership.role)
      || (item.legacyAdminFallback && profileRole === 'admin')
  }
  if (environmentKey !== 'sphere') return false
  if (item.dept) {
    return ALL_DEPARTMENT_ROLES.has(activeMembership.role)
      || activeMembership.departmentId === item.dept
      || activeMembership.departmentIds?.includes(item.dept) === true
  }
  return true
}

export function visibleEnvironmentItems(environment, access = {}) {
  const items = (environment?.items || []).filter(item => isNavigationItemVisible(item, {
    ...access, environmentKey: environment?.key,
  }))
  return items.filter((item, index) => {
    if (!item.isHeader) return true
    const following = items.slice(index + 1)
    const nextHeader = following.findIndex(next => next.isHeader)
    const section = nextHeader < 0 ? following : following.slice(0, nextHeader)
    return section.some(next => Boolean(next.path))
  })
}
