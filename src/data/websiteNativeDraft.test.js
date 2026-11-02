import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
import {prepareWebsiteNativeManifest,verifyWebsiteNativeManifest,nativeCopyParagraphs,websiteLayoutPrompt,readWebsiteLayoutProposal,nativeWebsiteCopySections,websiteNativeLayout} from '../../supabase/functions/_shared/websiteNativeDraft.js'
import {compileWebsiteNativeDesign,websiteNativeSnapshotChecksum} from './websiteNativeDesign.js'
const id=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export const nativeDraftContext=()=>({scope:{organization_id:id(1),project_id:id(2),engagement_id:id(3),page_id:id(4),page_key:'home'},architecture:{artifact_version_id:id(5),content_checksum:'a'.repeat(64),approval_id:id(9)},page:{title:'Home'},content_version:{id:id(6),content_checksum:'b'.repeat(64)},brief_version:{id:id(7),content_checksum:'c'.repeat(64)},site_version:{id:id(8),request_sha256:'d'.repeat(64),site:{title:'Brand',language:'en',description:'Global description',palette:{background:'#ffffff',surface:'#eeeeee',ink:'#111111',accent:'#224466'},navigation:[{label:'Home',path:'/home'}],footer:'Footer'}},content_page:{page_brief:'Agreed source brief',draft_copy:'Exact saved copy',meta_title:'Exact page title',meta_description:'Exact page description',primary_cta:'Contact'},review_sha256:'e'.repeat(64)})
const options=()=>({template:'home',sections:[{source_key:'copy',component:'prose',motion:'none'}],cta_path:''})
export const numberedCopy=()=>`## 1. Hero

### Connected work.

An exact introduction & audience.

**Primary CTA:** [Connect with Anka](https://ankasphere.com/contact-anka-sphere/)
**Secondary CTA:** [Explore our work](#selected-work)

## 2. Services
*Section anchor: \`services\`*

### Five connected areas.

Keep this introduction before the cards.

#### Branding
Identity and visual design.

#### Website Development
Website design and maintenance.

**CTA:** [Connect with Anka](https://ankasphere.com/contact-anka-sphere/)

## 3. Selected work
*Section anchor: \`selected-work\`*

### Selected examples.

#### Supplied example
Only supplied facts.

**CTA:** [Connect with Anka](https://ankasphere.com/contact-anka-sphere/)

## 4. How we work
*Section anchor: \`how-we-work\`*

### A clear direction.

#### 1. Understand the need
Begin with the need.

**CTA:** [Connect with Anka](https://ankasphere.com/contact-anka-sphere/)

## 5. FAQs
*Section anchor: \`faqs\`*

### Questions before we begin?

#### Can we start with one service?
Yes. Start with your current need.

**CTA:** [Connect with Anka](https://ankasphere.com/contact-anka-sphere/)

## 6. Contact
*Section anchor: \`contact\`*

### What would you like to build?

Tell us what you have in mind.

**Primary CTA:** [Connect with Anka](https://ankasphere.com/contact-anka-sphere/)`
test('native drafts retain original hashes and exact page title/description without site suffixes',async()=>{const ctx=nativeDraftContext(),m=await prepareWebsiteNativeManifest(ctx,options()),rendered=await compileWebsiteNativeDesign(m);assert.equal(m.sources.content.checksum,ctx.content_version.content_checksum);assert.equal(m.content.sections[0].paragraphs.join(''),'Exact saved copy');assert.ok(rendered.preview.includes('<title>Exact page title</title>'));assert.ok(rendered.preview.includes('name="description" content="Exact page description"'));assert.deepEqual(await verifyWebsiteNativeManifest(ctx,m),m)})
test('a rehashed copied manifest cannot replace canonical page copy or site settings',async()=>{const ctx=nativeDraftContext();for(const alter of [m=>m.content.title='Unreviewed replacement',m=>m.site.title='Other brand',m=>m.scope.project_id=id(99),m=>m.sources.content.version_id=id(99)]){const m=await prepareWebsiteNativeManifest(ctx,options());alter(m);m.snapshot_checksums.content=await websiteNativeSnapshotChecksum(m.content);m.snapshot_checksums.site_system=await websiteNativeSnapshotChecksum(m.site);await assert.rejects(verifyWebsiteNativeManifest(ctx,m),/selected exact source/)}})
test('long Unicode copy is bounded without truncation or broken surrogate pairs',()=>{const text='😀'.repeat(10000);const parts=nativeCopyParagraphs(text);assert.equal(parts.join(''),text);assert.ok(parts.every(p=>p.length<=3000&&!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p)));assert.throws(()=>nativeCopyParagraphs('x'.repeat(96001)),/not truncated/);assert.throws(()=>nativeCopyParagraphs(' '),/Complete/)})
test('manual section headings, columns, motion and explicit CTA remain declarative',async()=>{const ctx=nativeDraftContext(),o=options();o.sections=[{source_key:'copy',component:'feature_grid',motion:'reveal',heading:'A considered approach'}];const m=await prepareWebsiteNativeManifest(ctx,o);const rendered=await compileWebsiteNativeDesign(m);assert.match(rendered.blocks,/wp:columns/);assert.match(rendered.blocks,/A considered approach/);o.sections[0].component='call_to_action';await assert.rejects(prepareWebsiteNativeManifest(ctx,o));o.cta_path='/contact';assert.equal((await prepareWebsiteNativeManifest(ctx,o)).content.sections[0].action.label,'Contact')})
test('Chat proposal review is bound to exact selected sources and rejects unknown or omitted fields',async()=>{const ctx=nativeDraftContext(),o=options();assert.match(websiteLayoutPrompt(ctx.review_sha256,o),/I will review/);const value={schema_version:1,binding_key:ctx.review_sha256,template:'service',sections:o.sections};assert.deepEqual(readWebsiteLayoutProposal('```json\n'+JSON.stringify(value)+'\n```',ctx.review_sha256,['copy']),{template:'service',sections:o.sections});for(const alter of [v=>v.binding_key='old',v=>v.sections=[],v=>v.sections.push(v.sections[0]),v=>v.publish=true]){const v=structuredClone(value);alter(v);assert.throws(()=>readWebsiteLayoutProposal(JSON.stringify(v),ctx.review_sha256,['copy']))}const v={...value,sections:[{source_key:'copy',component:'raw_html',motion:'none'}]};await assert.rejects(prepareWebsiteNativeManifest(ctx,{...o,...readWebsiteLayoutProposal(JSON.stringify(v),ctx.review_sha256,['copy'])}),/Unsupported/)})

