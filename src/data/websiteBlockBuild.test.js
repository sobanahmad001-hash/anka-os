import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {buildWebsiteBlockSource,assertWebsiteBlockFiles,WEBSITE_BLOCK_FUNCTIONS} from '../../supabase/functions/_shared/websiteBlockBuild.js'
import {websiteNativeFixture} from '../../tools/website-native-fixture.js'
import {latestWordPressExportJob} from './wordpressExport.js'
test('review-only native packages never masquerade as delivery-approved legacy exports',()=>{
 const legacy={id:'old',website_page_design_id:'page',requested_at:'2026-01-01T00:00:00Z'},review={id:'new',website_page_design_id:'page',provider_job_id:'anka-native-block-v1',status:'complete',requested_at:'2026-10-28T00:00:00Z'}
 assert.equal(latestWordPressExportJob([legacy,review],'page'),legacy);assert.equal(latestWordPressExportJob([review],'page'),null)
})
for(const template of ['home','service','location','article','about','contact'])test('native block build '+template+' is deterministic and source-bound',async()=>{
 const source=await websiteNativeFixture(template),copy=structuredClone(source),built=await buildWebsiteBlockSource(source)
 assert.deepEqual(await buildWebsiteBlockSource(source),built);assert.deepEqual(source,copy)
 assert.equal(built.validation.files,9);assert.equal(built.files['functions.php'],WEBSITE_BLOCK_FUNCTIONS);assert.equal(built.source.delivery_approved,false);assert.equal(built.staging,false);assert.equal(built.published,false)
 assert.equal(built.page.page_id,source.scope.page_id);assert.equal(built.page.meta_description,source.content.summary)
 assert.match(built.files['templates/anka-'+template+'.html'],/wp:template-part/);assert.ok(built.file_hashes['source-manifest.json'])
 for(const [name,text]of Object.entries(built.files))assert.equal(built.file_hashes[name],createHash('sha256').update(text).digest('hex'))
})
test('archive boundary rejects traversal, symlink-shaped values, extra code, remote fetch and output overflow',async()=>{
 const built=await buildWebsiteBlockSource(await websiteNativeFixture())
 for(const change of [x=>x['../out.php']='x',x=>x['functions.php']+='<?php evil();',x=>x['parts/header.html']='<script src="https://evil.test/a"></script>',x=>x['style.css']+='@import "https://evil.test/a";',x=>x['theme.json']={symlink:'/etc/passwd'},x=>x['style.css']+='a'.repeat(1048576)]){
  const files=structuredClone(built.files);change(files);assert.throws(()=>assertWebsiteBlockFiles(files))
 }
})
test('hostile source text remains escaped data, never executable PHP or markup',async()=>{
 const {websiteNativeSnapshotChecksum}=await import('./websiteNativeDesign.js'),source=await websiteNativeFixture();source.content.sections[0].paragraphs=['<?php die(); ?><script>alert(1)</script>']
 source.snapshot_checksums.content=await websiteNativeSnapshotChecksum(source.content)
 const built=await buildWebsiteBlockSource(source)
 assert.match(built.page.post_content,/&lt;\?php/);assert.doesNotMatch(built.page.post_content,/<script/)
 assert.equal(built.files['functions.php'],WEBSITE_BLOCK_FUNCTIONS)
})
