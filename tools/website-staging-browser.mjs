import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {startStagingPreview} from './website-staging-preview.mjs'
const {chromium}=createRequire(import.meta.url)('C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),out=new URL('../outputs/website-staging-preview/',import.meta.url)
await mkdir(out,{recursive:true});const server=await startStagingPreview(),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),cases=[]
try{for(const width of [1440,390])for(const theme of ['light','dark'])for(const connected of [true,false]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')route.continue();else{external.push(route.request().url());route.abort()}})
 await page.goto('http://127.0.0.1:5212/tools/website-staging-preview.html?theme='+theme+'&connected='+(connected?'1':'0'))
 const panel=page.getByRole('region',{name:'WordPress staging and revisions',exact:true});await panel.getByLabel('Bound staging site',{exact:true}).waitFor()
 const before=await page.evaluate(()=>JSON.stringify(globalThis.__blockPreview.fixture.canonical))
 if(connected){
  await panel.getByText('Bind an authorized staging target',{exact:true}).click();await panel.getByLabel('Staging connection',{exact:true}).selectOption({index:1});await panel.getByRole('button',{name:'Inspect staging identity',exact:true}).click()
  assert.equal(await panel.getByRole('checkbox').isChecked(),false);assert.equal(await panel.getByRole('button',{name:'Bind reviewed staging target',exact:true}).isDisabled(),true)
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Bind reviewed staging target',exact:true}).click()
  await panel.getByText('Exact isolated staging target bound. Client publication remains unavailable here.',{exact:true}).waitFor()
  await panel.getByLabel('Bound staging site',{exact:true}).selectOption({index:1});await panel.getByLabel('Native package for staging',{exact:true}).selectOption({index:1})
  await panel.getByRole('button',{name:'Dry run staging',exact:true}).click();await panel.getByRole('region',{name:'Review exact staging deployment',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__blockPreview.fixture.staging.counts.deploy),0)
  await panel.getByRole('button',{name:'Deploy reviewed staging preview',exact:true}).click();await panel.getByText(/New writes remain blocked/).waitFor()
  assert.equal(await page.getByRole('button',{name:'Switch preview context',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'Refresh build history',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Switch preview context',exact:true}).isDisabled(),true)
  await panel.getByRole('button',{name:'Recover original staging request',exact:true}).click();await panel.getByText('Private WordPress staging preview verified. Work, delivery approval and client publication are unchanged.',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__blockPreview.fixture.staging.counts.deploy),1)
  await panel.getByText('Retained staging and revision history',{exact:true}).click();await panel.getByRole('link',{name:'Open authenticated WordPress preview',exact:true}).waitFor()
  await panel.getByLabel('Staged page for revision note',{exact:true}).selectOption({index:1});await panel.getByLabel('Staging revision note',{exact:true}).fill('Review the contact heading <script> stays text.');await panel.getByRole('button',{name:'Save reviewed page issue',exact:true}).click();await panel.getByText('Page revision event saved. No design, build, assignment or completion was changed.',{exact:true}).waitFor()
  await panel.getByLabel('Staging issue action',{exact:true}).selectOption({index:1});await panel.getByLabel('Staging revision note',{exact:true}).fill('Reviewed against the exact staged version.');await panel.getByRole('button',{name:'Save reviewed page issue',exact:true}).click()
  await panel.getByLabel('Native package for staging',{exact:true}).selectOption({index:2});await panel.getByLabel('Previous staging version',{exact:true}).selectOption({index:1});await panel.getByRole('button',{name:'Dry run staging',exact:true}).click();await panel.getByRole('button',{name:'Deploy reviewed staging preview',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__blockPreview.fixture.staging.runs.length===2)
  assert.equal(await page.evaluate(()=>globalThis.__blockPreview.fixture.staging.runs[0].previous_run_id),await page.evaluate(()=>globalThis.__blockPreview.fixture.staging.runs[1].id))
  assert.equal(await page.evaluate(()=>globalThis.__blockPreview.fixture.staging.issues.length),2)
 }else{
  await panel.getByText(/No current staging target is bound/).waitFor();assert.equal(await panel.getByRole('button',{name:'Dry run staging',exact:true}).isDisabled(),true)
  assert.deepEqual(await page.evaluate(()=>globalThis.__blockPreview.fixture.staging.counts),{inspect:0,bind:0,dryRun:0,deploy:0,recover:0,issue:0})
 }
 assert.equal(await page.evaluate(()=>JSON.stringify(globalThis.__blockPreview.fixture.canonical)),before)
 await panel.getByRole('heading',{name:'WordPress staging and revisions',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(width+'-'+theme+'-'+(connected?'connected':'missing')+'.png',out))})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 await page.getByRole('button',{name:'Switch preview context',exact:true}).click();assert.equal(await page.getByRole('region',{name:'WordPress staging and revisions',exact:true}).count(),0)
 cases.push({width,theme,connected,manualSelection:true,explicitUncheckedBinding:true,readOnlyDryRun:true,originalRecoveryNoResend:true,immutableIssueRevisionHistory:true,canonicalHistoryUnchanged:true,contextReset:true,productionWrites:0,providerCalls:0});await page.close()
}}finally{await browser.close();await server.close()}
await writeFile(new URL('verification.json',out),JSON.stringify({synthetic:true,productionWrites:0,providerCalls:0,cases},null,2));console.log(JSON.stringify(cases))
