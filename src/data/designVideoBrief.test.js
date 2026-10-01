import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyVideoBrief, normalizeVideoBrief, validateVideoBrief, videoBriefCreativeContent, videoBriefPrompt, requireVideoBriefVersion, requireVideoBriefHistoryVersion } from '../../supabase/functions/_shared/designVideoBrief.js'
import {exactVideoBriefAttempt,readVideoBriefDraft,writeVideoBriefDraft,videoBriefScopeKey,VIDEO_DRAFT_TTL_MS} from './designVideoBriefDraft.js'
const org='a0000000-0000-4000-8000-000000000002',actor='a0000000-0000-4000-8000-000000000001',context={private_conversation_id:'a0000000-0000-4000-8000-000000000005'}
const draft={...emptyVideoBrief(),purpose:'Explain the launch',audience:'Returning customers',channel:'Organic social',assets:'Use approved clips when available; reference uploads are unavailable here',script_storyboard:'Open with the product, then show three benefits',brand_constraints:'Use the approved palette; no unlicensed marks',required_text:'Launch date: 10 October'}
function saved() { const root={id:'a0000000-0000-4000-8000-000000000030',organization_id:org,created_by:actor,visibility:'private',frozen_version_id:'a0000000-0000-4000-8000-000000000031'}; const version={id:'a0000000-0000-4000-8000-000000000031',organization_id:org,created_by:actor,creative_brief_id:'a0000000-0000-4000-8000-000000000030',validation_snapshot:{valid:true,video_confirmation:{action:'confirm_video_brief',actor_id:actor,expected_revision:0,requested_root_id:null}},content:videoBriefCreativeContent(draft,context,'Launch film')};return {root,version} }
const validate=(root,version,value=draft,scope=context)=>requireVideoBriefVersion({brief:root,version,organizationId:org,actorId:actor,context:scope,draft:value})
test('T04 all seven business fields are explicit; unknowns are not silently filled',()=>{
 assert.deepEqual(validateVideoBrief(emptyVideoBrief()).missing,['Purpose','Audience','Channel / placement','Source assets / reuse plan','Script / storyboard','Brand constraints','Required text'])
 assert.equal(validateVideoBrief(draft).valid,true)
 for(const key of ['purpose','audience','channel','assets','script_storyboard','brand_constraints','required_text'])assert.equal(validateVideoBrief({...draft,[key]:'  '}).valid,false)
 const none={...draft,assets:'None — text-to-video only',required_text:'None required'};assert.equal(validateVideoBrief(none).valid,true)
})
test('settings are typed and explicit; no alias, automatic downgrade, prompt truncation or inferred capability',()=>{
 for(const patch of [{resolution:'1080p'},{mode:'production',resolution:'480p'},{duration_seconds:'5'},{duration_seconds:6},{generate_audio:'false'},{aspect_ratio:'auto'},{output_format:'webm'},{model_id:'video-alias'},{provider:'google'},{purpose:'x'.repeat(1001)}])assert.equal(validateVideoBrief({...draft,...patch}).valid,false)
 assert.throws(()=>normalizeVideoBrief({...draft,history:'private history'}),/exact video brief/)
 const long={...draft,script_storyboard:'x'.repeat(5001)};assert.equal(normalizeVideoBrief(long).script_storyboard.length,5001);assert.equal(validateVideoBrief(long).valid,false)
})
test('canonical content pins one explicit private or direction context and exact full provider prompt',()=>{
 const content=videoBriefCreativeContent(draft,context)
 assert.equal(content.instructions,videoBriefPrompt(draft));assert.deepEqual(content.video_context,context)
 assert.equal(content.video_provider,'higgsfield');assert.equal(content.output_type,'video')
 assert.ok(content.instructions.includes(draft.required_text));assert.ok(content.instructions.includes(draft.brand_constraints))
 assert.throws(()=>videoBriefCreativeContent(draft,{}),/exact video context/)
 assert.throws(()=>videoBriefCreativeContent(draft,{...context,direction_version_id:context.private_conversation_id}),/exact video context/)
 assert.throws(()=>videoBriefCreativeContent(draft,{private_conversation_id:'not-a-uuid'}),/exact video context/)
 assert.equal(videoBriefCreativeContent(draft,{direction_version_id:context.private_conversation_id}).video_context.direction_version_id,context.private_conversation_id)
})
test('confirmed immutable version rejects cross-org/owner/root, official context, unconfirmed and changed settings',()=>{
 const {root,version}=saved();assert.equal(validate(root,version),version)
 const reordered=JSON.parse(JSON.stringify(version));reordered.content.video_brief=Object.fromEntries(Object.entries(reordered.content.video_brief).reverse());assert.equal(validate(root,reordered),reordered)
 assert.throws(()=>validate(root,{...version,validation_snapshot:{valid:true}}),/exact confirmed/)
 for(const patch of [{organization_id:'foreign'},{created_by:'foreign'},{visibility:'official'},{engagement_id:'project'},{frozen_version_id:'v2'}])assert.throws(()=>validate({...root,...patch},version),/exact confirmed/)
 for(const patch of [{organization_id:'foreign'},{created_by:'foreign'},{creative_brief_id:'foreign'},{validation_snapshot:{valid:false}}])assert.throws(()=>validate(root,{...version,...patch}),/exact confirmed/)
 for(const patch of [{duration_seconds:4},{aspect_ratio:'9:16'},{required_text:'A different date'},{generate_audio:true}])assert.throws(()=>validate(root,version,{...draft,...patch}),/differs/)
 assert.throws(()=>validate(root,version,draft,{direction_version_id:context.private_conversation_id}),/differs/)
 assert.throws(()=>validate(root,{...version,content:{...version.content,history:'private text'}}),/differs/)
})

