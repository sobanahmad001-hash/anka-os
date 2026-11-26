import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
import {consentSuccessor} from './contentVersionConsent.js'
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
test('explicit consent saves once and verifies only the exact approved checksum',async t=>{
 const env=mountedEnvironment(),previous={document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
 const module={exports:{}},code=transformSync(readFileSync(new URL('../components/ContentVersionConsent.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
 new Function('require','module','exports','React',code)(n=>n==='react'?React:{consentSuccessor},module,module.exports,React)
 const root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
 const calls=[],artifact={id:'a',artifact_type:'content',engagement_id:'e'},version={id:'v',artifact_id:'a',version_number:1,content_checksum:'hash',data_classification:'internal',content:{schema_version:2,body:'Public wording'}}
 let returned='hash',savedId
 const repository={saveArtifact:async input=>{calls.push(input);return {artifact_id:'a',version:{id:'v2'}}},getProjectContext:async()=>({project_id:'p',approved_versions:[{artifact_id:'a',artifact_version_id:'v2',content_checksum:returned,approval_id:'approval'}]})}
 const input={artifact,version,latestId:'v',projectId:'p',repository,onSaved:async id=>{savedId=id}}
 const render=key=>act(async()=>root.render(React.createElement(module.exports.default,{...input,key})))
 const button=s=>elements(env.container,'button').find(n=>n.textContent===s)
 await render('v');assert.equal(props(button('Save consented version')).disabled,true)
 await act(async()=>props(elements(env.container,'input')[0]).onChange({target:{checked:true}}))
 const save=props(button('Save consented version')).onClick
 await act(async()=>Promise.all([save(),save()]))
 assert.equal(calls.length,1);assert.equal(savedId,'v2');assert.equal(calls[0].ai_use_allowed,true)
 input.version={...version,id:'v2',ai_use_allowed:true};input.latestId='v2';await render('v2')
 await act(async()=>props(button('Verify approved project context')).onClick())
 assert.match(env.container.textContent,/Approved project context verified: v2/)
 returned='wrong';await act(async()=>props(button('Verify approved project context')).onClick())
 assert.doesNotMatch(env.container.textContent,/Approved project context verified:/)
 assert.match(env.container.textContent,/not in approved project AI context/)
})
