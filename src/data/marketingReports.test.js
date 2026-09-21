import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildMarketingReportExport, marketingReportContentChecksum, marketingReportDraft, marketingReportEvidenceState, marketingReportMetricCandidates, marketingReportMetricFreshness, marketingReportRecords, marketingReportReviewState, marketingReportVersion, reconcileMarketingReportSave, validateMarketingReportDraft } from './marketingReports.js'

const organizationId = 'org-a'
const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const engagement = { id: 'eng-a', organization_id: organizationId, brand_id: 'brand-a' }
const artifact = { id: 'report-a', organization_id: organizationId, engagement_id: engagement.id, brand_id: engagement.brand_id, artifact_type: 'marketing_report', title: 'August report' }
const version = {
  id: 'version-a2', organization_id: organizationId, artifact_id: artifact.id, version_number: 2,
  created_at: '2026-09-02T00:00:00Z',
  content: {
    sources: ['Meta account A', 'Meta account A', 'Saved SEO research v3'],
    period_start: '2026-08-01', period_end: '2026-08-31',
    executive_summary: 'Measured activity remained stable.',
    insights: ['One evidenced insight'], recommended_actions: ['Review landing page evidence'],
  },
}

test('report draft validates exact period and an explicit non-duplicate source selection', () => {
  const result = validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), sources: ' Meta account A\nMeta account A\nSaved SEO research v3 ' })
  assert.equal(result.title, 'August report')
  assert.deepEqual(result.content.sources, ['Meta account A', 'Saved SEO research v3'])
})

test('new report versions pin their title independently of the mutable artifact label', () => {
  const draft = validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), title: 'September report' })
  assert.equal(draft.content.report_title, 'September report')
  const pinned = { ...version, content: draft.content }
  assert.equal(marketingReportDraft({ ...artifact, title: 'Later label' }, pinned).title, 'September report')
  const exportText = buildMarketingReportExport({ artifact: { ...artifact, title: 'Later label' }, version: pinned })
  assert.match(exportText, /^# September report/m)
  assert.match(exportText, /Title provenance: Pinned in this exact version/)
})
test('report draft rejects missing sources, reversed dates, and missing deployed-contract narrative', () => {
  assert.throws(() => validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), sources: [] }), /at least one report source/i)
  assert.throws(() => validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), period_start: '2026-09-01', period_end: '2026-08-01' }), /cannot precede/i)
  assert.throws(() => validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), period_start: '2026-02-31' }), /exact start and end dates/i)
  assert.throws(() => validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), executive_summary: '' }), /current report contract/i)
})

test('report metric candidates keep exact stored row identity and preserve validated references', () => {
  const snapshotId = '44444444-4444-4444-8444-444444444444'
  const candidates = marketingReportMetricCandidates({
    adCampaigns: [{ id: 'campaign-1', campaign_name: 'Search A' }],
    adSnapshots: [{ id: snapshotId, ad_campaign_id: 'campaign-1', snapshot_date: '2026-08-15' }],
  })
  assert.deepEqual(candidates, [{ source: 'google_ads', snapshot_id: snapshotId, date: '2026-08-15', label: 'Search A' }])
  const draft = { ...marketingReportDraft(artifact, version),
    metric_snapshot_refs: [{ source: 'google_ads', snapshot_id: snapshotId }] }
  assert.deepEqual(validateMarketingReportDraft(draft).content.metric_snapshot_refs, draft.metric_snapshot_refs)
  assert.throws(() => validateMarketingReportDraft({ ...draft,
    metric_snapshot_refs: [...draft.metric_snapshot_refs, ...draft.metric_snapshot_refs] }), /distinct exact metric/)
})

test('saved report selection remains tenant, engagement, brand, artifact, and exact-version scoped', () => {
  const records = marketingReportRecords({
    engagement,
    artifacts: [artifact, { ...artifact, id: 'foreign', organization_id: 'org-b' }, { ...artifact, id: 'wrong-brand', brand_id: 'brand-b' }],
    versions: [version, { ...version, id: 'version-a1', version_number: 1, created_at: '2026-09-01T00:00:00Z' }, { ...version, id: 'foreign-version', artifact_id: 'foreign', organization_id: 'org-b' }],
  })
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].versions.map(item => item.id), ['version-a2', 'version-a1'])
  assert.equal(marketingReportVersion(records, artifact.id, 'version-a1').version.id, 'version-a1')
  assert.equal(marketingReportVersion(records, artifact.id, 'unavailable-version').version, null)
  assert.equal(marketingReportVersion(records, 'unavailable-report', '').record, null)
  assert.equal(marketingReportVersion(records).version.id, 'version-a2')
})

test('content checksum matches never attribute an ambiguous save operation', async () => {
  const contentChecksum = await marketingReportContentChecksum(version.content)
  const record = { artifact, versions: [{ ...version, id: 'version-a3', content_checksum: contentChecksum }, version] }
  const pending = { artifactId: artifact.id, contentChecksum, knownVersionIds: [version.id] }
  assert.equal(reconcileMarketingReportSave([record], pending), null)
  assert.equal(reconcileMarketingReportSave([{ ...record, versions: [...record.versions, { ...version, id: 'version-a4', content_checksum: contentChecksum }] }], pending), null)
  assert.equal(reconcileMarketingReportSave([record], { ...pending, artifactId: 'another-report' }), null)
})

