import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const {chromium}=createRequire(import.meta.url)('C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const out=new URL('../outputs/project-work-actions-preview/',import.meta.url);await mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),cases=[]
try{for(const width of [1440,390])for(const theme of ['light','dark'])for(const flow of ['content','marketing','development']){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],external=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(new URL(r.request().url()).hostname!=='127.0.0.1'){external.push(r.request().url());return r.abort()}return r.continue()})
 await page.goto(`http://127.0.0.1:5214/tools/project-work-actions-preview.html?panel=project-navigation&surface=project&state=populated&theme=${theme}`)
 const hub=page.getByRole('region',{name:'Connected project delivery',exact:true});await hub.getByRole('heading',{name:'Project delivery',exact:true}).waitFor();const before=await page.evaluate(()=>JSON.stringify(globalThis.__directChatPreview.projectWorkspace.projectTasks))
 await hub.getByText('Create work or connect a Content result',{exact:true}).click();await hub.getByLabel('Exact active service').selectOption({label:`${flow}: ${flow} service`});await hub.getByLabel('Work title',{exact:true}).fill(`${flow} reviewed request`);await hub.getByLabel('Reviewed project brief',{exact:true}).fill('Human reviewed brief, no automatic conversation transfer.');await hub.getByRole('button',{name:'Review new work request',exact:true}).click();assert.equal(await page.evaluate(()=>globalThis.__workActions.commands.length),0)
 if(flow==='development')await page.evaluate(()=>globalThis.__workActions.state.lost=true)
 await hub.getByRole('button',{name:'Apply reviewed work action',exact:true}).click()
 if(flow==='development'){await hub.getByRole('button',{name:'Recover original work action',exact:true}).click();await hub.getByText(/recovered without another write/).waitFor()}else await hub.getByText(/Reviewed work action saved/).waitFor()
 if(flow==='content'){
  await hub.getByLabel('Original Content work').selectOption({label:'content reviewed request'});await hub.getByLabel('Exact saved Content version').selectOption({label:'Reviewed Website content · v1'});await hub.getByRole('button',{name:'Review result link',exact:true}).click();await hub.getByRole('button',{name:'Apply reviewed work action',exact:true}).click();await hub.getByText(/Reviewed work action saved/).waitFor()
 }
 const result=await page.evaluate(()=>({calls:globalThis.__workActions.commands,work:globalThis.__directChatPreview.projectWorkspace.engagementWorkItems,tasks:JSON.stringify(globalThis.__directChatPreview.projectWorkspace.projectTasks),overflow:document.documentElement.scrollWidth>innerWidth+1}))
 assert.equal(result.tasks,before);assert.equal(result.work.length,2);assert.equal(result.work[1].status,'not_started');assert.equal(result.work[1].assignee_id,null);if(flow==='content')assert.ok(result.work[1].linked_artifact_version_id);if(flow==='development')assert.deepEqual(result.calls.map(c=>Boolean(c.recovery)),[false,true]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(result.overflow,false)
 if(flow==='content')await page.screenshot({path:new URL(`${width}-${theme}.png`,out).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true})
 cases.push({width,theme,flow,passed:true,network:'localhost only',auth:'synthetic',writes:'synthetic',canonicalHistory:'unchanged'});await page.close()
}await writeFile(new URL('result.json',out),JSON.stringify({cases,passed:cases.length},null,2));console.log(JSON.stringify({passed:cases.length,out:out.pathname}))}finally{await browser.close()}
