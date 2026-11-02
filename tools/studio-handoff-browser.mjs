import {startContentJourneyPreview} from './project-content-journey-preview.mjs'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const out=new URL('../outputs/studio-handoff/',import.meta.url);await mkdir(out,{recursive:true})
const server=await startContentJourneyPreview({port:5267});const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})}),cases=[];let currentPage
try{for(const width of [1440,390])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:1050}}),errors=[],external=[];currentPage=page;page.setDefaultTimeout(45000)
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort()}return route.continue()})
 await page.goto(`http://127.0.0.1:5267/tools/project-content-journey-preview.html?panel=project-navigation&surface=project&state=populated&theme=${theme}`)
 await page.getByRole('button',{name:'AI conversations',exact:true}).click()
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Write a project launch article, then review it and hand it to Design.')
 await page.getByRole('button',{name:'Send',exact:true}).click()
 await page.locator('.project-content-journey').waitFor({state:'visible'});console.log('Journey visible',width,theme);const journey=page.locator('.project-content-journey');await journey.getByLabel('Content work in this conversation').selectOption({label:'Website copy'});await journey.getByLabel('Saved human request').selectOption({index:1});await journey.getByRole('button',{name:'Track this work in this conversation',exact:true}).click();await journey.getByRole('button',{name:'Review & explicit Design handoff',exact:true}).click();
 await journey.getByRole('button',{name:'Use single-manager route for version 1',exact:true}).waitFor()
 await journey.getByRole('button',{name:'Use single-manager route for version 1',exact:true}).click();await journey.getByText('Exact version approved',{exact:true}).waitFor()
 await journey.getByLabel('Active recipient service').selectOption({index:1});await journey.getByLabel('Active recipient project workstream').selectOption({index:1});await journey.getByLabel('Existing downstream work (optional)').selectOption({index:1})
 await journey.getByRole('button',{name:'Prepare handoff preview',exact:true}).click();assert.equal(await page.evaluate(()=>globalThis.__journey.state.handoffs.length),0)
 await page.evaluate(()=>globalThis.__journey.state.lost=true);await journey.getByRole('button',{name:'Confirm internal N3 handoff',exact:true}).click();await journey.getByRole('button',{name:'Recover original journey action',exact:true}).click()
 assert.equal(await page.evaluate(()=>globalThis.__journey.state.handoffs.length),1)
 await page.evaluate(()=>globalThis.__journey.result());await journey.getByRole('button',{name:'Refresh this journey',exact:true}).click();await journey.getByText('Preview saved Design output · v3',{exact:true}).click();await journey.getByText('Exact linked Design result',{exact:false}).waitFor()
 const result=await page.evaluate(()=>({calls:globalThis.__journey.state.calls,links:globalThis.__journey.state.links,work:globalThis.__directChatPreview.projectWorkspace.engagementWorkItems,overflow:document.documentElement.scrollWidth>innerWidth+1}))
 assert.equal(result.links.length,1);assert.equal(result.calls.filter(x=>x==='handoff').length,1);assert.equal(result.work[0].status,'not_started');assert.equal(result.work[1].status,'in_progress');assert.equal(result.overflow,false)
 await page.screenshot({path:new URL(`${width}-${theme}-result.png`,out).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});await journey.getByRole('heading',{name:'Design progress and result',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:new URL(`${width}-${theme}-viewport.png`,out).pathname.replace(/^\/([A-Za-z]:)/,'$1')})
 console.log('Finished journey',width,theme);assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 await page.getByRole('button',{name:'New chat',exact:true}).click();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Write a different Content request.');await page.getByRole('button',{name:'Send',exact:true}).click();await journey.waitFor({state:'visible'});await journey.getByLabel('Content work in this conversation').waitFor();assert.equal(await journey.getByText('Exact linked Design result',{exact:false}).count(),0)
 cases.push({width,theme,journey:'existing canonical work -> exact saved version -> authorized review -> explicit handoff -> original recovery -> on-demand exact Design preview',canonicalHistory:'unchanged',crossConversationLeak:false,network:'localhost only',acceptance:'synthetic'});await page.close()
}
await writeFile(new URL('result.json',out),JSON.stringify({cases},null,2))
}catch(error){if(currentPage&&!currentPage.isClosed()){console.log((await currentPage.locator('body').innerText()).slice(-7000));await currentPage.screenshot({path:new URL('failed.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:true})}throw error}finally{await browser.close();await server.close()}
