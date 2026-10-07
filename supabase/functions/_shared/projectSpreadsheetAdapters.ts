import { validateContentArtifact } from './contentArtifacts.ts'

type Json = Record<string, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{64}$/
const fail = (message: string) => { throw Object.assign(new Error(message), { status: 409 }) }
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v
const keywordIdentity = (v: Json) => JSON.stringify([v.term.trim().toLowerCase(), v.locale.trim().toLowerCase(), v.target_page_key])
export function requireProjectImportSource(input: Json, type: string) {
  const { conversation: c, attachment: a, preview: p, actorId, organizationId, projectId } = input
  if (![actorId, organizationId, projectId, c?.id, a?.id].every(v => UUID.test(v || ''))
    || c.owner_id !== actorId || c.organization_id !== organizationId || c.project_id !== projectId || c.context_kind !== 'project_team' || c.state !== 'active'
    || a.conversation_id !== c.id || a.organization_id !== organizationId || a.project_id !== projectId || a.uploaded_by !== actorId
    || a.source_kind !== 'project_spreadsheet' || a.share_with_recipients !== false || a.ai_use_allowed !== false || a.status !== 'reference_only' || !SHA.test(a.sha256_hex || '')
    || p?.projectId !== projectId || p.type !== type || !SHA.test(p.batchId || '') || !Array.isArray(p.rows) || !p.rows.length || p.rows.length > 25) fail('Exact owned private source and bounded reconstructed preview required')
  const seen = new Set()
  for (const row of p.rows) {
    if (!SHA.test(row.rowId || '') || seen.has(row.rowId) || row.source?.fileSha256 !== a.sha256_hex || row.source?.fileName !== a.original_name
      || typeof row.source?.sheet !== 'string' || !row.source.sheet || !Number.isSafeInteger(row.source.row) || row.source.row < 2
      || !Array.isArray(row.errors) || row.errors.length || !['create', 'update', 'skip'].includes(row.action)
      || !row.values || typeof row.values !== 'object' || Array.isArray(row.values)) fail('Resolve every selected row and its exact provenance')
    seen.add(row.rowId)
  }
}
const receipt = (input: Json) => ({ origin: 'spreadsheet_import', attachment_id: input.attachment.id, batch_sha256: input.preview.batchId,
  rows: input.preview.rows.map((row: Json) => ({ row_id: row.rowId, source: structuredClone(row.source), identity: row.identity, action: row.action,
    historical_evidence: Object.fromEntries(['original_date', 'timezone', 'channel', 'historical_status', 'status_evidence'].filter(k => Object.hasOwn(row.values, k)).map(k => [k, row.values[k]])) })) })

export function prepareProjectKeywordImportDraft(input: Json) {
  requireProjectImportSource(input, 'keyword_plan')
  const { artifact, latestVersion: latest, expectedParentVersionId: expected = null, architecture } = input
  if (!architecture || architecture.project_id !== input.projectId || architecture.organization_id !== input.organizationId || !UUID.test(architecture.version_id || '') || !Array.isArray(architecture.pages)) fail('Exact same-project architecture version required')
  if (latest && (!artifact || artifact.id !== latest.artifact_id || artifact.project_id !== input.projectId || artifact.organization_id !== input.organizationId || artifact.artifact_type !== 'keyword_strategy'
    || latest.organization_id !== input.organizationId || latest.id !== expected || latest.content?.schema_version !== 2)) fail('Exact current same-project keyword version required; legacy migration needs separate review')
  if (!latest && (expected !== null || artifact)) fail('Expected keyword head is unavailable')
  const content = latest ? structuredClone(latest.content) : { schema_version: 2, source_architecture_version_id: architecture.version_id, keywords: [] }
  if (latest && content.source_architecture_version_id !== architecture.version_id) fail('Review the keyword plan against its original architecture version')
  const keywords = new Map<string, Json>()
  for (const keyword of content.keywords) {
    if (keyword.target_kind !== 'page') continue
    const key = keywordIdentity(keyword)
    if (keywords.has(key)) fail('Existing phrase/locale/target identity is ambiguous; do not merge different intents')
    keywords.set(key, keyword)
  }
  const selected = new Set(); const changed = new Map()
  const allowed = new Set(['term','locale','target_page_key','intent','topic_group','priority','evidence_source','search_volume','difficulty','observation_date','category','notes'])
  for (const row of input.preview.rows) {
    const v = row.values
    if (Object.keys(v).some(k => !allowed.has(k)) || typeof v.term !== 'string' || !v.term.trim() || typeof v.locale !== 'string' || !v.locale.trim() || typeof v.target_page_key !== 'string') fail('Unsupported keyword mapping')
    const identity = keywordIdentity(v)
    if (row.identity !== identity || selected.has(identity)) fail('Duplicate or changed keyword identity')
    selected.add(identity)
    const old = keywords.get(identity)
    if ((row.action === 'create' && old) || (row.action !== 'create' && !old)) fail('Keyword match changed; preview again')
    const page = architecture.pages.find((p: Json) => p.page_key === v.target_page_key)
    if (!page) fail('Keyword target is outside the selected project architecture')
    if (row.action === 'skip') continue
    const next = { ...old, ...v, target_kind: 'page', target_content_request_id: null, target_page_slug: page.slug }
    for (const k of ['search_volume', 'difficulty']) {
      if (!Object.hasOwn(v, k)) { next[k] = old?.[k] ?? null; continue }
      if (v[k] === '') next[k] = null
      else if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v[k]) || !Number.isFinite(Number(v[k])) || k === 'search_volume' && !Number.isSafeInteger(Number(v[k]))) fail('Review exact nonnegative keyword measurements')
      else next[k] = Number(v[k])
    }
    changed.set(identity, next)
  }
  content.keywords = content.keywords.map((k: Json) => k.target_kind === 'page' ? changed.get(keywordIdentity(k)) || k : k)
  for (const [key, value] of changed) if (!keywords.has(key)) content.keywords.push(value)
  return { artifactType: 'keyword_strategy', content: validateContentArtifact('keyword_strategy', content), expectedParentVersionId: expected,
    privateReceipt: receipt(input), approvalCreated: false, providerRequestMade: false }
}

