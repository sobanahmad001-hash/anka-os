import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectPipelineConfigurationsRepository, normalizeSelectedSteps, parseMicrousd, pipelineGroupView } from './projectPipelineConfigurationsRepository.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const steps = [
  { key: 'brief', label: 'Brief', depends_on: [] },
  { key: 'draft', label: 'Draft', depends_on: ['brief'] },
]

test('keeps selected step order and requires dependencies and bounded total quantity', () => {
  assert.deepEqual(normalizeSelectedSteps(steps, { brief: '2', draft: '3' }), [
    { key: 'brief', quantity: 2 }, { key: 'draft', quantity: 3 },
  ])
  assert.throws(() => normalizeSelectedSteps(steps, { draft: '1' }), /requires its earlier steps/)
  assert.throws(() => normalizeSelectedSteps(steps, { brief: '50', draft: '1' }), /total quantity/)
  assert.throws(() => normalizeSelectedSteps(steps, { brief: '1.5' }), /quantity must be/)
})

test('parses exact microdollars without float rounding', () => {
  assert.equal(parseMicrousd('0.000001'), 1)
  assert.equal(parseMicrousd('12.345678'), 12345678)
  assert.throws(() => parseMicrousd('0.0000001'), /six decimal/)
  assert.throws(() => parseMicrousd('9007199255'), /too large/)
})

test('activation requires explicit impact acknowledgement and sends the reviewed token', async () => {
  const calls = []
  const repo = createProjectPipelineConfigurationsRepository({
    from() { throw new Error('not expected') },
    rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: { activation_number: 1 }, error: null }) },
  })
  assert.throws(() => repo.activate({ organizationId: A, configurationId: B, requestId: C,
    impactToken: 'a'.repeat(64), acknowledged: false }), /acknowledge/)
  assert.equal(calls.length, 0)
  const result = await repo.activate({ organizationId: A, configurationId: B, requestId: C,
    impactToken: 'a'.repeat(64), acknowledged: true })
  assert.equal(result.activation_number, 1)
  assert.equal(calls[0].name, 'activate_project_pipeline_configuration')
  assert.equal(calls[0].args.p_impact_token_sha256, 'a'.repeat(64))
  assert.equal(calls[0].args.p_impact_acknowledged, true)
})

const group='44444444-4444-4444-8444-444444444444',marketing='55555555-5555-4555-8555-555555555555'
test('Website, Marketing and Legacy each retain their own current activation and definitions',()=>{
 const records={groups:[{id:group,preset_publication_id:A},{id:marketing,preset_publication_id:B}],available:[{id:'legacy'}],publishedDefinitions:[{id:'website',definition:{preset_publication_id:A}},{id:'marketing',definition:{preset_publication_id:B}}],configurations:[{id:'l1',revision:1},{id:'w1',pipeline_group_id:group,revision:2,group_revision:1},{id:'m1',pipeline_group_id:marketing,revision:3,group_revision:1},{id:'w2',pipeline_group_id:group,revision:4,group_revision:2}],activations:[{configuration_id:'m1',pipeline_group_id:marketing,activation_number:30,group_activation_number:1},{configuration_id:'w1',pipeline_group_id:group,activation_number:2,group_activation_number:1},{configuration_id:'l1',activation_number:1},{configuration_id:'w2',pipeline_group_id:group,activation_number:4,group_activation_number:2}]}
 assert.equal(pipelineGroupView(records).activations[0].configuration_id,'l1')
 assert.deepEqual(pipelineGroupView(records).available,[{id:'legacy'}])
 const website=pipelineGroupView(records,group)
 assert.equal(website.activations[0].configuration_id,'w2');assert.deepEqual(website.configurations.map(x=>x.id),['w2','w1']);assert.deepEqual(website.available.map(x=>x.id),['website'])
 assert.equal(pipelineGroupView(records,marketing).activations[0].configuration_id,'m1');assert.deepEqual(pipelineGroupView(records,marketing).available.map(x=>x.id),['marketing'])
 assert.throws(()=>pipelineGroupView(records,C),/unavailable/)
 assert.equal(records.activations[0].configuration_id,'m1','view must not mutate stored history')
})
test('group configuration explicitly binds identity; Legacy preserves the existing request shape',async()=>{
 const calls=[];const repo=createProjectPipelineConfigurationsRepository({from(){throw Error('unexpected')},rpc(name,args){calls.push({name,args});return Promise.resolve({data:{},error:null})}})
 const input={organizationId:A,engagementId:B,definitionPublicationId:C,requestId:A,selectedSteps:[{key:'brief',quantity:1}],maxAiCostMicrousd:0}
 await repo.create(input);await repo.create({...input,pipelineGroupId:group})
 assert.equal(calls[0].name,'create_project_pipeline_configuration');assert.equal('p_pipeline_group_id' in calls[0].args,false)
 assert.equal(calls[1].name,'create_project_pipeline_group_configuration');assert.equal(calls[1].args.p_pipeline_group_id,group);assert.equal(calls[1].args.p_request_id,A);assert.deepEqual(calls[1].args.p_selected_steps,input.selectedSteps)
 assert.throws(()=>repo.create({...input,pipelineGroupId:'other'}),/UUID/);assert.equal(calls.length,2)
})
test('group creation requires explicit bounded kind/name/published preset and stable request',async()=>{
 const calls=[];const repo=createProjectPipelineConfigurationsRepository({from(){throw Error('unexpected')},rpc(name,args){calls.push({name,args});return Promise.resolve({data:{group:{id:group}},error:null})}})
 const input={organizationId:A,engagementId:B,presetPublicationId:C,kind:'website',name:'Website',requestId:group}
 for(const change of [{kind:'legacy'},{name:''},{name:'x'.repeat(81)},{presetPublicationId:'inferred'}]) assert.throws(()=>repo.createGroup({...input,...change}))
 assert.equal(calls.length,0);await repo.createGroup(input);assert.deepEqual(calls[0],{name:'create_project_pipeline_group',args:{p_organization_id:A,p_engagement_id:B,p_preset_publication_id:C,p_kind:'website',p_name:'Website',p_request_id:group}})
})

test('reviewed decisions bind one native group or Legacy receipt, and source search is project-scoped and bounded',async()=>{
 const calls=[],repo=createProjectPipelineConfigurationsRepository({from(){throw new Error('No background reads')},rpc(name,payload){calls.push({name,payload});return Promise.resolve({data:{configuration_id:A},error:null})}})
 const decisions=[{key:'brief',action:'run',quantity:1,inputs:[{key:'audience',value:'Reviewed audience'}]}]
 await repo.create({organizationId:A,engagementId:B,definitionPublicationId:C,requestId:A,selectedSteps:[{key:'brief',quantity:1}],stageDecisions:decisions,maxAiCostMicrousd:0})
 assert.equal(calls[0].name,'create_reviewed_project_pipeline_configuration');assert.equal(calls[0].payload.p_pipeline_group_id,null);assert.deepEqual(calls[0].payload.p_stage_decisions,decisions);assert.equal('p_selected_steps' in calls[0].payload,false)
 await repo.listStageArtifacts(A,B,{query:A,offset:25});assert.deepEqual(calls[1],{name:'list_project_pipeline_stage_artifacts',payload:{p_organization_id:A,p_engagement_id:B,p_query:A,p_offset:25,p_limit:25}})
 assert.throws(()=>repo.listStageArtifacts(A,B,{offset:10001}),/Bounded/);assert.equal(calls.length,2)
})
