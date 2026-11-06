import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {createServer} from 'vite'
const {chromium}=createRequire(import.meta.url)('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const server=await createServer({server:{port:5292,host:'127.0.0.1'},plugins:[{name:'offline-design',enforce:'pre',resolveId(s){if(s.endsWith('/lib/supabase.js'))return '\0offline-client';if(s.endsWith('OrganizationContext.jsx'))return '\0offline-org'},load(id){if(id==='\0offline-client')return 'export const supabase={rpc(){throw Error("Unexpected live RPC")},functions:{invoke(){throw Error("Unexpected live Edge")}}}';if(id==='\0offline-org')return 'export const useOrganization=()=>({})'}}]});await server.listen()
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),reports=[]
await mkdir('outputs/chat-design',{recursive:true})
try{for(const [width,theme]of [[1440,'dark'],[390,'light']]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1:5292\/)/,r=>r.abort())
 await page.goto('http://127.0.0.1:5292/tools/project-chat-design-preview.html?theme='+theme)
 await page.getByRole('button',{name:'Continue Design',exact:true}).click();await page.getByRole('button',{name:'Load exact Design sources',exact:true}).click()
 await page.getByLabel('Motion',{exact:true}).selectOption('reveal');await page.getByRole('button',{name:'Review Design draft',exact:true}).click()
 await page.getByRole('button',{name:'Confirm Design save',exact:true}).waitFor();await page.screenshot({path:`outputs/chat-design/${width}-${theme}-review.png`,fullPage:true})
 const confirm=page.getByRole('button',{name:'Confirm Design save',exact:true});await confirm.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Revise this Design draft',exact:true}).waitFor()
 await page.getByRole('button',{name:'Revise this Design draft',exact:true}).click();await page.getByRole('button',{name:'Load exact Design sources',exact:true}).click();await page.getByRole('button',{name:'Review Design draft',exact:true}).click()
 if(width===390)await page.evaluate(()=>{__designFixture.state.lose=true})
 await page.getByRole('button',{name:'Confirm Design save',exact:true}).click()
 if(width===390){await page.getByRole('button',{name:'Check saved Design result'}).waitFor();await page.getByRole('button',{name:'Reopen conversation'}).click();await page.getByRole('button',{name:'Check saved Design result'}).click()}
 await page.getByRole('heading',{name:'Design draft saved · v2',exact:true}).waitFor()
 assert.equal(await page.getByLabel('Chat draft').inputValue(),'Keep my next question')
 const result=await page.evaluate(()=>({writes:__designFixture.state.calls.filter(c=>c.name==='website-native-design').length,overflow:document.documentElement.scrollWidth>innerWidth}))
 assert.equal(result.writes,2);assert.equal(result.overflow,false);assert.deepEqual(errors,[]);await page.screenshot({path:`outputs/chat-design/${width}-${theme}-saved.png`,fullPage:true});reports.push({width,theme,...result,errors});await page.close()
 }}finally{await browser.close();await server.close()}
await writeFile('outputs/chat-design/report.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports))
