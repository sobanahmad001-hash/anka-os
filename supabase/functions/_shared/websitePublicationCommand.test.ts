import {assertEquals, assertRejects, assertThrows} from 'jsr:@std/assert@1.0.14'
import {publicationCommand, rollbackCommand, verifyPublicationReceipt} from './websitePublicationCommand.js'
import {buildWebsitePublicationBundle} from './websitePublicationBundle.js'
import {buildWebsiteBlockSource} from './websiteBlockBuild.js'
import {websiteNativeSnapshotChecksum} from './websiteNativeDesign.js'
import {reviewWebsitePublication,reviewWebsiteRollback} from './websitePublicationReview.js'
import {createStoredZip} from '../wordpress-export/theme.ts'
import {sha} from './websiteStaging.js'
import {websiteNativeFixture} from '../../../tools/website-native-fixture.js'

const id = (n: number) => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0')
const now = Date.parse('2026-10-29T10:00:05Z'), actor = id(30)
async function rollbackFixture(){
 const f=await fixture(),base=f.review.snapshot,post={post_id:100,revision:101,path:'/home',sha256:'a'.repeat(64),managed_page_id:base.pages[0].page_id,post_type:'page',post_status:'publish'}
 const inspection={...base.inspection,head:id(50),posts:[post]},retained={publication_id:id(51),scope:base.scope,target_id:base.target.target_id,site_id:base.target.site_id,origin:base.target.origin,published_head:inspection.head,published_theme_sha256:inspection.theme_sha256,backup_snapshot_sha256:'f'.repeat(64),posts:[{page_id:post.managed_page_id,post_id:post.post_id,revision:post.revision,sha256:post.sha256,operation:'replace'}]}
 const reviewed=await reviewWebsiteRollback({scope:base.scope,target:base.target,inspection,retained,theme_change:{mode:'restore',expected_sha256:inspection.theme_sha256,reviewed_sha256:'c'.repeat(64),sitewide_impact_acknowledged:true,affected_posts:[{post_id:post.post_id,revision:post.revision,sha256:post.sha256}]}})
 return {...f,review:{...f.review,kind:'rollback',snapshot:reviewed.snapshot,review_sha256:reviewed.review_sha256}}
}
async function fixture() {
  const manifest = await websiteNativeFixture(), native = await buildWebsiteBlockSource(manifest)
  const zip = createStoredZip(Object.entries(native.files).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({name: native.directory + '/' + name, bytes: new TextEncoder().encode(value)})))
  const job = {id: id(20), artifact_sha256: await sha(zip), seo_verification: {file_hashes: native.file_hashes, package_bytes: zip.byteLength}}
  const page = {page_id: manifest.scope.page_id, page_key: manifest.scope.page_key, path: '/home', job_id: job.id, package_sha256: job.artifact_sha256, source_review_sha256: 'a'.repeat(64), site_version_id: manifest.sources.site_system.version_id, qa: {receipt_id: id(21), artifact_version_id: id(22), run_id: id(23), page_id: manifest.scope.page_id, package_sha256: job.artifact_sha256, current: true}, release_approval: {id: id(24), artifact_version_id: id(22), decision: 'approved', current: true}, operation: 'create', post_id: null, expected_post_revision: null, expected_post_sha256: null}
  const bundle = await buildWebsitePublicationBundle({pages: [page], packages: [{page_id: page.page_id, source: {manifest}, job}], site_version_id: page.site_version_id})
  const origin = 'https://publication.example.test'
  const reviewed = await reviewWebsitePublication({scope: {organization_id: id(1), project_id: id(2), engagement_id: id(3)}, target: {target_id: id(15), connection_id: id(16), site_id: id(17), origin, environment: 'production', connection_revision: '2026-10-29T09:00:00Z'}, inspection: {site_id: id(17), origin, environment: 'production', head: null, inventory_sha256: 'b'.repeat(64), theme_sha256: bundle.theme.theme_sha256, complete: true, posts: []}, site_version_id: page.site_version_id, pages: [page], theme_change: {mode: 'retain', expected_sha256: bundle.theme.theme_sha256, reviewed_sha256: bundle.theme.theme_sha256, sitewide_impact_acknowledged: false, affected_posts: []}})
  const review = {id: id(40), snapshot: reviewed.snapshot, review_sha256: reviewed.review_sha256, created_by: actor, created_at: '2026-10-29T10:00:00Z'}
  const command = {id: id(41), review_id: review.id, request_id: id(42), created_by: actor, created_at: '2026-10-29T10:00:01Z'}
  return {review, command, bundle}
}

