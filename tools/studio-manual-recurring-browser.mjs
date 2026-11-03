import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {startUxPreview} from './os-uiux-preview.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const out=new URL('../outputs/manual-recurring/',import.meta.url)
await mkdir(out,{recursive:true})
const server=await startUxPreview({port:5293}),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH})
const reports=[]
let current
function fixture({scenario,receipt=null}){
  const app=__integration,setup=app.setup,old=setup.snapshot,id=n=>'b0000000-0000-4000-8000-'+String(n).padStart(12,'0')
  const state={scenario,receipt,calls:[],failure:null}
  globalThis.__recurringPreview=state
  setup.snapshot=async(...args)=>{
    const snap=await old(...args)
    const leaf=snap.leaves.find(row=>row.name==='Discovery brief')||snap.leaves[0]
    const line={service_group:'marketing',start_date:'2028-01-31',target_date:'2028-02-10',timezone:'Asia/Karachi',generation_horizon:3}
    snap.scopes=[{id:id(1),service_id:leaf.id,engagement_service_id:id(8),status:'active',quantity:12,unit:'deliverable',recurrence:'monthly'}]
    snap.state.plan.contributions=[{scope_id:id(1),service_id:leaf.id,cadence:'monthly',service_line:line}]
    // The recurring service owner is independent of setup manager authority.
    snap.can_manage=false
    return snap
  }
  state.table=table=>{const filter={};const q={select:()=>q,eq:(k,v)=>{filter[k]=v;return q},order:()=>q,then:(resolve,reject)=>Promise.resolve(old()).then(s=>{
    const rows=table==='recurring_work_plans'?[id(10),id(11)].map(pid=>({id:pid,organization_id:s.organization_id,project_id:s.project_id,engagement_id:s.engagement_id,status:'draft'})):
      [{id:id(20),plan_id:filter.plan_id,title:filter.plan_id===id(10)?'Original monthly plan':'Seasonal monthly plan',version_number:2,schedule_definition:{service_bridge:{contributors:[{scope_id:id(1)}]}}}]
    return {data:rows}
  }).then(resolve,reject)};return q}
  globalThis.__workBatchRpc=async(name,args)=>{
    state.calls.push({name,args:structuredClone(args)})
    const snap=await old(),owner=__directChatPreview.fixture.data.rows[0].owner_id
    if(args.p_organization_id!==snap.organization_id||args.p_engagement_id!==snap.engagement_id||args.p_project_id!==snap.project_id)throw Error('Unexpected project scope')
    if(name==='recover_service_recurring_plan')return {data:state.receipt?{status:'applied',request_id:args.p_request_id,original_result:state.receipt}:{status:'not_applied',request_id:args.p_request_id}}
    if(args.p_scope_id!==id(1))throw Error('Wrong service scope')
    if(scenario==='denied')return {error:{code:'42501',message:'Only the current primary activated service owner may draft this recurring plan'}}
    if(scenario==='ambiguous'&&!args.p_plan_id)return {error:{code:'22023',message:'Several exact recurring plans already cover this scope; choose the intended existing plan'}}
    const existing=scenario==='ambiguous'?args.p_plan_id:scenario==='existing'?id(10):null
    const qty=scenario==='existing'?15:12, start=args.p_proposal?.effective_start||'2028-01-31'
    const contributions=['Content','Design','Marketing'].map((dept,i)=>({name:dept+' contribution',scope_id:id(i+1),department_id:dept,quantity:qty,unit:'deliverables',service_line:{target_date:'2028-02-10'}}))
    const result={version:1,context:{organization_id:snap.organization_id,project_id:snap.project_id,engagement_id:snap.engagement_id,selected_scope_id:id(1),primary_owner_id:owner,existing_plan_id:existing,plan_head:existing?{schedule_definition:{service_bridge:{deliverable_count:12,work_card_count:36}}}:null},proposal:{version:1,effective_start:start,scheduler:scenario==='scheduled'?{enabled:true}:null},compiled:{title:'Monthly channel content',frequency:'monthly',timezone:'Asia/Karachi',effective_start:start,effective_end:start==='2028-01-31'?'2028-04-29':'2028-05-30',deliverable_count:qty,work_card_count:qty*3,dependency_count:qty*2,channels:['Instagram','LinkedIn'],schedule_definition:{service_bridge:{generation_horizon:3,cycle_anchor:'2028-01-31',contributors:contributions}}},can_apply:true,review_sha256:'a'.repeat(64)}
    if(name==='get_service_recurring_plan_context')return {data:result}
    if(args.p_proposal.scheduler!==null)throw Error('Manual proposal must carry explicit null')
    if(name==='review_service_recurring_plan')return {data:result}
    if(name!=='apply_service_recurring_plan')throw Error('Unexpected command '+name)
    const key=Object.keys(sessionStorage).find(k=>k.startsWith('anka:service-recurring:'))
    const original=JSON.parse(sessionStorage.getItem(key))
    if(original.requestId!==args.p_request_id||original.reviewed.review.review_sha256!==args.p_review_sha256)throw Error('Original request was not persisted')
    if(state.failure==='rollback')return {error:{code:'40001',message:'Recurring source changed; review current service scope'}}
    if(state.failure==='uncertain-not-applied')throw Error('Connection interrupted')
    state.receipt={organization_id:snap.organization_id,project_id:snap.project_id,engagement_id:snap.engagement_id,scope_id:id(1),plan_id:existing||id(10),plan_version_id:id(21),plan_version_number:existing?2:1,request_id:args.p_request_id,work_created:false,activation_performed:false}
    if(state.failure==='lost')throw Error('Connection interrupted after save')
    return {data:state.receipt}
  }
}
try{
 for(const [width,scenario] of [[1440,'new'],[390,'existing'],[390,'denied'],[1440,'ambiguous'],[390,'scheduled']]){
  const page=await browser.newPage({viewport:{width,height:900}});current=page;page.setDefaultTimeout(15000)
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
  const open=async(receipt=null)=>{
    await page.getByRole('textbox',{name:'Message',exact:true}).waitFor()
    await page.evaluate(fixture,{scenario,receipt})
    await page.getByRole('button',{name:'Set up project',exact:true}).click()
    const pane=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Recurring service plan$/})}).last()
    await pane.locator('summary').first().waitFor()
    if(!await pane.getAttribute('open')&&!(await pane.evaluate(n=>n.open)))await pane.locator('summary').first().click()
    return pane
  }
  await page.goto('http://127.0.0.1:5293/tools/project-chat-integration-preview.html?panel=project-navigation&surface=project&state=populated')
  let pane=await open()
  await pane.getByLabel('Saved service').selectOption({index:1})
  await pane.getByRole('button',{name:'Review recurring plan'}).click()
  if(scenario==='denied'||scenario==='scheduled'){
    await pane.getByRole('alert').waitFor()
    assert.equal(await pane.getByRole('button',{name:'Save reviewed plan version'}).count(),0)
  }else{
    if(scenario==='ambiguous'){
      await pane.getByLabel('Existing plan').selectOption('b0000000-0000-4000-8000-000000000011')
      await pane.getByRole('button',{name:'Review recurring plan'}).click()
    }
    const summary=pane.getByRole('region',{name:'Recurring service plan review'})
    await summary.getByText((scenario==='existing'?'15':'12')+' deliverables per cycle',{exact:true}).waitFor()
    await summary.getByText('First cycle: 2028-01-31 through 2028-02-28.').waitFor()
    assert.match(await summary.innerText(),scenario==='existing'?/45 departmental work cards · 30 dependencies/:/36 departmental work cards · 24 dependencies/)
    await summary.getByText('Channels: Instagram, LinkedIn').waitFor()
    await summary.getByText('Contributing services and deadlines',{exact:true}).click()
    assert.match(await summary.innerText(),/Target: 2028-02-10/)
    await summary.scrollIntoViewIfNeeded()
    await page.screenshot({path:fileURLToPath(new URL(width+'-'+scenario+'.png',out))})
    await pane.getByText('First cycle start',{exact:true}).first().click()
    await pane.getByLabel('First cycle start',{exact:true}).fill('2028-02-29')
    assert.equal(await summary.count(),0)
    await pane.getByRole('button',{name:'Review recurring plan'}).click()
    await summary.getByText('First cycle: 2028-02-29 through 2028-03-30.').waitFor()
    if(scenario==='existing'){
      await page.evaluate(()=>{__recurringPreview.failure='rollback'})
      await pane.getByRole('button',{name:'Save reviewed plan version'}).click()
      await pane.getByText(/Recurring source changed/).waitFor()
      assert.equal(await summary.count(),0);assert.equal(await pane.getByLabel('First cycle start').inputValue(),'2028-02-29')
      await pane.getByRole('button',{name:'Review recurring plan'}).click()
      await page.evaluate(()=>{__recurringPreview.failure='uncertain-not-applied'})
      await pane.getByRole('button',{name:'Save reviewed plan version'}).click()
      await pane.getByRole('button',{name:'Check original recurring save'}).click()
      await pane.getByText(/The original draft was not saved/).waitFor()
      assert.equal(await pane.getByLabel('First cycle start').inputValue(),'2028-02-29')
      await pane.getByRole('button',{name:'Review recurring plan'}).click()
    }
    await page.evaluate(mode=>{__recurringPreview.failure=mode==='new'?'lost':null},scenario)
    const save=pane.getByRole('button',{name:'Save reviewed plan version'})
    await save.evaluate(n=>{n.click();n.click()})
    if(scenario==='new'){
      await pane.getByRole('button',{name:'Check original recurring save'}).waitFor()
      const state=await page.evaluate(()=>({receipt:__recurringPreview.receipt,calls:__recurringPreview.calls}))
      assert.equal(state.calls.filter(x=>x.name==='apply_service_recurring_plan').length,1)
      await page.reload();pane=await open(state.receipt)
      await pane.getByRole('button',{name:'Check original recurring save'}).click()
      await pane.getByText(/Saved recurring plan version 1/).waitFor()
      const calls=await page.evaluate(()=>__recurringPreview.calls)
      assert.deepEqual(calls.map(c=>c.name),['recover_service_recurring_plan'])
      assert.equal(calls[0].args.p_request_id,state.receipt.request_id)
    }else{
      await pane.getByText(/Saved recurring plan version 2/).waitFor()
      const calls=await page.evaluate(()=>__recurringPreview.calls)
      const writes=calls.filter(x=>x.name==='apply_service_recurring_plan')
      assert.equal(writes.length,scenario==='existing'?3:1)
      assert.equal(new Set(writes.map(w=>w.args.p_request_id)).size,writes.length)
      assert.equal(writes.at(-1).args.p_proposal.scheduler,null)
      if(scenario==='ambiguous')assert.equal(writes.at(-1).args.p_plan_id,'b0000000-0000-4000-8000-000000000011')
    }
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  reports.push({width,scenario,passed:true});console.log(width,scenario,'pass');await page.close()
 }
 await writeFile(new URL('verification.json',out),JSON.stringify({synthetic:true,reports},null,2))
}catch(e){if(current&&!current.isClosed())console.log((await current.locator('body').innerText()).slice(-4000));throw e}
finally{await browser.close();await server.close()}
