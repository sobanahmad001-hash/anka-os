import assert from 'node:assert/strict'
import test from 'node:test'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
const org='a0000000-0000-4000-8000-000000000001',actor='a0000000-0000-4000-8000-000000000002',engagement='a0000000-0000-4000-8000-000000000003',website='a0000000-0000-4000-8000-000000000004',marketing='a0000000-0000-4000-8000-000000000005',preset='a0000000-0000-4000-8000-000000000006'
const props=node=>node?.[Object.keys(node).find(key=>key.startsWith('__reactProps$'))]
async function mount(t,{lost=false,initialStorage=new Map(),panel='configuration',hideRecent=false,stages=false,declared=false,initialRunRows=[]}={}) {
 const records={available:[],publishedDefinitions:[{id:'a0000000-0000-4000-8000-000000000007',definition:{name:'Published Website',version_number:1,preset_publication_id:preset,steps:[]}}],groups:[{id:website,name:'Website',kind:'website',preset_publication_id:preset},{id:marketing,name:'Marketing',kind:'marketing',preset_publication_id:preset}],configurations:[{id:'legacy',revision:9,selected_steps:[{key:'Legacy',quantity:1}],max_ai_cost_microusd:0},{id:'web',pipeline_group_id:website,revision:10,group_revision:2,selected_steps:[{key:'Website',quantity:1}],max_ai_cost_microusd:0},{id:'mkt',pipeline_group_id:marketing,revision:11,group_revision:3,selected_steps:[{key:'Marketing',quantity:1}],max_ai_cost_microusd:0}],activations:[{configuration_id:'mkt',pipeline_group_id:marketing,activation_number:11,group_activation_number:3},{configuration_id:'legacy',activation_number:9},{configuration_id:'web',pipeline_group_id:website,activation_number:10,group_activation_number:2}]}
 if(stages)records.publishedDefinitions[0].definition.steps=[{key:'brief',label:'Project brief',kind:'human',department_id:'content',service_id:preset,depends_on:[]},{key:'draft',label:'Draft copy',kind:'human',department_id:'content',service_id:preset,depends_on:['brief']}]
 if(declared){
  records.publishedDefinitions[0].definition.steps=[{key:'brief',label:'Project brief',kind:'human',department_id:'content',service_id:preset,depends_on:[],stage_contract:{optional:false,output_label:'Approved launch article',reuse_allowed:true,artifact_type:'content',output_type:'blog_article',required_inputs:[{key:'audience',label:'Audience',kind:'manual'}]}},{key:'draft',label:'Draft copy',kind:'human',department_id:'content',service_id:preset,depends_on:['brief'],stage_contract:{optional:false,output_label:'Page copy',reuse_allowed:false,required_inputs:[{key:'article',label:'Approved source',kind:'approved_artifact',artifact_type:'content',output_type:'blog_article'}]}},{key:'proof',label:'Additional proof',kind:'human',department_id:'content',service_id:preset,depends_on:['brief'],stage_contract:{optional:true,output_label:'Proof notes',reuse_allowed:false,required_inputs:[]}}]
 }
 const artifact={artifact_id:'a0000000-0000-4000-8000-000000000030',artifact_version_id:'a0000000-0000-4000-8000-000000000031',version_number:2,title:'Approved launch source',artifact_type:'content',output_type:'blog_article',ai_use_allowed:false,approval_id:'a0000000-0000-4000-8000-000000000032',content_checksum:'a'.repeat(64)}
 const definitionCalls=[],definitionRecords={definitions:[],approvals:[],publications:[]}
 const definitionRepository={list:async()=>structuredClone(definitionRecords),create:async input=>{definitionCalls.push(structuredClone(input));if(gate)await gate;const row={id:input.requestId,request_id:input.requestId,created_by:actor,name:input.name,steps:input.steps,steps_sha256:'a'.repeat(64),preset_publication_id:input.presetPublicationId,version_number:1};definitionRecords.definitions.push(row);if(lost)throw new Error('Lost original definition response');return {definition_id:row.id,version_number:1}}}
 const configCalls=[]
 const calls=[],reads=[];let release=null,gate=null
 const repository={list:async(...args)=>{reads.push(args);return structuredClone(records)},createGroup:async input=>{calls.push(structuredClone(input));if(gate)await gate;const group={id:'a0000000-0000-4000-8000-000000000008',preset_publication_id:input.presetPublicationId,created_by:actor,kind:input.kind,name:input.name,request_id:input.requestId};records.groups.push(group);if(lost)throw new Error('Lost original response');return {group}}}
 repository.create=async input=>{configCalls.push(structuredClone(input));if(gate)await gate;const row={id:'a0000000-0000-4000-8000-000000000021',configured_by:actor,request_id:input.requestId,pipeline_group_id:input.pipelineGroupId,group_revision:3,revision:12,selected_steps:input.selectedSteps,max_ai_cost_microusd:input.maxAiCostMicrousd};records.configurations.push(row);if(lost)throw new Error('Lost original configuration response');return row}
 const runRows=structuredClone(initialRunRows),runCalls=[],runReads=[]
 const runRepository={list:async()=>hideRecent ? [] : structuredClone(runRows),findRequest:async input=>{runReads.push(input);return runRows.find(row=>row.request_id===input.requestId && row.requested_by===input.actorId)||null},start:async input=>{runCalls.push(input);if(gate)await gate;const row={id:'a0000000-0000-4000-8000-000000000020',request_id:input.requestId,requested_by:actor,pipeline_group_id:input.pipelineGroupId,status:'awaiting_review',requested_at:new Date().toISOString(),input_sha256:'a'.repeat(64),input_manifest:{pipeline:{version_id:preset},assets:[]}};runRows.push(row);if(lost)throw new Error('Lost run response');return {run_intent_id:row.id}}}
 repository.listStageArtifacts=async()=>({artifacts:[structuredClone(artifact)],offset:0,has_more:false});repository.listGroups=async()=>structuredClone(records.groups)
 const previousFixture=globalThis.__pipelineGroupFixture;globalThis.__pipelineGroupFixture={repository,runRepository,definitionRepository,actor}
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'isolated-pipeline-groups',enforce:'pre',resolveId(source){if(source.endsWith('/projectWebsiteSeoObservations.js'))return '\0website-seo-repository';if(source.endsWith('/projectCampaignPlanning.js'))return '\0campaign-planning-repository';if(source.endsWith('/projectReportingBindings.js'))return '\0reporting-bindings-repository';if(source.endsWith('/projectWebsitePages.js'))return '\0website-pages-repository';if(source.endsWith('/pipelineExecutionDefinitions.js'))return '\0definition-repository';if(source.endsWith('/projectPipelineConfigurations.js'))return '\0pipeline-repository';if(source.endsWith('/pipelineRunIntents.js'))return '\0run-repository';if(source.endsWith('/AuthContext.jsx'))return '\0pipeline-auth'},load(id){if(id==='\0website-seo-repository')return 'export const projectWebsiteSeoObservations={}';if(id==='\0campaign-planning-repository')return 'export const projectCampaignPlanning={}' ;if(id==='\0reporting-bindings-repository')return 'export const projectReportingBindings={}' ;if(id==='\0website-pages-repository')return 'export const projectWebsitePages={}' ;if(id==='\0definition-repository')return 'export const pipelineExecutionDefinitions=globalThis.__pipelineGroupFixture.definitionRepository';if(id==='\0pipeline-repository')return 'export const projectPipelineConfigurations=globalThis.__pipelineGroupFixture.repository';if(id==='\0run-repository')return 'export const pipelineRunIntents=globalThis.__pipelineGroupFixture.runRepository';if(id==='\0pipeline-auth')return 'export function useAuth(){return {user:{id:globalThis.__pipelineGroupFixture.actor}}}'}}]})
 const {default:Panel}=await server.ssrLoadModule(panel==='definition' ? '/src/components/PipelineExecutionDefinitionPanel.jsx' : panel==='run' ? '/src/components/PipelineRunIntentPanel.jsx' : '/src/components/ProjectPipelineConfigurationPanel.jsx'),env=mountedEnvironment(),storage=initialStorage
 const names=['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','sessionStorage','fetch'];const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));Object.assign(globalThis,{document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},fetch:()=>{throw new Error('Network forbidden')}})
 const root=createRoot(env.container);const render=async()=>act(async()=>root.render(createElement(Panel,{organizationId:org,engagement:{id:engagement,status:'active'},catalog:{publications:[{id:preset,pipeline_template_version_id:preset}],versions:[{id:preset,name:'Website',version_number:1}],selections:[{pipeline_template_version_id:preset,service_id:preset}]},services:panel==='definition' ? [{id:preset,name:'Content',department_id:'content',is_active:true}] : (stages || declared) ? [{service_id:preset,status:'active'}] : [],assets:[],membership:{role:'operations_admin'}})))
 t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,previous);globalThis.__pipelineGroupFixture=previousFixture})
 await render()
 const button=name=>elements(env.container,'button').find(node=>node.textContent===name),field=name=>['select','input','textarea'].flatMap(tag=>elements(env.container,tag)).find(node=>props(node)?.['aria-label']===name)
 const click=async name=>act(async()=>{const node=button(name);assert.ok(node,name);assert.notEqual(props(node).disabled,true);props(node).onClick()})
 const change=async(name,value)=>act(async()=>props(field(name)).onChange({target:{value}}))
 const prepare=async()=>{await change('Pipeline name','Second Website');await change('Independent pipeline preset',preset);await click('Review pipeline creation')}
 const previewDraft=async()=>act(async()=>{const form=elements(env.container,'form')[0];props(form).onSubmit({preventDefault(){}})})
 return {env,storage,records,artifact,calls,definitionCalls,definitionRecords,configCalls,previewDraft,reads,runCalls,runReads,runRows,button,field,click,change,prepare,setGate(){gate=new Promise(done=>{release=done})},release:async()=>act(async()=>release())}
}
test('actual panel selects Website, Marketing and Legacy independently with no latest-global fallback',async t=>{
 const ui=await mount(t);assert.match(ui.env.container.textContent,/Active revision 9 · Legacy/)
 await ui.change('Pipeline selection',website);assert.match(ui.env.container.textContent,/Active revision 2 · Website/);assert.doesNotMatch(ui.env.container.textContent,/Revision 3 · activated/)
 await ui.change('Pipeline selection',marketing);assert.match(ui.env.container.textContent,/Active revision 3 · Marketing/);assert.doesNotMatch(ui.env.container.textContent,/Revision 2 · activated/)
 await ui.change('Pipeline selection','');assert.match(ui.env.container.textContent,/Active revision 9 · Legacy/);assert.equal(ui.calls.length,0)
})
test('creation review writes nothing, edits invalidate it, and a double Confirm writes one scoped group',async t=>{
 const ui=await mount(t);await ui.prepare();assert.equal(ui.calls.length,0)
 await ui.change('Pipeline name','Edited Website');assert.equal(ui.button('Confirm independent pipeline'),undefined)
 await ui.click('Review pipeline creation');ui.setGate();const click=props(ui.button('Confirm independent pipeline')).onClick;await act(async()=>{void click();void click()});assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].organizationId,org);assert.equal(ui.calls[0].engagementId,engagement);assert.equal(ui.calls[0].name,'Edited Website');assert.equal(ui.calls[0].presetPublicationId,preset);assert.equal(ui.storage.size,1)
 await ui.release();assert.equal(ui.calls.length,1);assert.equal(ui.storage.size,0);assert.match(ui.env.container.textContent,/Choose steps and review activation separately/)
})
test('lost group response stays blocked until read-only exact immutable request recovery',async t=>{
 const ui=await mount(t,{lost:true});await ui.prepare();await ui.click('Confirm independent pipeline');assert.equal(ui.calls.length,1);assert.equal(ui.storage.size,1);assert.equal(props(ui.field('Pipeline selection')).disabled,true)
 const stored=[...ui.storage.values()][0];assert.equal(stored.includes('Second Website'),false);assert.equal(JSON.parse(stored).requestId,ui.calls[0].requestId)
 await ui.click('Refresh');assert.equal(ui.calls.length,1);assert.equal(ui.storage.size,0);assert.equal(props(ui.field('Pipeline selection')).disabled,false);assert.match(ui.env.container.textContent,/Original command recovered/)
})

