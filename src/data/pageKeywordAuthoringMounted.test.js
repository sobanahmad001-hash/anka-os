import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
import {keywordAuthoringKeys} from './pageKeywordAuthoring.js'
const require=createRequire(import.meta.url)
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
async function mount(t) {
  const env=mountedEnvironment(), storage=new Map(), calls=[]
  const names=['window','document','sessionStorage','confirm','IS_REACT_ACT_ENVIRONMENT']
  const prior=Object.fromEntries(names.map(k=>[k,globalThis[k]]))
  Object.assign(globalThis,{window:env.window,document:env.document,confirm:()=>true,IS_REACT_ACT_ENVIRONMENT:true,
    sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
  const asset={kind:'website_page',id:'page',pageKey:'stable-key',title:'Home',organizationId:'org',projectId:'project',engagementId:'eng',sourceVersionId:'arch',architectureVersionId:'arch'}
  const workspace={engagement:{id:'eng',project_id:'project',organization_id:'org'},stages:[],contentServices:[{id:'service'}],artifacts:[{id:'root',artifact_type:'website_architecture',organization_id:'org',project_id:'project',engagement_id:'eng'}],versions:[{id:'arch',version_number:2,organization_id:'org',artifact_id:'root',content:{pages:[{page_key:'stable-key',slug:'home',title:'Home'}]}}]}
  const row={page_id:'page',source:{page_key:'stable-key'}}, pages={list:async()=>({reference:{artifact_id:'root',artifact_version_id:'arch'},pages:[row],counts:{filtered_total:1}})}
  const state={lose:false,rollback:false,receipt:null,reads:[]}
  const studio={organizationId:'org',load:async()=>workspace,
    savePageKeywordStrategy:async input=>{
      calls.push(input)
      if(state.rollback)throw Object.assign(Error('Architecture changed'),{rollbackVerified:true})
      const identity=Object.fromEntries(['request_id','project_id','engagement_id','page_id','page_key','architecture_version_id'].map(key=>[key,input[key]]))
      state.receipt={...identity,artifact_id:'strategy',warnings:[],version:{id:'version',artifact_id:'strategy',organization_id:'org',created_by:'actor',version_number:1,parent_version_id:null,content:input.content}}
      if(state.lose)throw Error('Response lost')
      return state.receipt
    },
    recoverPageKeywordStrategy:async identity=>{state.reads.push(identity);return state.receipt}
  }
  function load(url){const mod={exports:{}},code=transformSync(readFileSync(url,'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).code
    new Function('require','module','exports','React',code)(s=>{
      if(s==='react')return React
      if(/(KeywordStrategyEditor|KeywordCsvImportPanel|ContentStudio)\.jsx$/.test(s))return load(new URL(s,url))
      if(/\/(contentStudio|contentKeywordImpact|contentKeywordCsv|pageKeywordAuthoring)\.js$/.test(s))return require(fileURLToPath(new URL(s,url)))
      return {__esModule:true,default:()=>null,WebsiteArchitecturePathAlert:()=>null}
    },mod,mod.exports,React);return mod.exports}
  const Panel=load(new URL('../components/PageKeywordAuthoring.jsx',import.meta.url)).PageStrategyEditor
  let root=createRoot(env.container)
  async function render(){await act(async()=>root.render(React.createElement(Panel,{asset,actorId:'actor',studio,pages,onClose(){}})))}
  async function reopen(){await act(async()=>root.unmount());root=createRoot(env.container);await render()}
  await render()
  t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,prior)})
  const button=name=>elements(env.container,'button').find(n=>n.textContent===name)
  const field=name=>['input','select'].flatMap(tag=>elements(env.container,tag)).find(n=>props(n)['aria-label']===name+' for keyword 1')
  const change=(name,value)=>act(async()=>props(field(name)).onChange({target:{value}}))
  async function edit(){if(!field('Keyword phrase'))await act(async()=>props(button('Add keyword')).onClick());await change('Keyword phrase','example term');await change('Language or locale','en');await change('Target type','page');await change('Target','stable-key')}
  const submit=()=>act(async()=>props(elements(env.container,'form')[0]).onSubmit({preventDefault(){}}))
  const check=()=>act(async()=>props(button('Check original strategy receipt')).onClick())
  return {env,storage,calls,state,row,workspace,edit,submit,reopen,field,button,check,keys:keywordAuthoringKeys(asset,'actor')}
}
test('registered page opens the canonical keyword form, restores edited rows and saves the exact source and page key',async t=>{
  const ui=await mount(t);await ui.edit();await ui.reopen();assert.equal(props(ui.field('Keyword phrase')).value,'example term')
  await ui.submit();assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].content.source_architecture_version_id,'arch');assert.equal(ui.calls[0].content.keywords[0].target_page_key,'stable-key')
  assert.equal(ui.storage.has(ui.keys.attempt),false);assert.match(ui.env.container.textContent,/Strategy version 1 saved/)
})
test('foreign project at entry and changed registered page at confirmation deny authoring',async t=>{
  const ui=await mount(t);await ui.edit();ui.row.page_id='different';await ui.submit();assert.equal(ui.calls.length,0);assert.equal(ui.storage.has(ui.keys.attempt),false)
  ui.workspace.engagement.project_id='other';await ui.reopen();assert.equal(elements(ui.env.container,'form').length,0);assert.match(ui.env.container.textContent,/project and engagement/)
})
test('ambiguous canonical save retains its attempted payload and draft across reload even when a matching strategy appears',async t=>{
  const ui=await mount(t);await ui.edit();ui.state.lose=true;await ui.submit();const original=ui.storage.get(ui.keys.attempt)
  assert.equal(JSON.parse(original).input.content.keywords[0].target_page_key,'stable-key')
  ui.workspace.artifacts.push({id:'strategy',artifact_type:'keyword_strategy'});await ui.reopen()
  assert.equal(ui.storage.get(ui.keys.attempt),original);assert.equal(ui.storage.has(ui.keys.draft),true);assert.equal(elements(ui.env.container,'form').length,0)
  assert.match(ui.env.container.textContent,/unverified outcome/);assert.equal(ui.calls.length,1)
})
test('absent and foreign receipts preserve the original until an exact local read succeeds',async t=>{
  const ui=await mount(t);await ui.edit();ui.state.lose=true;await ui.submit()
  const original=ui.storage.get(ui.keys.attempt),exact=ui.state.receipt
  await ui.reopen();ui.state.receipt=null;await ui.check()
  assert.equal(ui.storage.get(ui.keys.attempt),original)
  assert.deepEqual(ui.state.reads[0],JSON.parse(original).identity)
  for(const changed of [{...exact,page_key:'elsewhere'},{...exact,request_id:'different'},
    {...exact,version:{...exact.version,created_by:'other'}},{...exact,version:{...exact.version,parent_version_id:'other'}}]){
    ui.state.receipt=changed;await ui.check();assert.equal(ui.storage.get(ui.keys.attempt),original)
  }
  ui.state.receipt=exact;await ui.check();assert.equal(ui.storage.has(ui.keys.attempt),false)
  assert.equal(ui.calls.length,1);assert.match(ui.env.container.textContent,/Strategy version 1 saved/)
})
test('precontract attempt stays visible and cannot dispatch either a replacement or an invented receipt identity',async t=>{
  const ui=await mount(t)
  const legacy=JSON.stringify({id:'local-only',actorId:'actor',pageId:'page',pageKey:'stable-key',input:{engagement_id:'eng'}})
  ui.storage.set(ui.keys.attempt,legacy);await ui.reopen()
  assert.equal(ui.button('Check original strategy receipt'),undefined);assert.equal(ui.button('Save first version'),undefined)
  assert.equal(ui.storage.get(ui.keys.attempt),legacy);assert.equal(ui.state.reads.length,0);assert.equal(ui.calls.length,0)
})

