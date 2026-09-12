import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildContentUpdatePreview, normalizeResearchUrl, shouldApplySeoResearchResponse, sourceAvailabilitySummary, validateSeoResearchInput } from './marketingSeoResearch.js'

test('research input requires explicit supported scope and never invents language or device', () => {
  assert.throws(() => validateSeoResearchInput({ research_type: '', target_url: 'https://example.test', market: 'PK' }), /supported research type/)
  assert.throws(() => validateSeoResearchInput({ research_type: 'page', target_url: 'https://example.test', market: '' }), /Market is required/)
  const input = validateSeoResearchInput({ research_type: 'page', target_url: 'HTTPS://Example.TEST/path/#fragment', market: 'Pakistan', seed_keywords: ' Growth  \nGrowth\nseo ' })
  assert.equal(input.target_url, 'https://example.test/path')
  assert.equal(input.language, null)
  assert.equal(input.device, null)
  assert.deepEqual(input.seed_keywords, ['Growth', 'seo'])
})

test('URL validation rejects credentials and unsupported schemes', () => {
  assert.throws(() => normalizeResearchUrl('https://user:secret@example.test/path'), /without embedded credentials/)
  assert.throws(() => normalizeResearchUrl('file:///etc/passwd'), /HTTP or HTTPS/)
  assert.throws(() => normalizeResearchUrl('not a URL'), /valid HTTP or HTTPS/)
})

test('request preview preserves fact and interpretation labels without creating work', () => {
  const preview = buildContentUpdatePreview({
    input: { target_url: 'https://example.test/page', content_strategy_version_id: 'version-1' },
    source_facts: [{ observation: 'Stored index status is indexed.', source: 'technical_seo_audit', evidence_date: '2026-09-12' }],
    interpretations: [{ proposed_action: 'Retain monitoring.' }],
  })
  assert.equal(preview.status, 'not_started')
  assert.equal(preview.target_department, 'content')
  assert.match(preview.description, /Source facts/)
  assert.match(preview.description, /Marketing interpretation/)
  assert.match(preview.description, /Do not create a competing strategy or copy/)
  assert.equal('id' in preview, false)
})

test('source availability and response identity remain honest and context-bound', () => {
  const sources = sourceAvailabilitySummary({ technicalSeoPages: 1, trackedKeywords: 0, contentStrategies: [] })
  assert.deepEqual(sources.map(item => item.available), [true, false, false])
  const request = { organizationId: 'org-a', brandId: 'brand-a', engagementId: 'eng-a', revision: 2, signal: { aborted: false } }
  assert.equal(shouldApplySeoResearchResponse(request, request, 3, 3), true)
  assert.equal(shouldApplySeoResearchResponse(request, { ...request, brandId: 'brand-b' }, 3, 3), false)
  assert.equal(shouldApplySeoResearchResponse({ ...request, signal: { aborted: true } }, request, 3, 3), false)
})

test('production wiring uses server preview, replay-safe save, additive persistence, and a visibly blocked request confirmation', async () => {
  const [repository, component, studio, edge, migration, verifier, concurrency, relations, workItems, proofing] = await Promise.all([
    readFile(new URL('./marketingSeoResearchRepository.js', import.meta.url), 'utf8'),
    readFile(new URL('../components/MarketingSeoResearch.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/marketing-studio/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/migrations/20260912160000_mb03b_seo_research.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/verify_20260912160000_mb03b_seo_research.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/mb03b-concurrency.ts', import.meta.url), 'utf8'),
    readFile(new URL('./artifactRelations.js', import.meta.url), 'utf8'),
    readFile(new URL('./workItems.js', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/proofing-layer/index.ts', import.meta.url), 'utf8'),
  ])
  assert.match(repository, /preview_seo_research/)
  assert.match(repository, /save_seo_research/)
  assert.match(repository, /service_catalog\.department_id', 'content'/)
  assert.match(component, /Confirm request unavailable/)
  assert.match(component, /generic Work Item save path is not replay-safe/)
  assert.match(studio, /seo-research/)
  assert.match(edge, /safeResearchUrl/)
  assert.match(edge, /No remote URL was fetched/)
  assert.match(edge, /SEO research must be saved through the replay-safe research workflow/)
  assert.match(migration, /save_marketing_seo_research/)
  assert.match(migration, /seo_research/)
  assert.match(verifier, /cross_tenant_rejected/)
  assert.match(verifier, /rollback;/)
  assert.match(concurrency, /MB03B_LOCAL_TEMPLATE_URL/)
  assert.match(concurrency, /localhost.*127\.0\.0\.1.*\[::1\]/)
  assert.match(concurrency, /CREATE DATABASE[\s\S]*TEMPLATE/)
  assert.match(concurrency, /DROP DATABASE/)
  assert.match(concurrency, /same_key_race=one_write_one_replay/)
  assert.match(concurrency, /expired_key_race=one_fresh_write_one_replay/)
  assert.match(relations, /seo_research/)
  assert.match(workItems, /seo_research/)
  assert.match(proofing, /seo_research/)
})
