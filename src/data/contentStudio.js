export const CONTENT_ARTIFACT_FORMS = Object.freeze({
  discovery: Object.freeze({
    label: 'Discovery', description: 'Accepted context, objectives, offers, evidence, and constraints.',
    fields: Object.freeze([
      { key: 'summary', label: 'Discovery statement', kind: 'textarea' },
      { key: 'objectives', label: 'Objectives', kind: 'list' },
      { key: 'offers', label: 'Offers and services', kind: 'list' },
      { key: 'evidence', label: 'Evidence', kind: 'list' },
      { key: 'constraints', label: 'Constraints', kind: 'list' },
    ]),
  }),
  vision: Object.freeze({
    label: 'Vision', description: 'Vision, positioning, value proposition, values, and verbal identity.',
    fields: Object.freeze([
      { key: 'vision_statement', label: 'Vision statement', kind: 'textarea' },
      { key: 'positioning', label: 'Positioning', kind: 'textarea' },
      { key: 'value_proposition', label: 'Value proposition', kind: 'textarea' },
      { key: 'values', label: 'Values', kind: 'list' },
      { key: 'voice_principles', label: 'Voice principles', kind: 'list' },
    ]),
  }),
  audience: Object.freeze({
    label: 'Audience', description: 'Priority audiences, motivations, objections, response, and accessibility context.',
    fields: Object.freeze([
      { key: 'primary_audience', label: 'Primary audience', kind: 'textarea' },
      { key: 'segments', label: 'Segments', kind: 'list' },
      { key: 'motivations', label: 'Motivations', kind: 'list' },
      { key: 'objections', label: 'Objections', kind: 'list' },
      { key: 'desired_response', label: 'Desired response', kind: 'textarea' },
      { key: 'accessibility_considerations', label: 'Accessibility and cultural considerations', kind: 'list' },
    ]),
  }),
  website_architecture: Object.freeze({
    label: 'Website architecture', description: 'Structured sitemap, page inventory, page goals, audiences, and calls to action.',
    fields: Object.freeze([
      { key: 'site_goal', label: 'Overall website goal', kind: 'textarea' },
      { key: 'navigation_principles', label: 'Navigation principles', kind: 'list' },
      { key: 'pages', label: 'Page inventory', kind: 'records', addLabel: 'Add page', recordFields: [
        ['page_name', 'Page name', 'text'], ['path', 'Path', 'text'], ['page_goal', 'Page goal', 'textarea'],
        ['primary_audience', 'Primary audience', 'text'], ['primary_cta', 'Primary CTA', 'text'],
      ] },
    ]),
  }),
  keyword_strategy: Object.freeze({
    label: 'Keyword strategy', description: 'Service, search-demand, and brand-identity keyword lenses mapped to pages.',
    fields: Object.freeze([
      { key: 'strategy_summary', label: 'Strategy summary', kind: 'textarea' },
      { key: 'page_keywords', label: 'Page keyword map', kind: 'records', addLabel: 'Add page mapping', recordFields: [
        ['page_path', 'Page path', 'text'], ['service_keywords', 'Service/product keywords', 'list'],
        ['search_demand_keywords', 'Search-demand keywords', 'list'], ['brand_identity_keywords', 'Brand/identity keywords', 'list'],
      ] },
      { key: 'measurement_notes', label: 'Measurement and review notes', kind: 'list' },
    ]),
  }),
  content: Object.freeze({
    label: 'Content and copy', description: 'Page briefs, draft copy, metadata, and calls to action.',
    fields: Object.freeze([
      { key: 'content_strategy', label: 'Content strategy', kind: 'textarea' },
      { key: 'pages', label: 'Page content', kind: 'records', addLabel: 'Add page content', recordFields: [
        ['page_path', 'Page path', 'text'], ['page_brief', 'Page brief', 'textarea'],
        ['draft_copy', 'Draft copy', 'textarea'], ['meta_title', 'Meta title', 'text'],
        ['meta_description', 'Meta description', 'textarea'], ['primary_cta', 'Primary CTA', 'text'],
      ] },
    ]),
  }),
  campaign_messaging: Object.freeze({
    label: 'Campaign messaging', description: 'Message frameworks that feed Marketing campaign briefs without duplicating them.',
    fields: Object.freeze([
      { key: 'campaign_goal', label: 'Campaign goal', kind: 'textarea' },
      { key: 'audience', label: 'Audience', kind: 'textarea' },
      { key: 'message_framework', label: 'Message framework', kind: 'records', addLabel: 'Add message pillar', recordFields: [
        ['message_pillar', 'Message pillar', 'text'], ['promise', 'Promise', 'textarea'],
        ['proof', 'Proof', 'textarea'], ['objection_response', 'Objection response', 'textarea'],
      ] },
      { key: 'channel_adaptations', label: 'Channel adaptations', kind: 'list' },
    ]),
  }),
  scripts: Object.freeze({
    label: 'Scripts', description: 'Structured video, audio, presentation, or campaign script foundations.',
    fields: Object.freeze([
      { key: 'script_purpose', label: 'Script purpose', kind: 'textarea' },
      { key: 'audience', label: 'Audience', kind: 'textarea' },
      { key: 'format', label: 'Format', kind: 'text' },
      { key: 'estimated_duration', label: 'Estimated duration', kind: 'text' },
      { key: 'hook', label: 'Hook', kind: 'textarea' },
      { key: 'script_beats', label: 'Script beats', kind: 'list' },
      { key: 'call_to_action', label: 'Call to action', kind: 'textarea' },
    ]),
  }),
})

