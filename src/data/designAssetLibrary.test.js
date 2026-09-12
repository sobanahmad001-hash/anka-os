import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDesignAssetRows, designAssetAccessState, designAssetArchiveEligibility, designAssetLibraryContextKey, designAssetLibraryReducer, designAssetSourceFocus, filterDesignAssetRows, initialDesignAssetLibraryState } from './designAssetLibrary.js'

const now = Date.parse('2026-09-11T12:00:00.000Z')
const workspace = () => ({
  sessions: [{ id: 'session-a', output_goal: 'Launch assets' }], directions: [{ id: 'direction-a', session_id: 'session-a' }],
  directionVersions: [{ id: 'version-a', direction_id: 'direction-a', version_number: 3, content: { title: 'Quiet confidence' } }], experimentalDirectionVersions: [],
  models: [{ id: 'model-a', display_name: 'Approved image model' }],
  imageGenerationJobs: [{ id: 'job-a', direction_version_id: 'version-a', media_asset_id: 'asset-a', model_registry_id: 'model-a', status: 'succeeded' }],
  variants: [{ id: 'variant-b', source_direction_version_id: 'version-a', design_media_asset_id: 'asset-b', variant_format: 'portrait_4x5' }],
  mediaAssets: [
    { id: 'asset-b', design_direction_version_id: 'version-a', media_type: 'image', status: 'failed', prompt: 'Variant', created_at: '2026-08-01T00:00:00.000Z' },
    { id: 'asset-a', design_direction_version_id: 'version-a', media_type: 'image', status: 'ready', prompt: 'Hero', provider: 'openai', generated_by: 'user-a', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/a.png?token=signed', created_at: '2026-09-11T11:00:00.000Z' },
  ],
})

test('builds deterministic provenance only from already-loaded authorized workspace rows', () => {
  const rows = buildDesignAssetRows(workspace())
  assert.deepEqual(rows.map(row => row.id), ['asset-a', 'asset-b'])
  assert.equal(rows[0].jobId, 'job-a')
  assert.equal(rows[0].modelName, 'Approved image model')
  assert.equal(rows[0].directionVersionId, 'version-a')
  assert.equal(rows[0].sessionId, 'session-a')
  assert.equal(rows[0].provider, 'openai')
  assert.equal(rows[0].generatedBy, 'user-a')
  assert.deepEqual(rows[0].recorded, { dimensions: null, mimeType: null, name: null, reviewState: null, independentVersion: null })
  assert.equal(rows[1].sourceType, 'variant')
  assert.equal(rows[1].recordedVariantFormat, 'portrait_4x5')
  assert.equal(rows[1].jobId, '')
})

test('does not call an output generated when no durable job or variant provenance is loaded', () => {
  const data = workspace()
  data.mediaAssets.push({ id: 'asset-c', design_direction_version_id: 'version-a', media_type: 'video', status: 'unavailable', prompt: 'Video', created_at: '2026-09-10T00:00:00.000Z' })
  const row = buildDesignAssetRows(data).find(item => item.id === 'asset-c')
  assert.equal(row.sourceType, 'recorded')
  assert.equal(row.jobId, '')
})

test('canonical asset versions replace matching legacy rows without inventing cross-output lineage', () => {
  const data = workspace()
  data.designAssets = [{ id: 'design-asset-a', name: 'Hero master', placement: 'Homepage', rights_notes: '', created_at: '2026-09-11T11:00:00.000Z' }]
  data.designAssetVersions = [
    { id: 'asset-version-2', asset_id: 'design-asset-a', version_number: 2, parent_version_id: 'asset-version-1', source_kind: 'upload', source_direction_version_id: 'version-a', lifecycle_status: 'draft', mime_type: 'image/png', width: 1600, height: 900, original_filename: 'hero-v2.png', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/v2.png?token=v2', created_by: 'user-a', created_at: '2026-09-11T11:00:00.000Z' },
    { id: 'asset-version-1', asset_id: 'design-asset-a', version_number: 1, parent_version_id: null, source_kind: 'generated', source_media_asset_id: 'asset-a', source_direction_version_id: 'version-a', lifecycle_status: 'draft', mime_type: 'image/png', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/v1.png?token=v1', created_by: 'user-a', created_at: '2026-09-10T11:00:00.000Z' },
  ]
  const rows = buildDesignAssetRows(data)
  const canonical = rows.find(row => row.id === 'design-asset-a')
  assert.equal(rows.some(row => row.id === 'asset-a'), false)
  assert.equal(canonical.assetVersionId, 'asset-version-2')
  assert.equal(canonical.assetVersions.length, 2)
  assert.equal(canonical.sourceType, 'upload')
  assert.deepEqual(canonical.recorded, {
    dimensions: '1600×900', mimeType: 'image/png', name: 'Hero master',
    reviewState: 'draft', independentVersion: 'v2 · asset-version-2',
  })
  assert.equal(canonical.assetVersions[0].parent_version_id, 'asset-version-1')
  assert.equal(rows.find(row => row.id === 'asset-b').sourceType, 'variant')
})

test('filters status, durable source and date without changing or widening the source rows', () => {
  const rows = buildDesignAssetRows(workspace())
  assert.deepEqual(filterDesignAssetRows(rows, { status: 'ready', source: 'all', date: 'all' }, now).map(row => row.id), ['asset-a'])
  assert.deepEqual(filterDesignAssetRows(rows, { status: 'all', source: 'variant', date: 'all' }, now).map(row => row.id), ['asset-b'])
  assert.deepEqual(filterDesignAssetRows(rows, { status: 'all', source: 'all', date: 'day' }, now).map(row => row.id), ['asset-a'])
  assert.equal(rows.length, 2)
})

test('controller resets selected asset, filters and view when the work context changes', () => {
  let state = initialDesignAssetLibraryState('engagement-a')
  state = designAssetLibraryReducer(state, { type: 'set_view', view: 'list' })
  state = designAssetLibraryReducer(state, { type: 'set_filter', name: 'status', value: 'ready' })
  state = designAssetLibraryReducer(state, { type: 'select', assetId: 'asset-a' })
  assert.equal(designAssetLibraryReducer(state, { type: 'context_changed', contextKey: 'engagement-a' }), state)
  state = designAssetLibraryReducer(state, { type: 'context_changed', contextKey: 'engagement-b' })
  assert.deepEqual(state, initialDesignAssetLibraryState('engagement-b'))
})

test('full context identity changes for same-engagement service, work and output navigation', () => {
  const base = { contextKey: 'official:org-a:engagement-a:project-a:brand-a:service-a,service-b', activeOrganizationId: 'org-a', projectId: 'project-a', engagementId: 'engagement-a', brandId: 'brand-a', activeServiceId: 'service-a', workRecord: { kind: 'project_task', id: 'task-a' }, output: { kind: 'design_session', id: 'session-a', versionId: 'version-a' } }
  const original = designAssetLibraryContextKey(base)
  assert.notEqual(designAssetLibraryContextKey({ ...base, activeServiceId: 'service-b' }), original)
  assert.notEqual(designAssetLibraryContextKey({ ...base, workRecord: { kind: 'engagement_work_item', id: 'work-a' } }), original)
  assert.notEqual(designAssetLibraryContextKey({ ...base, output: { kind: 'design_session', id: 'session-b', versionId: 'version-b' } }), original)
})

test('signed access is limited to ready images and becomes unusable before server expiry', () => {
  const row = buildDesignAssetRows(workspace())[0]
  const access = { issuedAt: now, expiresInSeconds: 300, trustedOrigin: 'https://project.supabase.co' }
  assert.equal(designAssetAccessState(row, { ...access, now: now + 294000 }).canOpen, true)
  assert.equal(designAssetAccessState(row, { ...access, now: now + 295000 }).status, 'expired')
  assert.equal(designAssetAccessState({ ...row, status: 'failed' }, { ...access, now }).canOpen, false)
  assert.equal(designAssetAccessState({ ...row, previewUrl: '' }, { ...access, now }).status, 'missing')
  assert.equal(designAssetAccessState(row, { ...access, issuedAt: undefined, now }).status, 'expired')
  assert.equal(designAssetAccessState(row, { ...access, issuedAt: now + 1, now }).status, 'expired')
  for (const previewUrl of ['not-a-valid-url', 'javascript:alert(1)', 'http://project.supabase.co/storage/v1/object/sign/design/a.png?token=signed', 'https://attacker.invalid/storage/v1/object/sign/design/a.png?token=signed', 'https://user:secret@project.supabase.co/storage/v1/object/sign/design/a.png?token=signed', 'https://project.supabase.co/prefix/storage/v1/object/sign/design/a.png?token=signed', 'https://project.supabase.co/storage/v1/object/sign/design/a.png?token=', 'https://project.supabase.co/storage/v1/object/public/design/a.png']) {
    assert.equal(designAssetAccessState({ ...row, previewUrl }, { ...access, now }).status, 'invalid')
  }
})

test('source focus uses exact existing session, immutable direction version and job identities', () => {
  const row = buildDesignAssetRows(workspace())[0]
  assert.deepEqual(designAssetSourceFocus(row), { sessionId: 'session-a', directionVersionId: 'version-a', jobId: 'job-a' })
  assert.equal(designAssetSourceFocus({ ...row, sessionId: '' }), null)
})

test('archive eligibility fails closed and permits only standalone upload-only draft history', () => {
  const eligible = { assetId: 'asset-root', archivedAt: '', assetVersions: [
    { lifecycle_status: 'draft', source_kind: 'upload', source_media_asset_id: null, source_direction_version_id: null },
    { lifecycle_status: 'draft', source_kind: 'upload', source_media_asset_id: null, source_direction_version_id: null },
  ] }
  assert.deepEqual(designAssetArchiveEligibility(eligible), {
    eligible: true,
    reason: 'Standalone uploaded draft. All 2 immutable versions and stored files will be retained.',
  })
  assert.equal(designAssetArchiveEligibility({ ...eligible, archivedAt: '2026-09-12T00:00:00Z' }).eligible, false)
  assert.equal(designAssetArchiveEligibility({ ...eligible, assetVersions: [{ ...eligible.assetVersions[0], source_direction_version_id: 'direction-version' }] }).eligible, false)
  assert.equal(designAssetArchiveEligibility({ ...eligible, assetVersions: [{ ...eligible.assetVersions[0], source_kind: 'generated', source_media_asset_id: 'media' }] }).eligible, false)
  assert.equal(designAssetArchiveEligibility({ ...eligible, assetVersions: [] }).eligible, false)
})
