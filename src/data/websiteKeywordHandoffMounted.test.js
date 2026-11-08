import test from 'node:test'
import assert from 'node:assert/strict'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'

test('Website plan uses exact brief passages, current service version and registered page for research', async t => {
  const id = n => 'a0000000-0000-4000-8000-'+String(n).padStart(12,'0')
  const scope = {organizationId:id(1),projectId:id(2),engagementId:id(3)}, actor=id(4)
  const binding = {request_id:id(5),checkpoint_id:id(6),source_version:72,brief_sha256:'b'.repeat(64)}
  const brief='Goal: request a consultation. Audience: independent retailers.'
  const structure={version_id:id(7),version_number:1,conversation_id:id(8),positioning_version_id:id(9),wording_sha256:'c'.repeat(64)}
  const row={page_id:id(10),source:{title:'Home',path:'/',page_key:'home'}}
  const calls=[]
  let drift=false
  const fixtures={
    supabase:{from(){throw Error('Unexpected table access')},rpc(name,args){
      calls.push(name)
      const common={organization_id:id(1),project_id:id(2),engagement_id:id(3),actor_id:actor}
      let data
      if(name==='read_project_positioning_output') data={...common,binding_id:binding.request_id,selected:null,current:{version_id:id(9),version_number:1,conversation_id:id(8),binding_id:binding.request_id,wording_sha256:'a'.repeat(64)}}
      else if(name==='read_project_service_structure_output') data={...common,current:drift?{...structure,version_id:id(20)}:structure,positioning_version_id:id(9),selected:args.p_version_id?{...structure,wording:'Retail consulting services'}:null}
      else throw Error(name)
      return {abortSignal:async()=>({data})}
    }},
    catalogue:{listStageArtifacts:async()=>({offset:0,has_more:false,artifacts:[{artifact_type:'website_architecture',artifact_version_id:id(11),title:'Architecture',version_number:2}]})},
    pages:{list:async args=>{assert.equal(args.architectureVersionId,id(11));return {reference:{artifact_id:id(12),artifact_version_id:id(11)},counts:{filtered_total:2},pages:[row,{page_id:null,source:{title:'Unregistered'}}]}}},
    evidence:{list:async args=>{assert.equal(args.pageId,id(10));assert.equal(args.architectureVersionId,id(11));return {offset:0,matching:1,items:[{id:id(13),query:'retail services',snapshot_date:'2026-11-01'}]}}}
  }
  const saved=[]
  fixtures.actor=actor
  fixtures.org=scope.organizationId
  fixtures.studio={organizationId:id(1),load:async()=>({
    engagement:{id:id(3),project_id:id(2),organization_id:id(1)},stages:[],contentServices:[{id:id(14)}],
    artifacts:[{id:id(12),artifact_type:'website_architecture',organization_id:id(1),project_id:id(2),engagement_id:id(3)}],
    versions:[{id:id(11),artifact_id:id(12),organization_id:id(1),version_number:2,content:{pages:[{title:'Home',slug:'home',page_key:'home'}]}}]
  }),savePageKeywordStrategy:async input=>{
    saved.push(input)
    return {...input,artifact_id:id(15),warnings:[],version:{id:id(16),artifact_id:id(15),organization_id:id(1),created_by:actor,version_number:1,parent_version_id:null,content:input.content}}
  }}
  const storage=new Map()
  const env=mountedEnvironment()
  const globals={window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:()=>{},localStorage:{getItem:()=>null},confirm:()=>true,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},__websiteHandoff:fixtures}
  const old=Object.fromEntries(Object.keys(globals).map(k=>[k,globalThis[k]]))
  Object.assign(globalThis,globals)
  const modules={empty:'export default function Empty(){return null}', 'react-router-dom':'export const Link=()=>null,useSearchParams=()=>[]','/lib/supabase.js':'export const supabase=globalThis.__websiteHandoff.supabase',
    '/projectPipelineConfigurations.js':'export const projectPipelineConfigurations=globalThis.__websiteHandoff.catalogue',
    '/projectWebsitePages.js':'export const projectWebsitePages=globalThis.__websiteHandoff.pages',
    '/projectWebsiteSeoObservations.js':'export const projectWebsiteSeoObservations=globalThis.__websiteHandoff.evidence',
    '/OrganizationContext.jsx':"export const useOrganization=()=>({activeOrganizationId:globalThis.__websiteHandoff.org})",
    '/AuthContext.jsx':"export const useAuth=()=>({user:{id:globalThis.__websiteHandoff.actor}})",
    '/contentStudioRepository.js':"export const contentStudio={forOrganization:()=>globalThis.__websiteHandoff.studio}"}
  const server=await createServer({ssr:{noExternal:['react-router-dom']},server:{middlewareMode:true},logLevel:'silent',plugins:[{name:'local-handoff-fixture',enforce:'pre',resolveId(name,importer){if(importer?.endsWith('/ContentStudio.jsx') && name.startsWith('../components/') && name.endsWith('.jsx') && !name.includes('KeywordStrategyEditor'))return '\0handoffempty';const key=Object.keys(modules).find(k=>name.endsWith(k));return key?'\0handoff'+key:null},load(name){if(name.startsWith('\0handoff'))return modules[name.slice(8)]}}]})
  const root=createRoot(env.container)
  t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,old)})
  const {default:Panel}=await server.ssrLoadModule('/src/components/ProjectStagePlanPanel.jsx')
  const foundation={read:async(_,key)=>({current_binding:binding,selected:key?{...binding,brief_text:brief,matches_current_brief:true}:null})}
  await act(async()=>root.render(createElement(Panel,{scope,actorId:actor,positioningClient:fixtures.supabase,repository:{read:async()=>({organization_id:id(1),project_id:id(2),engagement_id:id(3),state:'unconfigured',groups:[],bindings:[],can_manage:true})},foundationRepository:foundation})))
  const all=n=>[n,...n.childNodes.flatMap(all)], fields=tag=>all(env.container).filter(n=>n.tagName===tag), props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
  const button=label=>fields('BUTTON').find(n=>typeof label==='string'?n.textContent===label:label.test(n.textContent))
  async function click(label){for(let i=0;i<60&&!button(label);i++)await act(()=>new Promise(r=>setTimeout(r,15)));const b=button(label);assert.ok(b,String(label));await act(async()=>props(b).onClick({}))}
  const change=(node,value)=>act(async()=>props(node).onChange({target:{value}}))
  await click(/^WebsiteEach/);await click('Read bound business brief')
  await change(fields('TEXTAREA')[0],'Invented goal');await change(fields('TEXTAREA')[1],'independent retailers')
  assert.equal(props(button('Use these passages in this plan session')).disabled,true)
  await change(fields('TEXTAREA')[0],'request a consultation')
  await click('Use these passages in this plan session');await click('Continue to Website keyword research')
  await click('Use this version as keyword research input');await click('Find approved architectures')
  await change(fields('SELECT').find(n=>n.textContent.includes('Choose a version')),id(11))
  await click('Find registered pages');assert.equal(button('Unregistered'),undefined)
  await click('Home');await click('Read stored query evidence')
  assert.match(env.container.textContent,/retail services/);assert.match(env.container.textContent,/unknown metrics/)
  drift=true;await click('Open keyword strategy for this page')
  assert.equal(fields('FORM').length,0);assert.match(env.container.textContent,/latest service structure/)
  drift=false;await click('Open keyword strategy for this page')
  const field=name=>[...fields('INPUT'),...fields('SELECT')].find(n=>props(n)?.['aria-label']===name+' for keyword 1')
  for(let i=0;i<180&&!field('Keyword phrase')&&!button('Add keyword');i++)await act(()=>new Promise(r=>setTimeout(r,20)))
  if(!field('Keyword phrase'))await click('Add keyword')
  await change(field('Keyword phrase'),'retail consulting')
  await change(field('Language or locale'),'en')
  await change(field('Target type'),'page')
  await change(field('Target'),'home')
  const submit=()=>act(async()=>props(fields('FORM')[0]).onSubmit({preventDefault(){}}))
  drift=true;await submit();assert.equal(saved.length,0)
  drift=false;await submit();assert.equal(saved.length,1)
  assert.equal(saved[0].content.keywords[0].target_page_key,'home')
  assert.equal(saved[0].content.keywords[0].search_volume,null)
  assert.equal(saved[0].content.source_architecture_version_id,id(11))
  assert.match(env.container.textContent,/Strategy version 1 saved/)
  assert.ok(calls.every(n=>n.startsWith('read_')))
})