test('current brief draft is bounded, actor/context scoped, one-hour retained and contains no history or credentials',()=>{
 const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)},key=videoBriefScopeKey(actor,org,context)
 writeVideoBriefDraft(storage,key,{...emptyVideoBrief(),purpose:'Keep my partial draft'},100);assert.equal(readVideoBriefDraft(storage,key,101).purpose,'Keep my partial draft')
 assert.equal(readVideoBriefDraft(storage,videoBriefScopeKey(org,actor,context),101),null)
 assert.throws(()=>writeVideoBriefDraft(storage,key,{...draft,messages:['private history']},100),/unexpected/);assert.throws(()=>writeVideoBriefDraft(storage,key,{...draft,script_storyboard:'x'.repeat(5001)},100),/bounds/)
 assert.equal(readVideoBriefDraft(storage,key,100+VIDEO_DRAFT_TTL_MS),null);assert.equal(map.size,0)
 assert.throws(()=>videoBriefScopeKey(actor,org,{...context,direction_version_id:context.private_conversation_id}),/exact/)
 const operation='a0000000-0000-4000-8000-000000000050',input={...context,creative_brief_id:null,expected_revision:0,operation_key:operation,video_brief:draft},record={operation_key:operation,input}
 assert.deepEqual(exactVideoBriefAttempt(record,context),input)
 for (const patch of [{operation_key:'different'},{input:{...input,messages:[]}},{input:{...input,expected_revision:-1}},{input:{...input,video_brief:{...draft,purpose:''}}},{input:{...input,private_conversation_id:operation}}]) assert.throws(()=>exactVideoBriefAttempt({...record,...patch},context),/Original/)
})

test('an exact superseded confirmation can settle read-only recovery but cannot grant generation eligibility',()=>{
 const {root,version}=saved(),superseded={...root,frozen_version_id:'a0000000-0000-4000-8000-000000000090'}
 const input={brief:superseded,version,organizationId:org,actorId:actor,context,draft}
 assert.equal(requireVideoBriefHistoryVersion(input),version);assert.throws(()=>requireVideoBriefVersion(input),/exact confirmed/)
 assert.throws(()=>requireVideoBriefHistoryVersion({...input,actorId:org}),/exact confirmed/)
 assert.throws(()=>requireVideoBriefHistoryVersion({...input,draft:{...draft,purpose:'changed'}}),/differs/)
})
