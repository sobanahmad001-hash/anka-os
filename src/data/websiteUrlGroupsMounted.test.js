import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
const nodes=n=>[n,...n.childNodes.flatMap(nodes)]
const props=n=>n[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]||{}
test('URL folders request scoped slices, reset pagination and discard old project responses',async()=>{
 const env=mountedEnvironment(),old={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true})
 const requests=[],module={exports:{}}
 const require=name=>name==='react'?React:name.includes('supabase')?{supabase:{rpc:(name,args)=>new Promise(resolve=>requests.push({args,resolve}))}}:name.includes('WebsitePageHealth')?{usePageHealth:()=>({rows:[]}),HealthSummary:()=>null}:null
 const code=transformSync(readFileSync(new URL('../components/WebsiteUrlGroups.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
 new Function('require','module','exports','React',code)(require,module,module.exports,React)
 const root=createRoot(env.container),show=id=>root.render(React.createElement(module.exports.default,{workspace:{project:{id,organization_id:'org'}},onOpen:()=>{}}))
 const click=async text=>act(async()=>props(nodes(env.container).find(n=>n.textContent===text&&props(n).onClick)).onClick())
 try{
 await act(async()=>show('a'))
 await act(async()=>requests[0].resolve({data:{projectPages:1061,total:40,items:[{kind:'folder',id:'/blogs/',title:'blogs',count:409}]}}))
 await click('Next entries');assert.equal(requests[1].args.p_offset,25)
 await act(async()=>requests[1].resolve({data:{projectPages:1061,total:40,items:[{kind:'folder',id:'/blogs/',title:'blogs',count:409}]}}))
 await click('▸ blogs');assert.equal(requests[2].args.p_folder,'/blogs/');assert.equal(requests[2].args.p_offset,0)
 await act(async()=>show('b'));assert.equal(requests[3].args.p_folder,'/');assert.equal(requests[3].args.p_project,'b')
 await act(async()=>requests[2].resolve({data:{projectPages:9,total:1,items:[{kind:'folder',id:'/private/',title:'Old project private',count:9}]}}))
 assert.doesNotMatch(env.container.textContent,/Old project private/)
 await act(async()=>requests[3].resolve({error:{message:'Denied'}}));assert.match(env.container.textContent,/Denied/)
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,old)}
})
