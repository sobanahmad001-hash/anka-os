import test from 'node:test'
import assert from 'node:assert/strict'
import { act,createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
const all=n=>[n,...n.childNodes.flatMap(all)]
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const id=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
test('gated commit pane opens without IO; reviewed proposal recovers lost save and confirms once',async t=>{
 const environment=mountedEnvironment(),stored=new Map(),keys=['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','sessionStorage']
 const previous=Object.fromEntries(keys.map(k=>[k,globalThis[k]]))
 Object.assign(globalThis,{document:environment.document,window:environment.window,Event:environment.window.Event,Node:environment.window.Node,HTMLElement:environment.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)}})
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
 const {default:Pane}=await vite.ssrLoadModule('/src/components/ProjectSpreadsheetCommitPane.jsx')
 const root=createRoot(environment.container),calls=[],sha='a'.repeat(64),reviewSha='b'.repeat(64);let saved
 const repository={targets:async()=>{calls.push('targets');return {type:'website_pages',engagements:[{id:id(5),label:'Synthetic website workstream',status:'active'}],artifacts:[],architectures:[]}},sourceStatus:async()=>{calls.push('source_status');return null},reserveSource:async(_f,uuid)=>{calls.push('reserve');return {attachment_id:uuid}},uploadSource:async()=>{calls.push('upload')},finishSource:async()=>{calls.push('finish');return {status:'reference_only',sha256_hex:sha}},
  preview:async input=>{calls.push('preview');return {review_sha256:reviewSha,preview:{rows:[{outcome:'create'}]},input}},save:async(input,request)=>{calls.push('save');saved={status:'pending',request_id:request,review_sha256:reviewSha,preview:{rows:[{outcome:'create'}]},input};throw Error('Lost save response')},recover:async request=>{calls.push('recover');assert.equal(request,saved.request_id);return saved},confirm:async request=>{calls.push('confirm');assert.equal(request,saved.request_id);return {rows:[{outcome:'verified'}]}}}
 const scope={organizationId:id(1),projectId:id(2),conversationId:id(3),actorId:id(4)}
 await act(async()=>root.render(createElement(Pane,{repository,scope,file:{name:'synthetic.csv',size:32},source:{sha256:sha},sheetIndex:0,sheet:{rows:[{row:1,cells:['title']},{row:2,cells:['Synthetic']}]},type:'website_pages',mapping:{title:0}})))
 t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,previous)})
 const nodes=()=>all(environment.container),button=text=>nodes().find(n=>n.tagName==='BUTTON'&&n.textContent===text)
 const input=label=>all(nodes().find(n=>n.tagName==='LABEL'&&n.textContent.startsWith(label))).find(n=>n.tagName==='INPUT')
 const click=async text=>{const b=button(text);assert.equal(b.disabled,false,text);await act(async()=>props(b).onClick())}
 assert.deepEqual(calls,[]);assert.equal(button('Upload reviewed private source').disabled,true)
 await act(async()=>props(input('I confirm uploading')).onChange({target:{checked:true}}))
 await click('Upload reviewed private source');assert.deepEqual(calls,['source_status','reserve','upload','finish'])
 await click('Load current project workstreams')
 const workstream=nodes().find(n=>n.tagName==='SELECT'&&n.getAttribute('aria-label')==='Import workstream')
 await act(async()=>{props(workstream).onChange({target:{value:id(5)}});await Promise.resolve()})
 await act(async()=>{props(input('Draft title')).onChange({target:{value:'Synthetic draft'}});props(input('Source row 2')).onChange({target:{checked:true}})})
 await click('Review canonical differences');assert.equal(calls.filter(x=>x==='save').length,0)
 await click('Save private reviewed proposal');assert(environment.container.textContent.includes('Lost save response'))
 assert.equal(button('Review canonical differences').disabled,true)
 assert(!JSON.stringify([...stored.values()]).includes('Synthetic draft'))
 await click('Resume original import')
 const confirm=button('Confirm exactly this saved proposal');await act(async()=>{props(confirm).onClick();props(confirm).onClick();await Promise.resolve()})
 await act(async()=>{await new Promise(r=>setTimeout(r,0))})
 assert.equal(calls.filter(x=>x==='confirm').length,1);assert(environment.container.textContent.includes('verified'));assert(!nodes().some(n=>n.tagName==='PRE'));assert(!environment.container.textContent.includes(saved.request_id))
 stored.set(`anka:project-import:${scope.organizationId}:${scope.projectId}:${scope.conversationId}:${scope.actorId}`,JSON.stringify({requestId:saved.request_id}))
 const beforeReload=calls.length
 await act(async()=>root.render(createElement(Pane,{key:'without-source',repository,scope,type:'website_pages',sheetIndex:0,mapping:{}})))
 assert.equal(calls.length,beforeReload);assert(button('Resume original import'));assert.equal(button('Upload reviewed private source'),undefined)
 await click('Resume original import');assert(button('Confirm exactly this saved proposal'))
})
