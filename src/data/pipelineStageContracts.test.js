import assert from 'node:assert/strict'
import test from 'node:test'
import {normalizePipelineStageContract,inspectPipelineStagePlan} from './pipelineStageContracts.js'
import {normalizeExecutionSteps,createPipelineExecutionDefinitionsRepository} from './pipelineExecutionDefinitionsRepository.js'
const id='a0000000-0000-4000-8000-000000000001'
const contract={optional:true,output_label:'Approved launch article',reuse_allowed:true,artifact_type:'content',output_type:'blog_article',required_inputs:[{key:'audience',label:'Audience',kind:'manual'},{key:'article',label:'Approved source',kind:'approved_artifact',artifact_type:'content',output_type:'blog_article'}]}
const step={key:'article',label:'Launch article',kind:'human',department_id:'content',service_id:id,depends_on:[]}
test('full explicit contract reaches immutable authoring; legacy definition payload remains exact',async()=>{
 const calls=[],repository=createPipelineExecutionDefinitionsRepository({from(){},rpc(name,payload){calls.push({name,payload});return Promise.resolve({data:{definition_id:id}})}})
 await repository.create({organizationId:id,presetPublicationId:id,requestId:id,name:'Launch',steps:[{...step,stage_contract:contract}]});assert.deepEqual(calls[0].payload.p_steps[0].stage_contract,contract)
 assert.deepEqual(normalizeExecutionSteps([step]),[step]);assert.equal('stage_contract' in normalizeExecutionSteps([step])[0],false)
})
test('unknown/coerced/ambiguous input contracts and reused approval gates are rejected',()=>{
 for(const bad of [{...contract,optional:'true'},{...contract,output_type:'bad type'},{...contract,reuse_allowed:false},{...contract,provider:'guessed'},{...contract,required_inputs:[{key:'a',label:'A',kind:'approved_artifact'}]},{...contract,required_inputs:[{key:'a',label:'A',kind:'manual',actor_id:id}]},{...contract,required_inputs:[{key:'a',label:'A',kind:'manual'},{key:'a',label:'B',kind:'manual'}]},{...contract,required_inputs:Array.from({length:9},(_,n)=>({key:'a'+n,label:'A',kind:'manual'}))}])assert.throws(()=>normalizePipelineStageContract(bad))
 assert.throws(()=>normalizeExecutionSteps([{...step,kind:'approval_gate',stage_contract:contract}]),/approval gate/)
})

test('reuse skips regeneration inputs while dependent AI input still requires explicit AI permission',()=>{
 const first={...step,stage_contract:contract},second={...step,key:'copy',label:'Copy',kind:'ai_assisted',depends_on:['article'],stage_contract:{optional:false,output_label:'Page copy',reuse_allowed:false,required_inputs:[contract.required_inputs[1]]}}
 const source={artifact_version_id:id,artifact_type:'content',output_type:'blog_article',ai_use_allowed:false},actions={article:'reuse',copy:'run'},values={article:{artifact_version_id:id},copy:{article:id}}
 const denied=inspectPipelineStagePlan([first,second],{copy:1},actions,{},values,[source]);assert.equal(denied.ready,false);assert.match(denied.errors.join(' '),/missing or incompatible Approved source/)
 const allowed=inspectPipelineStagePlan([first,second],{copy:1},actions,{},values,[{...source,ai_use_allowed:true}]);assert.equal(allowed.ready,true);assert.equal(allowed.decisions[0].inputs,undefined);assert.deepEqual(allowed.selectedSteps,[{key:'article',quantity:1},{key:'copy',quantity:1}])
 const missingDependency=inspectPipelineStagePlan([first,second],{copy:1},{article:'omit',copy:'run'},{article:'Optional source skipped'},values,[{...source,ai_use_allowed:true}]);assert.equal(missingDependency.ready,false);assert.match(missingDependency.errors.join(' '),/requires its earlier steps/)
})
