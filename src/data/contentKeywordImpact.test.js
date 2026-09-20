import assert from 'node:assert/strict'
import test from 'node:test'
import { keywordDownstreamImpact } from './contentKeywordImpact.js'

const row = target => ({ term: 'ank a', locale: 'en-PK', intent: 'commercial', target_kind: 'page', target_page_key: target })
const latest = { id: 'keyword-v2', artifact_id: 'keyword-a' }
const workspace = {
  artifacts: [{ id: 'architecture-a', artifact_type: 'website_architecture' }, { id: 'other-a', artifact_type: 'website_architecture' }],
  versions: [
    { id: 'keyword-v1', artifact_id: 'keyword-a', version_number: 1 },
    { id: 'keyword-other', artifact_id: 'keyword-other-a', version_number: 1 },
    { id: 'architecture-v3', artifact_id: 'architecture-a', version_number: 3, content: { pages: [
      { page_key: 'page:home', title: 'Home', keyword_strategy_version_id: 'keyword-v1' },
      { page_key: 'page:about', title: 'About', keyword_strategy_version_id: 'keyword-other' },
    ] } },
    { id: 'architecture-other', artifact_id: 'other-a', version_number: 2, content: { pages: [
      { page_key: 'page:service', title: 'Services', keyword_strategy_version_id: 'keyword-v2' },
    ] } },
  ],
}

test('C03 flags exact saved page-brief references across versions of the same keyword root', () => {
  const review = keywordDownstreamImpact({ keywords: [row('page:home')] }, { keywords: [row('page:new')] }, latest, workspace)
  assert.deepEqual(review.linkedPages.map(page => [page.title, page.versionNumber]), [['Home', 3], ['Services', 2]])
  assert.equal(review.targetsChanged, true)
})

test('C03 does not flag unchanged assignments or first versions', () => {
  assert.equal(keywordDownstreamImpact({ keywords: [row('page:home')] }, { keywords: [row('page:home')] }, latest, workspace), null)
  assert.equal(keywordDownstreamImpact({}, { keywords: [row('page:home')] }, null, workspace), null)
})

test('C03 flags a changed exact architecture source even when page keys match', () => {
  const impact = keywordDownstreamImpact(
    { source_architecture_version_id: 'architecture-v1', keywords: [row('page:home')] },
    { source_architecture_version_id: 'architecture-v2', keywords: [row('page:home')] }, latest, workspace)
  assert.equal(impact.targetsChanged, false)
  assert.equal(impact.sourceChanged, true)
})
