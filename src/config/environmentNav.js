export const environmentNav = [
  {
    key: 'admin',
    label: 'Admin',
    basePath: '/admin',
    description: 'Central hub',
    items: [
      { label: 'Overview', path: '/admin' },
      { label: 'Users', path: '/users' },
      { label: 'Rules', path: '/settings' },
      { label: 'Assistant', path: '/assistant' },
    ],
  },
  {
    key: 'sphere',
    label: 'Anka Sphere',
    basePath: '/sphere/projects',
    description: 'Client delivery',
    items: [
      // Core — visible to all
      { label: 'Projects', path: '/sphere/projects', dept: null },
      { label: 'Clients', path: '/sphere/clients', dept: null },
      { label: 'Client Portal', path: '/sphere/portal', dept: null },
      { label: 'Team Board', path: '/sphere/team-board', dept: null },

      // Design dept
      { label: '— Design', path: null, dept: 'design', isHeader: true },
      { label: 'Figma Workspace', path: '/sphere/figma', dept: 'design' },
      { label: 'Creative Studio', path: '/sphere/assets', dept: 'design' },
      { label: 'Asset Library', path: '/sphere/moodboard', dept: 'design' },
      { label: 'Brand Guidelines', path: '/sphere/design-reviews', dept: 'design' },

      // Development dept (WordPress focused)
      { label: '— Development', path: null, dept: 'development', isHeader: true },
      { label: 'WP Engine', path: '/sphere/wp-sites', dept: 'development' },
      { label: 'Page Builder', path: '/sphere/deployments', dept: 'development' },
      { label: 'Site Tracker', path: '/sphere/performance', dept: 'development' },

      // Marketing dept
      { label: '— Marketing', path: null, dept: 'marketing', isHeader: true },
      { label: 'Marketing Hub', path: '/sphere/campaigns', dept: 'marketing' },
      { label: 'Content', path: '/sphere/content', dept: 'marketing' },
      { label: 'Calendar', path: '/sphere/calendar', dept: 'marketing' },
      { label: 'SEO Tracker', path: '/sphere/seo', dept: 'marketing' },
    ],
  },
  {
    key: 'diversify',
    label: 'Anka Diversify',
    basePath: '/diversify/projects',
    description: 'Product build',
    items: [
      { label: 'Projects', path: '/diversify/projects', dept: null },
      { label: 'Coding Agent', path: '/diversify/agent', dept: null },
      { label: 'Sprint / Queue', path: '/diversify/kanban', dept: null },
      { label: 'Git & PRs', path: '/diversify/git', dept: null },
      { label: 'API Docs', path: '/diversify/api-docs', dept: null },
      { label: 'Terminal', path: '/diversify/terminal', dept: null },
    ],
  },
]

export function getEnvironmentFromPath(pathname) {
  if (!pathname) return 'diversify'
  if (pathname.startsWith('/admin') || pathname === '/users' || pathname === '/settings') return 'admin'
  if (pathname.startsWith('/sphere')) return 'sphere'
  if (pathname.startsWith('/diversify')) return 'diversify'
  return 'diversify'
}
