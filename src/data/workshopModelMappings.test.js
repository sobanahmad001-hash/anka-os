import test from 'node:test'
import assert from 'node:assert/strict'
import {createWorkshopModelMappings,validateMappingResult} from './workshopModelMappings.js'
const id='11111111-1111-4111-8111-111111111111',scope={organization_id:id,project_id:id,engagement_id:id}
const snapshot={...scope,schema_version:1,token:'a'.repeat(32),project_name:'Fixture',candidates:[]}
for(const mutation of [x=>x.organization_id='other',x=>x.token='bad',x=>x.candidates=[{}],x=>x.schema_version=2])test('rejects malformed scoped snapshot '+String(mutation),()=>{const data=structuredClone(snapshot);mutation(data);assert.throws(()=>validateMappingResult(data,scope))})
test('read uses exact selected scope and never supplies actor',async()=>{let body;const api=createWorkshopModelMappings(async b=>{body=b;return {data:{result:snapshot}}});await api.read(scope);assert.deepEqual(body,{action:'list_workshop_mappings',...scope})})
test('save pins original command and validates exact selections',async()=>{const command={request_id:id,expected_token:'a'.repeat(32),selections:[{connection_id:id,department_id:'content'}],organization_id:'foreign'};let body;const api=createWorkshopModelMappings(async b=>{body=b;return {data:{result:{...scope,schema_version:1,request_id:id,persisted:true,added:[],selections:command.selections}}}});await api.save(scope,command);assert.equal(body.organization_id,id);assert.equal(body.request_id,id)})
test('thrown transport never reveals raw errors',async()=>{const api=createWorkshopModelMappings(async()=>{throw Error('raw secret')});await assert.rejects(api.read(scope),e=>!e.message.includes('raw secret'))})
test('wrong receipt UUID stays unconfirmed',()=>{assert.throws(()=>validateMappingResult({...scope,schema_version:1,persisted:true,request_id:'wrong',added:[],selections:[]},scope,{request_id:id,selections:[]}))})
