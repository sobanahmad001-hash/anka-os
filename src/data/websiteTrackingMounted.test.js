import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {compareDailyTracking} from '../../supabase/functions/_shared/websiteTrackingDays.js'
import {pageSnapshotDiff} from '../../supabase/functions/_shared/websiteObservedChanges.js'
test('tracking history ignores delayed responses after a project/page switch',async()=>{
 const env=mountedEnvironment(),old={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true})
 const requests=[],module={exports:{}}
 const require=name=>{
  if(name==='react')return React
  if(name.endsWith('/supabase.js'))return {supabase:{rpc:(name,args)=>new Promise(resolve=>requests.push({name,args,resolve}))}}
  if(name.includes('websiteTrackingDays'))return {compareDailyTracking}
  if(name.includes('websiteObservedChanges'))return {pageSnapshotDiff}
  throw Error(name)
 }
 const code=transformSync(readFileSync(new URL('../components/WebsiteTracking.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
 new Function('require','module','exports','React',code)(require,module,module.exports,React)
 const root=createRoot(env.container)
 const show=project=>root.render(React.createElement(module.exports.default,{project:{id:project,organization_id:'org'},page:{id:project+'page'}}))
 try{
  await act(async()=>show('first'));await act(async()=>show('second'))
  assert.equal(requests.length,4)
  assert.equal(requests[2].args.p_project,'second');assert.equal(requests[2].args.p_page,'secondpage')
  await act(async()=>{requests[2].resolve({data:{lastSuccess:'CURRENT'}});requests[3].resolve({data:{history:[]}})})
  assert.match(env.container.textContent,/CURRENT/)
  await act(async()=>{requests[0].resolve({data:{lastSuccess:'FOREIGN'}});requests[1].resolve({data:{history:[]}})})
  assert.doesNotMatch(env.container.textContent,/FOREIGN/)
  await act(async()=>show('third'))
  assert.doesNotMatch(env.container.textContent,/CURRENT/)
  await act(async()=>{requests[4].resolve({error:{message:'Denied'}});requests[5].resolve({data:{history:[]}})})
  assert.match(env.container.textContent,/Tracking evidence unavailable/)
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,old)}
})
