import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {createServer} from 'vite'
const {chromium}=createRequire(import.meta.url)('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const server=await createServer({server:{port:5293,host:'127.0.0.1'},plugins:[{name:'offline-execution',enforce:'pre',resolveId(s){if(s.endsWith('/lib/supabase.js'))return '\0offline-client';if(s.endsWith('OrganizationContext.jsx'))return '\0offline-org'},load(id){if(id==='\0offline-client')return 'export const supabase={rpc(){throw Error("Unexpected live RPC")},functions:{invoke(){throw Error("Unexpected live Edge")}}}';if(id==='\0offline-org')return 'export const useOrganization=()=>({})'}}]});await server.listen()
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),reports=[]
await mkdir('outputs/chat-execution',{recursive:true})
try{for(const [width,theme]of [[1440,'dark'],[390,'light']]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1:5293\/)/,r=>r.abort())
 await page.goto('http://127.0.0.1:5293/tools/project-chat-execution-preview.html?theme='+theme)
 await page.getByRole('button',{name:'Use this exact Chat Design',exact:true}).click();await page.getByRole('button',{name:'Review native package',exact:true}).click()
 await page.getByRole('button',{name:'Build private review package',exact:true}).waitFor();await page.screenshot({path:`outputs/chat-execution/${width}-${theme}-build-review.png`,fullPage:true})
 const build=page.getByRole('button',{name:'Build private review package',exact:true});await build.focus();await page.keyboard.press('Enter')
 await page.getByRole('button',{name:'Use this exact built package',exact:true}).click();await page.getByRole('button',{name:'Use tracked package for staging',exact:true}).click()
 await page.getByLabel('Bound staging site',{exact:true}).selectOption('a0000000-0000-4000-8000-000000000079');await page.getByRole('button',{name:'Dry run staging',exact:true}).click()
 await page.screenshot({path:`outputs/chat-execution/${width}-${theme}-stage-review.png`,fullPage:true})
 if(width===390)await page.evaluate(()=>{__executionFixture.state.loseStage=true})
 await page.getByRole('button',{name:'Deploy reviewed staging preview',exact:true}).click()
 if(width===390){await page.getByRole('button',{name:'Recover original staging request',exact:true}).waitFor();await page.getByRole('button',{name:'Reopen conversation',exact:true}).click();await page.locator('.project-website-execution > summary').click();await page.getByRole('button',{name:'2. Stage and review',exact:true}).click();await page.getByRole('button',{name:'Recover original staging request',exact:true}).click()}
 await page.getByRole('link',{name:'Open verified private Chat preview',exact:true}).waitFor()
 assert.equal(await page.getByLabel('Chat draft',{exact:true}).inputValue(),'Keep my next question')
 const result=await page.evaluate(()=>({builds:__executionFixture.calls.filter(c=>c.body?.action==='build_chat').length,staging:__executionFixture.calls.filter(c=>c.body?.action==='deploy-chat').length,remoteRecoveries:__executionFixture.calls.filter(c=>c.body?.action==='recover-chat').length,overflow:document.documentElement.scrollWidth>innerWidth,controllers:document.querySelectorAll('.project-website-execution').length}))
 assert.equal(result.builds,1);assert.equal(result.staging,1);assert.equal(result.remoteRecoveries,0);assert.equal(result.controllers,1);assert.equal(result.overflow,false);assert.deepEqual(errors,[])
 await page.screenshot({path:`outputs/chat-execution/${width}-${theme}-saved.png`,fullPage:true});reports.push({width,theme,...result,errors});await page.close()
}}finally{await browser.close();await server.close()}
await writeFile('outputs/chat-execution/report.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports))
