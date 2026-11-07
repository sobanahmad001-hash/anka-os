import test from 'node:test'
import assert from 'node:assert/strict'
import {PROJECT_STAGE_PHASES,projectStagePlan,summarizeProjectStageSteps} from './projectStagePlan.js'
const id=n=>'dd000000-0000-4000-8000-'+String(n).padStart(12,'0')
const scope={organization_id:id(1),project_id:id(2),engagement_id:id(3)}
const header=()=>({...scope,state:'available',plan_id:id(4),plan_version:2,can_manage:true,groups:[{id:id(5),configuration_current:true,kind:'website',publication_id:id(6),steps:[{key:'copy'}]}],bindings:[{group_id:id(5),publication_id:id(6),step_key:'copy',phase:'website.content'}]})
const item=(extra={})=>({instance:1,work_item_id:id(7),work_required:true,work_done:true,work_status:'done',output:{artifact_id:id(8),artifact_version_id:id(9),version_number:1,artifact_type:'content',approval_id:id(10),content_checksum:'a'.repeat(64)},output_approved:true,material_current:true,needs_update:false,dependency_blocked:false,missing_work:false,...extra})
const step=(extra={})=>({key:'copy',label:'Page copy',phase:'website.content',action:'run',items:[item()],...extra})
const unit=(extra={})=>({...scope,plan_id:id(4),group_id:id(5),partition:{kind:'website_page',id:id(11),architecture_version_id:id(12)},state:'current',context_sha256:'b'.repeat(64),page:{initial_path:'home'},steps:[step()],...extra})
const content=p=>p.tracks.find(t=>t.id==='website').stages.find(s=>s.id==='website.content')
test('approved taxonomy keeps all requested phases distinct and unconfigured without a saved plan',()=>{
 assert.equal(PROJECT_STAGE_PHASES.length,21)
 const h={...header(),state:'unconfigured',plan_id:null,groups:[],bindings:[]}
 assert.ok(projectStagePlan(h).tracks.flatMap(t=>t.stages).every(s=>!s.configured&&s.status===null&&s.progress===null))
})
test('exact required Work and output approval produce current completion for one page',()=>{
 const s=content(projectStagePlan(header(),[unit()]))
 assert.equal(s.status,'done');assert.deepEqual(s.progress,{completed:1,total:1,label:'current required items complete',approved:1})
 assert.equal(s.items[0].context.partition.id,id(11));assert.match(s.scopeLabel,/not a whole-project total/)
})
test('seventy pages do not block the selected homepage or inflate its count',()=>{
 const h=header();h.registered_page_count=70
 const s=content(projectStagePlan(h,[unit()]))
 assert.equal(s.status,'done');assert.equal(s.progress.total,1)
 const other=unit({partition:{kind:'website_page',id:id(13),architecture_version_id:id(12)},page:{initial_path:'about'},steps:[step({items:[item({work_done:false,work_status:'in_progress',output:null,output_approved:false})]})]})
 const combined=content(projectStagePlan(h,[unit(),other]))
 assert.equal(combined.items[0].status,'done');assert.equal(combined.items[1].status,'in_progress');assert.equal(combined.progress.completed,1);assert.equal(combined.progress.total,2)
})
test('done Work without exact approval remains in review, retaining output identity',()=>{
 const s=summarizeProjectStageSteps([step({items:[item({output_approved:false})]})])
 assert.equal(s.status,'in_review');assert.equal(s.progress.completed,0);assert.equal(s.outputs[0].versionId,id(9))
})
test('approved output without completed required Work is not Done',()=>{
 assert.notEqual(summarizeProjectStageSteps([step({items:[item({work_done:false,work_status:'in_progress'})]})]).status,'done')
})
test('uncreated required slots are Not started; cancelled tasks cannot count as completed',()=>{
 const missing=item({work_item_id:null,work_done:false,work_status:null,output:null,output_approved:false,material_current:false})
 assert.equal(summarizeProjectStageSteps([step({items:[missing]})]).status,'not_started')
 const cancelled=item({work_done:false,work_status:'cancelled'})
 assert.equal(summarizeProjectStageSteps([step({items:[cancelled]})]).progress.completed,0)
})
test('reuse is an approved material requirement, never a fabricated completed Work card',()=>{
 const s=summarizeProjectStageSteps([step({action:'reuse',items:[item({work_item_id:null,work_required:false,work_done:false})]})])
 assert.equal(s.status,'done');assert.equal(s.progress.completed,1)
})
test('omit and outside-scope preserve reasons without inventing completion',()=>{
 const s=summarizeProjectStageSteps([step({action:'omit',reason:'Not needed for this service',items:[]})])
 assert.equal(s.status,null);assert.equal(s.progress,null);assert.equal(s.excluded[0].reason,'Not needed for this service')
})
test('upstream changes flag review while retaining exact approved output and history',()=>{
 const s=summarizeProjectStageSteps([step({items:[item({needs_update:true})]})])
 assert.equal(s.status,'in_review');assert.equal(s.needsUpdate,true);assert.equal(s.progress.completed,0);assert.equal(s.progress.approved,1);assert.equal(s.outputs[0].approved,true)
})
test('changed material, blocked prerequisite and missing Work cannot be Done',()=>{
 for(const delta of [{material_current:false},{dependency_blocked:true},{missing_work:true},{work_status:'blocked',work_done:false}]){
  assert.notEqual(summarizeProjectStageSteps([step({items:[item(delta)]})]).status,'done')
 }
})
test('unavailable sources suppress counts without discarding retained recorded outputs',()=>{
 const s=content(projectStagePlan(header(),[unit({state:'temporarily_unavailable'})]))
 assert.equal(s.status,'blocked');assert.equal(s.progress,null);assert.equal(s.items[0].context,null);assert.equal(s.outputs[0].versionId,id(9))
})
test('missing mapped step evidence cannot create a false zero-of-zero completion',()=>{
 const s=content(projectStagePlan(header(),[unit({steps:[]})]))
 assert.equal(s.status,'blocked');assert.equal(s.progress,null)
})
test('foreign scope, stale plan and duplicate partitions are rejected',()=>{
 for(const delta of [{project_id:id(90)},{organization_id:id(90)},{engagement_id:id(90)},{plan_id:id(90)},{group_id:id(90)}])assert.throws(()=>projectStagePlan(header(),[unit(delta)]),/another exact/)
 assert.throws(()=>projectStagePlan(header(),[unit(),unit()]),/Duplicate/)
})
test('forged approval without exact approval ID or checksum fails closed',()=>{
 for(const delta of [{approval_id:null},{content_checksum:'unknown'},{version_number:0}]){
  const output={...item().output,...delta}
  assert.throws(()=>projectStagePlan(header(),[unit({steps:[step({items:[item({output})]})]})]),/Approved output/)
 }
})
test('unknown, duplicate and incompatible required-slot shapes are rejected',()=>{
 for(const steps of [[step(),step()],[step({action:'guess'})],[step({items:[]})],[step({items:[item(),item()]})],[step({action:'reuse'})],[step({action:'omit'})]]){
  assert.throws(()=>projectStagePlan(header(),[unit({steps})]))
 }
})
test('bindings do not adopt a changed published definition or infer a phase from a label',()=>{
 const h=header();h.bindings[0].publication_id=id(90)
 assert.equal(content(projectStagePlan(h,[unit()])).configured,false)
 h.bindings=[];assert.equal(content(projectStagePlan(h,[unit()])).configured,false)
})
test('page keyword intent remains linked to exact targeting revision and measured association',()=>{
 const keywords={revision:3,strategy_version_id:id(20),source_checksum:'c'.repeat(64),targets:[{keyword_index:0,role:'primary',cluster:'Planning',source:{term:'project planning',intent:'commercial'}}]}
 const association={tracked_page_id:id(21),link_number:2}
 const item=content(projectStagePlan(header(),[unit({keywords,performance_association:association})])).items[0]
 assert.deepEqual(item.keywords,['project planning']);assert.equal(item.intent,'commercial');assert.deepEqual(item.keywordTargets,keywords);assert.deepEqual(item.performanceAssociation,association)
})


test('loaded omitted phases remain available and do not suppress other required partitions',()=>{
 for(const action of ['omit','outside_scope']){
  const excluded=unit({steps:[step({action,reason:'Reviewed exclusion',items:[]})]})
  const alone=content(projectStagePlan(header(),[excluded]))
  assert.equal(alone.status,null);assert.equal(alone.progress,null)
  assert.equal(alone.excluded[0].reason,'Reviewed exclusion');assert.ok(alone.context)
  const required=unit({partition:{kind:'website_page',id:id(13),architecture_version_id:id(12)}})
  const mixed=content(projectStagePlan(header(),[excluded,required]))
  assert.equal(mixed.status,'done');assert.equal(mixed.progress.total,1);assert.equal(mixed.progress.completed,1)
  const unavailable=content(projectStagePlan(header(),[excluded,{...required,state:'temporarily_unavailable'}]))
  assert.equal(unavailable.status,'blocked');assert.equal(unavailable.progress,null)
 }
})