test('reload with an unresolved original operation blocks new commands and never guesses another group',async t=>{
 const stored=new Map([[`anka-pipeline-command:${actor}:${org}:${engagement}`,JSON.stringify({kind:'group',requestId:'a0000000-0000-4000-8000-000000000009'})]])
 const ui=await mount(t,{initialStorage:stored});assert.equal(props(ui.field('Pipeline selection')).disabled,true);assert.equal(ui.calls.length,0);await ui.click('Refresh');assert.equal(ui.calls.length,0);assert.equal(ui.storage.size,1);assert.equal(props(ui.field('Pipeline selection')).disabled,true)
})

test('actual manual run selector binds the chosen Website group; double request pins one immutable review request',async t=>{
 const ui=await mount(t,{panel:'run'});await ui.change('Run pipeline',website);ui.setGate();const click=props(ui.button('Request manual run review')).onClick;await act(async()=>{void click();void click()});assert.equal(ui.runCalls.length,1);assert.equal(ui.runCalls[0].pipelineGroupId,website);assert.equal(ui.runCalls[0].organizationId,org);assert.equal(ui.runCalls[0].engagementId,engagement);assert.deepEqual(ui.runCalls[0].assetIds,[]);assert.equal(ui.storage.size,1)
 await ui.release();assert.equal(ui.runCalls.length,1);assert.equal(ui.storage.size,0);assert.match(ui.env.container.textContent,/Pipeline: Website/);assert.equal(ui.calls.length,0)
})
test('lost run response recovers the exact actor/request beyond recent history, with no duplicate or provider submission',async t=>{
 const ui=await mount(t,{panel:'run',lost:true,hideRecent:true});await ui.change('Run pipeline',marketing);await ui.click('Request manual run review');assert.equal(ui.runCalls.length,1);assert.equal(ui.storage.size,1);assert.equal(props(ui.field('Run pipeline')).disabled,true)
 await ui.click('Check original run request');assert.equal(ui.runCalls.length,1);assert.equal(ui.storage.size,0);assert.equal(ui.runReads.at(-1).actorId,actor);assert.equal(ui.runReads.at(-1).requestId,ui.runCalls[0].requestId);assert.match(ui.env.container.textContent,/Original run request recovered/)
})

