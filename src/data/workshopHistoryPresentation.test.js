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