// New entries use the approved unassigned Marketing Engagement Work Item contract.
// Stable reviewed import keys live in existing private proposal receipts only.
export function prepareProjectCalendarImport(input: Json) {
  requireProjectImportSource(input, 'content_calendar')
  if (!input.engagement || input.engagement.project_id !== input.projectId || input.engagement.organization_id !== input.organizationId || !UUID.test(input.engagement.id || '')
    || typeof input.planningTimezone !== 'string' || !input.planningTimezone) fail('Exact engagement and current project planning timezone required')
  const targets = new Map(); const seen = new Set(); const createTitles = new Set(); const rows = []
  for (const target of input.targets || []) {
    const key = target.import_identity || target.record_kind + ':' + target.id
    if (targets.has(key)) fail('Calendar target identity is ambiguous')
    targets.set(key, target)
  }
  const allowed = new Set(['calendar_key','record_id','record_kind','title','original_date','timezone','channel','historical_status','status_evidence','due_date','start_date'])
  for (const row of input.preview.rows) {
    const v = row.values; const identity = v.record_id ? v.record_kind + ':' + v.record_id : 'calendar:' + v.calendar_key; const target: Json = targets.get(identity)
    if (Object.keys(v).some(k => !allowed.has(k)) || !['project_task','engagement_work_item'].includes(v.record_kind) || (v.record_id ? !UUID.test(v.record_id) : v.record_kind !== 'engagement_work_item' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v.calendar_key || '')) || row.identity !== identity || seen.has(identity)) fail('Select distinct existing canonical Task or Work Item identities')
    seen.add(identity)
    if (!date(v.original_date) || v.timezone !== input.planningTimezone) fail('Review source date and timezone separately from current scheduling')
    if (!target) {
      if (v.record_id || row.action !== 'create' || row.expectedRevision !== null && row.expectedRevision !== undefined) fail('Exact create review required')
      if (!v.title?.trim() || v.title.length > 200 || (input.targets || []).some((t: Json) => t.department_id === 'marketing' && t.title.trim().toLowerCase() === v.title.trim().toLowerCase())) fail('Potential existing calendar duplicate; map its exact record ID')
      const titleIdentity = v.title.trim().toLowerCase()
      if(createTitles.has(titleIdentity)) fail('Potential duplicate calendar titles within selected batch')
      createTitles.add(titleIdentity)
      const due = v.due_date || null; const start = v.start_date || null
      if (due && !date(due) || start && !date(start) || start && due && start > due) fail('Review explicit date-only canonical schedule')
      rows.push({ row_id: row.rowId, record_kind: 'engagement_work_item', record_id: null, expected_row_version: null, calendar_key: v.calendar_key, title: v.title.trim(), start_date: start, due_date: due, action: 'create' })
      continue
    }
    if (!target || target.organization_id !== input.organizationId || target.project_id !== input.projectId || target.department_id !== 'marketing'
      || target.archived_at || target.deleted_at || v.record_kind === 'engagement_work_item' && target.engagement_id !== input.engagement.id
      || !Number.isSafeInteger(target.row_version) || target.row_version < 1 || row.expectedRevision !== target.row_version || v.title !== target.title) fail('Calendar target/version/title changed; reload the exact record')
    if (v.timezone !== input.planningTimezone || !date(v.original_date)) fail('Review source date and timezone separately from current scheduling')
    // Historical dates and labels cannot silently become current deadlines.
    const due = v.due_date || target.due_date
    const start = Object.hasOwn(v,'start_date') ? v.start_date || null : target.start_date || null
    if (!date(due) || start && !date(start) || start && start > due || v.record_kind === 'project_task' && start) fail('Review explicit date-only canonical schedule')
    const changed = due !== target.due_date || (start || null) !== (target.start_date || null)
    rows.push({ row_id: row.rowId, record_kind: v.record_kind, record_id: target.id, expected_row_version: target.row_version, start_date: start, due_date: due,
      action: changed ? 'update' : 'skip' })
  }
  return { target: 'content_calendar', rows, privateReceipt: receipt(input), authorityChanged: false, providerRequestMade: false }
}
