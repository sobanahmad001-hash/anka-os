import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {summarizePageHealth} from './websitePageHealth.js'

test('page health ignores a previous project response and retains unknown state on failure',async()=>{
 const env=mountedEnvironment(),old={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true})
 const requests=[],module={exports:{}}
 const require=name=>{
  if(name==='react')return React
  if(name==='react-router-dom')return {Link:({children})=>React.createElement('span',null,children)}
  if(name.includes('supabase'))return {supabase:{rpc:(name,args)=>new Promise(resolve=>requests.push({name,args,resolve}))}}
  if(name.includes('websitePageHealth'))return {summarizePageHealth}
  if(name.includes('workItemExperience'))return {workRecordPath:()=>'/work'}
  throw Error(name)
 }
 const code=transformSync(readFileSync(new URL('../components/WebsitePageHealth.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
 new Function('require','module','exports','React',code)(require,module,module.exports,React)
 const root=createRoot(env.container)
 const show=project=>root.render(React.createElement(module.exports.default,{project:{id:project,organization_id:'org'},page:{id:'page'},workspace:{teamMembers:[]}}))
 try{
  await act(async()=>show('first'))
  await act(async()=>show('second'))
  assert.equal(requests.length,2)
  assert.equal(requests[0].name,'website_page_health')
  assert.deepEqual(requests[1].args,{p_org:'org',p_project:'second',p_pages:['page']})
  await act(async()=>requests[1].resolve({data:[{id:'page',tracking:{pageObserved:false}}]}))
  assert.match(env.container.textContent,/Not checked/)
  await act(async()=>requests[0].resolve({data:[{id:'page',tracking:{pageObserved:true,synced:'2099-01-01',through:'2099-01-01'}}]}))
  assert.doesNotMatch(env.container.textContent,/2099/)
  await act(async()=>show('third'))
  assert.match(env.container.textContent,/status unknown/)
  await act(async()=>requests[2].resolve({error:{message:'Denied'}}))
  assert.match(env.container.textContent,/Page health evidence is unavailable/)
  assert.match(env.container.textContent,/status unknown/)
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,old)}
})
