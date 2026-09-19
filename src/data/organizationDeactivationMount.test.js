import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
const nodes=node=>[node,...node.childNodes.flatMap(nodes)]
const find=(env,tag,text='')=>nodes(env.container).find(node=>node.tagName===tag && node.textContent.includes(text))
const click=(env,node)=>act(async()=>node.dispatchEvent(new env.window.Event('click')))
async function mount(t,client,props={}){
 const env=mountedEnvironment()
 const previous={document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
 const {default:Panel}=await server.ssrLoadModule('/src/components/OrganizationDeactivation.jsx')
 const root=createRoot(env.container)
 t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,previous)})
 await act(async()=>root.render(createElement(Panel,{organizationId:'org',userId:'target',actorId:'admin',status:'active',client,onDeactivated:()=>{},...props})))
 return env
}
test('deactivation UI requires explicit selected-org confirmation and deduplicates pending clicks',async t=>{
 const calls=[];let finish;let outcome
 const env=await mount(t,{rpc(name,args){calls.push({name,args});return new Promise(resolve=>{finish=resolve})}},{onDeactivated:result=>{outcome=result}})
 const button=find(env,'BUTTON','Deactivate organization access')
 assert.equal(button.disabled,true);assert.equal(calls.length,0)
 const checkbox=find(env,'INPUT')
 await act(async()=>{checkbox.checked=true;checkbox.dispatchEvent(new env.window.Event('click'))})
 await act(async()=>{button.dispatchEvent(new env.window.Event('click'));button.dispatchEvent(new env.window.Event('click'))})
 assert.equal(calls.length,1);assert.equal(calls[0].args.p_organization_id,'org');assert.equal(calls[0].args.p_user_id,'target')
 await act(async()=>finish({data:{organization_id:'org',user_id:'target',request_id:calls[0].args.p_request_id,status:'revoked',auth_account_preserved:true}}))
 assert.equal(outcome.status,'revoked')
 assert.match(env.container.textContent,/Auth sessions are unchanged/)
})
test('deactivation UI prevents self-removal and keeps already revoked members visible',async t=>{
 const env=await mount(t,{rpc(){throw new Error('must not call')}},{actorId:'target',status:'revoked'})
 assert.equal(find(env,'INPUT').disabled,true)
 assert.equal(find(env,'BUTTON','Already deactivated').disabled,true)
 assert.match(env.container.textContent,/Permanent deletion is a separate reviewed process/)
})
test('deactivation UI loads retained reassignment history only on explicit request',async t=>{
 let calls=0
 const env=await mount(t,{rpc(){calls++;return Promise.resolve({data:{organization_id:'org',user_id:'target',history:[{id:'audit',created_at:'today',
  reassignment_records:[{kind:'project_task',id:'task',title:'Retained task',project_id:'project',row_version:2}]}]}})}})
 assert.equal(calls,0)
 await click(env,find(env,'BUTTON','Load deactivation'))
 assert.equal(calls,1);assert.match(env.container.textContent,/Retained task/);assert.match(env.container.textContent,/review current work before reassigning/)
})
test('deactivation UI discards delayed results after scope revocation',async t=>{
 const controller=new AbortController();let finish;let called=false
 const env=await mount(t,{rpc(){return new Promise(resolve=>{finish=resolve})}},{requestSignal:controller.signal,onDeactivated:()=>{called=true}})
 const checkbox=find(env,'INPUT')
 await act(async()=>{checkbox.checked=true;checkbox.dispatchEvent(new env.window.Event('click'))})
 await click(env,find(env,'BUTTON','Deactivate organization access'))
 controller.abort()
 await act(async()=>finish({data:{organization_id:'foreign'}}))
 assert.equal(called,false)
 assert.equal(find(env,'P','scope mismatch'),undefined)
})
