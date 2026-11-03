import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {startUxPreview} from './os-uiux-preview.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const out=new URL('../outputs/studio-work-batch/',import.meta.url)
await mkdir(out,{recursive:true})
const server=await startUxPreview({port:5285})
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH})
const cases=[]
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
  await page.goto('http://127.0.0.1:5285/tools/direct-chat-preview.html?panel=website-pages&work-batch=1')
  await page.getByRole('region',{name:'Website pages'}).waitFor()
  const installFixture=()=>{
   const website=__directChatPreview.website
   website.rows[0].source.title='Anka Sphere homepage'
   const id=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0')
   const prior={key:'copy',instance:1,work_item_id:id(209),row_version:2}
   const stages=[{key:'copy',label:'Homepage copy',quantity:1},{key:'design',label:'Homepage layout',quantity:2},{key:'build',label:'Build homepage',quantity:1}].map(s=>({...s,action:'run',department_id:'design'}))
   window.batchCalls=[]
   window.cardVersion=2
   window.__workBatchRpc=async(name,args)=>{
    batchCalls.push({name,args})
    if(name.includes('get_project'))return {data:{partition:args.p_partition,asset_options:[args.p_partition],prior_slots:[{...prior,row_version:cardVersion}],work_options:[{id:id(209),row_version:cardVersion,department_id:'design'}],stages}}
    if(name.startsWith('review_')){
     const p=args.p_proposal
     if(p.slots.some(row=>(row.work_item_id&&row.row_version!==cardVersion)||(row.previous_work_item_id&&row.previous_row_version!==cardVersion)))return {error:{code:'40001',message:'Exact current card version required'}}
     const blockers=p.dependencies.length?[]:[{code:'dependency_mapping_required',key:'build',instance:1,depends_on_key:'design'}]
     return {data:{slots:p.slots.map(s=>({...s,title:stages.find(t=>t.key===s.key).label})),edges:p.dependencies,retained:[{key:'qa',instance:2,work_item_id:id(410)}],material_requirements:[],blockers,can_apply:!blockers.length,review_sha256:'a'.repeat(64)}}
    }
    if(name.startsWith('apply_')){const stored=Object.keys(sessionStorage).find(key=>key.startsWith('anka-work-batch:'));if(!stored||JSON.parse(sessionStorage.getItem(stored)).requestId!==args.p_request_id)throw Error('Original request not persisted');if(window.rollback){window.cardVersion=3;return {error:{code:'40001',message:'Work revision changed'}}};await new Promise(r=>setTimeout(r,80));throw Error('Connection interrupted after save')}
    if(name.startsWith('recover_'))return {data:window.notApplied?{status:'not_applied'}:{status:'applied',original_result:{atomic:true,request_id:args.p_request_id}}}
    throw Error('Unexpected request')
   }
  }
  await page.evaluate(installFixture)
  await page.getByRole('button',{name:'Find approved architectures'}).click()
  await page.getByLabel('Website approved architecture').selectOption({index:1})
  await page.getByRole('button',{name:'Review work cards'}).first().click()
  const panel=page.getByRole('region',{name:'Work card review'})
  await panel.getByLabel('Work card configuration').selectOption({index:1})
  const save=panel.getByRole('button',{name:'Save reviewed work cards'})
  await panel.getByText('Existing cards to reuse (1)',{exact:true}).waitFor()
  assert.equal(await save.isDisabled(),true)
  await panel.getByRole('combobox',{name:/Prerequisite for/}).selectOption('2')
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Work card review"] button:last-child')?.disabled && window.batchCalls.filter(x=>x.name.startsWith('review_')).length===2)
  await save.waitFor()
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({path:fileURLToPath(new URL(width+'-review.png',out))})
  await save.evaluate(node=>{node.click();node.click()})
  await panel.getByRole('button',{name:'Check original save'}).waitFor()
  if(width===1440){
    const previousCalls=await page.evaluate(()=>batchCalls)
    await page.reload()
    await page.getByRole('region',{name:'Website pages'}).waitFor()
    await page.evaluate(installFixture)
    await page.evaluate(previous=>batchCalls.push(...previous),previousCalls)
    await page.getByRole('button',{name:'Find approved architectures'}).click()
    await page.getByLabel('Website approved architecture').selectOption({index:1})
    await page.getByRole('button',{name:'Review work cards'}).first().click()
  }
  await panel.getByRole('button',{name:'Check original save'}).click()
  await panel.getByText('Original work-card save recovered.').waitFor()
  const calls=await page.evaluate(()=>batchCalls)
  const apply=calls.filter(x=>x.name.startsWith('apply_')),recover=calls.filter(x=>x.name.startsWith('recover_'))
  assert.equal(apply.length,1);assert.equal(recover[0].args.p_request_id,apply[0].args.p_request_id)
  assert.equal(apply[0].args.p_proposal.dependencies[0].depends_on_instance,2)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  {
    await panel.getByLabel('Work card configuration').selectOption({index:1})
    await panel.getByRole('combobox',{name:/Prerequisite for/}).selectOption('1')
    if(width===390){
    await panel.getByText('Replace this card',{exact:true}).click()
    const reason=panel.getByLabel('Reason for replacement')
    await reason.fill('The reviewed copy has new material.')
    await reason.press('Enter')
    await panel.getByText('Replacement cards (1)',{exact:true}).waitFor()
    }
    await page.evaluate(()=>{window.rollback=true})
    await panel.getByRole('button',{name:'Save reviewed work cards'}).click()
    await panel.getByText('Work revision changed',{exact:true}).waitFor()
    const staleCode=await page.evaluate(async()=>{const original=batchCalls.filter(x=>x.name.startsWith('review_')).at(-1);return (await __workBatchRpc(original.name,original.args)).error.code})
    assert.equal(staleCode,'40001')
    await page.evaluate(()=>{window.rollback=false;window.notApplied=true})
    await panel.getByRole('button',{name:'Review cards again'}).click()
    await panel.getByText(/version 2 → 3/).waitFor();assert.equal(await panel.getByRole('button',{name:'Save reviewed work cards'}).isDisabled(),true)
    await panel.getByRole('region',{name:'Changed card versions'}).scrollIntoViewIfNeeded()
    await page.screenshot({path:fileURLToPath(new URL(width+'-current-versions.png',out))})
    await panel.getByRole('button',{name:'Review with these versions'}).click()
    await panel.getByRole('button',{name:'Save reviewed work cards'}).click()
    await page.evaluate(()=>{window.cardVersion=4})
    await panel.getByRole('button',{name:'Check original save'}).click()
    await panel.getByText('Original save was not applied. Review the cards again.').waitFor()
    await panel.getByRole('button',{name:'Review cards again'}).click()
    await panel.getByText(/version 3 → 4/).waitFor()
    await panel.getByRole('button',{name:'Review with these versions'}).click()
    await panel.getByRole('button',{name:'Save reviewed work cards'}).waitFor()
    const latest=await page.evaluate(()=>batchCalls.at(-1))
    assert.equal(latest.args.p_proposal.dependencies[0].depends_on_instance,1)
    const replaced=latest.args.p_proposal.slots.find(slot=>slot.action==='create_replacement')
    if(width===390){assert.equal(replaced.previous_row_version,4);assert.equal(replaced.previous_work_item_id,'a0000000-0000-4000-8000-000000000209');assert.equal(replaced.material_reason,'The reviewed copy has new material.')}
    else assert.equal(latest.args.p_proposal.slots.find(slot=>slot.action==='use_existing').row_version,4)
  }
  let workEntry=false
  if(width===1440){
    await page.goto('http://127.0.0.1:5285/tools/project-chat-integration-preview.html?panel=project-navigation&surface=project&state=populated')
    await page.getByRole('tab',{name:'Work',exact:true}).click()
    await page.getByText('Review planned work cards',{exact:true}).click()
    await page.getByRole('button',{name:'Open pipeline plan',exact:true}).waitFor()
    await page.getByRole('region',{name:'Work card review'}).getByLabel('Work card configuration').waitFor()
    workEntry=true
  }
  cases.push({width,workEntry,firstSaveApplyCalls:1,firstSaveRecoveryCalls:1,exactPrerequisite:2,rollbackAndNotApplied:true,versionDeltas:[[2,3],[3,4]],preservedAction:width===390?'create_replacement':'use_existing'});await page.close()
 }
 await writeFile(new URL('verification.json',out),JSON.stringify({synthetic:true,cases},null,2))
}finally{await browser.close();await server.close()}
