import test from 'node:test'
import assert from 'node:assert/strict'
import { projectWebsiteImportDraft } from '../../supabase/functions/_shared/projectSpreadsheetDraft.mjs'
import { prepareProjectWebsiteImportDraft } from '../../supabase/functions/_shared/projectSpreadsheetDraft.ts'
const id = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function input() {
  return { actorId: id(1), organizationId: id(2), projectId: id(3),
    conversation: { id: id(4), organization_id: id(2), project_id: id(3), owner_id: id(1), context_kind: 'project_team', state: 'active' },
    attachment: { id: id(5), conversation_id: id(4), organization_id: id(2), project_id: id(3), uploaded_by: id(1), source_kind: 'project_spreadsheet', ai_use_allowed: false, share_with_recipients: false, sha256_hex: 'a'.repeat(64), original_name: 'synthetic.csv', status: 'reference_only' },
    preview: { projectId: id(3), type: 'website_pages', batchId: 'b'.repeat(64), rows: [{ rowId: 'c'.repeat(64), identity: 'page:home', action: 'create', errors: [], source: { fileSha256: 'a'.repeat(64), fileName: 'synthetic.csv', sheet: 'Pages', row: 2 }, values: { page_key: 'page:home', title: 'Home', planned_path: '/home', page_type: 'hub', purpose: 'Explain the service', historical_status: 'published', status_evidence: 'Original workbook status', original_date: '2026-09-30' } }] } }
}
test('website import prepares only an unapproved draft and keeps historical evidence private', () => {
  const result = projectWebsiteImportDraft(input())
  assert.equal(result.content.pages[0].slug, 'home')
  assert.equal(JSON.stringify(result.content).includes('published'), false)
  assert.equal(result.privateReceipt.rows[0].historical_evidence.historical_status, 'published')
  assert.equal(result.approvalCreated, false); assert.equal(result.pageRegistrationRequested, false); assert.equal(result.providerRequestMade, false)
})
test('private source and project identity cannot be substituted or implicitly shared', () => {
  for (const mutate of [x => { x.attachment.share_with_recipients = true }, x => { x.conversation.owner_id = id(9) }, x => { x.attachment.project_id = id(9) }, x => { x.preview.rows[0].source.fileSha256 = 'd'.repeat(64) }, x => { x.preview.rows[0].values.approved = 'true' }]) {
    const x = input(); mutate(x); assert.throws(() => projectWebsiteImportDraft(x))
  }
})
test('missing canonical fields and silent path normalization require clarification', () => {
  for (const mutate of [x => { delete x.preview.rows[0].values.purpose }, x => { x.preview.rows[0].values.page_type = 'article' }, x => { x.preview.rows[0].values.planned_path = '/Home' }, x => { x.preview.rows[0].values.planned_path = '/a/../b' }]) {
    const x = input(); mutate(x); assert.throws(() => projectWebsiteImportDraft(x), /Clarify|Review/)
  }
})
test('newer and foreign architecture versions are rejected and existing brief fields retained', () => {
  const x = input()
  x.artifact = { id: id(7), organization_id: id(2), project_id: id(3), artifact_type: 'website_architecture' }
  x.expectedParentVersionId = id(6)
  x.latestVersion = { id: id(6), artifact_id: id(7), organization_id: id(2), content: { schema_version: 2, pages: [{ page_key: 'page:home', title: 'Old', slug: 'home', page_type: 'hub', purpose: 'Existing purpose', position: 1000, sections: [{ heading: 'Preserved' }], source_version_ids: [id(8)] }, { page_key: 'page:other', slug: 'other', position: 2000 }] } }
  x.preview.rows[0].action = 'update'
  const before = structuredClone(x.latestVersion)
  const result = projectWebsiteImportDraft(x)
  assert.deepEqual(result.content.pages[0].sections, before.content.pages[0].sections)
  assert.deepEqual(result.content.pages[1], before.content.pages[1])
  assert.deepEqual(x.latestVersion, before)
  x.expectedParentVersionId = id(9); assert.throws(() => projectWebsiteImportDraft(x), /Newer/)
  x.expectedParentVersionId = id(6); x.artifact.project_id = id(9); assert.throws(() => projectWebsiteImportDraft(x), /same-project/)
})
test('every duplicate, unresolved row and changed create/update match blocks projection', () => {
  const x = input(); x.preview.rows.push(structuredClone(x.preview.rows[0]))
  assert.throws(() => projectWebsiteImportDraft(x), /Duplicate/)
  const y = input(); y.preview.rows[0].errors = ['ambiguous']; assert.throws(() => projectWebsiteImportDraft(y), /Resolve/)
  const z = input(); z.preview.rows[0].action = 'update'; assert.throws(() => projectWebsiteImportDraft(z), /match changed/)
})
test('draft preparation uses the real canonical architecture validator', () => {
  const result = prepareProjectWebsiteImportDraft(input())
  assert.deepEqual(result.content.pages[0], { page_key: 'page:home', slug: 'home', title: 'Home', parent_page_key: null, parent_slug: null, position: 1000, page_type: 'hub', purpose: 'Explain the service' })
  const invalid = input(); invalid.preview.rows[0].identity = invalid.preview.rows[0].values.page_key = 'bad key'
  assert.throws(() => prepareProjectWebsiteImportDraft(invalid), /page key/)
})
test('canonical validation rejects shared paths and ancestor cycles after draft merge', () => {
  for (const cycle of [false, true]) {
    const x = input(); const second = structuredClone(x.preview.rows[0]); second.rowId = 'd'.repeat(64); second.source.row = 3; second.identity = second.values.page_key = 'page:second'
    second.values.planned_path = cycle ? '/second' : '/home'
    if (cycle) { x.preview.rows[0].values.parent_page_key = 'page:second'; second.values.parent_page_key = 'page:home' }
    x.preview.rows.push(second)
    assert.throws(() => prepareProjectWebsiteImportDraft(x), cycle ? /cycle/ : /paths must be unique/)
  }
})