export const CONTENT_ARTIFACT_TYPES = Object.freeze(Object.keys(CONTENT_ARTIFACT_FORMS))

export function blankContentArtifact(type) {
  return Object.fromEntries((CONTENT_ARTIFACT_FORMS[type]?.fields || []).map(field => [
    field.key, field.kind === 'list' || field.kind === 'records' ? [] : '',
  ]))
}

export function contentArtifactEditor(type, content = null) {
  const source = content || blankContentArtifact(type)
  const definition = CONTENT_ARTIFACT_FORMS[type]
  return Object.fromEntries(definition.fields.map(field => {
    const value = source[field.key]
    if (field.kind === 'list') return [field.key, Array.isArray(value) ? value.join('\n') : '']
    if (field.kind === 'records') return [field.key, Array.isArray(value) ? value.map(record => ({ ...record })) : []]
    return [field.key, value || '']
  }))
}

export function serializeContentArtifact(type, editor) {
  const definition = CONTENT_ARTIFACT_FORMS[type]
  return Object.fromEntries(definition.fields.map(field => {
    const value = editor[field.key]
    if (field.kind === 'list') return [field.key, lines(value)]
    if (field.kind === 'records') return [field.key, (value || []).map(record => Object.fromEntries(
      field.recordFields.map(([key, , kind]) => [key, kind === 'list' ? commaList(record[key]) : String(record[key] || '').trim()]),
    ))]
    return [field.key, String(value || '').trim()]
  }))
}

export function newContentRecord(field) {
  return Object.fromEntries(field.recordFields.map(([key]) => [key, '']))
}

export function lines(value) {
  return String(value || '').split('\n').map(item => item.trim()).filter(Boolean)
}

export function commaList(value) {
  return String(value || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean)
}

export function latestVersion(rows = []) {
  return [...rows].sort((left, right) => right.version_number - left.version_number)[0] || null
}

export function approvalForVersion(approvals = [], versionId) {
  return approvals.find(item => item.artifact_version_id === versionId) || null
}

export function bestContentStage(stages = [], type = '') {
  const terms = {
    discovery: ['discovery'], vision: ['vision', 'identity'], audience: ['audience'],
    website_architecture: ['architecture'], keyword_strategy: ['keyword'], content: ['content'],
    campaign_messaging: ['campaign', 'messaging'], scripts: ['script'],
  }[type] || []
  return stages.find(stage => stage.accountable_department_id === 'content'
    && terms.some(term => stage.name.toLowerCase().includes(term)))
    || stages.find(stage => stage.accountable_department_id === 'content')
    || null
}
