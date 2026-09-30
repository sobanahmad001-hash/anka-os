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
