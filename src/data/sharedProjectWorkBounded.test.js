import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
test('Work paginates actual records and resets pagination on service changes',async()=>{
 const env=mountedEnvironment(),old={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true})
 const pending=[],module={exports:{}}
 const require=name=>name==='react'?React:name==='react-router-dom'?{Link:({children})=>React.createElement('a',null,children)}:name.includes('WorkCardAssets')?{__esModule:true,default:()=>null}:{readSharedWork:(workspace,signal,options)=>new Promise(resolve=>pending.push({workspace,signal,options,resolve}))}
 const code=transformSync(readFileSync(new URL('../components/SharedProjectWork.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
 new Function('require','module','exports','React',code)(require,module,module.exports,React)
 let params=new URLSearchParams('workView=list');const root=createRoot(env.container),show=id=>root.render(React.createElement(module.exports.default,{workspace:{project:{id,organization_id:'org'}},searchParams:params,setSearchParams:p=>{params=p},onOpenService:()=>{}}))
 try{
  await act(async()=>show('a'))
  assert.equal(pending[0].options.includePageAssets,false)
  await act(async()=>pending[0].resolve(Array.from({length:61},(_,i)=>({key:'task:'+i,title:'Task '+i,group:'Website',status:'open'}))))
  assert.match(env.container.textContent,/1–30 of 61 matching Work/)
  assert.doesNotMatch(env.container.textContent,/Task 30/)
  const nodes=n=>[n,...n.childNodes.flatMap(nodes)],props=n=>n[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]||{}
  const next=nodes(env.container).find(n=>n.textContent==='Next Work'&&props(n).onClick)
  await act(async()=>props(next).onClick());assert.equal(params.get('workOffset'),'30')
  const select=nodes(env.container).find(n=>n.nodeName==='SELECT')
  await act(async()=>props(select).onChange({target:{value:'Website'}}));assert.equal(params.has('workOffset'),false)

 }finally{await act(async()=>root.unmount());Object.assign(globalThis,old)}
})