test('numbered saved copy becomes six bound sections with exact headings, paragraphs, features and both Hero links',async()=>{
 const ctx=nativeDraftContext();ctx.content_page.draft_copy=numberedCopy();const raw=ctx.content_page.draft_copy,layout=websiteNativeLayout(ctx),m=await prepareWebsiteNativeManifest(ctx,layout),rendered=await compileWebsiteNativeDesign(m)
 assert.equal(ctx.content_page.draft_copy,raw);assert.equal(m.sources.content.checksum,ctx.content_version.content_checksum)
 assert.deepEqual(m.content.sections.map(s=>s.key),['hero','services','selected-work','how-we-work','faqs','contact'])
 assert.equal(m.content.sections[0].heading,'Connected work.');assert.equal(m.content.sections[1].items[0].body,'Identity and visual design.')
 assert.equal(m.content.sections.filter(s=>s.action?.label==='Connect with Anka').length,6)
 assert.equal(m.content.sections[0].secondary_action.path,'#selected-work');assert.equal(rendered.compiler_version,3)
 assert.equal((rendered.blocks.match(/<h1\b/g)||[]).length,1);assert.match(rendered.blocks,/<h1[^>]*>Connected work\.<\/h1>/)
 assert.match(rendered.blocks,/id="selected-work"/);assert.match(rendered.blocks,/href="#selected-work">Explore our work/)
 assert.match(rendered.blocks,/Keep this introduction before the cards\./);assert.match(rendered.blocks,/An exact introduction &amp; audience\./)
 assert.doesNotMatch(rendered.blocks,/\*\*|##|Section anchor/);assert.deepEqual(await verifyWebsiteNativeManifest(ctx,m),m)
})

test('structured source changes, forged text, forged secondary links and missing sections cannot pass rehashed verification',async()=>{
 const ctx=nativeDraftContext();ctx.content_page.draft_copy=numberedCopy();const layout=websiteNativeLayout(ctx)
 for(const change of [m=>m.content.sections[0].paragraphs[0]='Invented claim',m=>m.content.sections[0].secondary_action.path='https://elsewhere.org/',m=>m.content.sections[1].items[0].body='Altered service']){
  const m=await prepareWebsiteNativeManifest(ctx,layout);change(m);m.snapshot_checksums.content=await websiteNativeSnapshotChecksum(m.content);await assert.rejects(verifyWebsiteNativeManifest(ctx,m),/selected exact source/)
 }
 await assert.rejects(prepareWebsiteNativeManifest(ctx,{...layout,sections:layout.sections.slice(1)}),/omission/)
 await assert.rejects(prepareWebsiteNativeManifest(ctx,{...layout,cta_path:'/substituted'}),/exact saved Content/)
 const m=await prepareWebsiteNativeManifest(ctx,layout);ctx.content_page.draft_copy=numberedCopy().replace('Connected work.','Changed heading.');await assert.rejects(verifyWebsiteNativeManifest(ctx,m),/selected exact source/)
})

test('unsupported structured syntax, ambiguous numbering, anchors and unsafe links fail without silently discarding copy',()=>{
 for(const copy of [numberedCopy().replace('## 2.','## 3.'),numberedCopy().replace('`services`','`other`'),numberedCopy().replace('An exact introduction & audience.','<script>alert(1)</script>'),numberedCopy().replace('An exact introduction & audience.','[unexpected](https://elsewhere.org/)'),numberedCopy().replace('https://ankasphere.com/contact-anka-sphere/','javascript:alert'),numberedCopy()+'\n\nHidden after action',numberedCopy().replace('#### Branding','#### Branding\n#### Empty')])assert.throws(()=>nativeWebsiteCopySections(copy))
 assert.equal(nativeWebsiteCopySections('Plain legacy copy'),null)
})

test('all secondary anchors are checked and legacy numbered copy remains verifiable as its original flat manifest',async()=>{
 const ctx=nativeDraftContext();ctx.content_page.draft_copy=numberedCopy()
 const old=await prepareWebsiteNativeManifest(ctx,options());assert.equal(old.content.format,undefined);assert.equal(old.content.sections.length,1);assert.deepEqual(await verifyWebsiteNativeManifest(ctx,old),old)
 const structured=await prepareWebsiteNativeManifest(ctx,websiteNativeLayout(ctx));structured.content.sections[0].secondary_action.path='#missing';structured.snapshot_checksums.content=await websiteNativeSnapshotChecksum(structured.content);await assert.rejects(compileWebsiteNativeDesign(structured),/Anchor target/)
})

test('actual Website workspace loads and reviews all six source sections, retains sections on discard, and saves the exact reviewed manifest',async t=>{
 const ctx=nativeDraftContext();ctx.content_page.draft_copy=numberedCopy()
 const env=mountedEnvironment(),names=['window','document','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(names.map(k=>[k,globalThis[k]])),storage=new Map(),calls=[]
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const row=(version,title)=>({artifact:{title},version:{id:version,version_number:1}})
 const repository={workspace:async()=>({sites:[{id:id(8),site:ctx.site_version.site,version_number:1}],designs:[]}),source:async()=>ctx,saveDesign:async input=>{calls.push(input);return {version_number:1}}}
 const nativeRequire=createRequire(import.meta.url),source=readFileSync(new URL('../components/DesignWebsiteWorkspace.jsx',import.meta.url),'utf8'),code=transformSync(source,{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code,module={exports:{}}
 new Function('require','module','exports','React',code)(name=>{
  if(name.endsWith('.css'))return {}
  if(name.endsWith('/websiteNative.js'))return {websiteNative:repository}
  if(name.includes('projectWebsitePages'))return {projectWebsitePages:{list:async()=>({reference:{},pages:[{page_id:id(4),source:{title:'Home',path:''}}],counts:{filtered_total:1}})}}
  if(name.includes('websiteDesignSources'))return {websiteArchitectureOptions:()=>[row(id(5),'Architecture')],websiteContentOptions:()=>[row(id(6),'Home copy')],bindWebsiteContentSource:()=>true}
  if(name.includes('designIdentityReferences'))return {approvedDesignSystemReferences:()=>[]}
  if(name.includes('websiteNativeDraft'))return {prepareWebsiteNativeManifest,websiteNativeLayout,readWebsiteLayoutProposal,websiteLayoutPrompt}
  if(name.includes('websiteNativeDesign'))return {compileWebsiteNativeDesign,WEBSITE_NATIVE_TEMPLATES:['home']}
  return nativeRequire(name)
 },module,module.exports,React)
 const root=createRoot(env.container),Component=module.exports.default
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 await act(async()=>{root.render(React.createElement(Component,{workspace:{approvals:[{artifact_version_id:id(5),decision:'approved'}]},brief:{current_version_id:id(7)},confirmed:{id:id(7),version_number:1,content:{title:'Homepage',output_type:'website'}},organizationId:id(1),userId:id(20),engagement:{id:id(3),project_id:id(2)},canSave:true}));await new Promise(r=>setTimeout(r,0))})
 const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))],select=name=>elements(env.container,'select').find(n=>props(n)['aria-label']===name),button=name=>elements(env.container,'button').find(n=>n.textContent===name)
 for(const [label,value]of [['Approved architecture',id(5)],['Registered page',id(4)],['Exact Content version',id(6)],['Site settings version',id(8)]])await act(async()=>{props(select(label)).onChange({target:{value}});await new Promise(r=>setTimeout(r,0))})
 await act(async()=>{await props(button('Load selected page sources')).onClick();await new Promise(r=>setTimeout(r,0))})
 assert.equal(elements(env.container,'select').filter(n=>props(n)['aria-label']==='Content layout').length,6)
 assert.equal(props(elements(env.container,'input').find(n=>props(n).placeholder==='https://ankasphere.com/contact-anka-sphere/')).disabled,true)
 await act(async()=>{props(button('Discard local layout edits')).onClick();await new Promise(r=>setTimeout(r,0))})
 assert.equal(elements(env.container,'select').filter(n=>props(n)['aria-label']==='Content layout').length,6)
 for(let i=0;i<30&&props(button('Review Website draft')).disabled;i++)await act(async()=>{await new Promise(r=>setTimeout(r,10))})
 assert.equal(props(button('Review Website draft')).disabled,false)
 await act(async()=>{await props(button('Review Website draft')).onClick()});assert.equal(calls.length,0)
 await act(async()=>{await props(button('Save Website draft version')).onClick()})
 assert.equal(calls.length,1);assert.equal(calls[0].manifest.content.sections.length,6);assert.equal(calls[0].manifest.content.sections[0].secondary_action.path,'#selected-work')
})
