// Pure server-side projection. Call only after reconstructing the preview from
// verified private attachment bytes and a current authorized project snapshot.
// This does not persist, approve, register pages, or dispatch a provider.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash = /^[0-9a-f]{64}$/
const fields = new Set(['page_key', 'title', 'planned_path', 'parent_page_key', 'page_type', 'purpose', 'original_date', 'historical_status', 'status_evidence'])
const fail = message => { throw Object.assign(new Error(message), { status: 409 }) }
function literal(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail(`Clarify ${label}`)
  return value
}
/** @param {{conversation: Record<string, any>, attachment: Record<string, any>, actorId: string, organizationId: string, projectId: string, preview: Record<string, any>, artifact?: Record<string, any> | null, latestVersion?: Record<string, any> | null, expectedParentVersionId?: string | null}} input */
export function projectWebsiteImportDraft({ conversation, attachment, actorId, organizationId, projectId, preview, artifact = null, latestVersion = null, expectedParentVersionId = null }) {
  for (const id of [actorId, organizationId, projectId, conversation?.id, attachment?.id]) if (!uuid.test(id || '')) fail('Exact server-bound identities required')
  if (conversation.organization_id !== organizationId || conversation.project_id !== projectId || conversation.owner_id !== actorId || conversation.context_kind !== 'project_team' || conversation.state !== 'active') fail('Active owned Project Chat required')
  if (attachment.conversation_id !== conversation.id || attachment.organization_id !== organizationId || attachment.project_id !== projectId || attachment.uploaded_by !== actorId || attachment.share_with_recipients !== false || !hash.test(attachment.sha256_hex || '') || !['extracted', 'reference_only'].includes(attachment.status)) fail('Verified private source required')
  if (!preview || preview.projectId !== projectId || preview.type !== 'website_pages' || !hash.test(preview.batchId || '') || !Array.isArray(preview.rows) || !preview.rows.length || preview.rows.length > 1000) fail('Exact reconstructed website preview required')
  if (latestVersion && (!uuid.test(latestVersion.id || '') || latestVersion.organization_id !== organizationId || latestVersion.id !== expectedParentVersionId)) fail('Newer work exists; rebuild and review the preview')
  if (latestVersion && (!artifact || artifact.id !== latestVersion.artifact_id || artifact.project_id !== projectId || artifact.organization_id !== organizationId || artifact.artifact_type !== 'website_architecture')) fail('Exact same-project architecture root required')
  if (artifact && !latestVersion) fail('Existing root needs its current exact version')
  if (!latestVersion && expectedParentVersionId !== null) fail('Expected parent version is unavailable')
  const content = latestVersion ? structuredClone(latestVersion.content) : { pages: [] }
  if (!content || !Array.isArray(content.pages) || content.pages.length > 1000) fail('Unsupported canonical architecture')
  const pages = new Map()
  for (const page of content.pages) {
    if (!page?.page_key || pages.has(page.page_key)) fail('Existing architecture identity is ambiguous')
    pages.set(page.page_key, page)
  }
  const seen = new Set(); const privateRows = []
  let position = Math.max(0, ...content.pages.map(p => p.position || 0))
  for (const row of preview.rows) {
    if (!row || !hash.test(row.rowId || '') || !Array.isArray(row.errors) || row.errors.length || !['create', 'update', 'skip'].includes(row.action) || row.source?.fileSha256 !== attachment.sha256_hex || row.source?.fileName !== attachment.original_name || !Number.isSafeInteger(row.source?.row) || row.source.row < 2) fail('Resolve every row and exact source provenance before confirmation')
    const values = row.values
    if (!values || Object.keys(values).some(key => !fields.has(key))) fail('Unsupported or authority-bearing import field')
    const key = literal(values.page_key, 'page key', 1208)
    if (row.identity !== key || seen.has(key)) fail('Duplicate or mismatched page identity')
    seen.add(key)
    const previous = pages.get(key)
    if ((row.action === 'create' && previous) || (row.action !== 'create' && !previous)) fail('Canonical page match changed; review again')
    if (row.action !== 'skip') {
      const planned = literal(values.planned_path, 'URL path', 1200)
      if (!planned.startsWith('/') || /[?#\\\s]/.test(planned) || planned.split('/').some(p => p === '.' || p === '..') || planned === '/') fail('Review a canonical page path')
      // Canonical path normalization is performed by validateContentArtifact.
      // Require the reviewed value already in that form to avoid silent remapping.
      const slug = planned.slice(1)
      if (slug !== slug.normalize('NFKC').toLowerCase() || /\/\/|\/$/.test(slug)) fail('Review normalized URL path explicitly')
      const pageType = values.page_type || previous?.page_type
      if (!['hub', 'service', 'supporting'].includes(pageType)) fail('Clarify page type: hub, service or supporting')
      const purpose = literal(values.purpose || previous?.purpose, 'page purpose', 1200)
      if (content.schema_version === 2 && !previous) fail('New version-2 page needs the existing page-brief authoring contract')
      const next = { ...previous, page_key: key, slug, title: literal(values.title, 'page title', 240), page_type: pageType, purpose, position: previous?.position || (position += 1000) }
      if (Object.hasOwn(values, 'parent_page_key')) next.parent_page_key = values.parent_page_key || null
      else if (!previous) next.parent_page_key = null
      pages.set(key, next)
    }
    // Full source, unmapped columns and historical authority labels never enter
    // the organization-readable artifact. Keep evidence in the private proposal.
    privateRows.push({ row_id: row.rowId, source: structuredClone(row.source), page_key: key, action: row.action, historical_evidence: Object.fromEntries(['original_date', 'historical_status', 'status_evidence'].filter(k => Object.hasOwn(values, k)).map(k => [k, values[k]])) })
  }
  content.pages = [...pages.values()]
  for (const page of content.pages) {
    if (page.parent_page_key && !pages.has(page.parent_page_key)) fail('Parent identity is outside this architecture draft')
    if (page.parent_page_key || Object.hasOwn(page, 'parent_slug')) page.parent_slug = page.parent_page_key ? pages.get(page.parent_page_key).slug : null
  }
  return { artifactType: 'website_architecture', content, expectedParentVersionId, privateReceipt: { origin: 'spreadsheet_import', attachment_id: attachment.id, batch_sha256: preview.batchId, rows: privateRows }, approvalCreated: false, pageRegistrationRequested: false, providerRequestMade: false }
}
