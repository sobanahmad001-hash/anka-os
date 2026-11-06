import test from 'node:test'
import assert from 'node:assert/strict'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {createChatDesignFixture,uuid} from '../../tools/project-chat-design-fixture.js'
const nodes=n=>[n,...n.childNodes.flatMap(nodes)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0))})
async function until(check){for(let i=0;i<100;i++){if(check())return;await act(async()=>{await new Promise(r=>setTimeout(r,10))})}assert.ok(check(),'Expected mounted condition')}
async function mount(t,fixture){
 const env=mountedEnvironment(),storage=new Map(),signal=new AbortController().signal
 const values={document:env.document,window:env.window,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,globalThis[k]]));Object.assign(globalThis,values);globalThis.__contentActionTest=fixture
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'content-actions-mounted',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase.js'))return '\0content-client';if(source.endsWith('OrganizationContext.jsx'))return '\0content-org';if(source.endsWith('AuthContext.jsx'))return '\0content-auth';if(source.endsWith('artifactApprovalRepository.js'))return '\0content-approval'},load(id){if(id==='\0content-client')return 'export const supabase={rpc(){throw Error("Unexpected live RPC")}}';if(id==='\0content-org')return 'export const useOrganization=()=>({})';if(id==='\0content-auth')return 'export const useAuth=()=>({user:{id:globalThis.__contentActionTest.actorId}})';if(id==='\0content-approval')return 'export const artifactApprovals=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__contentActionTest.approvals[k](...a)})'}}]})
 const {ChatDesignActions:Panel}=await vite.ssrLoadModule('/src/components/ProjectChatDesignActions.jsx'),root=createRoot(env.container)
 const all=()=>nodes(env.container),button=text=>all().find(n=>n.tagName==='BUTTON'&&n.textContent===text)
 const field=label=>{const row=all().find(n=>n.tagName==='LABEL'&&n.childNodes[0]?.textContent===label);return row&&nodes(row).find(n=>['INPUT','TEXTAREA','SELECT'].includes(n.tagName))}
 const click=async text=>{const b=button(text);assert.ok(b,text);assert.ok(!b.disabled,text+' enabled');await act(async()=>props(b).onClick({preventDefault(){}}));await flush()}
 const change=async(label,value)=>{const el=field(label);assert.ok(el,label);await act(async()=>props(el).onChange({target:{value,checked:value}}));await flush()}
 const render=async(extra={})=>{await act(async()=>root.render(createElement(Panel,{key:fixture.props.conversationId,...fixture.props,signal,timeoutMs:2000,...extra})));await flush()}
 t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,previous);delete globalThis.__contentActionTest})
 return {fixture,storage,env,root,render,click,change,button,field,all}
}

async function draft(h){await h.render();await until(()=>h.button('Load exact Design sources'));await h.click('Load exact Design sources');await until(()=>h.field('Page template'));await h.change('Page template','home');await h.click('Review Design draft');await until(()=>h.button('Confirm Design save'))}
const writes=f=>f.state.calls.filter(c=>c.name==='website-native-design')
test('exact handoff -> native save -> explicit saved-parent revision retains copy and receiver',async t=>{
 const f=await createChatDesignFixture(),h=await mount(t,f);await draft(h);await h.click('Confirm Design save');assert.equal(writes(f).length,1);assert.match(h.env.container.textContent,/Design draft saved/)
 const first=writes(f)[0].args;assert.equal(first.context.expected_parent_design_id,null);assert.equal(first.context.receiving_work.id,f.c.receiving_work.id);assert.equal(first.manifest.content.summary,'');assert.equal(first.manifest.content.sections[0].paragraphs[0],f.s.content_page.draft_copy)
 await h.click('Revise this Design draft');await h.click('Load exact Design sources');await h.change('Motion','reveal');await h.click('Review Design draft');await h.click('Confirm Design save')
 assert.equal(writes(f).length,2);assert.equal(writes(f)[1].args.context.expected_parent_design_id,f.state.designs[0].design_id);assert.notEqual(writes(f)[1].args.request_id,first.request_id);assert.equal(h.storage.size,0)
})
test('unknown original survives reload and absent recovery never resends',async t=>{
 const f=await createChatDesignFixture(),h=await mount(t,f);await draft(h);f.state.lose=true;await h.click('Confirm Design save');assert.equal(h.storage.size,1);const original=[...h.storage.values()][0]
 await h.render({key:'reload',request:null});f.state.absent=true;await h.click('Check saved Design result');assert.equal([...h.storage.values()][0],original);assert.match(h.env.container.textContent,/does not permit resubmitting/)
 f.state.absent=false;await h.click('Check saved Design result');assert.equal(h.storage.size,0);assert.equal(writes(f).length,1)
})
test('verified stale rollback keeps edited layout and requires another review',async t=>{
 const f=await createChatDesignFixture(),h=await mount(t,f);await draft(h);await h.click('Edit reviewed Design');await h.change('Motion','reveal');await h.click('Review Design draft');f.state.blocked=true;await h.click('Confirm Design save')
 assert.equal(h.storage.size,0);assert.equal(props(h.field('Motion')).value,'reveal');assert.equal(h.button('Confirm Design save'),undefined);assert.equal(writes(f).length,1)
})
test('missing exact approved output or confirmed receiver brief fails closed',async t=>{
 const f=await createChatDesignFixture(),h=await mount(t,f);f.data.creativeBriefVersions=[];await h.render();await until(()=>h.field('Confirmed Website brief'));assert.equal(props(h.field('Confirmed Website brief')).value,'');assert.ok(h.button('Load exact Design sources').disabled);assert.equal(writes(f).length,0)
 f.data.versions=[];await h.click('Refresh prerequisites');assert.match(h.env.container.textContent,/exact handed-off Content version is unavailable/)
})
test('late write after scope switch cannot clear original pending recovery',async t=>{
 const f=await createChatDesignFixture(),h=await mount(t,f);await draft(h);f.state.never=true
 let click;await act(async()=>{click=props(h.button('Confirm Design save')).onClick()});await until(()=>f.state.release)
 await h.render({key:'other',conversationId:uuid(90),request:null});await act(async()=>f.state.release());await click;assert.equal(h.storage.size,1);assert.equal(h.env.container.textContent.includes('Design draft v1 saved.'),false)
})
test('bounded timeout retains original request until explicit check',async t=>{
 const f=await createChatDesignFixture(),h=await mount(t,f);await draft(h);await h.render({timeoutMs:40});f.state.never=true;await h.click('Confirm Design save');assert.equal(h.storage.size,1);await until(()=>f.state.release);await act(async()=>f.state.release());await flush();assert.equal(h.storage.size,1);await h.click('Check saved Design result');assert.equal(h.storage.size,0);assert.equal(writes(f).length,1)
})
