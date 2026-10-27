import test from 'node:test'
import assert from 'node:assert/strict'
import {validateWebsiteNativeDesign,compileWebsiteNativeDesign,changedWebsiteNativeSources,assertWebsiteNativeContext,WEBSITE_NATIVE_TEMPLATES} from './websiteNativeDesign.js'
import {bindWebsiteNativeFixture,websiteNativeFixture} from '../../tools/website-native-fixture.js'

for(const template of WEBSITE_NATIVE_TEMPLATES)test(`native ${template} source package retains existing identity and exact source bindings`,async()=>{
 const design=await websiteNativeFixture(template),result=await compileWebsiteNativeDesign(design)
 assert.deepEqual(result.scope,design.scope);assert.deepEqual(result.sources,design.sources)
 assert.equal(result.live,false);assert.equal(result.capability,'provider_free_source_package')
 assert.ok(result.files[`templates/anka-${template}.html`]);assert.ok(result.files['templates/index.html'])
 const theme=JSON.parse(result.files['theme.json']);assert.equal(theme.version,3);assert.equal(theme.customTemplates[0].name,`anka-${template}`);assert.ok(theme.styles.css.includes('prefers-reduced-motion'))
 assert.deepEqual(await compileWebsiteNativeDesign(design),result,'Build source manifest is deterministic')
 assert.deepEqual(Object.keys(result.files).filter(path=>/\.php$|\.js$/.test(path)),[])
 assert.match(result.blocks,/wp:group/);assert.match(result.blocks,/wp:heading/)
 assert.match(result.preview,/script-src 'none'/);assert.match(result.preview,/form-action 'none'/)
})
test('content/style tampering cannot retain a pinned source checksum',async()=>{
 const design=await websiteNativeFixture();design.content.title='Later source';await assert.rejects(compileWebsiteNativeDesign(design),/exact pinned checksum/)
 const other=await websiteNativeFixture();other.site.footer='A later footer';await assert.rejects(compileWebsiteNativeDesign(other),/exact pinned checksum/)
})
test('source revisions are reported without changing any downstream design',async()=>{
 const design=await websiteNativeFixture(),original=structuredClone(design),current=structuredClone(design.sources)
 current.content.version_id='a0000000-0000-4000-8000-000000000999';current.site_system.checksum='c'.repeat(64)
 assert.deepEqual(changedWebsiteNativeSources(design,current),['content','site_system']);assert.deepEqual(design,original)
 assert.throws(()=>changedWebsiteNativeSources(design,{...current,other:current.content}),/Exact/)
})
test('resolved source contexts reject a different project, page or source version',async()=>{
 const design=await websiteNativeFixture(),context={scope:design.scope,sources:design.sources}
 assert.equal(assertWebsiteNativeContext(design,context),true)
 for(const change of [x=>x.scope.project_id='a0000000-0000-4000-8000-000000000999',x=>x.scope.page_id='a0000000-0000-4000-8000-000000000999',x=>x.sources.content.version_id='a0000000-0000-4000-8000-000000000999']){
  const changed=structuredClone(context);change(changed);assert.throws(()=>assertWebsiteNativeContext(design,changed),/Resolved/)
 }
})
test('unsupported dynamic features, code, duplicate bindings and omitted content fail closed',async()=>{
 const design=await websiteNativeFixture()
 for(const change of [x=>x.layout.template='property_search',x=>x.layout.sections[0].component='raw_html',x=>x.layout.sections[0].motion='javascript',x=>x.layout.sections.push(x.layout.sections[0]),x=>x.layout.sections.pop(),x=>x.layout.sections[0].source_key='missing',x=>x.content.sections.push(x.content.sections[0]),x=>x.site.plugin='elementor',x=>x.scope.project_id='foreign',x=>x.sources.content.checksum='invalid']){
  const value=structuredClone(design);change(value);assert.throws(()=>validateWebsiteNativeDesign(value))
 }
})
test('hostile text remains inert text and unsafe paths/anchors are rejected',async()=>{
 const design=await websiteNativeFixture();design.content.title='<script>alert(1)</script> & "Text"';design.content.sections[0].paragraphs=['</style><iframe src="https://evil.invalid">']
 const safe=await compileWebsiteNativeDesign(await bindWebsiteNativeFixture(design))
 assert.ok(!safe.preview.includes('<script>'));assert.ok(!safe.preview.includes('<iframe'));assert.match(safe.preview,/&lt;script&gt;/)
 for(const url of ['//evil.invalid','https://evil.invalid','javascript:alert(1)','/../secret','/%2f%2fevil.invalid','#missing','/a?redirect=evil','/\npath']){
  const value=structuredClone(design);value.site.navigation[0].path=url;assert.throws(()=>validateWebsiteNativeDesign(value))
 }
})
test('bounded plain objects and required content prevent ambiguous or oversized manifests',async()=>{
 const design=await websiteNativeFixture()
 for(const change of [x=>x.content.sections[0].paragraphs=['x'.repeat(3001)],x=>x.content.sections=[],x=>x.content.summary='',x=>x.site.palette.accent='url(https://evil.invalid)',x=>x.site.palette.ink='#ffffff',x=>x.site.navigation=[],x=>x.content.sections[0].action={label:'Go',path:'#absent'},x=>x.scope=Object.assign(Object.create({inherited:true}),x.scope)]){
  const value=structuredClone(design);change(value);assert.throws(()=>validateWebsiteNativeDesign(value))
 }
})
