import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectMarketingPagePlanning} from './projectMarketingPagePlanning.js'
const id=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0')
const scope={actorId:id(1),organizationId:id(2),projectId:id(3),engagementId:id(4),brandId:id(5),pageId:id(6),architectureVersionId:id(7)}
const clone=v=>JSON.parse(JSON.stringify(v))
function fixture(){
 const context={organization_id:scope.organizationId,project_id:scope.projectId,engagement_id:scope.engagementId,brand_id:scope.brandId,page_id:scope.pageId,architecture_version_id:scope.architectureVersionId,page_key:'home',source_state:'available',planned_page:{title:'Home',path:'/'},tracked_page:{id:id(8)},reporting_binding_id:null,provider_request_made:false,provider_observations_ready:false,legacy_provider_metrics_withheld:true,recheck_reasons:['legacy_observation_not_version_bound']}
 const current={organization_id:scope.organizationId,project_id:scope.projectId,page_id:scope.pageId,revision:1,strategy_version_id:id(9),source_checksum:'a'.repeat(64),targets:[{keyword_index:0,role:'primary',cluster:'Local',source:{term:'Example',locale:null,evidence_source:null,observation_date:null}}]}
 const f={context,current,revision:1,calls:[],actor:scope.actorId,error:null,more:false,hook:null,audits:[],queries:[]}
 const client={auth:{async getUser(){return {data:{user:{id:f.actor}}}}},rpc:async(name,args)=>{
  f.calls.push({name,args});if(f.hook)await f.hook(name,args)
  if(f.error)return {error:f.error}
  if(name==='read_project_page_keyword_targets')return {data:clone({page_id:scope.pageId,measurement_kind:'planned_target',revision:f.revision,current:f.current})}
  assert.equal(name,'list_project_website_page_seo_observations')
  const items=args.p_category==='page_audits'?f.audits:f.queries
  return {data:clone({context:f.context,category:args.p_category,items,total:items.length,matching:items.length,offset:0,has_more:f.more,provider_request_made:false,provider_period_known:false})}
 }}
 f.api=createProjectMarketingPagePlanning(client);f.api.select(scope);return f
}
test('exact asset reads canonical RPCs and prepares only an explicitly reviewed local plan',async()=>{
 const f=fixture(),review=await f.api.review();assert.equal(review.page.id,scope.pageId);assert.equal(review.targeting.targets[0].measurement_kind,'planned_target')
 await assert.rejects(f.api.preparePlanningSeed(review),/Explicit review/)
 const plan=await f.api.preparePlanningSeed(review,{confirmed:true})
 assert.equal(plan.official,false);assert.equal(plan.measurement_value,null);assert.deepEqual(plan.channels,[]);assert.equal(plan.publication_authorized,false)
 assert.deepEqual([...new Set(f.calls.map(c=>c.name))].sort(),['list_project_website_page_seo_observations','read_project_page_keyword_targets'])
 assert.ok(f.calls.every(c=>c.args.p_page_id===scope.pageId&&c.args.p_project_id===scope.projectId));assert.ok(Object.isFrozen(plan.source_review))
})
test('unknown evidence and empty targeting stay unknown, never zero observations',async()=>{
 const f=fixture();f.revision=0;f.current=null;const r=await f.api.review();assert.equal(r.targeting.strategy_version_id,null);assert.deepEqual(r.targeting.targets,[]);assert.equal(r.limitations.provider_metrics,'withheld');assert.equal(r.limitations.provider_period,'unknown');assert.deepEqual(r.evidence.map(e=>e.items),[[],[]])
})
test('manual false is retained as historical evidence without current-version attribution',async()=>{
 const f=fixture();f.audits=[{id:id(10),organization_id:scope.organizationId,tracked_page_id:id(8),source_type:'manual',indexed:false,schema_valid:null,audit_date:'2026-11-01'}]
 const r=await f.api.review();assert.equal(r.evidence[0].items[0].indexed,false);assert.equal(r.evidence[0].items[0].schema_valid,null);assert.equal(r.evidence[0].items[0].version_binding,'unknown')
})
test('legacy query metric claims fail closed through existing canonical repository',async()=>{
 const f=fixture();f.queries=[{id:id(10),organization_id:scope.organizationId,tracked_page_id:id(8),record_kind:'query_observation',position:0,search_console_clicks:null,search_console_impressions:null,period_start:null,period_end:null,metrics_withheld_reason:'legacy_resource_provenance_unknown'}];await assert.rejects(f.api.review(),/cannot infer provider/)
})
test('cross-project, wrong architecture, brand and absent source cannot be planned',async()=>{
 for(const change of [{project_id:id(99)},{architecture_version_id:id(99)},{brand_id:id(99)},{source_state:'approved_source_unavailable'}]){const f=fixture();Object.assign(f.context,change);await assert.rejects(f.api.review(),/scope changed|context changed/)}
})
test('denied access remains an error, not empty evidence or a reusable review',async()=>{
 const f=fixture();f.error={code:'42501',message:'Access denied'};await assert.rejects(f.api.review(),e=>e.code==='42501');await assert.rejects(f.api.preparePlanningSeed({}, {confirmed:true}),/Explicit review/)
})
test('actor session changes deny results and clear snapshot eligibility',async()=>{
 const f=fixture();const r=await f.api.review();f.actor=id(99);await assert.rejects(f.api.preparePlanningSeed(r,{confirmed:true}),/access denied/)
})
test('changed scope invalidates an in-flight response and prior review',async()=>{
 const f=fixture();let release,started;const reached=new Promise(r=>{started=r});const gate=new Promise(r=>{release=r});f.hook=async()=>{started();await gate}
 const pending=f.api.review();await reached;f.api.select({...scope,pageId:id(99)});release();await assert.rejects(pending,/context changed/)
})
test('target revision changed after review requires a new explicit review',async()=>{
 const f=fixture(),r=await f.api.review();f.current.revision=2;f.revision=2;await assert.rejects(f.api.preparePlanningSeed(r,{confirmed:true}),/changed; review again/);await assert.rejects(f.api.preparePlanningSeed(r,{confirmed:true}),/Explicit review/)
})
test('target drift during composite read is rejected',async()=>{
 const f=fixture();let reads=0;f.hook=async name=>{if(name==='read_project_page_keyword_targets'&&++reads===2){f.revision=2;f.current.revision=2}};await assert.rejects(f.api.review(),/changed during review/)
})
test('aborted review and copied review objects cannot authorize local handoff',async()=>{
 const f=fixture(),abort=new AbortController();abort.abort();await assert.rejects(f.api.review({signal:abort.signal}),/context changed/);const r=await f.api.review();await assert.rejects(f.api.preparePlanningSeed(clone(r),{confirmed:true}),/Explicit review/)
})
test('paged evidence is explicitly incomplete and bounded; response objects are detached',async()=>{
 const f=fixture();f.more=true;const r=await f.api.review();assert.equal(r.limitations.history_complete,false);assert.ok(f.calls.filter(c=>c.name.startsWith('list_')).every(c=>c.args.p_limit===25));f.context.planned_page.title='Changed';assert.equal(r.page.title,'Home')
})
test('changed SEO association invalidates confirmation even when both pages have no evidence',async()=>{
 const f=fixture(),r=await f.api.review();f.context.tracked_page.id=id(90);await assert.rejects(f.api.preparePlanningSeed(r,{confirmed:true}),/changed; review again/)
})
