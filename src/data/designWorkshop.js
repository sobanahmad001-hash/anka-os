export const ARTIFACT_FORMS = Object.freeze({
  discovery: Object.freeze({
    label: 'Discovery',
    description: 'The accepted foundation: context, objectives, offers, evidence and constraints.',
    fields: Object.freeze([
      ['summary', 'Discovery statement', 'textarea'], ['objectives', 'Objectives', 'list'],
      ['offers', 'Offers and services', 'list'], ['evidence', 'Evidence', 'list'], ['constraints', 'Constraints', 'list'],
    ]),
  }),
  vision: Object.freeze({
    label: 'Vision',
    description: 'The authoritative vision, positioning, value proposition, values and voice.',
    fields: Object.freeze([
      ['vision_statement', 'Vision statement', 'textarea'], ['positioning', 'Positioning', 'textarea'],
      ['value_proposition', 'Value proposition', 'textarea'], ['values', 'Values', 'list'],
      ['voice_principles', 'Voice principles', 'list'],
    ]),
  }),
  audience: Object.freeze({
    label: 'Audience',
    description: 'Priority audiences, motivations, objections, desired response and accessibility context.',
    fields: Object.freeze([
      ['primary_audience', 'Primary audience', 'textarea'], ['segments', 'Segments', 'list'],
      ['motivations', 'Motivations', 'list'], ['objections', 'Objections', 'list'],
      ['desired_response', 'Desired response', 'textarea'],
      ['accessibility_considerations', 'Accessibility and cultural considerations', 'list'],
    ]),
  }),
})

export const OUTPUT_FAMILIES = Object.freeze([
  ['brand_identity', 'Brand identity'], ['website_design', 'Website design'],
  ['marketing_asset', 'Marketing asset'], ['video_motion', 'Video and motion'],
])

export function blankArtifactContent(type) {
  return Object.fromEntries((ARTIFACT_FORMS[type]?.fields || []).map(([key, , kind]) => [key, kind === 'list' ? [] : '']))
}

export function latestByVersion(rows = []) {
  return [...rows].sort((a, b) => b.version_number - a.version_number)[0] || null
}

export function approvalForVersion(approvals = [], versionId) {
  return approvals.find(item => item.artifact_version_id === versionId) || null
}
