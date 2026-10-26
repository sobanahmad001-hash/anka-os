import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import * as cards from './projectWorkCard.js'
const nativeRequire=createRequire(import.meta.url),nodes=n=>[n,...n.childNodes.flatMap(nodes)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
test('mounted Work card renders recorded owner/status/dependencies and exactly one contextual action',async t=>{
 const env=mountedEnvironment(),previous={document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
 const compiled=transformSync(readFileSync(new URL('../apps/ProjectEngagementWorkspace.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code,module={exports:{}}
 const require=name=>name.includes('projectWorkCard')?cards:name.startsWith('../')||name.startsWith('./')?{}:name==='react-router-dom'?{}:nativeRequire(name)
 new Function('require','module','exports','React',compiled)(require,module,module.exports,React)
 const root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
 const item={id:'work',organization_id:'org',project_id:'project',engagement_id:'eng',title:'Write page',status:'blocked',priority:'high',owner:{id:'owner',name:'Ava'}},input={...item,id:'input',title:'Approve brief',status:'not_started',owner:{id:'reviewer',name:'Reviewer'}}
 const workspace={project:{id:'project',organization_id:'org'},engagement:{id:'eng'},projectTasks:[],engagementWorkItems:[item,input],workItemDependencies:[{organization_id:'org',work_item_id:'work',depends_on_work_item_id:'input'}]};const opened=[]
 await act(async()=>root.render(React.createElement(module.exports.WorkRecord,{workspace,item,kind:'engagement_work_item',context:'Content',showKind:true,navigate:path=>opened.push(path)})))
 assert.match(env.container.textContent,/OwnerAva/);assert.match(env.container.textContent,/Blocked/);assert.match(env.container.textContent,/Approve brief.*Not Started.*Reviewer/)
 const buttons=nodes(env.container).filter(n=>n.tagName==='BUTTON');assert.equal(buttons.length,1);assert.equal(buttons[0].textContent,'Review dependency');await act(async()=>props(buttons[0]).onClick());assert.deepEqual(opened,['/sphere/workspace/items/engagement_work_item/input']);assert.equal(item.status,'blocked')
})
