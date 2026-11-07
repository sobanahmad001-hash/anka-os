import assert from 'node:assert/strict'
import test from 'node:test'
import {act,createElement,StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
import {websiteAsset} from './projectAssetWork.js'
const id=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0')
const props=node=>{const key=node&&Object.keys(node).find(k=>k.startsWith('__reactProps$'));return key?node[key]:{}}
async function mount(t){
 const f={actor:id(1),calls:[],denied:false,revision:1,gate:null},scope={organizationId:id(2),projectId:id(3),engagementId:id(4),brandId:id(5),architectureVersionId:id(7)}
 const context={organization_id:id(2),project_id:id(3),engagement_id:id(4),brand_id:id(5),page_id:id(6),page_key:'home',architecture_version_id:id(7),source_state:'available',planned_page:{title:'Homepage',path:'/'},tracked_page:{id:id(8)},reporting_binding_id:null,provider_request_made:false,provider_observations_ready:false,legacy_provider_metrics_withheld:true,recheck_reasons:['legacy_observation_not_version_bound']}
 f.client={auth:{async getUser(){return {data:{user:{id:f.actor}}}}},async rpc(name,args){f.calls.push({name,args});if(f.gate)await f.gate;if(f.denied)return {error:{code:'42501',message:'Page access denied'}};if(name==='read_project_page_keyword_targets')return {data:{page_id:id(6),measurement_kind:'planned_target',history:[],history_limit:50,revision:f.revision,current:{organization_id:id(2),project_id:id(3),page_id:id(6),revision:f.revision,strategy_version_id:id(9),source_checksum:'a'.repeat(64),targets:[{keyword_index:0,role:'primary',cluster:'Local services',source:{term:'Example term',locale:'en',evidence_source:'Manual research',observation_date:'2026-11-01'}}]}}};assert.equal(name,'list_project_website_page_seo_observations');return {data:{context:structuredClone(context),category:args.p_category,items:[],total:0,matching:0,offset:0,has_more:false,provider_request_made:false,provider_period_known:false}}}}
 const before=globalThis.__marketingPlanningClient;globalThis.__marketingPlanningClient=f.client
 const env=mountedEnvironment(),names=['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','sessionStorage','fetch'],prior=Object.fromEntries(names.map(n=>[n,globalThis[n]]));Object.assign(globalThis,{document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:()=>null},fetch(){throw Error('Network forbidden')}})
 const server=await createServer({ssr:{noExternal:['react-router-dom','react-router'],resolve:{conditions:['module','import']}},configFile:false,cacheDir:'../marketing-vite-cache',server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[react(),{name:'local-marketing-evidence',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase.js'))return '\0marketing-client'},load(key){if(key==='\0marketing-client')return 'export const supabase=globalThis.__marketingPlanningClient'}}]})
 t.after(async()=>server.close())
 const {default:Panel}=await server.ssrLoadModule('/src/components/ProjectAssetWorkspace.jsx'),root=createRoot(env.container)
 const {MemoryRouter}=await server.ssrLoadModule('react-router-dom')
 const asset=websiteAsset({page_id:id(6),source:{page_key:'home',title:'Homepage',path:'/'},operations:null},scope,{artifact_version_id:id(7),version_number:2})
 let current={asset,actorId:f.actor,workspace:{project:{id:id(3),organization_id:id(2)},engagement:{id:id(4),organization_id:id(2),project_id:id(3),brand_id:id(5)}},signal:new AbortController().signal,onClose(){f.closed=true}}
 t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,prior);globalThis.__marketingPlanningClient=before})
 const render=async changes=>{current={...current,...changes};await act(async()=>root.render(createElement(StrictMode,null,createElement(MemoryRouter,null,createElement(Panel,current)))))}
 await render()
 const button=name=>elements(env.container,'button').find(n=>n.textContent===name),field=name=>['input','textarea'].flatMap(tag=>elements(env.container,tag)).find(n=>props(n)['aria-label']===name)
 const click=async name=>act(async()=>{const node=button(name);assert.ok(node,name);assert.notEqual(props(node).disabled,true,name);await props(node).onClick()})
 const change=async(name,value)=>act(async()=>{const node=field(name);assert.ok(node,name);await props(node).onChange({target:{value,checked:value}})})
 const open=async()=>{await click('Plan Marketing from this page');for(let attempt=0;attempt<40&&!button('Review page for Marketing');attempt++)await act(async()=>{await new Promise(r=>setTimeout(r,25))});assert.ok(button('Review page for Marketing'))}
 const prepare=async()=>{await change('Page Marketing campaign goal','Grow qualified enquiries');await change('Page Marketing channels','Website\nEmail');await change('Confirm page Marketing source review',true);await click('Prepare Marketing planning draft')}
 return {f,env,button,field,click,change,render,open,prepare,current:()=>current}
}
test('normal persistent page asset entry reviews exact sources and prepares an attributed unsaved draft',async t=>{
 const ui=await mount(t);assert.equal(ui.f.calls.length,0);await ui.open();assert.equal(ui.f.calls.length,0);await ui.click('Review page for Marketing');assert.match(ui.env.container.textContent,/Example term.*primary.*Manual research/);assert.match(ui.env.container.textContent,/reporting period are unknown/);await ui.prepare();assert.match(ui.env.container.textContent,/Marketing planning draft · not saved/);assert.match(ui.env.container.textContent,/Website, Email/);assert.match(ui.env.container.textContent,/page home, targeting revision 1/);assert.match(ui.env.container.textContent,/No campaign was created or executed/);assert.ok(ui.f.calls.every(c=>c.args.p_page_id===id(6)));assert.deepEqual([...new Set(ui.f.calls.map(c=>c.name))].sort(),['list_project_website_page_seo_observations','read_project_page_keyword_targets']);assert.equal(props(ui.button('Close asset workspace')).disabled,true);await ui.click('Discard local Marketing draft');await ui.click('Close Marketing planning');assert.ok(ui.button('Plan Marketing from this page'))
})
test('denied source reads never become an empty successful plan',async t=>{
 const ui=await mount(t);await ui.open();ui.f.denied=true;await ui.click('Review page for Marketing');assert.match(ui.env.container.textContent,/Page access denied/);assert.equal(ui.button('Prepare Marketing planning draft'),undefined);assert.doesNotMatch(ui.env.container.textContent,/not saved/)
})
test('reviewed revision changes reject draft preparation while retaining entered goal',async t=>{
 const ui=await mount(t);await ui.open();await ui.click('Review page for Marketing');ui.f.revision=2;await ui.prepare();assert.match(ui.env.container.textContent,/changed; review again/);assert.equal(props(ui.field('Page Marketing campaign goal')).value,'Grow qualified enquiries');assert.doesNotMatch(ui.env.container.textContent,/Marketing planning draft · not saved/)
})
test('actor or request-signal replacement clears local draft and rejects retained callbacks',async t=>{
 const ui=await mount(t);await ui.open();await ui.click('Review page for Marketing');await ui.change('Page Marketing campaign goal','Keep private to actor');const retained=props(ui.button('Prepare Marketing planning draft')).onClick;ui.f.actor=id(50);await ui.render({actorId:id(50),signal:new AbortController().signal});await act(async()=>retained());assert.doesNotMatch(ui.env.container.textContent,/Keep private to actor/);assert.equal(ui.field('Page Marketing campaign goal'),undefined);assert.ok(ui.button('Review page for Marketing'));assert.equal(ui.f.calls.length,4)
})
test('late read cannot repopulate sources after scope replacement',async t=>{
 const ui=await mount(t);await ui.open();let release;ui.f.gate=new Promise(r=>{release=r});const read=props(ui.button('Review page for Marketing')).onClick;await act(async()=>{void read()});await ui.render({signal:new AbortController().signal});await act(async()=>{release();await Promise.resolve()});assert.equal(ui.field('Page Marketing campaign goal'),undefined);assert.doesNotMatch(ui.env.container.textContent,/Example term/)
})

for(const [tab,link] of [['History & conversation','Open project Chat'],['Pipeline','Open existing project pipeline']]){
 test('open Marketing protects the '+tab+' navigation until closed',async t=>{
  const ui=await mount(t)
  if(tab==='Pipeline'){
   const {asset,workspace}=ui.current()
   const work={id:id(14),organization_id:id(2),project_id:id(3),engagement_id:id(4),status:'done',title:'Approved copy',department_id:'content',linked_engagement_stage_instance_id:id(15)}
   await ui.render({asset:{...asset,workRefs:[{kind:'engagement_work_item',id:work.id}]},workspace:{...workspace,engagementWorkItems:[work],journey:[{...work,id:id(15),name:'Content review',status:'completed'}]}})
  }
  await ui.click(tab)
  const anchor=()=>elements(ui.env.container,'a').find(n=>n.textContent===link)
  assert.ok(anchor())
  await ui.open()
  await ui.click('Review page for Marketing')
  await ui.change('Page Marketing campaign goal','Retain this draft')
  assert.equal(props(anchor())['aria-disabled'],true)
  assert.equal(props(elements(ui.env.container,'div').find(n=>props(n).role==='tabpanel')).inert,true)
  await ui.click('Discard local Marketing draft')
  await ui.click('Close Marketing planning')
  assert.equal(props(anchor())['aria-disabled'],false)
 })
}
test('an already mounted keyword editor is inert while Marketing is open and becomes available after discard',async t=>{
 const ui=await mount(t)
 await ui.click('Keywords & evidence')
 await ui.click('Review page keyword targeting')
 for(let i=0;i<50&&(ui.button('Review page keyword targeting')||props(ui.button('Plan Marketing from this page')).disabled);i++)
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))})
 await ui.open()
 await ui.click('Review page for Marketing')
 await ui.change('Page Marketing campaign goal','Retain me')
 const panel=()=>elements(ui.env.container,'div').find(n=>props(n).role==='tabpanel')
 assert.equal(props(panel()).inert,true)
 assert.equal(props(panel()).hidden,true)
 await ui.click('Discard local Marketing draft')
 await ui.click('Close Marketing planning')
 assert.equal(props(panel()).inert,false)
 assert.equal(ui.button('Review page keyword targeting'),undefined)
})