test('review state is tied to the exact immutable version', () => {
  const approval = { organization_id: organizationId, artifact_version_id: version.id }
  assert.equal(marketingReportReviewState(version, [approval]), 'approved')
  assert.equal(marketingReportReviewState({ ...version, id: 'new-draft' }, [approval]), 'draft')
})

test('current contract reports missing metric pins instead of inventing freshness or values', () => {
  assert.equal(marketingReportEvidenceState(version).status, 'unverified')
  assert.match(marketingReportEvidenceState(version).message, /no pinned metric snapshots/i)
  assert.equal(marketingReportEvidenceState(null).status, 'missing')
})

test('exact-version export is deterministic, escaped, visibly draft, and performs no release action', () => {
  const input = { artifact: { ...artifact, title: '<August report>' }, version, brandName: 'Anka <Test>' }
  const first = buildMarketingReportExport(input)
  assert.equal(buildMarketingReportExport(input), first)
  assert.match(first, /DRAFT - NOT APPROVED OR RELEASED/)
  assert.match(first, /&lt;August report&gt;/)
  assert.match(first, /Legacy artifact label; not pinned to this version/)
  assert.match(first, new RegExp(version.id))
  assert.match(first, /No metric snapshots pinned to this exact version/)
  assert.match(first, /does not approve, release, publish, refresh, or share/i)
})

test('pinned metric rows preserve exact values, collection time, and unavailable definitions in export', () => {
  const pinned = { ...version, content: { ...version.content, metric_snapshots: [{
    source: 'google_ads', source_record_id: 'snapshot-1', source_parent_id: 'campaign-a',
    source_filter: { brand_id: 'brand-a', parent_id: 'campaign-a', period_start: '2026-08-01', period_end: '2026-08-31' },
    snapshot_date: '2026-08-15',
    retrieved_at: '2026-08-16T10:00:00Z', pinned_at: '2026-09-21T12:00:00Z',
    account_id: '123', label: 'Campaign', metrics: { impressions: 120, cost: 8.5 },
    definitions: { metric_units: { impressions: 'count', cost: 'currency amount' },
      reporting_timezone: null, currency: null, provider_finality: null },
  }] } }
  assert.equal(marketingReportEvidenceState(pinned).status, 'pinned')
  assert.equal(marketingReportMetricFreshness(pinned.content.metric_snapshots[0]).status, 'stale_at_pin')
  assert.equal(marketingReportMetricFreshness({ retrieved_at: null, pinned_at: null }).status, 'unknown')
  const exported = buildMarketingReportExport({ artifact, version: pinned })
  assert.match(exported, /row snapshot-1/)
  assert.match(exported, /impressions=120, cost=8.5/)
  assert.match(exported, /collected 2026-08-16T10:00:00Z/)
  assert.match(exported, /age at pin .*over 24h/)
  assert.match(exported, /filter brand_id=brand-a, parent_id=campaign-a/)
  assert.match(exported, /units impressions=count, cost=currency amount/)
  assert.match(exported, /unavailable definitions: reporting_timezone, currency, provider_finality/)
})

test('approved export remains bound to the selected version only', () => {
  const approved = buildMarketingReportExport({ artifact, version, approval: { organization_id: organizationId, artifact_version_id: version.id } })
  const newer = buildMarketingReportExport({ artifact, version: { ...version, id: 'version-a3', version_number: 3 }, approval: { organization_id: organizationId, artifact_version_id: version.id } })
  const foreign = buildMarketingReportExport({ artifact, version, approval: { organization_id: 'org-b', artifact_version_id: version.id } })
  assert.match(approved, /APPROVED VERSION/)
  assert.match(newer, /DRAFT - NOT APPROVED OR RELEASED/)
  assert.match(foreign, /DRAFT - NOT APPROVED OR RELEASED/)
})

test('Reports is a dedicated Marketing tab that reuses canonical artifacts and governed review', () => {
  const studio = read('src/apps/MarketingStudio.jsx')
  const reports = read('src/components/MarketingReports.jsx')
  assert.match(studio, /\['reports', 'Reports'\]/)
  assert.match(studio, /<MarketingReports/)
  assert.match(studio, /type === 'marketing_report'[\s\S]*Open Reports/)
  assert.match(studio, /loading && !\(tab === 'reports' && workspace\)/)
  assert.match(studio, /useBlocker\(briefDirty \|\| reportDirty\)/)
  assert.match(studio, /requestedOutput=\{contextValidation\.context\?\.output \|\| null\}/)
  assert.match(studio, /actorId=\{userId\}/)
  assert.match(reports, /label="Brand"[\s\S]*workspace\.engagement\.brands/)
  assert.match(reports, /studio\.saveMarketingReport/)
  assert.match(reports, /request_id: operationId/)
  assert.match(reports, /<ArtifactApprovalPanel[\s\S]*minimumApprovers=\{2\}/)
  assert.doesNotMatch(reports, /approveArtifact|onSingleApprove|releaseReport|publishReport|client_visibility/i)
})

test('MB07 local slice adds no provider refresh, schema, or parallel report store', () => {
  const model = read('src/data/marketingReports.js')
  const reports = read('src/components/MarketingReports.jsx')
  for (const source of [model, reports]) {
    assert.doesNotMatch(source, /supabase|functions\.invoke|\.from\(|analytics_dashboard|googleapis|fetch\(/i)
    assert.doesNotMatch(source, /create table|create policy|alter table/i)
  }
  assert.match(reports, /does not refresh providers or invent missing metrics/i)
  assert.match(model, /No metric snapshots pinned to this exact version/i)
})
