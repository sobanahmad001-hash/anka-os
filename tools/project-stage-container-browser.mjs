import {createServer} from 'vite'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const {chromium}=createRequire(import.meta.url)('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const server=await createServer({server:{host:'127.0.0.1',port:5284},logLevel:'error',plugins:[{name:'offline-stage-client',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/src/lib/supabase.js'))return 'export const supabase={rpc(){throw Error("Unexpected live RPC")}}'}}]});await server.listen()
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const reports=[];await mkdir('outputs/project-stages',{recursive:true})
try{for(const [width,theme,outcome] of [[1440,'dark','saved'],[390,'light','unknown'],[1440,'light','timeout']]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:5284\/)/,r=>r.abort())
 await page.goto(`http://127.0.0.1:5284/tools/project-stage-container-preview.html?theme=${theme}&outcome=${outcome}`)
 await page.getByRole('button',{name:'Map stages',exact:true}).waitFor()
 await page.getByLabel('Saved pipeline',{exact:true}).selectOption({index:1})
 await page.getByRole('button',{name:'Browse saved items'}).click();await page.getByRole('button',{name:'Load progress: Homepage',exact:true}).waitFor()
 await page.getByRole('button',{name:'Next items'}).click();await page.getByRole('button',{name:'Load progress: Page 26',exact:true}).waitFor()
 await page.getByRole('button',{name:'Previous items'}).click();await page.getByRole('button',{name:'Load progress: Homepage',exact:true}).click()
 await page.getByRole('button',{name:/^Website/}).click();await page.getByRole('button',{name:/Page content Done/}).click()
 assert.match(await page.getByRole('region',{name:'Stage details: Page content'}).innerText(),/Only 1 loaded partition; not a whole-project total/)
 assert.deepEqual(await page.evaluate(()=>[__stageFixture.calls.apply,__stageFixture.calls.review]),[0,0])
 await page.screenshot({path:`outputs/project-stages/${width}-${theme}-integrated.png`,fullPage:true})
 await page.getByRole('button',{name:'Map stages',exact:true}).click();const phase=page.getByRole('combobox',{name:/Phase for/});await phase.selectOption('website.design')
 await page.getByRole('button',{name:'Review stage mapping',exact:true}).click();await page.getByRole('button',{name:'Apply reviewed mapping'}).waitFor()
 await phase.selectOption('website.content');assert.equal(await page.getByRole('button',{name:'Apply reviewed mapping'}).count(),0)
 await phase.selectOption('website.design');await page.getByRole('button',{name:'Review stage mapping',exact:true}).click()
 await page.getByRole('button',{name:'Apply reviewed mapping'}).click()
 if(outcome!=='saved'){await page.getByRole('button',{name:'Check original mapping save'}).waitFor();assert.equal(await page.getByRole('button',{name:'Apply reviewed mapping'}).isDisabled(),true);await page.getByRole('button',{name:'Check original mapping save'}).click();await page.getByText('Original stage mapping recovered. No save was repeated.',{exact:true}).waitFor()}
 else await page.getByText('Stage mapping saved. Existing work and history are retained.',{exact:true}).waitFor()
 if(outcome==='timeout'){await page.evaluate(()=>__resolveMapping({request_id:'late-unrelated-receipt'}));assert.equal(await page.getByText('Original stage mapping recovered. No save was repeated.',{exact:true}).isVisible(),true)}
 assert.equal(await page.evaluate(()=>__stageFixture.calls.apply),1)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
 assert.deepEqual(errors,[]);reports.push({width,theme,outcome,paging:true,reviewInvalidated:true,applyOnce:true,originalRecovery:outcome!=='saved'});await page.close()
}await writeFile('outputs/project-stages/container-verification.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports))}finally{await browser.close();await server.close()}
