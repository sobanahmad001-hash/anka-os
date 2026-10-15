import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
const nativeRequire=createRequire(import.meta.url)
const props=node=>node?.[Object.keys(node??{}).find(key=>key.startsWith('__reactProps$'))]??{}
test('one loaded-title search filters separate groups without widening requests or losing pagination and access guards', async t=>{
 const env=mountedEnvironment(),previous={document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
 const calls=[],opened=[],abort=new AbortController(),engagement={id:'e',project_id:'p',organization_id:'o',name:'Launch'}
 const repository={listContextConversations:async()=>[{id:'private',title:'Personal notes',context_kind:'department_private',department_id:'design',owner_id:'a',organization_id:'o'}],searchConversations:async(_d,input)=>{calls.push(input);return {items:[{id:input.before_id?'older':'current',title:input.before_id?'Older direction':'Homepage direction',department_id:'design',project_id:'p',engagement_id:'e',organization_id:'o',access_role:'recipient',state:'active'}],next_cursor:input.before_id?null:{id:'current',last_activity_at:'2026-10-15'}}}}
 function load(url){const module={exports:{}},compiled=transformSync(readFileSync(url,'utf8'),{loader:url.pathname.endsWith('jsx')?'jsx':'js',format:'cjs',jsxFactory:'React.createElement'}).code;const require=name=>name.includes('departmentChatRepository')?{departmentChat:repository}:name.startsWith('.')?load(new URL(name,url)):nativeRequire(name);new Function('require','module','exports','React',compiled)(require,module,module.exports,React);return module.exports}
 const List=load(new URL('../components/WorkshopConversationList.jsx',import.meta.url)).default,root=createRoot(env.container)
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
 await act(async()=>root.render(React.createElement(List,{simplifiedHistory:true,compact:true,organizationId:'o',actorId:'a',departmentId:'design',scopeRevision:1,signal:abort.signal,engagements:[engagement],projects:[{id:'p',name:'Project'}],activeEngagementId:'e',onOpen:item=>opened.push(item)})))
 assert.equal(elements(env.container,'input').length,1)
 assert.match(env.container.textContent,/Closed engagements have not been searched/)
 assert.match(env.container.textContent,/Private · Only you/)
 assert.match(env.container.textContent,/Shared with you/)
 assert.doesNotMatch(env.container.textContent,/engagement: 1 loaded|sharing managed in conversation/)
 await act(async()=>props(elements(env.container,'input')[0]).onChange({target:{value:'Older'}}))
 assert.equal(calls.length,1);assert.equal(calls[0].query,'')
 assert.doesNotMatch(env.container.textContent,/Homepage direction|Personal notes/)
 const more=elements(env.container,'button').find(n=>n.textContent==='Load more engagement conversations')
 await act(async()=>props(more).onClick())
 assert.match(env.container.textContent,/Older direction/)
 assert.equal(calls[1].engagement_id,'e');assert.equal(calls[1].before_id,'current');assert.equal(calls[1].query,'')
 const row=elements(env.container,'button').find(n=>n.textContent.includes('Older direction'))
 abort.abort()
 await act(async()=>props(row).onClick())
 assert.equal(opened.length,0)
})

for (const departmentId of ['design', 'content', 'marketing']) test(`${departmentId}: selected context resets search, excludes other histories and ignores stale reads/opens`, async t => {
 const env=mountedEnvironment(), previous={document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
 const calls=[],opened=[],pending=[]
 const repository={
  listContextConversations:async()=>{calls.push('private');return [{id:'mine',title:'Private title',context_kind:'department_private',department_id:departmentId,owner_id:'a',project_id:null,engagement_id:null}]},
  searchConversations:async(_d,input)=>{calls.push(input);return new Promise(resolve=>pending.push({input,resolve}))}
 }
 function load(url){const module={exports:{}},compiled=transformSync(readFileSync(url,'utf8'),{loader:url.pathname.endsWith('jsx')?'jsx':'js',format:'cjs',jsxFactory:'React.createElement'}).code;const require=name=>name.includes('departmentChatRepository')?{departmentChat:repository}:name.startsWith('.')?load(new URL(name,url)):nativeRequire(name);new Function('require','module','exports','React',compiled)(require,module,module.exports,React);return module.exports}
 const List=load(new URL('../components/WorkshopConversationList.jsx',import.meta.url)).default,root=createRoot(env.container)
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
 const base={compact:true,simplifiedHistory:departmentId==='design',organizationId:'o',actorId:'a',departmentId,scopeRevision:1,engagements:[{id:'e',project_id:'p',organization_id:'o',name:'Selected'},{id:'other',project_id:'q',organization_id:'o',name:'Other'}],projects:[{id:'p',organization_id:'o'},{id:'q',organization_id:'o'}],onOpen:item=>opened.push(item)}
 const render=async selectedContext=>act(async()=>root.render(React.createElement(List,{...base,selectedContext})))
 await render({kind:'private'})
 assert.deepEqual(calls,['private'])
 const oldOpen=props(elements(env.container,'button').find(n=>n.textContent.includes('Private title'))).onClick
 await act(async()=>props(elements(env.container,'input')[0]).onChange({target:{value:'hidden'}}))
 await render({kind:'engagement',projectId:'p',engagementId:'e'})
 assert.equal(props(elements(env.container,'input')[0]).value,'')
 assert.equal(calls.length,2);assert.equal(calls[1].project_id,'p');assert.equal(calls[1].engagement_id,'e')
 assert.doesNotMatch(env.container.textContent,/Private title/)
 await act(async()=>oldOpen());assert.equal(opened.length,0)
 await render({kind:'private'})
 await act(async()=>pending[0].resolve({items:[{id:'late',title:'Late project title',department_id:departmentId,project_id:'p',engagement_id:'e'}],next_cursor:{id:'late'}}))
 assert.match(env.container.textContent,/Private title/);assert.doesNotMatch(env.container.textContent,/Late project title|Load more engagement/)
 await render({kind:'engagement',projectId:'p',engagementId:'e'})
 const projectRow={id:'current',title:'Current project',department_id:departmentId,project_id:'p',engagement_id:'e'}
 await act(async()=>pending[1].resolve({items:[projectRow],next_cursor:{id:'current',last_activity_at:'2026-10-15'}}))
 if(departmentId==='design') assert.doesNotMatch(env.container.textContent,/engagement: 1 loaded|sharing managed in conversation/)
 const oldProjectOpen=props(elements(env.container,'button').find(n=>n.textContent.includes('Current project'))).onClick
 let morePromise
 await act(async()=>{morePromise=props(elements(env.container,'button').find(n=>n.textContent==='Load more engagement conversations')).onClick()})
 assert.equal(pending[2].input.before_id,'current')
 await render({kind:'engagement',projectId:'q',engagementId:'other'})
 await act(async()=>{pending[2].resolve({items:[{...projectRow,id:'older',title:'Old page'}],next_cursor:null});await morePromise;oldProjectOpen()})
 assert.doesNotMatch(env.container.textContent,/Current project|Old page/);assert.equal(opened.length,0)
 assert.equal(pending[3].input.project_id,'q');assert.equal(pending[3].input.before_id,undefined)
 await act(async()=>pending[3].resolve({items:[{...projectRow,title:'Wrong response'}],next_cursor:null}))
 assert.match(env.container.textContent,/scope mismatch/);assert.doesNotMatch(env.container.textContent,/Wrong response/)
 const reads=calls.length
 await render({kind:'engagement',projectId:'p',engagementId:'other'})
 assert.equal(calls.length,reads);assert.equal(elements(env.container,'input').length,0)
 assert.match(env.container.textContent,/Select an available/)
})
