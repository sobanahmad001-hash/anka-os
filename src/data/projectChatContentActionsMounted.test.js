import test from 'node:test'
import assert from 'node:assert/strict'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {createContentActionFixture,actionId} from '../../tools/project-chat-content-fixture.js'
const nodes=n=>[n,...n.childNodes.flatMap(nodes)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0))})
async function until(check){for(let i=0;i<100;i++){if(check())return;await act(async()=>{await new Promise(r=>setTimeout(r,10))})}assert.ok(check(),'Expected mounted condition')}
// Real WebCrypto confirmation can exceed 50 ms under parallel test load.
// Reserve the short deadline for the deliberate unresolved-response case.
async function mount(t,{timeoutMs=2000}={}){
 const env=mountedEnvironment(),storage=new Map(),fixture=createContentActionFixture(),signal=new AbortController().signal
 const values={document:env.document,window:env.window,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,globalThis[k]]));Object.assign(globalThis,values);globalThis.__contentActionTest=fixture
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'content-actions-mounted',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase.js'))return '\0content-client';if(source.endsWith('AuthContext.jsx'))return '\0content-auth';if(source.endsWith('artifactApprovalRepository.js'))return '\0content-approval'},load(id){if(id==='\0content-client')return 'export const supabase={rpc(){throw Error("Unexpected live RPC")}}';if(id==='\0content-auth')return 'export const useAuth=()=>({user:{id:globalThis.__contentActionTest.actorId}})';if(id==='\0content-approval')return 'export const artifactApprovals=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__contentActionTest.approvals[k](...a)})'}}]})
 const {default:Panel}=await vite.ssrLoadModule('/src/components/ProjectChatContentActions.jsx'),root=createRoot(env.container)
 const all=()=>nodes(env.container),button=text=>all().find(n=>n.tagName==='BUTTON'&&n.textContent===text)
 const field=label=>{const row=all().find(n=>n.tagName==='LABEL'&&n.childNodes[0]?.textContent===label);return row&&nodes(row).find(n=>['INPUT','TEXTAREA','SELECT'].includes(n.tagName))}
 const click=async text=>{const b=button(text);assert.ok(b,text);assert.ok(!b.disabled,text+' enabled');await act(async()=>props(b).onClick({preventDefault(){}}));await flush()}
 const change=async(label,value)=>{const el=field(label);assert.ok(el,label);await act(async()=>props(el).onChange({target:{value,checked:value}}));await flush()}
 const render=async(extra={})=>{await act(async()=>root.render(createElement(Panel,{key:fixture.conversationId,workspace:fixture.workspace,conversationId:fixture.conversationId,actorId:fixture.actorId,messages:fixture.messages,selection:fixture.selection,signal,repository:fixture.repository,studio:fixture.studio,stages:fixture.stages,relations:fixture.relations,timeoutMs,...extra})));await flush()}
 t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,previous);delete globalThis.__contentActionTest})
 async function draft({useDefaults=false,expectedService=actionId(13)}={}){await render({request:{id:'start',sourceMessageId:actionId(8)}});await until(()=>field('Content title'));assert.equal(props(field('Exact website structure')).value,actionId(9));assert.equal(props(field('Page')).value,'home');assert.equal(props(field('Content service')).value,expectedService);for(const [label,value]of [['Content title','Homepage'],['Exact website structure',actionId(9)],['Page','home'],['Objective','Explain the service'],['Audience','Visitors'],['Language','English'],['Content text','  Exact body\nwith spaces.  '],['Content service',actionId(13)],['Source Content Work',actionId(6)]]){if(useDefaults&&['Exact website structure','Page','Content service'].includes(label))continue;await change(label,value)};await click('Review Content save');await until(()=>button('Confirm Content save'))}
 return {fixture,storage,env,root,render,click,change,button,field,draft,all}
}
test('save -> existing exact approval -> new same-page handoff; original proposal and body retained',async t=>{
 const h=await mount(t);await h.draft({useDefaults:true});await h.click('Confirm Content save');await until(()=>h.button('Approve version 1'))
 const save=h.fixture.state.calls.find(c=>c.name==='apply_project_chat_content_action').args
 assert.equal(save.p_action.content.body,'  Exact body\nwith spaces.  ');assert.equal(save.p_action.selection.context_sha256,'a'.repeat(64));assert.equal(h.storage.size,0)
 await h.click('Approve version 1');await until(()=>h.button('Prepare Design handoff'))
 await h.render({key:'reloaded-saved-action',selection:{...h.fixture.selection,group_id:actionId(91),partition:{...h.fixture.selection.partition,id:actionId(92)}}})
 await until(()=>h.button('Review exact saved version'));await h.click('Review exact saved version');await until(()=>h.button('Prepare Design handoff'))
 await h.click('Prepare Design handoff')
 assert.equal(props(h.field('Receiving Design service')).value,actionId(14));assert.equal(props(h.field('Receiving Design workstream')).value,actionId(15));assert.equal(props(h.field('Receiving Design Work')).value,actionId(7));await h.click('Review Design handoff');await h.click('Confirm Design handoff')
 const writes=h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action');assert.equal(writes.length,2)
 const handoff=writes[1].args;assert.equal(handoff.p_action.selection.context_sha256,'d'.repeat(64));assert.deepEqual(handoff.p_action.selection.partition,save.p_action.selection.partition);assert.equal(handoff.p_action.source_work.id,actionId(6));assert.equal(handoff.p_action.receiving_work.id,actionId(7));assert.equal(handoff.p_source_message_id,save.p_source_message_id);assert.notEqual(handoff.p_request_id,save.p_request_id)
 assert.equal(save.p_action.selection.context_sha256,'a'.repeat(64));assert.match(h.env.container.textContent,/Design handoff recorded/)
 await h.render({key:'reload'});await until(()=>h.env.container.textContent.includes('Design handoff recorded'));assert.equal(h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,2)
})
test('unknown save preserves immutable original; absent observation and remount never resend',async t=>{
 const h=await mount(t);await h.draft();h.fixture.state.lose=true;await h.click('Confirm Content save');await until(()=>h.button('Check saved result'))
 const original=JSON.parse([...h.storage.values()][0]);h.fixture.state.hash='f'.repeat(64);h.fixture.state.recoverAbsent=true
 await h.click('Check saved result');assert.equal(h.storage.size,1);assert.match(h.env.container.textContent,/does not permit resubmitting/)
 await h.render({key:'remount'});await until(()=>h.button('Check saved result'));h.fixture.state.recoverAbsent=false;await h.click('Check saved result')
 assert.equal(h.storage.size,0);assert.equal(h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,1)
 const checks=h.fixture.state.calls.filter(c=>c.name==='recover_project_chat_content_action');assert.equal(checks.length,2);assert.equal(checks[1].args.p_request_id,original.identity.requestId);assert.equal('p_action'in checks[1].args,false)
})
test('known stale save keeps edited body; missing exact saved version never substitutes latest',async t=>{
 const h=await mount(t);await h.draft();h.fixture.state.blocked=true;await h.click('Confirm Content save')
 assert.equal(h.storage.size,0);assert.equal(props(h.field('Content text')).value,'  Exact body\nwith spaces.  ');assert.equal(h.button('Confirm Content save'),undefined)
 h.fixture.state.blocked=false;await h.click('Review Content save');h.fixture.state.missing=true;await h.click('Confirm Content save');assert.match(h.env.container.textContent,/exact saved version is unavailable/);assert.equal(h.button('Approve version 1'),undefined);assert.match(h.env.container.textContent,/Content saved/)
})
test('late result after bounded timeout cannot clear unknown; original recovery remains available',async t=>{
 const h=await mount(t,{timeoutMs:50});await h.draft();h.fixture.state.never=true;await h.click('Confirm Content save');await until(()=>h.button('Check saved result'))
 assert.equal(h.storage.size,1);await act(async()=>h.fixture.state.release());await flush();assert.equal(h.storage.size,1)
 await h.click('Check saved result');assert.equal(h.storage.size,0);assert.equal(h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,1)
})
test('scope switch while apply is pending ignores late receipt and preserves original recovery',async t=>{
 const h=await mount(t);await h.draft();h.fixture.state.never=true
 // Start without awaiting the unresolved click; switch the keyed conversation immediately.
 let click;await act(async()=>{click=props(h.button('Confirm Content save')).onClick()});await until(()=>h.fixture.state.release)
 await h.render({key:'other-conversation',conversationId:actionId(99),request:null})
 await act(async()=>h.fixture.state.release());await click;await flush()
 assert.equal(h.storage.size,1);assert.equal(h.env.container.textContent.includes('Review Content · version 1'),false)
})
test('new selected-stage Content Work requires explicit slot and existing dependency choices',async t=>{
 const h=await mount(t);await h.draft();await h.click('Edit reviewed action');await h.change('Source Content Work','new');await h.change('New Content Work title','Content slot two')
 await h.click('Review Content save');await h.click('Confirm Content save')
 const action=h.fixture.state.calls.find(c=>c.name==='apply_project_chat_content_action').args.p_action
 assert.deepEqual(action.source_work.stage_slot,{step_key:'copy',instance:2,dependencies:[]});assert.equal(action.source_work.id,null)
})
test('ambiguous missing slots and predecessor instances require explicit choices; lost Work excluded',async t=>{
 const h=await mount(t),read=h.fixture.stages.readPartition
 h.fixture.stages.readPartition=async()=>{const p=await read();p.steps[0].depends_on=['brief'];p.steps[0].items.push({instance:3,work_required:true,work_item_id:null,missing_work:false},{instance:4,work_required:true,work_item_id:null,missing_work:true});p.steps.push({key:'brief',phase:'website.goals',action:'run',items:[{instance:1,work_item_id:actionId(70),missing_work:false},{instance:2,work_item_id:actionId(71),missing_work:false}]});return p}
 await h.draft();await h.click('Edit reviewed action');await h.change('Source Content Work','new');await h.change('New Content Work title','Explicit slot')
 await h.click('Review Content save');assert.equal(h.button('Confirm Content save'),undefined);assert.match(h.env.container.textContent,/Choose one eligible/)
 await h.change('Content stage slot','copy:3');await h.click('Review Content save');assert.equal(h.button('Confirm Content save'),undefined);assert.match(h.env.container.textContent,/existing prerequisite instance/)
 const label=h.all().find(n=>n.tagName==='LABEL'&&n.textContent.startsWith('Existing prerequisite · brief'))
 const select=nodes(label).find(n=>n.tagName==='SELECT');await act(async()=>props(select).onChange({target:{value:'2'}}))
 await h.click('Review Content save');await h.click('Confirm Content save')
 const action=h.fixture.state.calls.find(c=>c.name==='apply_project_chat_content_action').args.p_action
 assert.deepEqual(action.source_work.stage_slot,{step_key:'copy',instance:3,dependencies:[{step_key:'brief',instance:2}]})
})
test('governed signoff remains separate from exact approval and cannot enable handoff',async t=>{
 const h=await mount(t);let signed=false
 h.fixture.approvals.load=async()=>({request:{id:actionId(80),status:'pending',approval_policy:'parallel'},signoffs:[{id:actionId(81),required_approver_id:h.fixture.actorId,signed_off_at:signed?'2026-11-06':null}],approvers:[{user_id:h.fixture.actorId,full_name:'Reviewer'}]})
 h.fixture.approvals.signOff=async()=>{signed=true}
 await h.draft();await h.click('Confirm Content save');await until(()=>h.button('Sign off this exact version'))
 assert.equal(h.button('Approve version 1'),undefined);await h.click('Sign off this exact version')
 assert.equal(h.button('Prepare Design handoff'),undefined);assert.match(h.env.container.textContent,/remaining named approvers/)
 assert.equal(h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,1)
})

