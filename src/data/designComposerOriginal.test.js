import * as React from 'react'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
const all=n=>[n,...n.childNodes.flatMap(all)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
test('original previews require exact retained MIME, byte count and checksum',async t=>{
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});t.after(()=>vite.close())
 const {validatedReferenceOriginal:read}=await vite.ssrLoadModule('/src/data/designReferenceOriginal.js')
 const blob=new Blob(['synthetic'],{type:'image/png'}),row={id:'one',verified_mime:'image/png',declared_bytes:blob.size,expected_sha256:createHash('sha256').update('synthetic').digest('hex')}
 assert.equal(await read(blob,row),blob)
 for(const changed of [{...row,declared_bytes:10},{...row,verified_mime:'image/jpeg'},{...row,expected_sha256:'b'.repeat(64)},{...row,expected_sha256:null}])await assert.rejects(read(blob,changed),/verified|checksum/)
 await assert.rejects(read(new Blob([],{type:'image/png'}),row),/verified/)
})
test('late authorized original read cannot create a preview after card unmount',async t=>{
 const env=mountedEnvironment(),before={};for(const [k,v] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[k]=globalThis[k];globalThis[k]=v}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'}),root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,before)})
 const {default:Card}=await vite.ssrLoadModule('/src/components/DesignReferenceOriginal.jsx');let finish,created=0;const original=URL.createObjectURL;URL.createObjectURL=()=>{created++;return 'blob:synthetic'};t.after(()=>{URL.createObjectURL=original})
 const blob=new Blob(['synthetic'],{type:'image/png'}),row={id:'one',original_name:'test.png',verified_mime:'image/png',declared_bytes:blob.size,expected_sha256:createHash('sha256').update('synthetic').digest('hex')}
 await act(async()=>root.render(createElement(Card,{row,read:()=>new Promise(resolve=>{finish=resolve}),run:action=>action(),signal:new AbortController().signal})))
 let pending;await act(async()=>{pending=props(all(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent==='Preview image')).onClick()});await act(async()=>root.render(null));await act(async()=>{finish(blob);await pending});assert.equal(created,0)
})
test('preferred private animation source is re-read, exact and never consents or dispatches',async t=>{
 const env=mountedEnvironment(),before={};for(const [k,v] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:()=>null,setItem(){}}})){before[k]=globalThis[k];globalThis[k]=v}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'}),root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,before)})
 const {default:Media}=await vite.ssrLoadModule('/src/components/DesignUnifiedMediaComposer.jsx');let reads=0,dispatches=0;const checksum='a'.repeat(64),source={kind:'private_attachment',id:'original',checksum,label:'Owner PNG',mime_type:'image/png'},signal=new AbortController().signal
 const studio={listPrivateAnimationSources:async()=>{reads++;return[source]},listMediaChoices:async()=>{dispatches++;return{choices:[]}},generateMediaRequest:async()=>{dispatches++},quoteMediaRequest:async()=>{dispatches++}}
 const render=(id,preferred)=>act(async()=>root.render(createElement(Media,{key:id,studio,mode:'video',outputKind:'motion',organizationId:'org',userId:'actor',context:{kind:'private',id},brief:{id:'brief',frozen_version_id:'v1'},signal,preferredInput:preferred})))
 await render('chat',{source,purpose:'motion',conversationId:'chat'});assert.equal(reads,1)
 const select=all(env.container).find(n=>n.tagName==='SELECT'&&props(n)?.['aria-label']==='Starting image');assert.equal(props(select).value,'original')
 const checkbox=all(env.container).find(n=>n.tagName==='INPUT'&&props(n)?.type==='checkbox');assert.equal(props(checkbox).checked,false);assert.equal(dispatches,0)
 await render('other',{source,purpose:'motion',conversationId:'chat'});assert.equal(reads,1);const other=all(env.container).find(n=>n.tagName==='SELECT'&&props(n)?.['aria-label']==='Starting image');assert.equal(props(other).value,'');assert.equal(dispatches,0)
})

test('private upload context switch during checksum or saved-chat verification cannot start an upload',async t=>{
 const env=mountedEnvironment(),before={};for(const [k,v] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[k]=globalThis[k];globalThis[k]=v}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'}),root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,before)})
 const repo={departmentChat:{}};const code=transformSync(readFileSync(new URL('../components/DesignPrivateAttachmentPanel.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export default function','function'),{loader:'jsx',jsxFactory:'React.createElement'}).code;const Panel=new Function('React','useEffect','useRef','useState','departmentChat','DesignReferenceOriginal',code+';return DesignPrivateAttachmentPanel')(React,React.useEffect,React.useRef,React.useState,repo.departmentChat,()=>null);const old={list:repo.departmentChat.listDesignPrivateAttachments,upload:repo.departmentChat.uploadDesignPrivateAttachment};let uploads=0,ensures=0,finishBytes,finishEnsure;repo.departmentChat.listDesignPrivateAttachments=async()=>[];repo.departmentChat.uploadDesignPrivateAttachment=async()=>{uploads++};t.after(()=>{repo.departmentChat.listDesignPrivateAttachments=old.list;repo.departmentChat.uploadDesignPrivateAttachment=old.upload})
 const signal=new AbortController().signal,scope={organizationId:'org',signal},onSelection=()=>{},run=fn=>fn(),ensure=()=>{ensures++;return new Promise(resolve=>{finishEnsure=resolve})}
 const render=key=>act(async()=>root.render(createElement(Panel,{conversationKey:key,conversationId:key,requestScope:scope,run,ensureConversation:ensure,selectedIds:[],onSelection})))
 await render('a');const file={name:'test.png',size:4,arrayBuffer:()=>new Promise(resolve=>{finishBytes=resolve})};let input=all(env.container).find(n=>n.tagName==='INPUT'&&props(n)?.type==='file');await act(async()=>props(input).onChange({target:{files:[file]}}));let pending;await act(async()=>{pending=props(all(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent==='Upload reference')).onClick()});await render('b');await act(async()=>{finishBytes(new Uint8Array([1,2,3,4]).buffer);await pending});assert.equal(ensures,0);assert.equal(uploads,0)
 await render('c');input=all(env.container).find(n=>n.tagName==='INPUT'&&props(n)?.type==='file');await act(async()=>props(input).onChange({target:{files:[{...file,arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer}]}}));await act(async()=>{pending=props(all(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent==='Upload reference')).onClick();await new Promise(resolve=>setTimeout(resolve,20))});assert.equal(ensures,1);await render('d');await act(async()=>{finishEnsure({id:'c'});await pending});assert.equal(uploads,0)
})