test('verified rollback restores the edited draft and allows only an explicit retry after reload',async t=>{
  const ui=await mount(t);await ui.edit();ui.state.rollback=true;await ui.submit()
  assert.equal(ui.storage.has(ui.keys.attempt),false)
  assert.match(ui.env.container.textContent,/save rolled back/)
  assert.equal(props(ui.field('Keyword phrase')).value,'example term')
  assert.equal(ui.calls.length,1)
  await ui.reopen();assert.equal(props(ui.field('Keyword phrase')).value,'example term')
  assert.equal(ui.calls.length,1)
  ui.state.rollback=false;await ui.submit()
  assert.equal(ui.calls.length,2);assert.notEqual(ui.calls[0].request_id,ui.calls[1].request_id)
  assert.equal(ui.storage.has(ui.keys.attempt),false)
  assert.match(ui.env.container.textContent,/Strategy version 1 saved/)
})
test('canonical repository uses separate page save and receipt lookup actions and preserves Workshop save',async()=>{
  const calls=[],mod={exports:{}}
  const file=new URL('./contentStudioRepository.js',import.meta.url)
  const code=transformSync(readFileSync(file,'utf8'),{format:'cjs'}).code
  const client={functions:{invoke:async(name,{body})=>{calls.push({name,body});return {data:{data:null}}}}}
  new Function('require','module','exports',code)(s=>s.endsWith('/lib/supabase.js')?{supabase:client}:require(fileURLToPath(new URL(s,file))),mod,mod.exports)
  const repo=mod.exports.createContentStudioScope('org')
  const identity={request_id:'original',project_id:'project',engagement_id:'eng',page_id:'page',page_key:'stable-key',architecture_version_id:'arch'}
  const fields={artifact_type:'keyword_strategy',content:{keywords:[]}}
  await repo.savePageKeywordStrategy({...fields,...identity})
  assert.equal(await repo.recoverPageKeywordStrategy(identity),null)
  await repo.saveArtifact(fields)
  assert.deepEqual(calls.map(call=>call.name),['content-studio','content-studio','content-studio'])
  assert.deepEqual(calls.map(call=>call.body),[
    {...fields,...identity,action:'save_page_keyword_strategy',organization_id:'org'},
    {...identity,action:'recover_page_keyword_strategy',organization_id:'org'},
    {...fields,action:'save_artifact',organization_id:'org'},
  ])
})

