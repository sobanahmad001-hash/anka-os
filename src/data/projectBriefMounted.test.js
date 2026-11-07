import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {buildSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
import {createProjectBriefRepository} from './projectBriefRepository.js'

const require=createRequire(import.meta.url)
const bundle=buildSync({entryPoints:['src/components/ProjectBriefDialog.jsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','../lib/supabase.js','./WorkspaceDialog.jsx']})
const compiled={exports:{}}
new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name.endsWith('WorkspaceDialog.jsx')?({children})=>children:name.endsWith('supabase.js')?{supabase:{from(){},rpc(){}}}:require(name),compiled,compiled.exports)
const props=node=>node?.[Object.keys(node).find(k=>k.startsWith('__reactProps$'))]
async function mount(t,mode){
 const env=mountedEnvironment(),storage=new Map(),keys=['window','document','IS_REACT_ACT_ENVIRONMENT','sessionStorage'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]))
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 let row={id:'p',organization_id:'o',description:'Original',updated_at:'r1',revision:'12'}
 const writes=[], tables=[]
 const client={auth:{getUser:async()=>({data:{user:{id:'a'}}})},rpc(name,args){
  tables.push(name)
  return {async abortSignal(){
   if(name==='save_project_business_brief'){
    writes.push(args)
    if(mode==='stale'||mode==='reload')row={...row,description:'Other edit',revision:'13'}
    if(row.revision!==args.p_original_revision||row.description!==args.p_original_description)return {data:null}
    row={...row,description:args.p_description,revision:'14'}
    if(mode==='lost')throw Error('Response lost')
   }
   return {data:{...row}}
  }}
 }}
 const root=createRoot(env.container),scope={organizationId:'o',projectId:'p',actorId:'a'},repo=createProjectBriefRepository(client)
 const render=key=>act(async()=>root.render(React.createElement(compiled.exports.default,{key,scope,repo,canEdit:async()=>mode!=='reader',onRead:()=>{}})))
 await render(0)
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 const button=name=>elements(env.container,'button').find(n=>n.textContent===name)
 const click=name=>act(async()=>props(button(name)).onClick())
 const field=()=>elements(env.container,'textarea')[0]
 return {render,env,writes,tables,storage,button,click,field,change:text=>act(async()=>props(field()).onChange({target:{value:text}}))}
}
for(const mode of ['saved','lost','stale','reload','reader']){
 test('canonical project brief '+mode,async t=>{
  const ui=await mount(t,mode)
  assert.match(ui.env.container.textContent,/Original/)
  if(mode==='reader'){assert.equal(ui.field(),undefined);assert.deepEqual(ui.writes,[]);return}
  await ui.change('Proposed')
  await ui.click('Review brief changes')
  const retained=props(ui.button('Save reviewed brief')).onClick
  await ui.change('Final')
  await act(async()=>retained())
  assert.deepEqual(ui.writes,[])
  await ui.click('Review brief changes');await ui.click('Save reviewed brief')
  assert.deepEqual(ui.writes,[{p_actor_id:'a',p_description:'Final',p_original_revision:'12',p_original_updated_at:'r1',p_original_description:'Original',p_organization_id:'o',p_project_id:'p'}])
  assert.ok(ui.tables.every(name=>['read_project_business_brief','save_project_business_brief'].includes(name)))
  if(mode==='stale'||mode==='reload'){
   if(mode==='reload')await ui.render(1)
   assert.match(ui.env.container.textContent,/Other edit/)
   assert.equal(props(ui.field()).value,'Final')
   assert.equal(ui.storage.size,1)
   await ui.click('Check current saved brief')
   await ui.click('Keep draft and review against current brief')
   assert.equal(ui.writes.length,1)
   assert.equal(ui.button('Save reviewed brief'),undefined)
  }else{
   assert.equal(ui.storage.size,0)
   assert.match(ui.env.container.textContent,mode==='lost'?/matches your reviewed text/:/Business brief saved/)
  }
 })
}

test('long private briefs use POST bodies with no URL filters',async()=>{
 const {createClient}=await import('@supabase/supabase-js')
 const original='Private & confidential? # / '.repeat(4096), proposed=original+' revised'
 const row={id:'p',organization_id:'o',description:original,updated_at:'r1',revision:'42'},requests=[]
 const client=createClient('https://brief.invalid','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options)=>{
  requests.push({url:new URL(url),method:options.method,body:JSON.parse(options.body)})
  return new Response(JSON.stringify({...row,description:requests.length===1?original:proposed}),{headers:{'content-type':'application/json'}})
 }}})
 const repo=createProjectBriefRepository({auth:{getUser:async()=>({data:{user:{id:'a'}}})},rpc:client.rpc.bind(client)})
 const scope={organizationId:'o',projectId:'p',actorId:'a'}
 await repo.save(scope,await repo.read(scope),proposed)
 assert.deepEqual(requests.map(r=>[r.method,r.url.pathname,r.url.search]),[
  ['POST','/rest/v1/rpc/read_project_business_brief',''],['POST','/rest/v1/rpc/save_project_business_brief','']])
 assert.equal(requests[1].body.p_original_description,original)
 assert.equal(requests[1].body.p_description,proposed)
})