Deno.test('command freezes the exact original review package actor and request without dispatching', async () => {
  const f = await fixture(), command = await publicationCommand(f.review, f.command, f.bundle, actor, now)
  const {command_sha256, ...unsigned} = command
  assertEquals(command_sha256, await websiteNativeSnapshotChecksum(unsigned))
  assertEquals(command.command_id, f.command.id); assertEquals(command.request_id, f.command.request_id)
  f.review.snapshot.pages[0].path = '/later-edit'
  assertEquals(command.review_snapshot.pages[0].path, '/home')
})
Deno.test('rollback command pins exact original backup, complete impact and actual actor',async()=>{
 const f=await rollbackFixture(),command=await rollbackCommand(f.review,f.command,actor,now)
 assertEquals(command.kind,'rollback');assertEquals(command.review_snapshot.retained.backup_snapshot_sha256,'f'.repeat(64))
 await assertRejects(()=>rollbackCommand(f.review,f.command,id(99),now));await assertRejects(()=>rollbackCommand(f.review,f.command,actor,now+600000))
})
Deno.test('rollback cannot substitute a later head, missing impact or a changed original backup',async()=>{
 const f=await rollbackFixture();f.review.snapshot.theme_change.sitewide_impact_acknowledged=false
 await assertRejects(()=>rollbackCommand(f.review,f.command,actor,now))
 f.review.snapshot.theme_change.sitewide_impact_acknowledged=true;f.review.snapshot.retained.backup_snapshot_sha256='b'.repeat(64)
 await assertRejects(()=>rollbackCommand(f.review,f.command,actor,now),Error,'checksum differs')
})
Deno.test('wrong actor future timestamps expired dispatch and modified review are denied', async () => {
  const f = await fixture()
  await assertRejects(() => publicationCommand(f.review, f.command, f.bundle, id(99), now))
  await assertRejects(() => publicationCommand(f.review, {...f.command, created_at: '2026-10-29T10:01:00Z'}, f.bundle, actor, now))
  await assertRejects(() => publicationCommand(f.review, f.command, f.bundle, actor, now + 600000))
  f.review.snapshot.pages[0].path = '/changed'
  await assertRejects(() => publicationCommand(f.review, f.command, f.bundle, actor, now), Error, 'checksum differs')
})
Deno.test('resigning a modified payload cannot substitute executable PHP for the fixed runtime', async () => {
  const f = await fixture()
  f.bundle.theme.files['functions.php'] = '<?php exit;'
  f.bundle.theme.file_hashes['functions.php'] = await sha(new TextEncoder().encode(f.bundle.theme.files['functions.php']))
  f.bundle.theme.theme_sha256 = await websiteNativeSnapshotChecksum(f.bundle.theme.files)
  f.review.snapshot.theme_change = {...f.review.snapshot.theme_change, mode: 'replace', reviewed_sha256: f.bundle.theme.theme_sha256, sitewide_impact_acknowledged: true}
  f.review.review_sha256 = (await reviewWebsitePublication(f.review.snapshot)).review_sha256
  const {payload_sha256: _old, ...payload} = f.bundle
  f.bundle.payload_sha256 = await websiteNativeSnapshotChecksum(payload)
  await assertRejects(() => publicationCommand(f.review, f.command, f.bundle, actor, now), Error, 'fixed reviewed publication theme')
})
Deno.test('recovery accepts only the exact original receipt and never treats missing as permission to resend', async () => {
  const f = await fixture()
  const receipt = {request_id: f.command.request_id, command_id: f.command.id, kind: 'publication', review_sha256: f.review.review_sha256, status: 'succeeded', head: f.command.request_id, backup_snapshot_sha256: 'f'.repeat(64)}
  assertEquals(verifyPublicationReceipt(receipt, f.review, f.command), receipt)
  assertThrows(() => verifyPublicationReceipt({...receipt, head: id(99)}, f.review, f.command))
  assertThrows(() => verifyPublicationReceipt({...receipt, command_id: id(99)}, f.review, f.command))
  assertThrows(() => verifyPublicationReceipt({request_id: f.command.request_id, status: 'missing'}, f.review, f.command), Error, 'never resends')
})