test('page transport exposes only explicit rollback proof, never HTTP status or missing outcome',async()=>{
  const file=new URL('./contentStudioRepository.js',import.meta.url),mod={exports:{}}
  const code=transformSync(readFileSync(file,'utf8'),{format:'cjs'}).code
  let response
  const client={functions:{invoke:async()=>response}}
  new Function('require','module','exports',code)(s=>s.endsWith('/lib/supabase.js')?{supabase:client}:require(fileURLToPath(new URL(s,file))),mod,mod.exports)
  const repo=mod.exports.createContentStudioScope('org')
  response={error:{message:'HTTP error',context:new Response(JSON.stringify({error:'Verified SQL rollback',code:'22023',rollback_verified:true,request_retained:false}),{status:400})}}
  await assert.rejects(repo.savePageKeywordStrategy({}),e=>e.rollbackVerified===true&&e.code==='22023')
  for(const detail of [{error:'Busy',code:'40001',rollback_verified:false,request_retained:true},{error:'Unknown',rollback_verified:true,request_retained:true},{error:'HTTP rejection only'}]){
    response={error:{message:'Failed',context:new Response(JSON.stringify(detail),{status:409})}}
    await assert.rejects(repo.savePageKeywordStrategy({}),e=>e.rollbackVerified===false)
  }
  response={data:{error:'No trustworthy response'}}
  await assert.rejects(repo.savePageKeywordStrategy({}),e=>e.rollbackVerified===false)
})
