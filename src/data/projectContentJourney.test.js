import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectContentJourneyRepository} from './projectContentJourneyRepository.js'
import {projectContentRequestProposal} from './projectContentRequestProposal.js'
const scope={organizationId:'org',projectId:'project',engagementId:'engagement',conversationId:'conversation',actorId:'actor'}
test('saved-message proposals require the exact human author and conversation and perform no write',()=>{
 const message={id:'message',role:'user',author_id:'actor',conversation_id:'conversation',body:'Write a launch article\nExact reviewed brief'}
 const p=projectContentRequestProposal(message,scope);assert.equal(p.action,'create');assert.equal(p.description,message.body);assert.equal(p.sourceMessageId,message.id)
 for(const patch of [{role:'assistant'},{author_id:'other'},{conversation_id:'other'},{body:'x'.repeat(8001)}])assert.throws(()=>projectContentRequestProposal({...message,...patch},scope))
 assert.equal(projectContentRequestProposal({...message,body:'x'.repeat(250)},scope).title,'')
})
test('conversation binding passes exact origin IDs and recovery remains read only',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:name.startsWith('read')?[]:{conversation_id:args.p_conversation_id}}}}
 const repo=createProjectContentJourneyRepository(client);await repo.bind(scope,'message','work');await repo.list(scope)
 assert.deepEqual(calls.map(c=>c.name),['bind_project_content_journey','read_project_content_journeys'])
 assert.deepEqual(calls[0].args,{p_organization_id:'org',p_project_id:'project',p_conversation_id:'conversation',p_source_message_id:'message',p_work_item_id:'work'})
})
test('Design results resolve only the exact linked output version, never the latest version',async()=>{
 const calls=[],responses={content_n3_handoff_links:[{request_id:'request',receiving_service_id:'design-service',work_kind:'engagement_work_item',work_id:'design-work'}],engagement_services:{id:'design-service',engagement_id:'engagement',service_catalog:{department_id:'design'}},requests:{id:'request',status:'open'},work_items:{id:'design-work',department_id:'design',engagement_id:'engagement',linked_artifact_id:'design-output',linked_artifact_version_id:'exact-version'},artifacts:{id:'design-output'},artifact_versions:{id:'exact-version',version_number:2}}
 const client={from(table){const filters=[];const q={select:()=>q,limit:()=>q,eq:(...a)=>{filters.push(a);return q},maybeSingle:()=>q,then(resolve){calls.push({table,filters});return Promise.resolve({data:responses[table]}).then(resolve)}};return q}}
 const rows=await createProjectContentJourneyRepository(client).handoffs(scope,'content-version');assert.equal(rows[0].version.id,'exact-version')
 assert.deepEqual(calls.find(c=>c.table==='artifact_versions').filters,[['organization_id','org'],['artifact_id','design-output'],['id','exact-version']])
 assert.ok(calls.find(c=>c.table==='content_n3_handoff_links').filters.some(([k,v])=>k==='artifact_version_id'&&v==='content-version'))
 responses.work_items.engagement_id='foreign';calls.length=0;const foreign=await createProjectContentJourneyRepository(client).handoffs(scope,'content-version');assert.equal(foreign[0].version,null);assert.ok(!calls.some(c=>c.table==='artifact_versions'))
 responses.engagement_services.service_catalog.department_id='marketing';assert.deepEqual(await createProjectContentJourneyRepository(client).handoffs(scope,'content-version'),[])
})
