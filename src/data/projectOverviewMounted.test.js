import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
test('overview uses canonical work state and due date and clears project scope',async()=>{
 const env=mountedEnvironment(),old={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true})
 const pending=[],module={exports:{}}
 const require=name=>name==='react'?React:name.includes('WebsiteTracking')?{WebsiteTrackingOverview:()=>null}:{readSharedWork:(workspace,signal,options)=>new Promise(resolve=>pending.push({workspace,signal,options,resolve}))}
 const code=transformSync(readFileSync(new URL('../components/ProjectOverview.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
 new Function('require','module','exports','React',code)(require,module,module.exports,React)
 const root=createRoot(env.container),show=id=>root.render(React.createElement(module.exports.default,{workspace:{project:{id,organization_id:'org'}},onNavigate:()=>{}}))
 try{
  await act(async()=>show('a'))
  assert.equal(pending[0].options.includePageAssets,false)
  await act(async()=>pending[0].resolve([{workStatus:'done',status:'draft',dueDate:'2000-01-01'},{workStatus:'blocked',status:'published',dueDate:'2000-01-01'},{workStatus:'active',status:'reviewed',day:'2000-01-01'}]))
  assert.match(env.container.textContent,/Open work2Blocked1Overdue1/)
  await act(async()=>show('b'))
  assert.match(env.container.textContent,/Loading project summary/)
  assert.doesNotMatch(env.container.textContent,/Open work2/)
  assert.equal(pending[0].signal.aborted,true)
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,old)}
})
