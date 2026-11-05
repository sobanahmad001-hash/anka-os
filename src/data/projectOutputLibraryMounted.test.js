import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
const native=createRequire(import.meta.url),nodes=n=>[n,...n.childNodes.flatMap(nodes)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
async function mount(t){
 const env=mountedEnvironment(),previous={document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
 const source=transformSync(readFileSync(new URL('../components/ProjectOutputLibrary.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code,module={exports:{}}
 new Function('require','module','exports','React',source)(name=>name.endsWith('.css')?{}:name.includes('WorkspaceDialog')?{__esModule:true,default:({title,children,onClose})=>React.createElement('div',{'aria-label':title},React.createElement('button',{onClick:onClose},'Close'),children)}:name==='react-router-dom'?{Link:({to,children,...rest})=>React.createElement('a',{href:to,...rest},children)}:native(name),module,module.exports,React)
 const scope={organization_id:'org',project_id:'project',engagement_id:'eng'},workspace={project:{id:'project',organization_id:'org'},engagement:{...scope,id:'eng'},activeServices:[{id:'service',organization_id:'org',engagement_id:'eng',status:'active',service_catalog:{department_id:'content'}}],workshopArtifacts:[{...scope,id:'output',title:'Saved copy',artifact_type:'content',versions:[{id:'v2',artifact_id:'output',organization_id:'org',version_number:2},{id:'v1',artifact_id:'output',organization_id:'org',version_number:1}]}],projectTasks:[],engagementWorkItems:[{...scope,id:'work',title:'Linked work',department_id:'content',status:'not_started',linked_artifact_id:'output',linked_artifact_version_id:'v1'}],journey:[]}
 const input={workspace},root=createRoot(env.container),render=()=>act(async()=>root.render(React.createElement(module.exports.default,input)))
 const all=()=>nodes(env.container),button=text=>all().find(n=>n.tagName==='BUTTON'&&n.textContent.startsWith(text)),link=()=>all().find(n=>n.tagName==='A'&&n.textContent==='Open exact version'),select=()=>all().find(n=>n.tagName==='SELECT'&&n.parentNode.textContent.startsWith('Saved version'))
 const click=()=>act(async()=>props(button('Inspect output')).onClick()),choose=id=>act(async()=>props(select()).onChange({target:{value:id}}))
 await render();t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
 return {env,input,render,all,click,choose,link}
}
test('selected output never substitutes a newer version; stale and busy contexts block navigation',async t=>{
 const u=await mount(t);await u.click();assert.equal(u.link(),undefined);await u.choose('v1');assert.match(props(u.link()).href,/version=v1/)
 assert.deepEqual(u.all().filter(n=>n.tagName==='OPTION').slice(-2).map(n=>n.textContent),['Version 2','Version 1']);assert.match(u.env.container.textContent,/Version: v1/)
 for(const state of ['stale','busy']){u.input[state]=true;await u.render();assert.equal(u.all().filter(n=>props(n)?.href).length,0);for(const title of ['Open exact version','Linked work']){const button=u.all().find(n=>n.tagName==='BUTTON'&&n.textContent===title);assert.ok(button);assert.equal(props(button).disabled,true)}u.input[state]=false;await u.render();assert.match(props(u.link()).href,/version=v1/);assert.ok(u.all().some(n=>props(n)?.href?.includes('/engagement_work_item/work')))}
 u.input.workspace={...u.input.workspace,workshopArtifacts:u.input.workspace.workshopArtifacts.map(a=>({...a,versions:a.versions.filter(v=>v.id!=='v1')}))};await u.render();assert.equal(u.link(),undefined);assert.equal(props(u.all().find(n=>n.tagName==='SELECT'&&n.parentNode.textContent.startsWith('Saved version'))).value,'')
})
test('project switch clears selected output and search rather than reusing same-ID context',async t=>{
 const u=await mount(t);const search=u.all().find(n=>n.tagName==='INPUT');await act(async()=>props(search).onChange({target:{value:'Saved'}}));await u.click();await u.choose('v1')
 u.input.workspace={...u.input.workspace,project:{id:'other',organization_id:'org'},engagement:null,workshopArtifacts:[]};await u.render();assert.equal(u.link(),undefined);assert.equal(props(u.all().find(n=>n.tagName==='INPUT')).value,'');assert.match(u.env.container.textContent,/No saved Workshop outputs/)
})
test('stage output selection opens only the scoped exact version and reports an unavailable pin',async t=>{
 const u=await mount(t)
 u.input.exactSelection={scope:{organizationId:'org',projectId:'project',engagementId:'eng'},artifactId:'output',versionId:'v1'}
 await u.render();assert.match(props(u.link()).href,/version=v1/)
 u.input.exactSelection={...u.input.exactSelection,versionId:'missing'};await u.render()
 assert.equal(u.link(),undefined);assert.match(u.env.container.textContent,/no other version was substituted/)
 u.input.workspace={...u.input.workspace,project:{id:'other',organization_id:'org'},engagement:null,workshopArtifacts:[]};await u.render();assert.equal(u.link(),undefined)
})
