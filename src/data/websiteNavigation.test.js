import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {validateWebsiteNavigationDestination,compileWebsiteNativeDesign} from './websiteNativeDesign.js'
import {buildWebsiteBlockSource,assertWebsiteBlockFiles} from '../../supabase/functions/_shared/websiteBlockBuild.js'
import {websiteNativeFixture,bindWebsiteNativeFixture} from '../../tools/website-native-fixture.js'
import {prepareWebsiteNativeManifest,verifyWebsiteNativeManifest} from '../../supabase/functions/_shared/websiteNativeDraft.js'
const id=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0')
const nativeDraftContext=()=>({scope:{organization_id:id(1),project_id:id(2),engagement_id:id(3),page_id:id(4),page_key:'home'},architecture:{artifact_version_id:id(5),content_checksum:'a'.repeat(64),approval_id:id(9)},page:{title:'Home'},content_version:{id:id(6),content_checksum:'b'.repeat(64)},brief_version:{id:id(7),content_checksum:'c'.repeat(64)},site_version:{id:id(8),request_sha256:'d'.repeat(64),site:{title:'Brand',language:'en',description:'Global description',palette:{background:'#ffffff',surface:'#eeeeee',ink:'#111111',accent:'#224466'},navigation:[{label:'Home',path:'/home'}],footer:'Footer'}},content_page:{page_brief:'Agreed source brief',draft_copy:'Exact saved copy',meta_title:'Exact page title',meta_description:'Exact page description',primary_cta:'Connect with Anka'},review_sha256:'e'.repeat(64)})
const destination='https://ankasphere.com/contact-anka-sphere/'
test('exact approved HTTPS CTA survives source verification, compilation and fixed block package',async()=>{
 const context=nativeDraftContext(),manifest=await prepareWebsiteNativeManifest(context,{template:'home',sections:[{source_key:'copy',component:'call_to_action',motion:'none'}],cta_path:destination})
 assert.deepEqual(await verifyWebsiteNativeManifest(context,manifest),manifest)
 const compiled=await compileWebsiteNativeDesign(manifest),bundle=await buildWebsiteBlockSource(manifest)
 assert.ok(compiled.preview.includes(`href="${destination}"`));assert.ok(bundle.page.post_content.includes(`href="${destination}"`))
 assert.equal(bundle.published,false);assert.equal(bundle.staging,false)
 const edited=structuredClone(manifest);edited.content.sections[0].action.path='https://ankasphere.com/other/'
 await assert.rejects(compileWebsiteNativeDesign(edited),/checksum/)
})
test('navigation accepts explicit public HTTPS destinations and retains local/anchor behavior',()=>{
 for(const value of [destination,'https://example.com/contact?a=1&b=2#team','/contact','#contact'])assert.equal(validateWebsiteNavigationDestination(value),value)
 for(const value of ['http://example.com','//example.com','javascript:alert(1)','data:text/html,hello','https://user:pass@example.com/','https://example.com:8443/','https://example.com:443/','https://localhost/','https://127.0.0.1/','https://[::1]/','https://intranet/','https://service.internal/','https://evil.invalid/','https://example.com\\@evil.com/','https://example.com/\nfoo','https://example.com/%0afoo','https://example.com/%5cfoo','https://example.com/" onclick="x','https://example.com/%zz','/../secret','/%2f%2fevil.com'])assert.throws(()=>validateWebsiteNavigationDestination(value),undefined,value)
})
test('package validation distinguishes anchor navigation from remote resource attributes',async()=>{
 const design=await websiteNativeFixture();design.site.navigation[0].path=destination
 const bundle=await buildWebsiteBlockSource(await bindWebsiteNativeFixture(design))
 assertWebsiteBlockFiles(bundle.files)
 for(const markup of ['<img src="https://example.com/x">','<img src=https://example.com/x>','<a src="/local-resource">x</a>','<div href="https://example.com/">x</div>','<a href="javascript:alert(1)">x</a>','<a href="//example.com/">x</a>','<script src="/script"></script>']){
  const files={...bundle.files,'parts/header.html':markup};assert.throws(()=>assertWebsiteBlockFiles(files))
 }
 assert.throws(()=>assertWebsiteBlockFiles({...bundle.files,'style.css':bundle.files['style.css']+'a{background:url(https://example.com/x)}'}))
})
test('Chat controller integration retains asset locks and current QA, linking and actor context',()=>{
 const chat=readFileSync(new URL('../components/DirectContextChat.jsx',import.meta.url),'utf8'),panel=readFileSync(new URL('../components/WebsiteStagingPanel.jsx',import.meta.url),'utf8')
 assert.match(chat,/journeyLock\.content\|\|journeyLock\.asset\|\|journeyLock\.website/)
 assert.match(chat,/<ProjectAssetConversation/);assert.match(chat,/<ProjectWebsiteExecution/)
 assert.match(panel,/onQaSaved,externalBusy/);assert.match(panel,/const scope=\{organizationId,projectId,engagementId,actorId\}/)
})
