import assert from 'node:assert/strict'
import test from 'node:test'
import { clearDirectChatDraft, readDirectChatDraft, writeDirectChatDraft } from './directChatDraft.js'
import { directChatRecoveryKey } from './directChatRecovery.js'
const uuid = () => crypto.randomUUID()
const storage = () => { const data = new Map(); return { data, getItem: key => data.get(key) || null, setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) } }
test('draft retention is bounded to one hour and scoped to actor/org/project/department', () => {
 const store=storage(), actor=uuid(), org=uuid(), project=uuid(), key=directChatRecoveryKey(actor,org,'project_team',project,'')
 writeDirectChatDraft(key,{new_conversation_id:uuid(),conversation_id:null,text:'Scoped draft',attempt:null},store,1000)
 assert.equal(readDirectChatDraft(key,store,1001).text,'Scoped draft')
 for (const other of [directChatRecoveryKey(uuid(),org,'project_team',project,''),directChatRecoveryKey(actor,uuid(),'project_team',project,''),directChatRecoveryKey(actor,org,'project_team',uuid(),''),directChatRecoveryKey(actor,org,'department_private','','content')]) assert.equal(readDirectChatDraft(other,store,1001),null)
 assert.equal(readDirectChatDraft(key,store,3601000),null);assert.equal(store.data.size,0)
})
test('invalid/unbounded drafts and mismatched metadata cannot enter recovery storage', () => {
 const store=storage(),key='test',record={new_conversation_id:uuid(),text:'Draft',attempt:null}
 assert.throws(()=>writeDirectChatDraft(key,{...record,text:'x'.repeat(8001)},store,1000))
 assert.throws(()=>writeDirectChatDraft(key,{...record,attempt:{conversation_id:uuid(),client_request_id:uuid(),text:'Draft',isNew:true,provider_secret:'forbidden'}},store,1000))
 writeDirectChatDraft(key,record,store,1000);clearDirectChatDraft(key,store);assert.equal(store.data.size,0)
})

test('private Design draft retains exact source IDs and rejects duplicates or overflow',()=>{
 const store=storage(),key='design-sources',source=uuid(),record={new_conversation_id:uuid(),text:'Draft',attempt:{conversation_id:uuid(),client_request_id:uuid(),text:'Draft',isNew:false,design_attachment_ids:[source]}}
 writeDirectChatDraft(key,record,store,1000)
 assert.deepEqual(readDirectChatDraft(key,store,1001).attempt.design_attachment_ids,[source])
 for(const ids of [[source,source],[uuid(),uuid(),uuid(),uuid()],['not-a-uuid']])assert.throws(()=>writeDirectChatDraft(key,{...record,attempt:{...record.attempt,design_attachment_ids:ids}},store,1000))
})
test('stage draft retains immutable exact selection and rejects body/approval injection or attachment combination',()=>{
 const store=storage(),key='stage-message',selection={version:1,organization_id:uuid(),project_id:uuid(),engagement_id:uuid(),plan_id:uuid(),group_id:uuid(),phase:'website.content',partition:{kind:'website_page',id:uuid(),architecture_version_id:uuid()},context_sha256:'a'.repeat(64)},version=uuid()
 const record={new_conversation_id:uuid(),text:'Original request',attempt:{conversation_id:uuid(),client_request_id:uuid(),text:'Original request',isNew:true,project_stage_context:{selection,output_version_ids:[version]}}}
 writeDirectChatDraft(key,record,store,1000);selection.context_sha256='b'.repeat(64)
 const restored=readDirectChatDraft(key,store,1001);assert.equal(restored.attempt.project_stage_context.selection.context_sha256,'a'.repeat(64));assert.deepEqual(restored.attempt.project_stage_context.output_version_ids,[version])
 for(const stage of [{...record.attempt.project_stage_context,body:'private'}, {...record.attempt.project_stage_context,output_version_ids:[version,version]}, {...record.attempt.project_stage_context,selection:{...selection,approved:true}}, {...record.attempt.project_stage_context,selection:{...selection,partition:{kind:'website_page',id:uuid()}}}])assert.throws(()=>writeDirectChatDraft(key,{...record,attempt:{...record.attempt,project_stage_context:stage}},store,1000))
 for(const field of ['project_document_ids','design_attachment_ids'])assert.throws(()=>writeDirectChatDraft(key,{...record,attempt:{...record.attempt,[field]:[]}},store,1000))
})
