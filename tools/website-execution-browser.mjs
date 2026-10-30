import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {startWebsiteExecutionPreview} from './website-execution-preview.mjs'
const {chromium}=createRequire(import.meta.url)('C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const out=new URL('../outputs/website-execution-preview/',import.meta.url);await mkdir(out,{recursive:true})
const finalGuard=process.argv.includes('--final-guard')
const server=await startWebsiteExecutionPreview(),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),cases=[]
try{for(const width of finalGuard?[390]:[1440,390])for(const theme of finalGuard?['light']:['light','dark'])for(const connected of finalGuard?[true]:[true,false]){
 const page=await browser.newPage({viewport:{width,height:1050}}),errors=[],external=[];page.setDefaultTimeout(60000)
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(new URL(r.request().url()).hostname==='127.0.0.1')r.continue();else{external.push(r.request().url());r.abort()}})
 await page.goto(`http://127.0.0.1:5218/tools/website-execution-preview.html?panel=project-navigation&surface=project&state=populated&theme=${theme}&connected=${connected?'1':'0'}`,{waitUntil:'domcontentloaded',timeout:60000})
 await page.getByRole('button',{name:'AI conversations',exact:true}).click();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Build the reviewed Website and prepare an isolated staging preview.');await page.getByRole('button',{name:'Send',exact:true}).click()
 const panel=page.locator('.project-website-execution');await panel.locator(':scope > summary').click()
 await panel.getByLabel('Saved Website design for build',{exact:true}).selectOption({index:1});await panel.getByRole('button',{name:'Review native package',exact:true}).click()
 assert.equal(await page.evaluate(()=>globalThis.__websitePilot.build.counts.build),0)
 await panel.getByRole('button',{name:'Build private review package',exact:true}).click();await panel.getByRole('button',{name:'Recover original native build',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'New chat',exact:true}).isDisabled(),true);await page.locator('.direct-project-tools > summary').click();assert.equal(await page.getByRole('button',{name:'Asset links',exact:true}).isDisabled(),true);await page.locator('.direct-project-tools > summary').click()
 await panel.getByRole('button',{name:'Recover original native build',exact:true}).click();await panel.getByRole('button',{name:'Use this exact built package',exact:true}).click()
 assert.equal(await page.evaluate(()=>globalThis.__websitePilot.build.counts.build),1)
 await panel.getByRole('button',{name:'Use tracked package for staging',exact:true}).click()
 if(connected){
  await panel.getByText('Bind an authorized staging target',{exact:true}).click();await panel.getByLabel('Staging connection',{exact:true}).selectOption({index:1});await panel.getByRole('button',{name:'Inspect staging identity',exact:true}).click()
  assert.equal(await panel.getByRole('checkbox').isChecked(),false);await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Bind reviewed staging target',exact:true}).click()
  await panel.getByLabel('Bound staging site',{exact:true}).selectOption({index:1});await panel.getByRole('button',{name:'Dry run staging',exact:true}).click()
  assert.equal(await page.evaluate(()=>globalThis.__websitePilot.staging.counts.deploy),0)
  await panel.getByRole('button',{name:'Deploy reviewed staging preview',exact:true}).click();await panel.getByRole('button',{name:'Recover original staging request',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'New chat',exact:true}).isDisabled(),true);await page.locator('.direct-project-tools > summary').click();assert.equal(await page.getByRole('button',{name:'Asset links',exact:true}).isDisabled(),true);await page.locator('.direct-project-tools > summary').click()
  await panel.getByRole('button',{name:'Recover original staging request',exact:true}).click();await panel.getByText('An exact package preview is recorded for a current target. Review its retained evidence below.',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__websitePilot.staging.counts.deploy),1)
  await panel.getByLabel('Staged page for revision note',{exact:true}).selectOption({index:1});await panel.getByLabel('Staging revision note',{exact:true}).fill('Review exact staged heading')
  await page.waitForFunction(()=>document.querySelector('button[aria-label="New chat"]')?.disabled)
  assert.equal(await page.getByRole('button',{name:'New chat',exact:true}).isDisabled(),true);await page.locator('.direct-project-tools > summary').click();assert.equal(await page.getByRole('button',{name:'Asset links',exact:true}).isDisabled(),true);await page.locator('.direct-project-tools > summary').click()
  await panel.getByRole('button',{name:'1. Review and build',exact:true}).click();assert.equal(await panel.getByRole('button',{name:'Review native package',exact:true}).isDisabled(),true)
  await panel.getByRole('button',{name:'2. Stage and review',exact:true}).click();assert.equal(await panel.getByLabel('Staging revision note',{exact:true}).inputValue(),'Review exact staged heading')
  await panel.getByRole('button',{name:'Save reviewed page issue',exact:true}).click()
 }else{
  await panel.getByText(/No current staging target is bound/).waitFor();assert.equal(await panel.getByRole('button',{name:'Dry run staging',exact:true}).isDisabled(),true)
  assert.equal(await page.evaluate(()=>globalThis.__websitePilot.staging.counts.deploy),0)
 }
 assert.deepEqual(await page.evaluate(()=>globalThis.__directChatPreview.projectWorkspace.engagementWorkItems),await page.evaluate(()=>globalThis.__websitePilot.canonical))
 await panel.locator(':scope > summary').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(`${width}-${theme}-${connected?'connected':'missing'}.png`,out))})
 if(finalGuard){await panel.getByRole('heading',{name:'WordPress staging and revisions',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('390-light-final-controls.png',out))})}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 await page.getByRole('button',{name:'New chat',exact:true}).click();await page.getByRole('textbox',{name:'Message',exact:true}).fill('A separate website request');await page.getByRole('button',{name:'Send',exact:true}).click()
 assert.equal(await panel.getByLabel('Package tracked in this conversation').inputValue(),'')
 cases.push({width,theme,connected,buildWrites:1,stageWrites:connected?1:0,originalRecoveryNoResend:true,exactPackageHandoff:true,conversationIsolation:true,canonicalWorkUnchanged:true,acceptance:'synthetic'});await page.close()
}}finally{await browser.close();await server.close()}
await writeFile(new URL(finalGuard?'final-guard-verification.json':'verification.json',out),JSON.stringify({cases,providerCalls:0,productionWrites:0},null,2));console.log(JSON.stringify(cases))
