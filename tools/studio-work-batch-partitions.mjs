import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {writeFile,mkdir} from 'node:fs/promises'
import {startUxPreview} from './os-uiux-preview.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const server=await startUxPreview({port:5287})
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH})
const out=new URL('../outputs/studio-work-batch/',import.meta.url)
await mkdir(out,{recursive:true})
const reports=[]
try{
 for(const kind of (process.env.PARTITION_CASE?[process.env.PARTITION_CASE]:['engagement','recurring_occurrence','campaign_asset'])){
  const page=await browser.newPage({viewport:{width:kind==='recurring_occurrence'?390:1440,height:900}})
  page.on('pageerror',error=>console.error(error.message));page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text())})
  page.setDefaultTimeout(12000)
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
  const campaign=kind==='campaign_asset'
  await page.goto('http://127.0.0.1:5287/tools/'+(campaign?'direct-chat-preview.html?panel=campaign-planning&work-batch=1':'project-chat-integration-preview.html?panel=project-navigation&surface=project&state=populated'))
  if(campaign)await page.locator('summary').filter({hasText:'Campaign assets and calendar'}).click()
  else await page.getByRole('tab',{name:'Work',exact:true}).waitFor()
  const installFixture=kind=>{
    const f=__directChatPreview,w=f.projectWorkspace,c=f.campaign
    const config='a0000000-0000-4000-8000-000000000400', occurrence='a0000000-0000-4000-8000-000000000401'
    const engagement=kind==='campaign_asset'?c.engagementId:w.engagement.id
    const project=kind==='campaign_asset'?c.projectId:w.project.id
    const partition={kind,id:kind==='engagement'?engagement:kind==='campaign_asset'?c.assetId:occurrence}
    if(kind!=='campaign_asset'){
      w.engagementWorkItems[0].recurring_occurrence_id=occurrence
      f.pipeline.repository.list=async()=>({groups:[],configurations:[{id:config,revision:1,pipeline_group_id:null}],activations:[],available:[],publishedDefinitions:[]})
    }
    window.batchOps=[]
    const card=w?.engagementWorkItems?.[0]
    window.__workBatchRpc=async(name,args)=>{
      batchOps.push({name,args})
      if(name.startsWith('recover_'))return {data:{status:'not_applied'}}
      if(args.p_project_id!==project||args.p_engagement_id!==engagement||args.p_configuration_id!==config||JSON.stringify(args.p_partition)!==JSON.stringify(partition))throw Error('Unexpected batch source')
      const option=card?{id:card.id,row_version:7,department_id:card.department_id}:null
      if(name.startsWith('get_'))return {data:{partition,stages:[{key:'deliver',instance:1,quantity:1,action:'run',department_id:card?.department_id||'marketing',label:'Prepare deliverable'}],prior_slots:[],asset_options:kind==='campaign_asset'?[partition]:[],work_options:args.p_work_item_ids?.includes(card?.id)?[option]:[]}}
      const proposal=args.p_proposal,slot=proposal.slots[0]
      const blockers=[]
      if(kind==='recurring_occurrence'&&slot.action!=='use_existing')blockers.push({code:'partition_reuse_only',reason:'Use the existing occurrence card.'})
      if(slot.action==='use_existing'&&(slot.work_item_id!==card.id||slot.row_version!==7))return {error:{code:'40001',message:'Original occurrence card version changed'}}
      if(kind==='campaign_asset'&&(proposal.asset_links.length!==1||proposal.asset_links[0].id!==partition.id||proposal.asset_links[0].kind!==kind))throw Error('Exact campaign asset required')
      if(kind!=='campaign_asset'&&proposal.asset_links.length)throw Error('Unexpected asset link')
      if(name.startsWith('review_'))return {data:{slots:[{...slot,title:'Prepare deliverable',department_id:card?.department_id||'marketing'}],edges:[],retained:[],material_requirements:[],blockers,can_apply:!blockers.length,review_sha256:'a'.repeat(64)}}
      if(name.startsWith('apply_')&&window.interrupt)throw Error('Interrupted save')
      if(name.startsWith('apply_')&&!blockers.length)return {data:{atomic:true,organization_id:args.p_organization_id,project_id:project,engagement_id:engagement,request_id:args.p_request_id}}
      throw Error('Invalid write')
    }
    return {partition,config,card:card?.id,asset:c?.assetId,plan:c?.planId,service:c?.serviceId,campaign:c?.campaignId}
  }
  const expected=await page.evaluate(installFixture,kind)
  if(campaign){
    await page.getByRole('button',{name:'Find campaigns',exact:true}).click()
    await page.getByLabel('Exact campaign',{exact:true}).selectOption(expected.campaign)
    await page.getByRole('button',{name:'Load exact plan versions',exact:true}).click()
    await page.getByLabel('Exact campaign plan version',{exact:true}).selectOption(expected.plan)
    await page.getByLabel('Marketing service',{exact:true}).selectOption(expected.service)
    await page.getByRole('button',{name:'Load shared assets',exact:true}).click()
    await page.getByRole('button',{name:'Review work cards',exact:true}).first().click()
  }else{
    await page.getByRole('button',{name:'Refresh',exact:true}).first().click()
    await page.getByRole('tab',{name:'Work',exact:true}).click()
    await page.getByText('Review planned work cards',{exact:true}).click()
    if(kind==='recurring_occurrence')await page.getByLabel('Work scope').selectOption(expected.partition.id)
  }
  const panel=page.getByRole('region',{name:'Work card review'})
  await panel.getByLabel('Work card configuration').selectOption(expected.config)
  if(kind==='recurring_occurrence'){
    await panel.getByText('Use the existing occurrence card.').waitFor()
    await panel.getByLabel('Use an existing card').selectOption(expected.card)
  }
  const save=panel.getByRole('button',{name:'Save reviewed work cards'})
  await save.click()
  await page.waitForFunction(()=>batchOps.filter(x=>x.name.startsWith('apply_')).length===1)
  const write=await page.evaluate(()=>batchOps.find(x=>x.name.startsWith('apply_')).args)
  assert.deepEqual(write.p_partition,expected.partition)
  assert.equal(write.p_configuration_id,expected.config)
  assert.equal(write.p_proposal.slots[0].action,kind==='recurring_occurrence'?'use_existing':'create_missing')
  reports.push({partition:expected.partition,configuration:expected.config,action:write.p_proposal.slots[0].action,card:write.p_proposal.slots[0].work_item_id,applyCalls:1})
  if(kind==='recurring_occurrence'){
    await panel.getByLabel('Work card configuration').selectOption(expected.config)
    await panel.getByLabel('Use an existing card').selectOption(expected.card)
    await page.evaluate(()=>{window.interrupt=true})
    await save.click()
    await panel.getByRole('button',{name:'Check original save'}).waitFor()
    await page.reload()
    await page.getByRole('tab',{name:'Work',exact:true}).waitFor()
    await page.evaluate(installFixture,kind)
    await page.getByRole('button',{name:'Refresh',exact:true}).first().click()
    await page.getByRole('tab',{name:'Work',exact:true}).click()
    await page.getByText('Review planned work cards',{exact:true}).click()
    await panel.getByRole('button',{name:'Check original save'}).click()
    await panel.getByText(/Reopen its work scope to restore/).waitFor()
    await page.getByLabel('Work scope').selectOption(expected.partition.id)
    await panel.getByRole('button',{name:'Restore original choices'}).click()
    await panel.getByRole('button',{name:'Review cards again'}).click()
    await panel.getByRole('button',{name:'Save reviewed work cards'}).waitFor()
    assert.equal(await page.evaluate(()=>batchOps.some(x=>x.name.startsWith('apply_'))),false)
    assert.equal(await page.evaluate(()=>batchOps.at(-1).args.p_proposal.slots[0].work_item_id),expected.card)
    reports.at(-1).crossPartitionRestore=true
  }
  console.log(kind,'passed')
  await page.close()
 }
 await writeFile(new URL('partition-verification.json',out),JSON.stringify({synthetic:true,reports},null,2))
} finally{await browser.close();await server.close()}
