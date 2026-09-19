import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
const nodes = node => [node,...node.childNodes.flatMap(nodes)]
const find = (env,tag,text='') => nodes(env.container).find(node=>node.tagName===tag && node.textContent.includes(text))
const flush = () => act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})
const change = (env,node,value) => act(async()=>{node.value=value;node.dispatchEvent(new env.window.Event('change'))})
const click = (env,node) => act(async()=>{node.dispatchEvent(new env.window.Event('click'))})
const envelope = project => ({organization_id:'org',project_id:project,token:'snapshot-token',records:[]})
async function mount(t,client){
 const env=mountedEnvironment()
 const previous={document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
 const {default:Panel}=await server.ssrLoadModule('/src/components/ProjectDepartmentParticipation.jsx')
 const root=createRoot(env.container)
 t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,previous)})
 await act(async()=>root.render(createElement(Panel,{organizationId:'org',client,projects:[{id:'project',name:'One'},{id:'next',name:'Two'}],departments:[{id:'design',name:'Design'}]})))
 return env
}
test('participation UI requires explicit project and submit, tokenizes mutation, ignores duplicate clicks',async t=>{
 const calls=[];let finish
 const env=await mount(t,{rpc(name,args){
  calls.push({name,args})
  return name.startsWith('get_') ? Promise.resolve({data:envelope(args.p_project_id)}) : new Promise(resolve=>{finish=resolve})
 }})
 assert.equal(calls.length,0)
 await change(env,find(env,'SELECT'),'project');await flush()
 assert.equal(calls.length,1)
 const button=find(env,'BUTTON','Include department')
 await act(async()=>{button.dispatchEvent(new env.window.Event('click'));button.dispatchEvent(new env.window.Event('click'))})
 assert.equal(calls.length,2)
 assert.equal(calls[1].args.p_expected_token,'snapshot-token')
 assert.equal(calls[1].args.p_enabled,true)
 assert.ok(calls[1].args.p_request_id)
 assert.equal(find(env,'SELECT').disabled,true)
 await act(async()=>finish({error:{code:'40001',message:'stale'}}));await flush()
 assert.match(env.container.textContent,/changed elsewhere/)
 assert.equal(calls.filter(call=>call.name.startsWith('change_')).length,1)
})
test('participation UI discards delayed project reads and fails closed on wrong scope',async t=>{
 let finish
 const env=await mount(t,{rpc(_name,args){
  return args.p_project_id==='project' ? new Promise(resolve=>{finish=resolve}) : Promise.resolve({data:envelope('wrong-project')})
 }})
 await change(env,find(env,'SELECT'),'project')
 await change(env,find(env,'SELECT'),'next');await flush()
 await act(async()=>finish({data:envelope('project')}));await flush()
 assert.match(env.container.textContent,/scope mismatch/)
 assert.equal(find(env,'BUTTON','Include department'),undefined)
})
test('participation UI missing migration exposes reload and no mutation controls',async t=>{
 const env=await mount(t,{rpc(){return Promise.resolve({error:{code:'PGRST202',message:'Participation migration unavailable'}})}})
 await change(env,find(env,'SELECT'),'project');await flush()
 assert.match(env.container.textContent,/migration unavailable/)
 assert.equal(find(env,'BUTTON','Include department'),undefined)
 await click(env,find(env,'BUTTON','Reload participation'));await flush()
 assert.equal(find(env,'BUTTON','Include department'),undefined)
})