test('stage preview writes nothing; exact reviewed dependency order and scope are saved once',async t=>{
 const ui=await mount(t,{stages:true});await ui.change('Pipeline selection',website)
 const publication=elements(ui.env.container,'select').find(node=>props(node).required)
 await act(async()=>props(publication).onChange({target:{value:'a0000000-0000-4000-8000-000000000007'}}))
 await ui.change('Project brief quantity','1');await ui.change('Draft copy quantity','2');await ui.previewDraft()
 assert.equal(ui.configCalls.length,0);assert.match(ui.env.container.textContent,/Dependencies: brief/);assert.match(ui.env.container.textContent,/Output: not specified/);assert.match(ui.env.container.textContent,/Required inputs: not specified/)
 ui.setGate();const confirm=props(ui.button('Confirm draft revision')).onClick;await act(async()=>{void confirm();void confirm()});assert.equal(ui.configCalls.length,1);assert.deepEqual(ui.configCalls[0].selectedSteps,[{key:'brief',quantity:1},{key:'draft',quantity:2}]);assert.equal(ui.configCalls[0].pipelineGroupId,website);await ui.release();assert.equal(ui.storage.size,0)
})
test('omitted required dependency fails preview; editing invalidates a retained confirmation callback',async t=>{
 const ui=await mount(t,{stages:true});await ui.change('Pipeline selection',website)
 await act(async()=>props(elements(ui.env.container,'select').find(node=>props(node).required)).onChange({target:{value:'a0000000-0000-4000-8000-000000000007'}}))
 await ui.change('Draft copy quantity','1');await ui.previewDraft();assert.match(ui.env.container.textContent,/requires its earlier steps/);assert.equal(ui.button('Confirm draft revision'),undefined);assert.equal(ui.configCalls.length,0)
 await ui.change('Project brief quantity','1');await ui.previewDraft();const oldConfirm=props(ui.button('Confirm draft revision')).onClick
 await ui.change('Draft copy quantity','3');assert.equal(ui.button('Confirm draft revision'),undefined);await act(async()=>oldConfirm());assert.equal(ui.configCalls.length,0)
})
test('lost configuration response blocks editing until immutable exact request read recovery',async t=>{
 const ui=await mount(t,{stages:true,lost:true});await ui.change('Pipeline selection',website)
 await act(async()=>props(elements(ui.env.container,'select').find(node=>props(node).required)).onChange({target:{value:'a0000000-0000-4000-8000-000000000007'}}))
 await ui.change('Project brief quantity','1');await ui.previewDraft();await ui.click('Confirm draft revision');assert.equal(ui.configCalls.length,1);assert.equal(ui.storage.size,1);assert.equal(props(ui.field('Pipeline selection')).disabled,true)
 await ui.click('Refresh');assert.equal(ui.configCalls.length,1);assert.equal(ui.storage.size,0);assert.match(ui.env.container.textContent,/Original command recovered/)
})

