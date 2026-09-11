export const environmentNav = [
  {
    key: 'admin',
    label: 'Admin',
    basePath: '/admin',
    description: 'Central hub',
    items: [
      { label: 'Overview', path: '/admin' },
      { label: 'Users', path: '/users' },
      { label: 'Connectors', path: '/settings' },
      { label: 'Product Document', path: '/admin/living-product-document' },
      { label: 'Assistant', path: '/assistant' },
    ],
  },
  {
    key: 'sphere',
    label: 'Anka Sphere',
    basePath: '/sphere/workspace',
    description: 'Client delivery',
    items: [
      { label: 'Workspace', path: null, dept: null, isHeader: true },
      { label: 'Home', path: '/sphere/workspace', dept: null, activePrefixes: ['/sphere/workspace/projects'] },
      { label: 'Portfolio', path: '/sphere/portfolio', dept: null },
      { label: 'Client Work', path: '/sphere/clients', dept: null, activePrefixes: ['/sphere/clients'] },
      { label: 'Internal Work', path: '/sphere/internal', dept: null },
      { label: 'My Work', path: '/sphere/my-work', dept: null, activePrefixes: ['/sphere/workspace/items'] },

      { label: 'Workshops', path: null, dept: null, isHeader: true },
      { label: 'Content Workshop', path: '/sphere/content', dept: 'content', activePrefixes: ['/sphere/content'] },
      { label: 'Design Workshop', path: '/sphere/design', dept: 'design', activePrefixes: ['/sphere/design'] },
      { label: 'Marketing Workshop', path: '/sphere/marketing', dept: 'marketing', activePrefixes: ['/sphere/marketing'] },

      { label: 'Delivery & Support', path: null, dept: null, isHeader: true },
      { label: 'Development', path: '/sphere/delivery', dept: 'development', activePrefixes: ['/sphere/delivery'] },
      { label: 'Sphere Events', path: '/sphere/events', dept: null },
      { label: 'Client Portal', path: '/sphere/portal', dept: null },
      { label: 'Reports & Records', path: '/sphere/reports', dept: null },
    ],
  },
]

export function getEnvironmentFromPath(pathname) {
  if (!pathname) return 'sphere'
  if (pathname.startsWith('/admin') || pathname === '/users' || pathname === '/settings') return 'admin'
  if (pathname.startsWith('/sphere')) return 'sphere'
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

export function isNavigationItemVisible(item, { environmentKey, role, department, aiAssistance = true } = {}) {
  if (item.path === '/assistant' && !aiAssistance) return false
  if (environmentKey === 'admin') return role === 'admin'
  if (environmentKey !== 'sphere') return false
  return item.dept == null || role === 'admin' || department === item.dept
}

export function visibleEnvironmentItems(environment, access = {}) {
  return (environment?.items || []).filter((item) => isNavigationItemVisible(item, {
    ...access,
    environmentKey: environment?.key,
  }))
}
