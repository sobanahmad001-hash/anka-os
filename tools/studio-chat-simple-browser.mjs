import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {startUxPreview} from './os-uiux-preview.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const out=new URL('../outputs/chat-simple/',import.meta.url)
await mkdir(out,{recursive:true})
const server=await startUxPreview({port:5278}),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const reports=[]
try {
 for(const [width,height,theme,mode] of [[1440,960,'dark','populated'],[390,844,'dark','populated'],[1440,960,'light','empty'],[390,844,'light','uncertain']]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[]
  page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(90000)
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)})
  page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())})
  const pendingRequests=new Set();page.on('request',r=>pendingRequests.add(r.url()));page.on('requestfinished',r=>pendingRequests.delete(r.url()));page.on('requestfailed',r=>{pendingRequests.delete(r.url());console.log('FAILED',r.url(),r.failure())})
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5278\/)/,r=>r.abort())
  await page.addInitScript(()=>{globalThis.__workBatchRpc=async name=>{if(name==='read_project_content_journeys')return {data:[],error:null};throw new Error('Unexpected preview RPC: '+name)}})
  await page.goto(`http://127.0.0.1:5278/tools/project-chat-integration-preview.html?panel=project-navigation&surface=project&state=${mode}&theme=${theme}`,{waitUntil:'domcontentloaded'})
  await page.getByRole('region',{name:'Project AI conversations'}).waitFor()
  const chat=page.locator('.direct-project-chat')
  if(mode==='populated'){
   await page.evaluate(()=>{const f=__directChatPreview.fixture;f.data.rows[0].title='Plan our next month';f.data.messages[0].body='Help me plan our next month. We need website copy and a weekly social cycle.';f.data.messages[1].body='Let’s start with the outcome you want this month.\n\nWhich audience are you trying to reach, and what should they do next? Once that is clear, we can review the services, quantities and timing together in your project plan.'})
   await chat.getByRole('button',{name:'History',exact:true}).click()
   await page.getByRole('button',{name:'Plan our next month',exact:true}).click()
   if(await chat.getByRole('button',{name:'History',exact:true}).getAttribute('aria-expanded')==='true')await chat.getByRole('button',{name:'History',exact:true}).click()
   await page.getByText('Which audience are you trying', {exact:false}).waitFor()
  }
  await page.getByLabel('Message',{exact:true}).waitFor()
  if(mode==='uncertain'){
   await page.getByRole('button',{name:'Check recovery',exact:true}).waitFor()
   assert.equal(await page.locator('.direct-chat-recovery').count(),1)
   assert.equal(await page.locator('.direct-chat-message .direct-chat-recovery').count(),1)
   assert.equal(await page.getByLabel('Message',{exact:true}).isDisabled(),true)
   const retained=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('anka:direct-chat:'))))
   await page.evaluate(()=>{__directChatPreview.fixture.runner.recover=()=>new Promise(()=>{})})
   await page.getByRole('button',{name:'Check recovery',exact:true}).click()
   await page.getByText('Recovery check timed out.',{exact:false}).waitFor({timeout:25000})
   assert.equal(await page.getByRole('button',{name:'Check recovery',exact:true}).isDisabled(),false)
   assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('anka:direct-chat:')))),retained)
   await page.getByRole('tab',{name:'Work',exact:true}).click()
   await page.getByRole('tab',{name:'Work',exact:true,selected:true}).waitFor()
   await page.getByRole('tab',{name:'Chat',exact:true}).click()
  }
  assert.equal(await chat.getByRole('button',{name:'History',exact:true}).getAttribute('aria-expanded'),'false')
  assert.equal(await page.getByRole('complementary',{name:'Project context'}).count(),0)
  assert.equal(await page.getByRole('complementary',{name:'Chat details'}).count(),0)
  assert.equal(await page.getByText('Content → review → Design journey',{exact:true}).count(),0)
  assert.equal(await page.getByText('Website execution: package to staging',{exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'Set up project',exact:true}).isVisible(),false)
  assert.equal(await page.getByRole('button',{name:'Attach files',exact:true}).isVisible(),true)
  const box=await page.getByLabel('Message',{exact:true}).boundingBox()
  if(box.y+box.height>height)console.log(await page.locator('.direct-chat-composer').evaluate(el=>{let a=[];while(el){const s=getComputedStyle(el);a.push([el.className,el.getBoundingClientRect().height,s.height,s.minHeight,s.flex,s.display]);el=el.parentElement}return a}))
  assert.ok(box.y+box.height<=height,JSON.stringify(box))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.screenshot({path:new URL(`${width}-${theme}-${mode}.png`,out).pathname.replace(/^\/(\w:)/,'$1')})
  if(mode==='populated' && width===1440){
    await page.getByRole('button',{name:'Open pipeline and work details'}).click()
    const dialog=page.getByRole('dialog',{name:'Pipeline & work details'})
    await dialog.waitFor();await dialog.getByText('Content → review → Design journey',{exact:true}).waitFor().catch(async error=>{console.log('WAITING', [...pendingRequests],await dialog.innerText());throw error})
    await page.screenshot({path:new URL('pipeline-work-details.png',out).pathname.replace(/^\/(\w:)/,'$1')})
    await dialog.getByRole('button',{name:'Close',exact:true}).click()
    await page.getByLabel('Chat tools',{exact:true}).click()
    await page.getByRole('button',{name:'Chat settings',exact:true}).click()
    await page.getByRole('complementary',{name:'Chat details'}).waitFor()
    await page.getByRole('button',{name:'Close settings'}).click()
    await page.getByRole('tab',{name:'Work',exact:true}).click()
    await page.getByRole('tab',{name:'Work',exact:true,selected:true}).waitFor()
    await page.getByRole('tab',{name:'Chat',exact:true}).click()
  }
  assert.deepEqual(errors,[])
  reports.push({width,height,theme,mode,passed:true,composerWithinViewport:true,historyClosed:true})
  await page.close()
 }
 await writeFile(new URL('verification.json',out),JSON.stringify({synthetic:true,providerCalls:0,reports},null,2))
 console.log(JSON.stringify(reports))
}finally{await browser.close();await server.close()}
