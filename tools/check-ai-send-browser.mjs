// Actual components with isolated transports. Never uses a signed-in browser.
import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const out=new URL('../outputs/ai-send-browser/',import.meta.url);await mkdir(out,{recursive:true})
const port=5254,base=`http://127.0.0.1:${port}/tools/direct-chat-preview.html`,server=spawn(process.execPath,['tools/direct-chat-preview.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,ANKA_DIRECT_CHAT_PREVIEW_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']})
let serverLog='',browser
server.stdout.on('data',s=>serverLog+=s);server.stderr.on('data',s=>serverLog+=s)
const cases=[]
try{
 const deadline=Date.now()+45000
 while(true){try{const r=await fetch(base);if(r.ok)break}catch{/* Wait for the owned local preview only. */}if(server.exitCode!==null||Date.now()>deadline)throw Error('Local preview failed: '+serverLog);await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),external=[],errors=[]
  page.setDefaultTimeout(60000)
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(base).origin)return route.continue();external.push(route.request().url());return route.abort()})
  await page.goto(base+`?surface=project&theme=${theme}`,{waitUntil:'domcontentloaded',timeout:90000});await page.getByLabel('Message',{exact:true}).waitFor()
  await page.waitForFunction(()=>globalThis.__directChatPreview?.fixture)
  await page.getByRole('button',{name:'Send',exact:true}).waitFor()
  const counters=()=>page.evaluate(()=>globalThis.__directChatPreview.fixture.data.counters)
  await page.evaluate(()=>{const f=globalThis.__directChatPreview.fixture;f.readiness={...f.readiness,model_status:'price_unavailable'}})
  await page.getByLabel('Message',{exact:true}).fill('An offline homepage status question')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'pricing'}).waitFor()
  assert.deepEqual(await counters(),{created:0,messages:0,run:0,recover:0});assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'An offline homepage status question')
  assert.equal(await page.getByRole('button',{name:'Send',exact:true}).evaluate(n=>n.scrollWidth<=n.clientWidth+1),true)
  await page.evaluate(()=>{const f=globalThis.__directChatPreview.fixture;f.readiness={...f.readiness,model_status:'configured',spend_readiness_status:'prior_cycle_reconciliation_required'}})
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'earlier billing month'}).waitFor()
  assert.deepEqual(await counters(),{created:0,messages:0,run:0,recover:0})
  const note=page.getByRole('button',{name:'Save message without AI',exact:true});await note.focus();assert.equal(await note.evaluate(n=>n===document.activeElement),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.screenshot({path:fileURLToPath(new URL(`blocked-${width}-${theme}.png`,out))})
  await note.click();await page.getByText('Message saved without an AI reply.',{exact:true}).waitFor()
  assert.deepEqual(await counters(),{created:1,messages:1,run:0,recover:0})
  await page.evaluate(()=>{const f=globalThis.__directChatPreview.fixture;f.readiness={...f.readiness,spend_readiness_status:'ready',model_status:'configured',paid_execution_enabled:true,spend_tracking_configured:true}})
  await page.getByLabel('Message',{exact:true}).fill('A fresh eligible offline question')
  await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Reply saved.',{exact:true}).waitFor()
  assert.deepEqual(await counters(),{created:1,messages:2,run:1,recover:0});assert.equal(await page.getByRole('dialog',{name:'Confirm AI data sharing'}).count(),0)
  await page.evaluate(()=>globalThis.__directChatPreview.fixture.runFailure=true)
  await page.getByLabel('Message',{exact:true}).fill('Keep the original uncertain request')
  await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Check recovery',exact:true}).waitFor()
  assert.equal((await counters()).run,2)
  const original=()=>page.evaluate(()=>Object.entries(sessionStorage).find(([key])=>key.startsWith('anka:direct-chat:b1:') && key.endsWith(']'))?.[1])
  const frozen=await original()
  assert.ok(JSON.parse(frozen).dispatch_request_id)
  await page.evaluate(async()=>{
    const f=globalThis.__directChatPreview.fixture
    const {createContextChatRunnerRepository}=await import('/src/data/contextChatRunnerTransport.js')
    const recovery=createContextChatRunnerRepository({functions:{invoke:async (_name,{body})=>{
      const id=body.message_id
      if(body.recover_only!==true)throw Error('Recovery attempted a dispatch')
      if(id!==JSON.parse(Object.entries(sessionStorage).find(([key])=>key.startsWith('anka:direct-chat:b1:') && key.endsWith(']'))[1]).message_id)throw Error('Wrong saved message')
      f.probeCount=(f.probeCount||0)+1
      await new Promise(resolve=>setTimeout(resolve,100))
      return {status:409,data:{status:f.probeCount<=2?'no_submission_recorded':'not_settled',must_not_submit:true,spend_readiness_status:'prior_cycle_reconciliation_required',reconciliation_sources:f.sources}}
    }}})
    f.sources=['context_chat']
    f.runner.recover=recovery.recover
  })
  const check=page.getByRole('button',{name:'Check recovery',exact:true})
  await check.evaluate(button=>{button.click();button.click()})
  await page.getByRole('status').filter({hasText:'original request may still be in progress'}).waitFor()
  assert.equal(await page.evaluate(()=>__directChatPreview.fixture.probeCount),1)
  const guidance=page.getByRole('status').filter({hasText:'Earlier charges remain unresolved'})
  assert.doesNotMatch(await guidance.innerText(),/Design media spending/)
  await page.evaluate(()=>{__directChatPreview.fixture.sources=['context_chat','design_media']})
  await check.click()
  await guidance.filter({hasText:'That view covers only the media portion.'}).waitFor()
  assert.match(await guidance.innerText(),/read-only Design media spending/)
  await check.click()
  await page.getByRole('status').filter({hasText:'outcome is still unknown'}).waitFor()
  assert.equal(await original(),frozen)
  assert.equal((await counters()).messages,3);assert.equal((await counters()).run,2)
  await page.goto(base+'?surface=content',{waitUntil:'domcontentloaded'})
  await page.getByLabel('Message',{exact:true}).waitFor()
  assert.equal(await check.count(),0);assert.equal((await counters()).recover,0)
  await page.goto(base+'?surface=project',{waitUntil:'domcontentloaded'})
  await page.getByText('Previous send recovered from saved messages. No new AI request was sent.').waitFor()
  assert.equal((await counters()).run,2);assert.equal((await counters()).recover,1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.screenshot({path:fileURLToPath(new URL(`recovered-${width}-${theme}.png`,out))})
  assert.deepEqual(external,[]);assert.deepEqual(errors,[])
  cases.push({width,theme,blockedSendWrites:0,explicitHumanSave:true,freshEligibleSend:true,noRedundantTextConsent:true,nonMediaAndMixedGuidance:true,noSubmissionRecorded:true,unknownRetained:true,duplicateCheckSuppressed:true,scopeIsolated:true,originalRecoveryNoRedispatch:true,keyboardFocus:true,overflow:false,externalRequests:0});await context.close()
 }
 await writeFile(new URL('verification.json',out),JSON.stringify({status:'ACTUAL_COMPONENTS_SYNTHETIC_TRANSPORTS',cases,realProviderAcceptance:false,paidCalls:0},null,2));console.log(JSON.stringify(cases))
}finally{await browser?.close();server.kill();await writeFile(new URL('server.log',out),serverLog)}
