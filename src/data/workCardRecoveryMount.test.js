import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
test('response loss retains request and text; retry reopens one version and saved retry recovers it',async t=>{
 const env=mountedEnvironment(),previous={document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
 const calls=[];let saved=null,lose=true
 const supabase={rpc(name,args){calls.push({name,args:structuredClone(args)});let data=null,error=null
  if(name==='list_work_card_assets')data={attached:saved?[{kind:'content',id:saved.id,label:'Brief'}]:[],options:[]}
  if(name==='save_hybrid_work_draft'){
   saved??={id:args.p_request,title:args.p_title,body:args.p_body,version:1}
   assert.equal(args.p_request,saved.id);assert.equal(args.p_body,saved.body)
   if(lose){lose=false;error=Error('Response lost')}else data={version_id:saved.id,project_id:'project',card_id:'card'}
  }
  if(name==='work_content_version')data=saved
  if(name==='retry_work_content_save')data={version_id:saved.id,project_id:'project',card_id:'card'}
  const result=Promise.resolve({data,error});result.abortSignal=()=>result;return result
 }}
 const module={exports:{}},code=transformSync(readFileSync(new URL('../components/WorkCardAssets.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
 new Function('require','module','exports','React',code)(n=>n==='react'?{...React}:n.includes('supabase')?{supabase}:n.includes('ProjectDrive')?{default:()=>null,driveFileId:()=>null,__esModule:true}:n.includes('ProjectFigma')?{default:()=>null,__esModule:true}:n==='react-router-dom'?{Link:()=>null}:{},module,module.exports,React)
 const root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
 const button=s=>elements(env.container,'button').find(n=>n.textContent===s),click=n=>act(async()=>props(n).onClick())
 await act(async()=>root.render(React.createElement(module.exports.default,{project:{id:'project',organization_id:'org'},cardKey:'engagement_work_item:card'})))
 await click(button('Write content'))
 await act(async()=>props(elements(env.container,'input')[0]).onChange({target:{value:'Brief'}}))
 await act(async()=>props(elements(env.container,'textarea')[0]).onChange({target:{value:'Exact supplied body'}}))
 await click(button('Save draft version'))
 assert.match(env.container.textContent,/Response lost/);assert.equal(props(elements(env.container,'textarea')[0]).disabled,true)
 await click(button('Retry same save'))
 assert.match(env.container.textContent,/Exact supplied body/)
 assert.equal(calls.filter(c=>c.name==='save_hybrid_work_draft').length,2)
 assert.equal(new Set(calls.filter(c=>c.name==='save_hybrid_work_draft').map(c=>c.args.p_request)).size,1)
 await click(button('Retry original save'))
 assert.match(env.container.textContent,/Original save recovered/)
 assert.equal(calls.filter(c=>c.name==='retry_work_content_save')[0].args.p_request,saved.id)
 assert.equal(calls.filter(c=>c.name==='save_hybrid_work_draft').length,2)
})
