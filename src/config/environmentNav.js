export const environmentNav = [
  {
    key: 'admin',
    label: 'Admin',
    basePath: '/admin',
    description: 'Org spine',
    items: [
      { label: 'Overview', path: '/admin' },
      { label: 'Portfolio', path: '/projects' },
      { label: 'Users', path: '/users' },
      { label: 'Rules', path: '/settings' },
    ],
  },
  {
    key: 'development',
    label: 'Development',
    basePath: '/dev-dashboard',
    description: 'Technical execution',
    items: [
      { label: 'Overview', path: '/dev-dashboard' },
      { label: 'Projects', path: '/projects' },
      { label: 'Sprint / Queue', path: '/kanban' },
      { label: 'API Docs', path: '/api-docs' },
      { label: 'Terminal', path: '/terminal' },
      { label: 'Git', path: '/git' },
    ],
  },
  {
    key: 'design',
    label: 'Design',
    basePath: '/projects',
    description: 'Creative execution',
    items: [
      { label: 'Overview', path: '/projects' },
      { label: 'Files', path: '/files' },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing',
    basePath: '/campaigns',
    description: 'Campaign execution',
    items: [
      { label: 'Overview', path: '/campaigns' },
      { label: 'Calendar', path: '/calendar' },
      { label: 'Clients', path: '/clients' },
    ],
  },
]

export function getEnvironmentFromPath(pathname) {
  if (!pathname) return 'development'

  if (pathname === '/admin' || pathname === '/users' || pathname === '/settings') {
    return 'admin'
  }

  if (
    pathname === '/dev-dashboard' ||
    pathname === '/kanban' ||
    pathname === '/api-docs' ||
    pathname === '/terminal' ||
    pathname === '/git'
  ) {
    return 'development'
  }

  if (pathname === '/campaigns' || pathname === '/calendar' || pathname === '/clients') {
    return 'marketing'
  }

  if (pathname === '/projects' || pathname === '/files') {
    return 'design'
  }

  return 'development'
}
