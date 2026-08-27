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
    basePath: '/sphere/engagements',
    description: 'Client delivery',
    items: [
      // Core - visible to all authorized team members
      { label: 'My Work', path: '/sphere/my-work', dept: null },
      { label: 'Engagements', path: '/sphere/engagements', dept: null },
      { label: 'Clients & Brands', path: '/sphere/clients', dept: null },
      { label: 'Client Portal', path: '/sphere/portal', dept: null },
      { label: 'Reports & Records', path: '/sphere/reports', dept: null },

      // Content dept
      { label: 'Content', path: null, dept: 'content', isHeader: true },
      { label: 'Content Workshop', path: '/sphere/content', dept: 'content' },

      // Design dept
      { label: 'Design', path: null, dept: 'design', isHeader: true },
      { label: 'Design Workspace', path: '/sphere/design', dept: 'design' },
      { label: 'Design Workshop', path: '/sphere/design/workshop', dept: 'design' },

      // Development dept (WordPress focused)
      { label: 'Development', path: null, dept: 'development', isHeader: true },
      { label: 'Development Studio', path: '/sphere/delivery', dept: 'development' },

      // Marketing dept
      { label: 'Marketing', path: null, dept: 'marketing', isHeader: true },
      { label: 'Marketing Workshop', path: '/sphere/marketing', dept: 'marketing' },
      { label: 'Marketing Studio', path: '/sphere/marketing/studio', dept: 'marketing' },
    ],
  },
]

export function getEnvironmentFromPath(pathname) {
  if (!pathname) return 'sphere'
  if (pathname.startsWith('/admin') || pathname === '/users' || pathname === '/settings') return 'admin'
  if (pathname.startsWith('/sphere')) return 'sphere'
  return 'sphere'
}
