import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {startUxPreview} from './os-uiux-preview.mjs'
const {chromium}=createRequire(import.meta.url)('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fixture=JSON.parse(await readFile(new URL('./project-stage-native-fixture.json',import.meta.url),'utf8'))
const server=await startUxPreview({port:5285}),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
await mkdir('outputs/project-stages',{recursive:true});const reports=[]
try{for(const [width,height,theme,persistenceLost] of [[1440,1000,'dark'],[390,844,'light'],[1440,1000,'light',true]]){
 const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000)
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:5285\/)/,r=>r.abort())
 await page.addInitScript(f=>{globalThis.__stageRpcCalls=[];globalThis.__stageStale=false;globalThis.__workBatchRpc=async(name,args)=>{
  __stageRpcCalls.push(name);if(name==='read_project_content_journeys')return {data:[],error:null}
  const scope={organization_id:args.p_organization_id,project_id:args.p_project_id,engagement_id:args.p_engagement_id}
  if(name==='read_project_stage_plan')return {data:{...structuredClone(f.header),...scope,can_manage:true},error:null}
  if(name==='list_project_stage_partitions')return {data:{...scope,plan_id:args.p_plan_id,group_id:args.p_group_id,kind:args.p_kind,offset:args.p_offset,limit:args.p_limit,total:1,has_more:false,items:[{title:'Homepage',partition:f.unit.partition}]},error:null}
  if(name==='read_project_stage_partition')return {data:{...structuredClone(f.unit),...scope,...(__stageStale?{context_sha256:'b'.repeat(64)}:{})},error:null}
  throw Error('Unexpected RPC in offline app fixture: '+name)
 }},fixture)
 await page.goto(`http://127.0.0.1:5285/tools/project-chat-integration-preview.html?panel=project-navigation&surface=project&state=empty&theme=${theme}`)
 await page.getByLabel('Message',{exact:true}).fill('Keep my existing homepage request')
 await page.getByRole('button',{name:'Open pipeline and work details'}).click()
 const dialog=page.getByRole('dialog',{name:'Project plan',exact:true});await dialog.getByLabel('Saved pipeline',{exact:true}).selectOption({index:1})
 await dialog.getByRole('button',{name:'Browse saved items'}).click();await dialog.getByRole('button',{name:'Load progress: Homepage',exact:true}).click()
 await dialog.getByRole('button',{name:/^Website/}).click();await dialog.getByRole('button',{name:/Page content Done/}).click()
 await page.screenshot({path:`outputs/project-stages/${width}-${theme}-app-plan.png`,fullPage:true})
 await dialog.getByRole('region',{name:'Stage details: Page content'}).getByRole('button',{name:/^Continue in Chat/}).last().click()
 await dialog.waitFor({state:'hidden'})
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Keep my existing homepage request')
 assert.deepEqual(await page.evaluate(()=>__directChatPreview.fixture.data.counters),{created:0,messages:0,run:0,recover:0})
 await page.locator('.stage-chat-context summary').click();await page.getByRole('button',{name:'Remove stage context'}).waitFor();await page.getByRole('checkbox',{name:/Recorded content/}).check()

 await page.evaluate(()=>{
  const f=__directChatPreview.fixture;globalThis.__stageMessages=[];globalThis.__stageRuns=[];globalThis.__failStageReply=false;
  f.beforeStart=input=>__stageMessages.push(structuredClone(input));
  const append=f.chat.appendContextHumanMessage;f.chat.appendContextHumanMessage=async input=>{__stageMessages.push(structuredClone(input));return append(input)};
  f.beforeRun=input=>{__stageRuns.push(structuredClone(input));if(__failStageReply)throw Error('Synthetic reply outcome unknown')};
 })
 await page.evaluate(()=>{__stageStale=true});await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText(/Selected stage changed/).waitFor()
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Keep my existing homepage request')
 assert.deepEqual(await page.evaluate(()=>__directChatPreview.fixture.data.counters),{created:0,messages:0,run:0,recover:0})
 await page.evaluate(lost=>{__stageStale=false;__directChatPreview.fixture.createUncertain=lost},Boolean(persistenceLost));await page.getByRole('button',{name:'Send',exact:true}).click()
 if(persistenceLost){
  await page.getByRole('button',{name:'Check recovery',exact:true}).waitFor();const reads=await page.evaluate(()=>__stageRpcCalls.length)
  await page.evaluate(()=>{__stageStale=true});await page.getByRole('button',{name:'Check recovery',exact:true}).click();await page.getByText('Send recovered. No new AI request was sent.',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>__stageRpcCalls.length),reads);assert.equal(await page.evaluate(()=>__stageMessages.length),1);assert.equal(await page.evaluate(()=>__directChatPreview.fixture.data.counters.run),0);await page.evaluate(()=>{__stageStale=false})
 }else await page.getByText('Reply saved.',{exact:true}).waitFor()
 const first=await page.evaluate(()=>__stageMessages[0]);assert.equal(first.message,'Keep my existing homepage request');assert.deepEqual(Object.keys(first.project_stage_context).sort(),['output_version_ids','selection']);assert.equal(Object.keys(first.project_stage_context.selection).length,9);assert.deepEqual(first.project_stage_context.output_version_ids,['cc000000-0000-4000-8000-000000000041']);assert.equal('project_document_ids' in first,false);assert.equal('design_attachment_ids' in first,false)
 await page.getByLabel('Message',{exact:true}).fill('Second stage question');await page.evaluate(()=>{__failStageReply=true});await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Check recovery',exact:true}).waitFor()
 const second=await page.evaluate(()=>__stageMessages[1]);assert.deepEqual(second.project_stage_context,first.project_stage_context)
 const beforeRecoveryReads=await page.evaluate(()=>__stageRpcCalls.length)
 await page.evaluate(()=>{__stageStale=true;__directChatPreview.fixture.recoveryAvailable=true});await page.getByRole('button',{name:'Check recovery',exact:true}).click();await page.getByText('Send recovered. No new AI request was sent.',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>__stageRpcCalls.length),beforeRecoveryReads)
 assert.deepEqual(await page.evaluate(()=>__directChatPreview.fixture.data.counters),{created:1,messages:2,run:persistenceLost?1:2,recover:1})
 await page.screenshot({path:'outputs/project-stages/'+width+'-'+theme+'-app-context.png',fullPage:true})
 if(!await page.getByRole('button',{name:'Remove stage context'}).isVisible())await page.locator('.stage-chat-context summary').click()
 await page.getByRole('button',{name:'Remove stage context'}).click();assert.equal(await page.locator('.stage-chat-context').count(),0)
 await page.getByLabel('Message',{exact:true}).fill('Ordinary project message');await page.evaluate(()=>{__failStageReply=false});await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Reply saved.',{exact:true}).waitFor();assert.equal('project_stage_context' in await page.evaluate(()=>__stageMessages[2]),false)
 await page.getByLabel('Message',{exact:true}).fill('Retain my draft across Work navigation')
 page.on('dialog',d=>d.accept());await page.getByRole('tab',{name:'Plan & Work',exact:true}).click();await page.getByRole('region',{name:'Saved project stage plan'}).waitFor()
 await page.evaluate(()=>{__stageStale=false})
 const work=page.getByRole('region',{name:'Saved project stage plan'})
 await work.getByLabel('Saved pipeline',{exact:true}).selectOption({index:1})
 await work.getByRole('button',{name:'Browse saved items'}).click();await work.getByRole('button',{name:'Load progress: Homepage',exact:true}).click()
 await work.getByRole('button',{name:/^Website/}).click();await work.getByRole('button',{name:/Page content Done/}).click()
 await page.evaluate(()=>{__stageStale=false})
 await work.getByRole('region',{name:'Stage details: Page content'}).getByRole('button',{name:/^Continue in Chat/}).last().click()
 await page.locator('.stage-chat-context summary').click()
 await page.getByRole('button',{name:'Remove stage context'}).waitFor()
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Retain my draft across Work navigation')
 await page.getByRole('button',{name:'Remove stage context'}).click()
 await page.getByRole('tab',{name:'Plan & Work',exact:true}).click()
 await page.getByRole('tab',{name:'Chat',exact:true}).click()
 await page.getByLabel('Message',{exact:true}).waitFor()
 assert.equal(await page.locator('.stage-chat-context').count(),0,'consumed Work event is absent after Chat remount')
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Retain my draft across Work navigation')

 assert.equal(await page.getByRole('tab').count(),4);assert.deepEqual(errors,[])
 reports.push({width,theme,persistenceLost:Boolean(persistenceLost),actualApp:true,draftPreserved:true,structuredContext:true,exactStageWire:true,originalRecoveryWithoutResend:true,ordinarySendPreserved:true,staleContextBlocked:true,navigation:true,workStageRestoration:true,consumedEventAbsentOnRemount:true});await page.close()
}await writeFile('outputs/project-stages/app-verification.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports))}finally{await browser.close();await server.close()}
