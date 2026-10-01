import test from 'node:test'
import assert from 'node:assert/strict'
import {readWebsiteArchitectureIdentities,serializeApprovedArchitectureBinding,serializeWebsitePageOperations,serializeWebsitePageUrl,reconcileRegisteredWebsitePageIdentity} from './projectWebsitePageContracts.js'
const uuid=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const page=(n,parent=null)=>({page_key:`page:${uuid(n)}`,slug:n===1 ? 'home' : `section/page-${n}`,title:`Page ${n}`,parent_page_key:parent,page_type:n===1 ? 'hub' : 'supporting',purpose:'Website page',sections:[{section_key:`section:${uuid(n)}`,heading:'Approved section',purpose:'Inform',cta:null}],conversion_action:{kind:'none',text:null},source_version_ids:[uuid(40)],keyword_strategy_version_id:uuid(41)})
const pages=Array.from({length:101},(_,n)=>page(n+1,n ? `page:${uuid(1)}` : null))
const engagement={id:uuid(3),organization_id:uuid(1),project_id:uuid(2),brand_id:uuid(4)},artifact={id:uuid(5),organization_id:uuid(1),project_id:uuid(2),engagement_id:uuid(3),brand_id:uuid(4),artifact_type:'website_architecture'},version={id:uuid(6),organization_id:uuid(1),artifact_id:uuid(5),content_checksum:'a'.repeat(64),content:{schema_version:2,pages}},approval={id:uuid(7),organization_id:uuid(1),artifact_id:uuid(5),artifact_version_id:uuid(6),engagement_id:uuid(3),decision:'approved'}
const binding=()=>serializeApprovedArchitectureBinding({organizationId:uuid(1),projectId:uuid(2),engagement,artifact,version,approval})
const operation={planned_url:'https://EXAMPLE.com/new-page',recorded_live_url:null,redirect_url:null,publication_state:'planned',template:'Standard page',work_item_id:null,implementation_notes:'Use the approved structure',qa_evidence:''}
test('101-page exact architecture decoder keeps stable keys, hierarchy and original section/CTA/source metadata untouched',()=>{
 const original=structuredClone(version),rows=readWebsiteArchitectureIdentities(version.content);assert.equal(rows.length,101);assert.equal(rows[100].parent_page_key,pages[0].page_key);assert.deepEqual(rows[100].source_page.sections,pages[100].sections);assert.deepEqual(rows[100].source_page.conversion_action,pages[100].conversion_action);assert.deepEqual(rows[100].source_page.source_version_ids,pages[100].source_version_ids);assert.deepEqual(version,original);assert.equal(binding().page_keys.length,101)
})
test('invalid duplicate paths/keys, missing parents, cycles and legacy parent ambiguity are rejected',()=>{
 for(const source of [[page(1),page(1)],[page(1),{...page(2),slug:'HOME'}],[page(1,`page:${uuid(99)}`)],[page(1,`page:${uuid(2)}`),page(2,`page:${uuid(1)}`)],[{...page(1),parent_slug:'missing'}],[page(1),{...page(2),parent_page_key:`page:${uuid(1)}`,parent_slug:'section/page-2'}]])assert.throws(()=>readWebsiteArchitectureIdentities({pages:source}))
 assert.throws(()=>readWebsiteArchitectureIdentities({pages:[{...page(1),slug:'../unsafe'}]}));assert.throws(()=>readWebsiteArchitectureIdentities({pages:[]}))
})
test('exact binding rejects another org/project/brand/root, unapproved version and unresolved governed approval',()=>{
 for(const changes of [{projectId:uuid(99)},{artifact:{...artifact,brand_id:uuid(99)}},{version:{...version,artifact_id:uuid(99)}},{approval:{...approval,artifact_version_id:uuid(99)}},{approval:{...approval,decision:'rejected'}},{approvalRequest:{organization_id:uuid(1),artifact_version_id:uuid(6),status:'pending'}}])assert.throws(()=>serializeApprovedArchitectureBinding({organizationId:uuid(1),projectId:uuid(2),engagement,artifact,version,approval,...changes}),/Exact same-project/)
})
test('new approved architecture path retains registered page identity and original path; roots never merge',()=>{
 const registered={id:uuid(50),organization_id:uuid(1),project_id:uuid(2),engagement_id:uuid(3),architecture_artifact_id:uuid(5),page_key:pages[0].page_key,initial_path:'home'}
 const renamed={...readWebsiteArchitectureIdentities(version.content)[0],path:'welcome'};const next=reconcileRegisteredWebsitePageIdentity(registered,binding(),renamed);assert.equal(next.initial_path,'home');assert.equal(next.current_planned_path,'welcome');assert.equal(next.page_id,registered.id);assert.throws(()=>reconcileRegisteredWebsitePageIdentity(registered,{...binding(),architecture_artifact_id:uuid(99)},renamed),/cannot silently merge/)
})
test('legacy path-derived keys are explicit and do not become URL identities',()=>{
 const rows=readWebsiteArchitectureIdentities({pages:[{slug:'home',title:'Home',page_type:'hub'},{slug:'home/contact',title:'Contact',page_type:'supporting',parent_slug:'home'}]});assert.deepEqual(rows.map(row=>[row.page_key,row.parent_page_key]),[['legacy:home',null],['legacy:home/contact','legacy:home']]);assert.throws(()=>readWebsiteArchitectureIdentities({pages:[{slug:'contact',title:'Contact',page_type:'supporting',parent_slug:'home'}]}),/Legacy parent path is missing/)
})
test('operational serializer is named, bounded and does not grant assignment or external publishing authority',()=>{
 assert.equal(serializeWebsitePageOperations(operation).planned_url,'https://example.com/new-page');assert.throws(()=>serializeWebsitePageOperations({...operation,owner_id:uuid(3)}),/assignment fields/);assert.throws(()=>serializeWebsitePageOperations({...operation,due_date:'2026-10-02'}));assert.throws(()=>serializeWebsitePageOperations({...operation,publication_state:'published'}),/live URL/);assert.throws(()=>serializeWebsitePageOperations({...operation,implementation_notes:'x'.repeat(4001)}));assert.equal(serializeWebsitePageOperations({...operation,recorded_live_url:'https://example.com/old',redirect_url:'https://example.com/new',publication_state:'published'}).redirect_url,'https://example.com/new')
})
test('URL serializer rejects credentials, unsupported protocols, query/fragment and raw/encoded traversal without performing requests',()=>{
 for(const url of ['javascript:alert(1)','//example.com/x','https://user:password@example.com/x','https://example.com/x?q=secret','https://example.com/x#fragment','https://example.com/../x','https://example.com/%2e%2e/x','https://example.com/\\x'])assert.throws(()=>serializeWebsitePageUrl(url));assert.equal(serializeWebsitePageUrl(null),null);assert.equal(serializeWebsitePageUrl('http://localhost:3000/page'),'http://localhost:3000/page')
})

test('implementation/QA evidence preserves bounded multiline instructions and planned paths reject URL identities',()=>{
 const value={...operation,implementation_notes:'Implement the approved sections\nKeep the current hierarchy',qa_evidence:'Keyboard pass\nMobile review pending'};assert.equal(serializeWebsitePageOperations(value).implementation_notes,value.implementation_notes);assert.throws(()=>readWebsiteArchitectureIdentities({pages:[{...page(1),slug:'https://example.com/page'}]}));assert.throws(()=>serializeApprovedArchitectureBinding({organizationId:uuid(1),projectId:uuid(2),engagement:{...engagement,brand_id:undefined},artifact:{...artifact,brand_id:undefined},version,approval}),/Brand must/)
})

test('legacy normalization disagreements require explicit approved stable-key reconciliation',()=>{
 for(const slug of ['home / contact','ｈｏｍｅ'])assert.throws(()=>readWebsiteArchitectureIdentities({pages:[{slug,title:'Home',page_type:'hub'}]}),/Legacy normalization differs/)
 assert.equal(readWebsiteArchitectureIdentities({pages:[{slug:'home / contact',page_key:'page:explicit',title:'Home',page_type:'hub'}]})[0].page_key,'page:explicit')
})
