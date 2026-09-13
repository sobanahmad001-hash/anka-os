import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildMarketingReportExport, marketingReportContentChecksum, marketingReportDraft, marketingReportEvidenceState, marketingReportRecords, marketingReportReviewState, marketingReportVersion, reconcileMarketingReportSave, validateMarketingReportDraft } from './marketingReports.js'

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

test('report draft rejects missing sources, reversed dates, and missing deployed-contract narrative', () => {
  assert.throws(() => validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), sources: [] }), /at least one report source/i)
  assert.throws(() => validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), period_start: '2026-09-01', period_end: '2026-08-01' }), /cannot precede/i)
  assert.throws(() => validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), period_start: '2026-02-31' }), /exact start and end dates/i)
  assert.throws(() => validateMarketingReportDraft({ ...marketingReportDraft(artifact, version), executive_summary: '' }), /current report contract/i)
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
  assert.match(marketingReportEvidenceState(version).message, /does not pin metric rows/i)
  assert.equal(marketingReportEvidenceState(null).status, 'missing')
})

test('exact-version export is deterministic, escaped, visibly draft, and performs no release action', () => {
  const input = { artifact: { ...artifact, title: '<August report>' }, version, brandName: 'Anka <Test>' }
  const first = buildMarketingReportExport(input)
  assert.equal(buildMarketingReportExport(input), first)
  assert.match(first, /DRAFT - NOT APPROVED OR RELEASED/)
  assert.match(first, /&lt;August report&gt;/)
  assert.match(first, new RegExp(version.id))
  assert.match(first, /Metric snapshot: Unavailable/)
  assert.match(first, /does not approve, release, publish, refresh, or share/i)
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
  assert.match(reports, /studio\.saveArtifact/)
  assert.match(reports, /artifact_type: 'marketing_report'/)
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
  assert.match(model, /Metric snapshot: Unavailable|does not pin metric rows/i)
})
