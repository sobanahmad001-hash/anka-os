const ALL_DEPARTMENTS = Object.freeze(['content', 'design', 'development', 'marketing'])

export const DEPARTMENT_LABELS = Object.freeze({
  content: 'Content',
  design: 'Design',
  development: 'Development',
  marketing: 'Marketing',
})

export const CONNECTOR_CATALOG = Object.freeze({
  openai: Object.freeze({
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    category: 'AI & models',
    description: 'Grounded writing, analysis, visual-model routing, quality review, and department assistance.',
    departments: ALL_DEPARTMENTS,
    authMode: 'secret',
    availability: 'available',
    secretPrefix: 'ANKA_OPENAI_',
    capabilities: Object.freeze(['Text and reasoning', 'Image-aware assistance', 'Structured recommendations']),
  }),
  github: Object.freeze({
    label: 'GitHub',
    shortLabel: 'GitHub',
    category: 'Development',
    description: 'Repository, branch, pull-request, and delivery context for Development.',
    departments: Object.freeze(['development']),
    authMode: 'secret',
    availability: 'available',
    secretPrefix: 'ANKA_GITHUB_',
    capabilities: Object.freeze(['Repository context', 'Read-only connection test']),
  }),
  figma: Object.freeze({
    label: 'Figma',
    shortLabel: 'Figma',
    category: 'Design',
    description: 'Design-file context, review references, and approved handoffs for the Design Workshop.',
    departments: Object.freeze(['design']),
    authMode: 'secret',
    availability: 'available',
    secretPrefix: 'ANKA_FIGMA_',
    capabilities: Object.freeze(['File context', 'Review and handoff']),
  }),
  wordpress: Object.freeze({
    label: 'WordPress',
    shortLabel: 'WordPress',
    category: 'Development',
    description: 'Site, staging, release, and maintenance context for the Development queue.',
    departments: Object.freeze(['development']),
    authMode: 'secret',
    availability: 'available',
    secretPrefix: 'ANKA_WORDPRESS_',
    capabilities: Object.freeze(['Site identity', 'Read-only connection test']),
  }),
  google_analytics: Object.freeze({
    label: 'Google Analytics 4',
    shortLabel: 'GA4',
    category: 'Measurement',
    description: 'Website engagement, event, conversion, and page-performance reporting.',
    departments: Object.freeze(['development', 'marketing']),
    authMode: 'oauth',
    availability: 'oauth_planned',
    capabilities: Object.freeze(['Reporting', 'Conversion measurement', 'Realtime health']),
  }),
  google_search_console: Object.freeze({
    label: 'Google Search Console',
    shortLabel: 'Search Console',
    category: 'Search',
    description: 'Query, page, click, impression, CTR, position, and sitemap visibility.',
    departments: Object.freeze(['content', 'development', 'marketing']),
    authMode: 'oauth',
    availability: 'oauth_planned',
    capabilities: Object.freeze(['Search performance', 'Page opportunities', 'Sitemap health']),
  }),
  google_ads: Object.freeze({
    label: 'Google Ads',
    shortLabel: 'Google Ads',
    category: 'Paid media',
    description: 'Campaign, spend, search-term, conversion, and optimisation reporting.',
    departments: Object.freeze(['marketing']),
    authMode: 'oauth',
    availability: 'oauth_planned',
    capabilities: Object.freeze(['Campaign reporting', 'Spend visibility', 'Conversion reporting']),
  }),
  google_drive: Object.freeze({
    label: 'Google Drive',
    shortLabel: 'Drive',
    category: 'Files',
    description: 'Approved source files, references, and delivery packages shared across departments.',
    departments: ALL_DEPARTMENTS,
    authMode: 'oauth',
    availability: 'planned',
    capabilities: Object.freeze(['References', 'Approved assets', 'Delivery packages']),
  }),
  meta: Object.freeze({
    label: 'Meta Business',
    shortLabel: 'Meta',
    category: 'Social & paid media',
    description: 'Facebook and Instagram campaign, creative, and engagement reporting.',
    departments: Object.freeze(['design', 'marketing']),
    authMode: 'oauth',
    availability: 'planned',
    capabilities: Object.freeze(['Campaign reporting', 'Creative performance', 'Social insights']),
  }),
  anthropic: Object.freeze({
    label: 'Anthropic',
    shortLabel: 'Anthropic',
    category: 'AI & models',
    description: 'An additional reasoning and writing provider for controlled multi-model workflows.',
    departments: ALL_DEPARTMENTS,
    authMode: 'secret',
    availability: 'planned',
    capabilities: Object.freeze(['Text and reasoning', 'Model comparison']),
  }),
})

export const CONFIGURABLE_CONNECTOR_IDS = Object.freeze(
  Object.keys(CONNECTOR_CATALOG).filter((id) => CONNECTOR_CATALOG[id].availability === 'available')
)

export function connectorsForDepartment(departmentId) {
  return Object.entries(CONNECTOR_CATALOG)
    .filter(([, connector]) => connector.departments.includes(departmentId))
    .map(([id, connector]) => ({ id, ...connector }))
}

export function connectorLabel(provider) {
  return CONNECTOR_CATALOG[provider]?.label || String(provider || 'Unknown connector')
}

export function departmentLabel(departmentId) {
  return DEPARTMENT_LABELS[departmentId] || String(departmentId || 'Unknown department')
}
