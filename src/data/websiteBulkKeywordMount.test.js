import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {eligibleKeyword} from './bulkKeywordReview.js'
import {assessQuery} from './keywordAssessment.js'
const nodes=node=>[node,...node.childNodes.flatMap(nodes)]
const props=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))]||{}
test('table startup and visible selection exclude existing and dismissed targets',async()=>{
 const env=mountedEnvironment(),old={window:globalThis.window,document:globalThis.document,sessionStorage:globalThis.sessionStorage,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{window:env.window,document:env.document,sessionStorage:{getItem:()=>null},IS_REACT_ACT_ENVIRONMENT:true})
 const page={id:'page',title:'Home',url:'https://example.com/',keywords:1,observed:true}
 const rows=[{query:'primary',roles:'primary',state:'selected',impressions:20},{query:'visible',roles:null,state:'suggested',impressions:30},{query:'dismissed',roles:null,state:'dismissed',impressions:40}]
 let reviewProps,keywordReads=0
 const module={exports:{}}
 const require=name=>{
  if(name==='react')return React
  if(name.includes('WebsiteUrlGroups'))return {__esModule:true,default:()=>null}
  if(name.includes('WebsitePageHealth'))return {usePageHealth:()=>({rows:[]}),HealthSummary:()=>null}
  if(name.includes('AuthContext'))return {useAuth:()=>({user:{id:'actor'}})}
  if(name.includes('supabase'))return {supabase:{rpc:async name=>{
   if(name==='website_keywords_table')keywordReads++
   return {data:name==='website_pages_table'?{items:[page],total:1}:{items:rows,total:3,page:{...page,path:'/'},source:null},error:null}
  }}}
  if(name.includes('bulkKeywordReview.js'))return {eligibleKeyword}
  if(name.includes('keywordAssessment'))return {assessQuery}
  if(name.includes('BulkKeywordReview.jsx'))return {__esModule:true,default:value=>{reviewProps=value;return React.createElement('p',null,'Bulk review')}}
  throw Error(name)
 }
 const code=transformSync(readFileSync(new URL('../components/WebsiteTables.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
 new Function('require','module','exports','React',code)(require,module,module.exports,React)
 const root=createRoot(env.container),settle=()=>new Promise(resolve=>setTimeout(resolve,200))
 try{
  await act(async()=>{root.render(React.createElement(module.exports.default,{workspace:{project:{id:'project',organization_id:'org',name:'Example Company'}},onOpen:()=>{}}));await settle()})
  await act(settle)
  assert.equal(keywordReads,0)
  const find=text=>nodes(env.container).find(node=>node.textContent===text&&typeof props(node).onClick==='function')
  assert.equal(props(find('URL groups'))['aria-pressed'],true)
  await act(async()=>{props(find('All pages')).onClick();await settle()})
  await act(settle)
  await act(async()=>{props(find('Keywords for Home')).onClick();await settle()})
  await act(settle)
  const selectAll=nodes(env.container).find(node=>props(node).type==='checkbox'&&!props(node)['aria-label'])
  assert.ok(selectAll)
  await act(async()=>props(selectAll).onChange({target:{checked:true}}))
  await act(async()=>props(find('Review 1 selected rows')).onClick())
  assert.deepEqual(reviewProps.items.map(row=>row.query),['visible'])
  assert.match(reviewProps.recoveryKey,/actor:org:project:page$/)
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,old)}
})
