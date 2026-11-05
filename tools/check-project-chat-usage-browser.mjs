import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const base='http://127.0.0.1:5270',out='outputs/project-chat-usage',reports=[]
const server=spawn(process.execPath,['tools/direct-chat-preview.mjs'],{env:{...process.env,ANKA_DIRECT_CHAT_PREVIEW_PORT:'5270'},windowsHide:true,stdio:'inherit'})
let browser
try{
 const until=Date.now()+60000
 while(true){try{if((await fetch(base+'/tools/direct-chat-preview.html')).ok)break}catch{}if(Date.now()>until)throw Error('Preview unavailable');await new Promise(r=>setTimeout(r,200))}
 await mkdir(out,{recursive:true});browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1:5270\/)/,r=>r.abort())
  await page.addInitScript(()=>{globalThis.__allowanceFixture={calls:[],readiness(_input,fixture){
   return {...fixture.readiness,model_status:'configured',paid_execution_enabled:true,spend_tracking_configured:true,
    spend_readiness_status:'ready',project_chat_spend_policy:'usage_only',unresolved_charges:true}
  },async rpc(){throw Error('Usage-only UI must not call allowance APIs')}}})
  await page.goto(base+'/tools/direct-chat-preview.html?surface=project&state=empty&allowance=owner',{waitUntil:'domcontentloaded'})
  const composer=page.getByRole('form',{name:'Chat composer'}),message=page.getByLabel('Message',{exact:true})
  await composer.getByText(/Costs are calculated from provider tokens and verified rates, not final invoices/).waitFor()
  assert.equal(await message.inputValue(),'');assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Review Project Chat allowance',exact:true}).count(),0)
  assert.deepEqual(await page.evaluate(()=>__directChatPreview.fixture.data.counters),{created:0,messages:0,run:0,recover:0})
  await page.screenshot({path:out+'/initial-'+width+'.png'})
  await page.locator('.direct-project-tools > summary').click();await page.getByRole('button',{name:'Chat settings',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Preview allowance',exact:true}).count(),0)
  await page.getByRole('button',{name:'Close settings',exact:true}).click()
  await message.fill('Please explain this project without changing records')
  assert.deepEqual(await page.evaluate(()=>__directChatPreview.fixture.data.counters),{created:0,messages:0,run:0,recover:0})
  await page.screenshot({path:out+'/draft-'+width+'.png'})
  await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Reply saved.',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(()=>__directChatPreview.fixture.data.counters),{created:1,messages:1,run:1,recover:0})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[])
  reports.push({width,initialEmptyReadiness:true,noAllowanceControls:true,calculatedCostLabel:true,draftKeptUntilExplicitSend:true,noAutomaticWrites:true,oneExplicitSend:true,noOverflow:true,providerCalls:false})
  await page.close()
 }
 await writeFile(out+'/verification.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports))
}finally{await browser?.close();server.kill()}
