import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewWebsitePublication, reviewWebsiteRollback} from '../../supabase/functions/_shared/websitePublicationReview.js'
const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0')
function fixture() {
  const scope = {organization_id: id(1), project_id: id(2), engagement_id: id(3)}
  const target = {target_id: id(4), connection_id: id(5), site_id: id(6), origin: 'https://publication.example.test', environment: 'production', connection_revision: '2026-10-29T09:00:00Z'}
  const inspection = {site_id: id(6), origin: target.origin, environment: 'production', head: id(7), inventory_sha256: 'a'.repeat(64), theme_sha256: 'b'.repeat(64), complete: true, posts: [{post_type: 'page', post_status: 'publish', post_id: 123, revision: 1, path: '/about', sha256: 'e'.repeat(64), managed_page_id: null}]}
  const page = {page_id: id(8), page_key: 'home', path: '/home', job_id: id(9), package_sha256: 'c'.repeat(64), source_review_sha256: 'd'.repeat(64), site_version_id: id(10), qa: {receipt_id: id(11), artifact_version_id: id(12), run_id: id(13), page_id: id(8), package_sha256: 'c'.repeat(64), current: true}, release_approval: {id: id(14), artifact_version_id: id(12), decision: 'approved', current: true}, operation: 'create', post_id: null, expected_post_revision: null, expected_post_sha256: null}
  return {scope, target, inspection, site_version_id: id(10), pages: [page], theme_change: {mode: 'retain', expected_sha256: 'b'.repeat(64), reviewed_sha256: 'b'.repeat(64), sitewide_impact_acknowledged: false, affected_posts: []}}
}
test('publication review is deterministic, detached and never executable or an approval', async () => {
  const input = fixture(), first = await reviewWebsitePublication(input), second = await reviewWebsitePublication(input)
  assert.equal(first.review_sha256, second.review_sha256)
  assert.equal(first.executable, false); assert.equal(first.requires_live_target_approval, true)
  input.pages[0].path = '/changed'; assert.equal(first.snapshot.pages[0].path, '/home')
})
test('staging bindings, incomplete inventory and secret-shaped extra fields cannot become live reviews', async () => {
  for (const mutate of [d => d.target.environment = 'staging', d => d.inspection.complete = false, d => d.target.password = 'synthetic', d => d.inspection.origin = 'https://other.example.test']) {
    const d = fixture(); mutate(d); await assert.rejects(reviewWebsitePublication(d))
  }
})
test('QA is tied to the exact package and deliverable approval stays separate', async () => {
  for (const mutate of [d => d.pages[0].qa.current = false, d => d.pages[0].qa.package_sha256 = 'e'.repeat(64), d => d.pages[0].release_approval.decision = 'pending', d => d.pages[0].release_approval.artifact_version_id = id(99)]) {
    const d = fixture(); mutate(d); await assert.rejects(reviewWebsitePublication(d))
  }
})
test('page/path/post collisions and silent replacement are denied', async () => {
  const d = fixture(); d.pages.push(structuredClone(d.pages[0])); await assert.rejects(reviewWebsitePublication(d), /Duplicate/)
  const replace = fixture(); replace.pages[0].post_id = 123; await assert.rejects(reviewWebsitePublication(replace), /overwrite/)
  const remote = fixture(); remote.pages[0].path = 'https://other.example.test'; await assert.rejects(reviewWebsitePublication(remote), /local publication/)
})
test('theme changes require explicit site-wide impact review and one shared site version', async () => {
  const d = fixture(); d.theme_change.mode = 'replace'; await assert.rejects(reviewWebsitePublication(d), /theme impact/)
  d.theme_change.sitewide_impact_acknowledged = true; await assert.rejects(reviewWebsitePublication(d), /every existing/); d.theme_change.affected_posts = d.inspection.posts.map(({post_id,revision,sha256})=>({post_id,revision,sha256})); assert.equal((await reviewWebsitePublication(d)).executable, false)
  d.pages[0].site_version_id = id(99); await assert.rejects(reviewWebsitePublication(d), /shared site version/)
})
test('rollback review pins retained backup and current head without authorizing a restore', async () => {
  const d = fixture(); d.inspection.posts[0].managed_page_id=id(8); const input = {scope: d.scope, target: d.target, inspection: d.inspection, retained: {publication_id: id(20), scope: d.scope, target_id: d.target.target_id, site_id: d.target.site_id, origin: d.target.origin, published_head: d.inspection.head, published_theme_sha256: d.inspection.theme_sha256, backup_snapshot_sha256: 'f'.repeat(64), posts: [{page_id:id(8),post_id:123,revision:1,sha256:'e'.repeat(64),operation:'replace'}]}}
  input.theme_change={mode:'restore',expected_sha256:d.inspection.theme_sha256,reviewed_sha256:'a'.repeat(64),sitewide_impact_acknowledged:true,affected_posts:d.inspection.posts.map(p=>({post_id:p.post_id,revision:p.revision,sha256:p.sha256}))};assert.equal((await reviewWebsiteRollback(input)).executable, false)
  input.inspection.head = id(99); await assert.rejects(reviewWebsiteRollback(input), /unchanged current head/)
})

test('inspected existing paths and post edits cannot be silently overwritten', async () => {
  const d=fixture();d.pages[0].path='/about';await assert.rejects(reviewWebsitePublication(d),/overwrite/)
  Object.assign(d.pages[0],{operation:'replace',post_id:123,expected_post_revision:1,expected_post_sha256:'e'.repeat(64)})
  assert.equal((await reviewWebsitePublication(d)).executable,false)
  d.inspection.posts[0].revision=2;await assert.rejects(reviewWebsitePublication(d),/no longer matches/)
})


test('one registered page cannot be recreated under another path or mapped twice', async () => {
  const d=fixture();d.inspection.posts[0].managed_page_id=d.pages[0].page_id
  await assert.rejects(reviewWebsitePublication(d),/duplicate/)
  d.inspection.posts.push({...d.inspection.posts[0],post_id:124,path:'/other'})
  await assert.rejects(reviewWebsitePublication(d),/multiple WordPress/)
})

test('theme replacement cannot omit or substitute a post affected by the sitewide change', async () => {
  const d=fixture();Object.assign(d.theme_change,{mode:'replace',sitewide_impact_acknowledged:true,affected_posts:[{post_id:123,revision:2,sha256:'e'.repeat(64)}]})
  await assert.rejects(reviewWebsitePublication(d),/complete inspected inventory/)
})
