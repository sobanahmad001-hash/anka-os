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
    label: 'Website architecture', description: 'Structured sitemap with page hierarchy, type, and purpose.',
    fields: Object.freeze([
      { key: 'pages', label: 'Page inventory', kind: 'records', addLabel: 'Add page', recordFields: [
        ['slug', 'Page slug', 'text'], ['title', 'Page title', 'text'],
        ['parent_slug', 'Parent page', 'parent_slug'],
        ['page_type', 'Page type', 'select', ['hub', 'service', 'supporting']],
        ['purpose', 'Page purpose', 'textarea'],
      ] },
    ]),
  }),
  keyword_strategy: Object.freeze({
    label: 'SEO and keyword planning', description: 'Industry, brand, and volume keywords linked to sitemap pages.',
    fields: Object.freeze([
      { key: 'keywords', label: 'Keyword-to-page map', kind: 'records', addLabel: 'Add keyword', recordFields: [
        ['term', 'Keyword term', 'text'],
        ['category', 'Category', 'select', ['industry', 'brand', 'volume']],
        ['search_volume', 'Search volume', 'number'],
        ['target_page_slug', 'Target sitemap page', 'target_page_slug'],
        ['notes', 'Notes', 'textarea_optional'],
      ] },
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
      field.recordFields.map(([key, , kind]) => {
        if (kind === 'list') return [key, commaList(record[key])]
        if (kind === 'number') return [key, Number(record[key])]
        if (kind === 'parent_slug') return [key, String(record[key] || '').trim() || null]
        return [key, String(record[key] || '').trim()]
      }),
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

function contentPageKey(page) {
  return String(page?.page_path || '').trim()
}

function architecturePageSlug(page) {
  return String(page?.slug || '').trim()
}

function approvedVersionForArtifact(workspace, artifact) {
  if (!artifact) return null
  const approval = [...(workspace.approvals || [])]
    .filter(item => item.artifact_id === artifact.id)
    .sort((left, right) => new Date(right.approved_at) - new Date(left.approved_at))[0]
  return (workspace.versions || []).find(version => version.id === approval?.artifact_version_id) || null
}

export function buildContentPageTracking(workspace) {
  const artifacts = workspace?.artifacts || []
  const versions = workspace?.versions || []
  const tasks = workspace?.contentTasks || []
  const architectureArtifact = artifacts.find(item => item.artifact_type === 'website_architecture')
  const contentArtifact = artifacts.find(item => item.artifact_type === 'content')
  const approvedArchitecture = approvedVersionForArtifact(workspace || {}, architectureArtifact)
  const latestContent = latestVersion(versions.filter(version => version.artifact_id === contentArtifact?.id))
  const contentPages = Array.isArray(latestContent?.content?.pages) ? latestContent.content.pages : []
  const architecturePages = Array.isArray(approvedArchitecture?.content?.pages) ? approvedArchitecture.content.pages : []
  const sourcePages = contentPages.length ? contentPages : architecturePages
  const source = contentPages.length ? 'content' : 'website_architecture'
  const taskByPath = new Map(tasks.map(task => [String(task.linked_page_path || '').trim(), task]))
  const pageKey = source === 'content' ? contentPageKey : architecturePageSlug
  const sourcePaths = new Set(sourcePages.map(pageKey).filter(Boolean))
  const rows = sourcePages.map(page => {
    const path = pageKey(page)
    const architecturePage = architecturePages.find(candidate => architecturePageSlug(candidate) === path)
    return {
      pagePath: path,
      pageTitle: architecturePage?.title || path,
      task: taskByPath.get(path) || null,
      mismatch: !taskByPath.has(path),
    }
  })
  const staleTasks = tasks.filter(task => !sourcePaths.has(String(task.linked_page_path || '').trim()))
  return {
    source,
    rows,
    staleTasks,
    approvedArchitecture,
    canGenerate: Boolean(approvedArchitecture && sourcePages.length && tasks.length === 0),
    hasMismatch: rows.some(row => row.mismatch) || staleTasks.length > 0,
  }
}

export function bestContentStage(stages = [], type = '') {
  const terms = {
    discovery: ['discovery'], vision: ['vision', 'identity'], audience: ['audience'],
    brand_statement: ['brand', 'positioning', 'identity'],
    website_architecture: ['architecture'], keyword_strategy: ['keyword'], content: ['content'],
    campaign_messaging: ['campaign', 'messaging'], scripts: ['script'],
  }[type] || []
  return stages.find(stage => stage.accountable_department_id === 'content'
    && terms.some(term => stage.name.toLowerCase().includes(term)))
    || stages.find(stage => stage.accountable_department_id === 'content')
    || null
}
