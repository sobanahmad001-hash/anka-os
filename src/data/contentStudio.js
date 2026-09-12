export const CONTENT_ARTIFACT_FORMS = Object.freeze({
  discovery: Object.freeze({
    label: 'Discovery', description: 'Accepted context, objectives, offers, evidence, and constraints.',
    fields: Object.freeze([
      { key: 'summary', label: 'Discovery statement', kind: 'textarea' },
      { key: 'objectives', label: 'Objectives', kind: 'list' },
      { key: 'offers', label: 'Offers and services', kind: 'list' },
      { key: 'evidence', label: 'Evidence', kind: 'list', unknownAllowed: true },
      { key: 'constraints', label: 'Constraints', kind: 'list', unknownAllowed: true },
    ]),
  }),
  vision: Object.freeze({
    label: 'Vision', description: 'Vision, positioning, value proposition, values, and verbal identity.',
    fields: Object.freeze([
      { key: 'vision_statement', label: 'Vision statement', kind: 'textarea' },
      { key: 'positioning', label: 'Positioning', kind: 'textarea' },
      { key: 'value_proposition', label: 'Value proposition', kind: 'textarea' },
      { key: 'differentiators', label: 'Differentiators', kind: 'list' },
      { key: 'values', label: 'Values', kind: 'list' },
      { key: 'voice_principles', label: 'Voice principles', kind: 'list' },
      { key: 'messaging_pillars', label: 'Messaging pillars', kind: 'list' },
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
    label: 'Website architecture', description: 'Structured sitemap with stable page identity, hierarchy, order, and purpose.',
    fields: Object.freeze([
      { key: 'pages', label: 'Page inventory', kind: 'records', recordType: 'website_page', addLabel: 'Add page', recordFields: [
        ['page_key', 'Stable page key', 'readonly'], ['slug', 'Proposed path', 'text'], ['title', 'Page title', 'text'],
        ['parent_page_key', 'Parent page', 'parent_page_key'],
        ['page_type', 'Page type', 'select', ['hub', 'service', 'supporting']],
        ['purpose', 'Page purpose', 'textarea'],
      ] },
    ]),
  }),
  keyword_strategy: Object.freeze({
    label: 'Keyword strategy', description: 'Versioned keyword intent, evidence, and page or standalone request targeting.',
    fields: Object.freeze([
      { key: 'source_architecture_version_id', label: 'Exact Website architecture version', kind: 'architecture_version' },
      { key: 'keywords', label: 'Keyword strategy', kind: 'records', recordType: 'keyword', addLabel: 'Add keyword', recordFields: [
        ['term', 'Keyword phrase', 'text'],
        ['locale', 'Language or locale', 'text'],
        ['intent', 'Intent', 'text_optional'],
        ['topic_group', 'Topic group', 'text_optional'],
        ['priority', 'Priority', 'text_optional'],
        ['evidence_source', 'Evidence source', 'text_optional'],
        ['search_volume', 'Search volume', 'number_optional'],
        ['difficulty', 'Difficulty', 'number_optional'],
        ['observation_date', 'Observation date', 'date_optional'],
        ['target_kind', 'Target type', 'select', [
          { value: 'page', label: 'Existing structure page' },
          { value: 'content_request', label: 'Standalone content request' },
        ]],
        ['target_id', 'Target', 'keyword_target'],
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
export const CONTENT_FOUNDATION_TYPES = Object.freeze(['discovery', 'vision', 'audience'])
export const MAX_KEYWORD_RECORDS = 500

export const DEFAULT_DISCOVERY_TEMPLATE = Object.freeze({
  id: 'content-discovery-default-v1',
  label: 'Default Content discovery',
  fields: Object.freeze(CONTENT_ARTIFACT_FORMS.discovery.fields.map(field => Object.freeze({
    key: field.key,
    required: true,
    unknownAllowed: field.unknownAllowed === true,
  }))),
})

export function resolveContentLanguage({ explicitLanguage, approvedBrandLanguage, organizationDefaultLanguage } = {}) {
  const choices = [
    ['explicit_request', explicitLanguage],
    ['approved_brand_value', approvedBrandLanguage],
    ['organization_default', organizationDefaultLanguage],
  ]
  const selected = choices.find(([, value]) => String(value || '').trim())
  return selected
    ? { status: 'ready', source: selected[0], language: String(selected[1]).trim() }
    : { status: 'selection_required', source: null, language: '' }
}

export function approvedVisionLanguage(workspace = {}) {
  const visionIds = (workspace.artifacts || []).filter(item => item.artifact_type === 'vision').map(item => item.id)
  const approval = [...(workspace.approvals || [])]
    .filter(item => visionIds.includes(item.artifact_id))
    .sort((left, right) => new Date(right.approved_at) - new Date(left.approved_at))[0]
  const version = (workspace.versions || []).find(item => item.id === approval?.artifact_version_id)
  return String(version?.content?.language || '').trim()
}

function sourceMetadataEditor(type, value = {}) {
  return Object.fromEntries((CONTENT_ARTIFACT_FORMS[type]?.fields || []).map(field => {
    const entry = value?.[field.key] || {}
    return [field.key, {
      source_label: entry.source_label || '', source_date: entry.source_date || '',
      needs_confirmation: entry.needs_confirmation === true,
      human_confirmed: entry.human_confirmed === true,
    }]
  }))
}

function serializeSourceMetadata(type, value = {}) {
  const entries = (CONTENT_ARTIFACT_FORMS[type]?.fields || []).map(field => {
    const entry = value[field.key] || {}
    const normalized = {
      source_label: String(entry.source_label || '').trim(),
      source_date: String(entry.source_date || '').trim() || null,
      needs_confirmation: entry.needs_confirmation === true,
      human_confirmed: entry.human_confirmed === true,
    }
    const used = normalized.source_label || normalized.source_date || normalized.needs_confirmation || normalized.human_confirmed
    return used ? [field.key, normalized] : null
  }).filter(Boolean)
  return entries.length ? Object.fromEntries(entries) : null
}

export function blankContentArtifact(type) {
  return Object.fromEntries((CONTENT_ARTIFACT_FORMS[type]?.fields || []).map(field => [
    field.key, field.kind === 'list' || field.kind === 'records' ? [] : '',
  ]))
}

export function normalizeWebsitePath(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(segment => segment.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
    .join('/')
}

export function normalizeKeywordWhitespace(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function keywordEditor(content = {}) {
  const sourceVersionId = String(content.source_architecture_version_id || '')
  return {
    source_architecture_version_id: sourceVersionId,
    keywords: (Array.isArray(content.keywords) ? content.keywords : []).map(keyword => {
      const targetKind = String(keyword.target_kind || '')
        || (keyword.target_content_request_id ? 'content_request' : keyword.target_page_key || keyword.target_page_slug ? 'page' : '')
      return {
        ...keyword,
        term: String(keyword.term || ''),
        locale: String(keyword.locale || ''),
        intent: String(keyword.intent || ''),
        topic_group: String(keyword.topic_group || ''),
        priority: String(keyword.priority || ''),
        evidence_source: String(keyword.evidence_source || ''),
        search_volume: keyword.search_volume ?? '',
        difficulty: keyword.difficulty ?? '',
        observation_date: String(keyword.observation_date || ''),
        target_kind: targetKind,
        target_id: String(targetKind === 'content_request' ? keyword.target_content_request_id || '' : keyword.target_page_key || ''),
        target_page_slug: String(keyword.target_page_slug || ''),
        notes: String(keyword.notes || ''),
      }
    }),
  }
}

function optionalMetric(value) {
  if (value === '' || value === null || value === undefined) return null
  return Number(value)
}

export function keywordDuplicateWarnings(records = []) {
  const warnings = new Map()
  const rowsByPhraseLocale = new Map()
  records.forEach((record, index) => {
    const phrase = normalizeKeywordWhitespace(record?.term).toLocaleLowerCase()
    const locale = normalizeKeywordWhitespace(record?.locale).toLocaleLowerCase()
    if (!phrase || !locale) return
    const key = `${locale}\u0000${phrase}`
    const indexes = rowsByPhraseLocale.get(key) || []
    indexes.push(index)
    rowsByPhraseLocale.set(key, indexes)
  })
  rowsByPhraseLocale.forEach(indexes => {
    if (indexes.length > 1) indexes.forEach(index => warnings.set(index,
      'Duplicate phrase in this locale. Keep distinct intents separate; rows are not merged automatically.'))
  })
  return warnings
}

export function keywordStrategyIssues(editor = {}, { pageTargetIds, contentRequestIds } = {}) {
  const issues = new Map()
  const sourceVersionId = String(editor.source_architecture_version_id || '').trim()
  if (!(editor.keywords || []).length) issues.set('form', 'Add at least one keyword.')
  if ((editor.keywords || []).length > MAX_KEYWORD_RECORDS) {
    issues.set('form', `Keyword strategies support at most ${MAX_KEYWORD_RECORDS} rows. Remove extra rows before saving.`)
  }
  ;(editor.keywords || []).forEach((record, index) => {
    const messages = []
    if (!normalizeKeywordWhitespace(record.term)) messages.push('Keyword phrase is required.')
    if (!normalizeKeywordWhitespace(record.locale)) messages.push('Language or locale is required.')
    if (!['page', 'content_request'].includes(record.target_kind)) messages.push('Choose a target type.')
    if (!String(record.target_id || '').trim()) messages.push('Choose an existing target.')
    if (record.target_kind === 'page' && !sourceVersionId) messages.push('Select the exact Website architecture version for page targets.')
    if (record.target_kind === 'page' && record.target_id && pageTargetIds && !pageTargetIds.has(record.target_id)) {
      messages.push('The selected page is not in the exact Website architecture version.')
    }
    if (record.target_kind === 'content_request' && record.target_id && contentRequestIds && !contentRequestIds.has(record.target_id)) {
      messages.push('The selected content request is not available in this workspace.')
    }
    for (const [key, label, max] of [
      ['term', 'Keyword phrase', 500], ['locale', 'Language or locale', 120], ['intent', 'Intent', 500],
      ['topic_group', 'Topic group', 500], ['priority', 'Priority', 120], ['evidence_source', 'Evidence source', 1000],
      ['notes', 'Notes', 2000],
    ]) {
      if (normalizeKeywordWhitespace(record[key]).length > max) messages.push(`${label} must be ${max} characters or fewer.`)
    }
    for (const [key, label] of [['search_volume', 'Search volume'], ['difficulty', 'Difficulty']]) {
      if (record[key] !== '' && record[key] !== null && record[key] !== undefined
        && (!Number.isFinite(Number(record[key])) || Number(record[key]) < 0)) messages.push(`${label} must be a non-negative number.`)
    }
    if (record.search_volume !== '' && record.search_volume !== null && record.search_volume !== undefined
      && !Number.isSafeInteger(Number(record.search_volume))) messages.push('Search volume must be a whole number.')
    const hasMeasuredValue = [record.search_volume, record.difficulty, record.observation_date]
      .some(value => value !== '' && value !== null && value !== undefined)
    if (hasMeasuredValue && !normalizeKeywordWhitespace(record.evidence_source)) {
      messages.push('Evidence source is required when metrics or an observation date are supplied.')
    }
    if (messages.length) issues.set(index, messages.join(' '))
  })
  return issues
}

function targetSignature(keyword = {}) {
  return [
    normalizeKeywordWhitespace(keyword.term).toLocaleLowerCase(),
    normalizeKeywordWhitespace(keyword.locale).toLocaleLowerCase(),
    normalizeKeywordWhitespace(keyword.intent).toLocaleLowerCase(),
    String(keyword.target_kind || ''),
    String(keyword.target_page_key || keyword.target_content_request_id || keyword.target_id || ''),
  ].join('\u0000')
}

export function keywordTargetsChanged(previous = [], next = []) {
  const before = previous.map(targetSignature).sort()
  const after = next.map(targetSignature).sort()
  return before.length !== after.length || before.some((value, index) => value !== after[index])
}

export function legacyWebsitePageKey(path) {
  const normalized = normalizeWebsitePath(path)
  return normalized ? `legacy:${normalized}` : ''
}

export function websitePageKey(page) {
  return String(page?.page_key || '').trim() || legacyWebsitePageKey(page?.slug)
}

function websiteArchitectureEditorPages(pages = [], { sort = true } = {}) {
  const normalized = pages.map((page, index) => ({
    ...page,
    page_key: websitePageKey(page),
    slug: String(page?.slug || ''),
    position: Number.isSafeInteger(Number(page?.position)) && Number(page.position) > 0
      ? Number(page.position) : (index + 1) * 1000,
  }))
  const keyByPath = new Map(normalized.map(page => [normalizeWebsitePath(page.slug), page.page_key]))
  const ordered = sort ? normalized.sort((left, right) => left.position - right.position) : normalized
  return ordered
    .map(page => ({
      ...page,
      parent_page_key: String(page.parent_page_key || '').trim()
        || keyByPath.get(normalizeWebsitePath(page.parent_slug)) || '',
    }))
}

export function contentArtifactEditor(type, content = null) {
  const source = content || blankContentArtifact(type)
  if (type === 'keyword_strategy') return keywordEditor(source)
  const definition = CONTENT_ARTIFACT_FORMS[type]
  const editor = Object.fromEntries(definition.fields.map(field => {
    const value = source[field.key]
    if (field.kind === 'list') return [field.key, Array.isArray(value) ? value.join('\n') : '']
    if (field.kind === 'records') {
      const records = Array.isArray(value) ? value.map(record => ({ ...record })) : []
      return [field.key, type === 'website_architecture' ? websiteArchitectureEditorPages(records) : records]
    }
    return [field.key, value || '']
  }))
  if (CONTENT_FOUNDATION_TYPES.includes(type)) {
    editor.language = String(source.language || '')
    editor.source_metadata = sourceMetadataEditor(type, source.source_metadata)
  }
  return editor
}

export function serializeContentArtifact(type, editor) {
  const definition = CONTENT_ARTIFACT_FORMS[type]
  if (type === 'website_architecture') {
    const pages = websiteArchitectureEditorPages(editor.pages || [], { sort: false })
    const pathByKey = new Map(pages.map(page => [page.page_key, normalizeWebsitePath(page.slug)]))
    return { pages: pages.map((page, index) => ({
      page_key: page.page_key,
      slug: normalizeWebsitePath(page.slug),
      title: String(page.title || '').trim(),
      parent_page_key: String(page.parent_page_key || '').trim() || null,
      parent_slug: pathByKey.get(String(page.parent_page_key || '').trim()) || null,
      position: (index + 1) * 1000,
      page_type: String(page.page_type || '').trim(),
      purpose: String(page.purpose || '').trim(),
    })) }
  }
  if (type === 'keyword_strategy') return {
    schema_version: 2,
    source_architecture_version_id: String(editor.source_architecture_version_id || '').trim() || null,
    keywords: (editor.keywords || []).map(record => ({
      term: normalizeKeywordWhitespace(record.term),
      locale: normalizeKeywordWhitespace(record.locale),
      intent: normalizeKeywordWhitespace(record.intent),
      topic_group: normalizeKeywordWhitespace(record.topic_group),
      priority: normalizeKeywordWhitespace(record.priority),
      evidence_source: normalizeKeywordWhitespace(record.evidence_source),
      search_volume: optionalMetric(record.search_volume),
      difficulty: optionalMetric(record.difficulty),
      observation_date: String(record.observation_date || '').trim() || null,
      target_kind: String(record.target_kind || '').trim(),
      target_page_key: record.target_kind === 'page' ? String(record.target_id || '').trim() : null,
      target_content_request_id: record.target_kind === 'content_request' ? String(record.target_id || '').trim() : null,
      target_page_slug: record.target_kind === 'page' ? String(record.target_page_slug || '').trim() || null : null,
      category: ['industry', 'brand', 'volume'].includes(record.category) ? record.category : null,
      notes: String(record.notes || '').trim(),
    })),
  }
  const content = Object.fromEntries(definition.fields.map(field => {
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
  if (CONTENT_FOUNDATION_TYPES.includes(type)) {
    content.language = String(editor.language || '').trim()
    const metadata = serializeSourceMetadata(type, editor.source_metadata)
    if (metadata) content.source_metadata = metadata
  }
  return content
}

export function newContentRecord(field) {
  const record = Object.fromEntries(field.recordFields.map(([key]) => [key, '']))
  if (field.recordType === 'website_page') record.page_key = `page:${globalThis.crypto.randomUUID()}`
  return record
}

export function addWebsiteChild(records = [], field, parentPageKey) {
  const parentKey = String(parentPageKey || '').trim()
  if (!parentKey || !records.some(page => websitePageKey(page) === parentKey)) {
    throw new Error('A current parent page is required')
  }
  return [...records, { ...newContentRecord(field), parent_page_key: parentKey }]
}

export function duplicateWebsitePage(records = [], field, pageKey) {
  const sourceKey = String(pageKey || '').trim()
  const source = records.find(page => websitePageKey(page) === sourceKey)
  if (!source) throw new Error('A current page is required')
  const duplicate = Object.fromEntries(field.recordFields.map(([key]) => [key, source[key] ?? '']))
  duplicate.page_key = newContentRecord(field).page_key
  duplicate.slug = ''
  return [...records, duplicate]
}

export function websiteArchitecturePathErrors(pages = []) {
  const errors = new Map()
  const pagesByPath = new Map()
  pages.forEach((page, index) => {
    const key = websitePageKey(page) || `index:${index}`
    const path = normalizeWebsitePath(page?.slug)
    if (!path) {
      errors.set(key, 'Enter a new unique proposed path before saving.')
      return
    }
    const matches = pagesByPath.get(path) || []
    matches.push(key)
    pagesByPath.set(path, matches)
  })
  pagesByPath.forEach(keys => {
    if (keys.length > 1) keys.forEach(key => errors.set(key, 'Choose a unique proposed path before saving.'))
  })
  return errors
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

function contentPagePath(page) {
  return normalizeWebsitePath(page?.page_path)
}

function architecturePagePath(page) {
  return normalizeWebsitePath(page?.slug)
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
  const architectureByPath = new Map(architecturePages.map(page => [architecturePagePath(page), page]))
  const architectureByKey = new Map(architecturePages.map(page => [websitePageKey(page), page]))
  const taskKeyByPath = new Map(tasks.map(task => [
    normalizeWebsitePath(task?.linked_page_path), String(task?.linked_page_key || '').trim(),
  ]).filter(([, key]) => key))
  const sourceIdentity = page => {
    if (source === 'website_architecture') return websitePageKey(page)
    return String(page?.page_key || '').trim()
      || taskKeyByPath.get(contentPagePath(page))
      || websitePageKey(architectureByPath.get(contentPagePath(page)))
      || legacyWebsitePageKey(contentPagePath(page))
  }
  const taskIdentity = task => String(task?.linked_page_key || '').trim()
    || legacyWebsitePageKey(task?.linked_page_path)
  const taskByKey = new Map(tasks.map(task => [taskIdentity(task), task]))
  const sourceKeys = new Set(sourcePages.map(sourceIdentity).filter(Boolean))
  const rows = sourcePages.map(page => {
    const pageKey = sourceIdentity(page)
    const architecturePage = source === 'content'
      ? architectureByKey.get(pageKey) || architectureByPath.get(contentPagePath(page))
      : page
    const path = architecturePage ? architecturePagePath(architecturePage) : contentPagePath(page)
    return {
      pageKey,
      pagePath: path,
      pageTitle: architecturePage?.title || path,
      task: taskByKey.get(pageKey) || null,
      mismatch: !taskByKey.has(pageKey),
    }
  })
  const staleTasks = tasks.filter(task => !sourceKeys.has(taskIdentity(task)))
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
