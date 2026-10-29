import test from 'node:test'
import assert from 'node:assert/strict'
import {projectContentSourceOptions,reviewProjectContentSources,projectContentSourcesCurrent,projectContentSourcesProposal} from './projectContentSources.js'
import {newContentWriterDraft,contentWriterPreview} from './contentWriter.js'
const scope={organizationId:'org',projectId:'project',engagementId:'engagement',actorId:'actor',conversationId:'conversation'}
const messages=[{id:'draft',role:'assistant',conversation_id:'conversation',sequence:4,body:'\n  Exact six-section copy.\n\nCTA: Contact us.  \n'},{id:'old',role:'user',author_id:'actor',conversation_id:'conversation',sequence:1,body:'Provisional brief: [services needed]'},{id:'brief',role:'assistant',conversation_id:'conversation',sequence:3,body:'Reviewed homepage brief\nServices and CTA supplied by the owner.'},{id:'request',role:'user',author_id:'actor',conversation_id:'conversation',sequence:2,body:'Use the reviewed facts for our homepage.'}]
const selection={requestId:'request',briefId:'brief',draftId:'draft'}
test('selection identifies exact reviewed sources without relying on array order or first request',()=>{
 const reviewed=reviewProjectContentSources(messages,selection,scope),proposal=projectContentSourcesProposal(reviewed)
 assert.equal(proposal.description,messages.find(m=>m.id==='brief').body);assert.equal(proposal.sourceMessageId,'request');assert.equal(reviewed.draft.body,messages[0].body)
 assert.deepEqual(projectContentSourceOptions(messages,scope).map(m=>m.id),['draft','brief','request','old'])
 assert.equal(reviewProjectContentSources([...messages].reverse(),selection,scope).key,reviewed.key)
 assert.throws(()=>{reviewed.brief.body='Unreviewed replacement'},TypeError)
 assert.throws(()=>{reviewed.scope.actorId='other'},TypeError)
})
test('foreign authors conversations duplicate IDs invalid roles and oversize text fail closed without truncation',()=>{
 for(const change of [{id:'request',author_id:'other'},{id:'brief',conversation_id:'foreign'},{id:'draft',role:'user'},{id:'brief',body:'x'.repeat(20001)},{id:'draft',body:'x'.repeat(128001)}])assert.throws(()=>reviewProjectContentSources(messages.map(m=>m.id===change.id?{...m,...change}:m),selection,scope))
 assert.throws(()=>reviewProjectContentSources([...messages,messages[0]],selection,scope));assert.throws(()=>reviewProjectContentSources(messages,{...selection,briefId:'draft'},scope))
})
test('changed source text author scope or missing history invalidates retained review; new messages do not silently replace it',()=>{
 const r=reviewProjectContentSources(messages,selection,scope)
 assert.equal(projectContentSourcesCurrent(r,[{...messages[0],id:'new',sequence:5,body:'A later reply'},...messages],scope),true)
 assert.equal(projectContentSourcesCurrent(r,messages.map(m=>m.id==='draft'?{...m,body:'Changed'}:m),scope),false)
 assert.equal(projectContentSourcesCurrent(r,messages.filter(m=>m.id!=='brief'),scope),false)
 assert.equal(projectContentSourcesCurrent(r,messages,{...scope,actorId:'different'}),false)
})
test('explicit Writer transfer preserves original text including whitespace through preview serialization',()=>{
 const body=messages[0].body,form={...newContentWriterDraft(),output_type:'custom_text',working_title:'Homepage draft',destination:'Homepage review',objective:'Owner supplied homepage brief',audience:'Prospective clients',language:'English',body}
 assert.equal(contentWriterPreview(form,[],{preserveBody:true}).content.body,body)
 assert.equal(contentWriterPreview(form).content.body,body.trim())
})