test('ambiguous eligible services and receiving Work remain explicit choices',async t=>{
 const h=await mount(t),load=h.fixture.studio.load,library=h.fixture.studio.loadLibrary
 h.fixture.studio.load=async(...a)=>{const d=await load(...a);d.contentServices.push({...d.contentServices[0],id:actionId(90)});return d}
 await h.draft({expectedService:''});await h.click('Confirm Content save');await until(()=>h.button('Approve version 1'));await h.click('Approve version 1')
 h.fixture.studio.loadLibrary=async(...a)=>{const d=await library(...a);d.downstreamServices.push({...d.downstreamServices[0],id:actionId(91)});d.downstreamWorkstreams.push({...d.downstreamWorkstreams[0],id:actionId(92)});return d}
 h.fixture.workspace.engagementWorkItems.push({...h.fixture.receiver,id:actionId(93)})
 await h.render()
 await h.click('Prepare Design handoff')
 for(const label of ['Receiving Design service','Receiving Design workstream','Receiving Design Work'])assert.equal(props(h.field(label)).value,'')
 await h.click('Review Design handoff');assert.equal(h.button('Confirm Design handoff'),undefined)
 assert.equal(h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,1)
})
for(const mode of ['missing architecture','wrong registered page','duplicate page key'])test('selected page default fails closed: '+mode,async t=>{
 const h=await mount(t),load=h.fixture.studio.load,read=h.fixture.stages.readPartition
 if(mode==='missing architecture')h.fixture.studio.load=async(...a)=>{const d=await load(...a);d.versions=d.versions.filter(v=>v.id!==actionId(9));return d}
 if(mode==='wrong registered page')h.fixture.stages.readPartition=async(...a)=>({...await read(...a),page:{id:actionId(98),page_key:'home',architecture_artifact_id:actionId(19)}})
 if(mode==='duplicate page key')h.fixture.studio.load=async(...a)=>{const d=await load(...a);d.versions[0]={...d.versions[0],content:{pages:[{page_key:'home'},{page_key:'home'}]}};return d}
 await h.render({request:{id:'page-default',sourceMessageId:actionId(8)}});await until(()=>h.env.container.textContent.includes('exact registered page or architecture'))
 assert.equal(h.field('Content title'),undefined);assert.equal(h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,0)
})
for(const mode of ['completed','conflicting asset','stale relationship version'])test('receiving Work is not defaulted with '+mode,async t=>{
 const h=await mount(t)
 await h.draft();await h.click('Confirm Content save');await until(()=>h.button('Approve version 1'));await h.click('Approve version 1')
 if(mode==='completed')h.fixture.receiver.status='done'
 else {const read=h.fixture.relations.read;h.fixture.relations.read=async input=>{const d=await read(input);if(input.subjectId===h.fixture.receiver.id){if(mode==='conflicting asset')d.assets=[{kind:'website_page',id:actionId(99)}];else d.subject.row_version++}return d}}
 await h.click('Prepare Design handoff')
 assert.equal(props(h.field('Receiving Design Work')).value,'');assert.equal(props(h.field('Receiving Design service')).value,actionId(14))
 assert.equal(h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,1)
})
test('a defaulted service revoked before handoff review is rejected without replacement',async t=>{
 const h=await mount(t);await h.draft();await h.click('Confirm Content save');await until(()=>h.button('Approve version 1'));await h.click('Approve version 1');await h.click('Prepare Design handoff')
 const library=h.fixture.studio.loadLibrary;h.fixture.studio.loadLibrary=async(...a)=>{const d=await library(...a);d.downstreamServices[0].status='inactive';return d}
 await h.click('Review Design handoff');assert.equal(h.button('Confirm Design handoff'),undefined);assert.match(h.env.container.textContent,/service or workstream changed/)
 assert.equal(h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,1)
})
test('unique eligible defaults ignore inactive and foreign scope alternatives',async t=>{
 const h=await mount(t),load=h.fixture.studio.load,library=h.fixture.studio.loadLibrary
 h.fixture.studio.load=async(...a)=>{const d=await load(...a),s=d.contentServices[0];d.contentServices.push({...s,id:actionId(90),status:'inactive'},{...s,id:actionId(91),organization_id:actionId(99)});return d}
 h.fixture.studio.loadLibrary=async(...a)=>{const d=await library(...a);d.downstreamServices.push({...d.downstreamServices[0],id:actionId(92),engagement_id:actionId(99)});d.downstreamWorkstreams.push({...d.downstreamWorkstreams[0],id:actionId(93),status:'inactive'});return d}
 h.fixture.workspace.engagementWorkItems.push({...h.fixture.receiver,id:actionId(94),status:'done'},{...h.fixture.receiver,id:actionId(95),project_id:actionId(99)})
 await h.draft({useDefaults:true});await h.click('Confirm Content save');await until(()=>h.button('Approve version 1'));await h.click('Approve version 1');await h.click('Prepare Design handoff')
 for(const [label,id]of [['Receiving Design service',actionId(14)],['Receiving Design workstream',actionId(15)],['Receiving Design Work',actionId(7)]])assert.equal(props(h.field(label)).value,id)
 assert.equal(h.fixture.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,1)
})
