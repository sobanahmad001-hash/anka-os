import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
const id=n=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const person=id(2),orgA=id(10),orgB=id(20)
const all=n=>[n,...n.childNodes.flatMap(all)]
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const envelope=(org,user,actor)=>({schema_version:1,compatibility_only:true,organization_id:org,actor_id:actor,token:user?'read-token':null,members:[{user_id:person,name:org===orgA?'Tenant A person':'Tenant B person',organization_id:org,role:'contributor',status:'active'}],departments:[],projects:[],snapshot:user?{organization_id:org,user_id:user,legacy_role:'contributor',legacy_department_id:'content',status:'active',department_memberships:[],contributor_designations:[],project_manager_bindings:[]}:null})
async function mount(t){
  const previousFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Direct network dispatch forbidden in read-only host test')};t.after(()=>{globalThis.fetch=previousFetch})
  const env=mountedEnvironment(),before={};for(const [key,value] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[key]=globalThis[key];globalThis[key]=value}
  let controller=new AbortController(),hold=null,deny=false;const calls=[]
  const state={user:{id:id(1)},profile:{role:'member'},scope:{loading:false,activeOrganizationId:orgA,activeOrganization:{name:'Tenant A'},activeMembership:{organizationId:orgA,role:'operations_admin'},scopeRevision:1,requestSignal:controller.signal}}
  globalThis.__peopleHost={state,client:{rpc(name,args){assert(['get_authority_administration','get_organization_deactivation_history'].includes(name),'No mutation or impersonating capability API');const call={name,args,actor:state.user.id};calls.push(call);let signal;const value=deny?{data:null,error:Error('Synthetic server denies current authority')}:{data:name==='get_authority_administration'?envelope(args.p_organization_id,args.p_user_id,state.user.id):{organization_id:args.p_organization_id,user_id:args.p_user_id,history:[]},error:null};const wait=hold&&args.p_user_id?hold.promise:null;return {abortSignal(s){signal=s;call.signal=s;return this},then(resolve,reject){return (wait||Promise.resolve(value)).then(resolve,reject)}}},from(table){calls.push({table});let target,signal;const q={select(){return q},eq(key,value){if(key==='id')target=value;return q},order(){return q},abortSignal(s){signal=s;return q},async maybeSingle(){signal?.throwIfAborted();return {data:{id:target,full_name:state.scope.activeOrganizationId===orgA?'Tenant A profile':'Tenant B profile',role:'admin',department:'design'}}},then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)}};return q}}}
  const vite=await createServer({ssr:{noExternal:['react-router-dom']},server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'synthetic-people-host',enforce:'pre',resolveId(source){if(source==='react-router-dom')return '\0people-host-router';if(source.endsWith('/context/AuthContext'))return '\0people-host-auth';if(source.endsWith('/context/OrganizationContext'))return '\0people-host-org';if(source.endsWith('/lib/supabase'))return '\0people-host-client';if(source.endsWith('/components/AuthorityCompatibilityAdmin'))return '\0people-host-compat'},load(source){if(source==='\0people-host-router')return "export const Navigate=()=>null";if(source==='\0people-host-auth')return 'export const useAuth=()=>globalThis.__peopleHost.state';if(source==='\0people-host-org')return 'export const useOrganization=()=>globalThis.__peopleHost.state.scope';if(source==='\0people-host-client')return 'export const supabase=globalThis.__peopleHost.client';if(source==='\0people-host-compat')return "import {createElement} from 'react';export default function Compatibility(){return createElement('p',{'aria-label':'Existing compatibility mode'},'Existing compatibility controls')}"}}]})
  const root=createRoot(env.container)
  t.after(async()=>{await act(async()=>root.unmount());await vite.close();delete globalThis.__peopleHost;Object.assign(globalThis,before)})
  const {default:Host}=await vite.ssrLoadModule('/src/apps/UserManagement.jsx')
  const render=()=>act(async()=>root.render(createElement(Host)))
  const named=name=>all(env.container).find(n=>props(n)?.['aria-label']===name)
  const button=name=>all(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent===name)
  const click=name=>act(async()=>{assert(button(name),name+' exists');await props(button(name)).onClick()})
  const select=()=>act(async()=>props(named('People access team member')).onChange({target:{value:person}}))
  await render()
  return {state,calls,env,render,named,button,click,select,setHold:value=>{hold=value},setDeny:value=>{deny=value},abort:()=>act(async()=>controller.abort()),freshSignal:()=>{controller=new AbortController();state.scope.requestSignal=controller.signal}}
}
test('optional host preserves default controls and stable adapter, mismatched profile roles never grant target authority',async t=>{
  const ui=await mount(t);assert(ui.named('Existing compatibility mode'));assert.equal(ui.calls.length,0)
  await ui.click('People & access — read only');await ui.select();assert.match(ui.env.container.textContent,/global profile role does not match/);assert.match(ui.env.container.textContent,/Client project access: not evaluated/);assert.match(ui.env.container.textContent,/Assign work: Not evaluated/)
  const count=ui.calls.length;await ui.render();assert.equal(ui.calls.length,count,'host rerender must not recreate adapter/refetch')
  await ui.click('Read retained deactivation history');assert(ui.calls.some(c=>c.name==='get_organization_deactivation_history'))
  await ui.click('Compatibility records — selected organization');assert(ui.named('Existing compatibility mode'));assert.equal(ui.named('People and access profile'),undefined)
  ui.state.profile.role='admin';await ui.render();assert(ui.button('Legacy team controls — Anka organization'));assert(ui.named('Existing compatibility mode'))
  ui.state.scope.activeMembership.role='contributor';await ui.render();assert.equal(ui.button('People & access — read only'),undefined);assert(ui.button('Legacy team controls — Anka organization'))
})
test('host resets on identity/org/revision, aborts pending scope, and respects current server denial',async t=>{
  const ui=await mount(t);await ui.click('People & access — read only');await ui.select();assert(ui.named('Identity and organization access'))
  await ui.abort();assert.equal(ui.named('Identity and organization access'),undefined);assert(ui.named('People access team member').disabled)
  ui.freshSignal();ui.state.scope.scopeRevision++;await ui.render();assert.equal(ui.named('Identity and organization access'),undefined);await ui.select()
  ui.state.user={id:id(3)};await ui.render();assert.equal(ui.named('Identity and organization access'),undefined);assert.equal(ui.named('People access team member').value,'');await ui.select()
  const pending=deferred();ui.setHold(pending);await ui.click('Refresh');const old=ui.calls.filter(c=>c.name==='get_authority_administration'&&c.args.p_user_id).at(-1)
  ui.setHold(null);ui.state.scope={...ui.state.scope,activeOrganizationId:orgB,activeOrganization:{name:'Tenant B'},activeMembership:{organizationId:orgB,role:'operations_admin'},scopeRevision:ui.state.scope.scopeRevision+1,requestSignal:new AbortController().signal};await ui.render();assert(old.signal.aborted);assert.equal(ui.named('Identity and organization access'),undefined)
  await act(async()=>pending.resolve({data:envelope(orgA,person,id(3)),error:null}));assert(!ui.env.container.textContent.includes('Tenant A profile'));await ui.select();assert.match(ui.env.container.textContent,/Tenant B profile/)
  ui.setDeny(true);await ui.click('Refresh');assert.equal(ui.named('Identity and organization access'),undefined);assert.match(ui.env.container.textContent,/Synthetic server denies current authority/)
  assert(ui.calls.filter(c=>c.name).every(c=>['get_authority_administration','get_organization_deactivation_history'].includes(c.name)))
})
