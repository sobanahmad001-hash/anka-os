import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildMarketingKeywordResearch, keywordDuplicateCounts, shouldApplyKeywordResearchResponse } from './marketingKeywordResearch.js'
import { collectKeywordResearchPages } from './marketingKeywordResearchRepository.js'

const orgA = 'org-a'
const brandA = { id: 'brand-a', organization_id: orgA, name: 'Anka' }

function fixture() {
  return {
    organizationId: orgA,
    brand: brandA,
    pages: [
      { id: 'page-1', organization_id: orgA, brand_id: 'brand-a', page_url: 'https://anka.test/one', page_type: 'service' },
      { id: 'page-2', organization_id: orgA, brand_id: 'brand-a', page_url: 'https://anka.test/two', page_type: 'blog' },
      { id: 'page-foreign', organization_id: 'org-b', brand_id: 'brand-b', page_url: 'https://foreign.test', page_type: 'homepage' },
    ],
    keywords: [
      { id: 'keyword-1', organization_id: orgA, brand_id: 'brand-a', tracked_page_id: 'page-1', keyword: 'growth strategy', source_artifact_id: 'artifact-1', target_rank_tier: 'top_10', active: true, created_at: '2026-08-01' },
      { id: 'keyword-2', organization_id: orgA, brand_id: 'brand-a', tracked_page_id: 'page-2', keyword: 'growth strategy', source_artifact_id: null, target_rank_tier: null, active: false, created_at: '2026-08-02' },
      { id: 'keyword-foreign', organization_id: 'org-b', brand_id: 'brand-b', tracked_page_id: 'page-foreign', keyword: 'private tenant term', active: true },
    ],
    snapshots: [
      { id: 'snapshot-new', organization_id: orgA, tracked_keyword_id: 'keyword-1', snapshot_date: '2026-09-02', position: 7, search_console_clicks: 4, search_console_impressions: 80, fetched_at: '2026-09-02T02:00:00Z' },
      { id: 'snapshot-old', organization_id: orgA, tracked_keyword_id: 'keyword-1', snapshot_date: '2026-09-01', position: 12, search_console_clicks: 2, search_console_impressions: 50, fetched_at: '2026-09-01T02:00:00Z' },
      { id: 'snapshot-unknown', organization_id: orgA, tracked_keyword_id: 'keyword-2', snapshot_date: '2026-09-03', position: null, search_console_clicks: 0, search_console_impressions: 3, fetched_at: '2026-09-03T02:00:00Z' },
      { id: 'snapshot-foreign', organization_id: 'org-b', tracked_keyword_id: 'keyword-foreign', snapshot_date: '2026-09-03', position: 1 },
    ],
    sourceArtifacts: [
      { id: 'artifact-1', organization_id: orgA, brand_id: 'brand-a', artifact_type: 'keyword_strategy', title: 'SEO keyword strategy' },
      { id: 'artifact-wrong-type', organization_id: orgA, brand_id: 'brand-a', artifact_type: 'content', title: 'Not a keyword source' },
      { id: 'artifact-foreign', organization_id: 'org-b', brand_id: 'brand-b', artifact_type: 'keyword_strategy', title: 'Private strategy' },
    ],
    backlinkTargets: [
      { id: 'link-1', organization_id: orgA, brand_id: 'brand-a', site_name: 'Industry Guild', site_url: 'https://guild.test', domain_authority: '41.5', relevance_score: '92', outreach_status: 'contacted', updated_at: '2026-09-01' },
      { id: 'link-foreign', organization_id: 'org-b', brand_id: 'brand-b', site_name: 'Private Link', outreach_status: 'secured' },
    ],
  }
}

test('SEO keyword identity keeps duplicate-looking records distinct and retains inactive keywords', () => {
  const model = buildMarketingKeywordResearch(fixture())
  assert.deepEqual(model.trackedKeywords.map(item => item.id), ['keyword-1', 'keyword-2'])
  assert.equal(model.trackedKeywords[0].keyword, model.trackedKeywords[1].keyword)
  assert.equal(model.trackedKeywords[0].pageTarget.url, 'https://anka.test/one')
  assert.equal(model.trackedKeywords[1].pageTarget.url, 'https://anka.test/two')
  assert.equal(model.trackedKeywords[1].active, false)
})