test('declared stage plan reviews exact reuse, omission reason and missing approved input before one canonical save',async t=>{
 const ui=await mount(t,{declared:true});await ui.change('Pipeline selection',website)
 await act(async()=>props(elements(ui.env.container,'select').find(node=>props(node).required)).onChange({target:{value:'a0000000-0000-4000-8000-000000000007'}}))
 await ui.change('Project brief decision','reuse');await ui.change('Draft copy decision','run');await ui.change('Additional proof decision','omit');await ui.change('Additional proof omission reason','Covered by approved source')
 await ui.previewDraft();assert.equal(props(ui.button('Confirm draft revision')).disabled,true);assert.match(ui.env.container.textContent,/missing or incompatible Approved source/);assert.equal(ui.configCalls.length,0)
 await ui.click('Find approved versions');await ui.change('Project brief approved version',ui.artifact.artifact_version_id);await ui.change('Draft copy input Approved source',ui.artifact.artifact_version_id);await ui.previewDraft()
 assert.match(ui.env.container.textContent,/Approved launch source · exact v2/);assert.match(ui.env.container.textContent,/Reason: Covered by approved source/);assert.equal(ui.configCalls.length,0);await ui.click('Confirm draft revision')
 assert.equal(ui.configCalls.length,1);assert.deepEqual(ui.configCalls[0].stageDecisions,[{key:'brief',action:'reuse',artifact_version_id:ui.artifact.artifact_version_id},{key:'draft',action:'run',quantity:1,inputs:[{key:'article',artifact_version_id:ui.artifact.artifact_version_id}]},{key:'proof',action:'omit',reason:'Covered by approved source'}]);assert.deepEqual(ui.configCalls[0].selectedSteps,[{key:'brief',quantity:1},{key:'draft',quantity:1}])
})
test('retained draft field and confirm callbacks cannot edit or redispatch an unknown stage save',async t=>{
 const ui=await mount(t,{stages:true,lost:true});await ui.change('Pipeline selection',website)
 await act(async()=>props(elements(ui.env.container,'select').find(node=>props(node).required)).onChange({target:{value:'a0000000-0000-4000-8000-000000000007'}}));await ui.change('Project brief quantity','1');await ui.previewDraft()
 const oldField=props(ui.field('Project brief quantity')).onChange,oldConfirm=props(ui.button('Confirm draft revision')).onClick;await ui.click('Confirm draft revision')
 await act(async()=>{oldField({target:{value:'4'}});await oldConfirm()});assert.equal(ui.configCalls.length,1);assert.equal(props(ui.field('Project brief quantity')).value,'1');assert.equal(ui.storage.size,1)
})
test('retained group confirmation is invalidated by edited group fields',async t=>{
 const ui=await mount(t);await ui.prepare();const oldConfirm=props(ui.button('Confirm independent pipeline')).onClick;await ui.change('Pipeline name','Changed later');await act(async()=>oldConfirm());assert.equal(ui.calls.length,0)
})

