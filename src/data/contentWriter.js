export const CONTENT_WRITER_OUTPUT_TYPES = Object.freeze([
  ['website_page_copy', 'Website page copy'],
  ['blog_article', 'Blog or article'],
  ['social_copy', 'Social copy'],
  ['campaign_copy', 'Campaign copy'],
  ['custom_text', 'Custom text'],
])

const OUTPUT_TYPE_SET = new Set(CONTENT_WRITER_OUTPUT_TYPES.map(([value]) => value))

export function newContentWriterDraft(defaults = {}) {
  return {
    output_type: 'website_page_copy', working_title: '', source_architecture_version_id: '',
    target_page_key: '', destination: '', objective: '', audience: '',
    language: defaults.language || '', tone: defaults.tone || '', body: '', cta: '', exclusions: '',
  }
}

export function writerDestinationLabel(outputType) {
  return {
    blog_article: 'Topic or purpose', social_copy: 'Channel and placement',
    campaign_copy: 'Campaign destination', custom_text: 'Destination description',
  }[outputType] || 'Destination'
}

export function architectureVersions(workspace = {}) {
  const artifactIds = new Set((workspace.artifacts || [])
    .filter(artifact => artifact.artifact_type === 'website_architecture').map(artifact => artifact.id))
  return (workspace.versions || []).filter(version => artifactIds.has(version.artifact_id)
    && Array.isArray(version.content?.pages)).sort((left, right) => right.version_number - left.version_number)
}

export function architecturePages(version) {
  return Array.isArray(version?.content?.pages)
    ? version.content.pages.filter(page => String(page?.page_key || '').trim()) : []
}

function clean(value) { return String(value || '').trim() }

export function contentWriterIssues(form, versions = []) {
  const issues = {}
  if (!OUTPUT_TYPE_SET.has(form.output_type)) issues.output_type = 'Choose a supported text output type.'
  const title = clean(form.working_title)
  if (title.length < 3 || title.length > 160) issues.working_title = 'Use a working title between 3 and 160 characters.'
  for (const [key, label] of [['objective', 'Objective'], ['audience', 'Audience'], ['language', 'Language'], ['body', 'Draft text']]) {
    if (!clean(form[key])) issues[key] = `${label} is required.`
  }
  if (form.output_type === 'website_page_copy') {
    const version = versions.find(item => item.id === clean(form.source_architecture_version_id))
    if (!version) issues.source_architecture_version_id = 'Choose an exact accessible Website Architecture version.'
    if (!architecturePages(version).some(page => page.page_key === clean(form.target_page_key))) {
      issues.target_page_key = 'Choose a page from that exact structure version.'
    }
  } else if (!clean(form.destination)) issues.destination = `${writerDestinationLabel(form.output_type)} is required.`
  return issues
}

export function serializeContentWriter(form, versions = []) {
  const issues = contentWriterIssues(form, versions)
  if (Object.keys(issues).length) throw new Error(Object.values(issues)[0])
  const website = form.output_type === 'website_page_copy'
  return {
    schema_version: 2, output_type: form.output_type, working_title: clean(form.working_title),
    source_architecture_version_id: website ? clean(form.source_architecture_version_id) : null,
    target_page_key: website ? clean(form.target_page_key) : null, target_page_path: null,
    destination: website ? null : clean(form.destination), objective: clean(form.objective),
    audience: clean(form.audience), language: clean(form.language), tone: clean(form.tone) || null,
    body: clean(form.body), cta: clean(form.cta) || null,
    exclusions: String(form.exclusions || '').split(/[,\n]/).map(clean).filter(Boolean), variant_number: 1,
  }
}

export function contentWriterPreview(form, versions = []) {
  const content = serializeContentWriter(form, versions)
  const sourceVersion = versions.find(version => version.id === content.source_architecture_version_id)
  const page = architecturePages(sourceVersion).find(item => item.page_key === content.target_page_key)
  return {
    content, signature: JSON.stringify(content),
    destinationLabel: content.output_type === 'website_page_copy'
      ? `${page?.title || content.target_page_key} · structure v${sourceVersion?.version_number}` : content.destination,
  }
}

export function isWriterContent(content) {
  return content?.schema_version === 2 && OUTPUT_TYPE_SET.has(content.output_type)
}

export function contentArtifactForMode(workspace = {}, mode = 'legacy') {
  const versions = workspace.versions || []
  return (workspace.artifacts || []).find(artifact => {
    if (artifact.artifact_type !== 'content') return false
    const latest = [...versions].filter(version => version.artifact_id === artifact.id)
      .sort((left, right) => right.version_number - left.version_number)[0]
    return mode === 'writer' ? isWriterContent(latest?.content) : !isWriterContent(latest?.content)
  }) || null
}

export function writerOutputs(workspace = {}) {
  return (workspace.artifacts || []).map(artifact => {
    if (artifact.artifact_type !== 'content') return null
    const latest = [...(workspace.versions || [])].filter(version => version.artifact_id === artifact.id)
      .sort((left, right) => right.version_number - left.version_number)[0]
    return isWriterContent(latest?.content) ? { artifact, latest } : null
  }).filter(Boolean)
}
