export const WEBSITE_QA_EVIDENCE = Object.freeze([
  ['responsive', 'Desktop and mobile layout'],
  ['keyboard', 'Keyboard navigation and focus'],
  ['structure', 'Headings and image descriptions'],
  ['motion', 'Reduced-motion behavior'],
  ['links_metadata', 'Links and page metadata'],
  ['security', 'Assets and security checks'],
  ['performance', 'Performance measurements and budget'],
])
export const qaAcceptanceKey = scope => ['anka:website-qa', scope.actorId, scope.organizationId, scope.projectId, scope.engagementId].join(':')
export function completeQaEvidence(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === WEBSITE_QA_EVIDENCE.length && WEBSITE_QA_EVIDENCE.every(([key]) => typeof value[key] === 'string' && value[key].trim().length >= 10 && value[key].length <= 1000)
}