async function authorDraft(ui){
 await ui.change('Definition published preset',preset);await ui.change('Execution version name','Website fulfilment');await ui.change('Step 1 key','article');await ui.change('Step 1 label','Approved article');await ui.change('Step 1 service',preset)
 await act(async()=>props(ui.field('Step 1 declare output and inputs')).onChange({target:{checked:true}}))
 await ui.change('Step 1 expected output','Approved launch article');await act(async()=>props(ui.field('Step 1 allow approved source')).onChange({target:{checked:true}}));await ui.change('Step 1 exact output type','blog_article')
}
test('actual definition author submits one immutable typed stage, and approval gates cannot replace source',async t=>{
 const ui=await mount(t,{panel:'definition'});await authorDraft(ui);ui.setGate();const submit=props(elements(ui.env.container,'form')[0]).onSubmit
 await act(async()=>{void submit({preventDefault(){}});void submit({preventDefault(){}})});assert.equal(ui.definitionCalls.length,1);assert.deepEqual(ui.definitionCalls[0].steps[0].stage_contract,{optional:false,output_label:'Approved launch article',reuse_allowed:true,artifact_type:'content',output_type:'blog_article',required_inputs:[]})
 await ui.release();assert.match(ui.env.container.textContent,/Department approval and publication are separate/);assert.equal(ui.definitionCalls.length,1)
 await authorDraft(ui);await ui.change('Step 1 kind','approval_gate');assert.equal(ui.field('Step 1 allow approved source'),undefined);const second=props(elements(ui.env.container,'form')[0]).onSubmit;await act(async()=>second({preventDefault(){}}));assert.deepEqual(ui.definitionCalls[1].steps[0].stage_contract,{optional:false,output_label:'Approved launch article',reuse_allowed:false,required_inputs:[]})
})
test('lost definition response freezes retained edits and submit until exact own request read-only recovery',async t=>{
 const ui=await mount(t,{panel:'definition',lost:true});await authorDraft(ui);const edit=props(ui.field('Execution version name')).onChange,submit=props(elements(ui.env.container,'form')[0]).onSubmit
 await act(async()=>submit({preventDefault(){}}));assert.equal(ui.definitionCalls.length,1);assert.match(ui.env.container.textContent,/original save outcome is unknown/)
 await act(async()=>{edit({target:{value:'Changed after uncertain'}});await submit({preventDefault(){}})});assert.equal(ui.definitionCalls.length,1);assert.equal(props(ui.field('Execution version name')).value,'Website fulfilment')
 await ui.click('Refresh');assert.equal(ui.definitionCalls.length,1);assert.match(ui.env.container.textContent,/Original execution definition v1 recovered/);assert.equal(props(ui.field('Execution version name')).value,'')
})

