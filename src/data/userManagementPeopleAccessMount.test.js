import test from 'node:test'
import assert from 'node:assert/strict'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
const all=n=>[n,...n.childNodes.flatMap(all)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
async function mount(t){
 const env=mountedEnvironment(),before={};for(const[k,v]of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[k]=globalThis[k];globalThis[k]=v}
 const state={user:{id:'actor'},profile:{role:'admin'},scope:{activeOrganizationId:'org-a',activeOrganization:{name:'Organization A'},activeMembership:{role:'operations_admin'},scopeRevision:1,requestSignal:new AbortController().signal}};globalThis.__peopleHost={state,created:0,seen:[],unmounted:[]}
 const mocks={AuthContext:'export const useAuth=()=>globalThis.__peopleHost.state',OrganizationContext:'export const useOrganization=()=>globalThis.__peopleHost.state.scope',supabase:'export const supabase={}',peopleManagement:'export const INVITATION_ORGANIZATION_ID="anka";export const createPeopleManagementRepository=()=>({identity:++globalThis.__peopleHost.created})',peopleAccessReadModel:'export const createPeopleAccessReadRepository=()=>({})'}
 for(const name of ['PeopleTeamControls','PeopleClientControls','AuthorityCompatibilityAdmin'])mocks[name]=`import{createElement,useEffect}from'react';export default function Controls(p){globalThis.__peopleHost.seen.push({kind:'${name}',...p});useEffect(()=>()=>globalThis.__peopleHost.unmounted.push('${name}'),[]);return createElement('p',null,'${name} '+p.organizationId)}`
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'people-host-contract',enforce:'pre',resolveId(source){const key=source.split('/').pop().replace(/\.js$/,'');if(mocks[key])return '\0people-'+key},load(id){if(id.startsWith('\0people-'))return mocks[id.slice(8)]}}]});const root=createRoot(env.container)
 t.after(async()=>{await act(async()=>root.unmount());await vite.close();delete globalThis.__peopleHost;Object.assign(globalThis,before)})
 const{default:Host}=await vite.ssrLoadModule('/src/apps/UserManagement.jsx');const render=()=>act(async()=>root.render(createElement(Host)));await render()
 const button=name=>all(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent===name)
 return{state,env,render,button,click:async name=>act(async()=>props(button(name)).onClick()),get data(){return globalThis.__peopleHost}}
}
test('unified People host uses current membership, preserves scoped relationships and never global profile fallback',async t=>{
 const ui=await mount(t);assert.match(ui.env.container.textContent,/PeopleTeamControls org-a/);assert(ui.button('Team'));assert(ui.button('Clients'));assert.equal(ui.data.created,1)
 await ui.render();assert.equal(ui.data.created,1,'stable repository across rerender');await ui.click('Departments & project relationships');assert.match(ui.env.container.textContent,/AuthorityCompatibilityAdmin org-a/)
 ui.state.scope.activeMembership={role:'executive'};await ui.render();assert.equal(ui.button('Team'),undefined);await ui.click('Clients');assert.match(ui.env.container.textContent,/PeopleClientControls org-a/)
 ui.state.scope.activeMembership={role:'contributor'};await ui.render();assert.match(ui.env.container.textContent,/unavailable with your current organization membership/);assert.equal(ui.button('Clients'),undefined)
})
test('identity, organization and revision remount People controls with exact signal and no old scope retained',async t=>{
 const ui=await mount(t);const first=ui.data.seen.at(-1);assert.equal(first.actorId,'actor');assert.equal(first.organizationId,'org-a');assert.equal(first.requestSignal,ui.state.scope.requestSignal)
 ui.state.user={id:'new-actor'};await ui.render();assert.equal(ui.data.seen.at(-1).actorId,'new-actor');assert.equal(ui.data.unmounted.length,1)
 ui.state.scope={...ui.state.scope,activeOrganizationId:'org-b',activeOrganization:{name:'Organization B'},scopeRevision:2,requestSignal:new AbortController().signal};await ui.render();assert.equal(ui.data.seen.at(-1).organizationId,'org-b');assert.equal(ui.data.seen.at(-1).requestSignal,ui.state.scope.requestSignal);assert.equal(ui.data.unmounted.length,2);assert(!ui.env.container.textContent.includes('org-a'))
 ui.state.scope.scopeRevision++;await ui.render();assert.equal(ui.data.unmounted.length,3)
})