test('duplicate warnings are presentation-only, page-specific, and case-insensitive', () => {
  const rows = [
    { id: 'a', tracked_page_id: 'page-1', keyword: 'Growth  Strategy' },
    { id: 'b', tracked_page_id: 'page-1', keyword: ' growth strategy ' },
    { id: 'c', tracked_page_id: 'page-2', keyword: 'growth strategy' },
  ]
  assert.deepEqual([...keywordDuplicateCounts(rows)], [['a', 2], ['b', 2], ['c', 1]])
  assert.equal(rows.length, 3)
})

test('rank history is dated, chronological, and preserves unknown rank explicitly', () => {
  const model = buildMarketingKeywordResearch(fixture())
  const active = model.trackedKeywords.find(item => item.id === 'keyword-1')
  const inactive = model.trackedKeywords.find(item => item.id === 'keyword-2')
  assert.deepEqual(active.history.map(item => item.date), ['2026-09-01', '2026-09-02'])
  assert.equal(active.latestSnapshot.position, 7)
  assert.equal(inactive.latestSnapshot.position, null)
  assert.equal(inactive.latestSnapshot.rankState, 'unknown')
  assert.equal(inactive.latestSnapshot.clicks, 0)
})

test('tenant and brand isolation applies to keywords, children, sources, and backlink facts', () => {
  const model = buildMarketingKeywordResearch(fixture())
  assert.equal(model.trackedKeywords.some(item => item.keyword.includes('private')), false)
  assert.deepEqual(model.trackedKeywords[0].sourceArtifact, {
    id: 'artifact-1', title: 'SEO keyword strategy', artifactType: 'keyword_strategy',
  })
  assert.deepEqual(model.backlinkEvidence.map(item => item.id), ['link-1'])
  assert.equal('interpretation' in model.backlinkEvidence[0], false)
  assert.throws(() => buildMarketingKeywordResearch({ ...fixture(), brand: { ...brandA, organization_id: 'org-b' } }), error => error.membershipMismatch)
})

test('stale, switched-brand, switched-organization, and aborted responses are rejected', () => {
  const request = { organizationId: orgA, brandId: 'brand-a', revision: 4, signal: { aborted: false } }
  assert.equal(shouldApplyKeywordResearchResponse(request, { organizationId: orgA, brandId: 'brand-a', revision: 4 }, 2, 2), true)
  assert.equal(shouldApplyKeywordResearchResponse(request, { organizationId: orgA, brandId: 'brand-b', revision: 4 }, 2, 2), false)
  assert.equal(shouldApplyKeywordResearchResponse(request, { organizationId: 'org-b', brandId: 'brand-a', revision: 4 }, 2, 2), false)
  assert.equal(shouldApplyKeywordResearchResponse(request, { organizationId: orgA, brandId: 'brand-a', revision: 5 }, 2, 2), false)
  assert.equal(shouldApplyKeywordResearchResponse(request, { organizationId: orgA, brandId: 'brand-a', revision: 4 }, 1, 2), false)
  assert.equal(shouldApplyKeywordResearchResponse({ ...request, signal: { aborted: true } }, { organizationId: orgA, brandId: 'brand-a', revision: 4 }, 2, 2), false)
})

test('pagination walks inclusive ranges until the short page', async () => {
  const ranges = []
  const rows = await collectKeywordResearchPages(async (from, to) => {
    ranges.push([from, to])
    return from < 1000 ? Array.from({ length: 500 }, (_, index) => from + index) : [1000]
  })
  assert.equal(rows.length, 1001)
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]])
})

test('production path is read-only, cancellable, paginated, and explicitly scoped', async () => {
  const repository = await readFile(new URL('./marketingKeywordResearchRepository.js', import.meta.url), 'utf8')
  const studio = await readFile(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
  assert.match(repository, /abortSignal\(signal\)/)
  assert.match(repository, /\.range\(from, to\)/)
  assert.match(repository, /\.eq\('organization_id', organizationId\)/)
  assert.match(repository, /\.eq\('brand_id', brand\.id\)/)
  assert.match(repository, /\.in\('tracked_keyword_id', keywordIds\)/)
  assert.doesNotMatch(repository, /\.(?:insert|update|upsert|delete|rpc)\s*\(/)
  assert.doesNotMatch(repository, /functions\.invoke/)
  assert.match(studio, /Tracked SEO keywords[\s\S]*separate from Google Ads planning keywords/)
  assert.match(studio, /This view does not generate or save interpretations/)
  assert.match(studio, /shouldApplyKeywordResearchResponse/)
  assert.match(studio, /Market, language, and device detail is not stored/)
  assert.match(studio, /Pause tracking/)
  assert.doesNotMatch(studio, /deleteKeyword|mergeKeyword/)
})