test('definition reload retains only the unresolved UUID and blocks a new save without guessing a historical result',async t=>{
 const request='a0000000-0000-4000-8000-000000000099',storage=new Map([[`anka:pipeline-definition:${org}:${actor}:v1`,request]])
 const ui=await mount(t,{panel:'definition',initialStorage:storage});assert.match(ui.env.container.textContent,/Unresolved original save request/);assert.equal(storage.get(`anka:pipeline-definition:${org}:${actor}:v1`),request)
 await ui.change('Execution version name','Unrelated new version');await act(async()=>props(elements(ui.env.container,'form')[0]).onSubmit({preventDefault(){}}));assert.equal(ui.definitionCalls.length,0);assert.equal(props(ui.field('Execution version name')).value,'')
 await ui.click('Refresh');assert.equal(ui.definitionCalls.length,0);assert.match(ui.env.container.textContent,/Unresolved original save request/)
})


test('actual run shows exact reviewed manual values, version/approval provenance and reuse exclusion before consent',async t=>{
 const reference={artifact_version_id:'a0000000-0000-4000-8000-000000000031',version_number:2,approval_id:'a0000000-0000-4000-8000-000000000032',content_checksum:'a'.repeat(64),ai_use_allowed:true}
 const row={id:'a0000000-0000-4000-8000-000000000090',requested_by:actor,status:'awaiting_review',requested_at:new Date().toISOString(),input_sha256:'a'.repeat(64),input_manifest:{pipeline:{version_id:preset},assets:[],stage_review:{id:'stage-review',review_sha256:'b'.repeat(64),decisions:[{key:'source',action:'reuse',artifact_version_id:reference.artifact_version_id},{key:'copy',action:'run',quantity:1,inputs:[{key:'audience',value:'Startup owners'},{key:'article',artifact_version_id:reference.artifact_version_id}]}],resolved_artifacts:[{step_key:'source',input_key:null,reference},{step_key:'copy',input_key:'article',reference}]}},review:{decision:'accepted_for_planning'},plan:{work_sha256:'c'.repeat(64),work_manifest:[]},job:{id:'job',status:'blocked_configuration',configured_steps:[],steps:[]}}
 const ui=await mount(t,{panel:'run',initialRunRows:[row]});assert.match(ui.env.container.textContent,/Exact reviewed stage inputs/);assert.match(ui.env.container.textContent,/Startup owners/);assert.ok(ui.env.container.textContent.includes(reference.artifact_version_id));assert.ok(ui.env.container.textContent.includes(reference.approval_id));assert.match(ui.env.container.textContent,/Satisfied by existing approval; no regeneration/);assert.match(ui.env.container.textContent,/reviewed stage inputs shown above/);assert.equal(ui.runCalls.length,0);assert.equal(ui.configCalls.length,0)
})
