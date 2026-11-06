import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {createServer} from 'vite'
const {chromium}=createRequire(import.meta.url)('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const server=await createServer({server:{port:5291,host:'127.0.0.1'},plugins:[{name:'offline-content-actions',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase.js'))return '\0content-client';if(source.endsWith('AuthContext.jsx'))return '\0content-auth';if(source.endsWith('artifactApprovalRepository.js'))return '\0content-approval'},load(id){if(id==='\0content-client')return 'export const supabase={rpc(){throw Error("Unexpected live RPC")}}';if(id==='\0content-auth')return 'export const useAuth=()=>({user:{id:globalThis.__contentActionTest.actorId}})';if(id==='\0content-approval')return 'export const artifactApprovals=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__contentActionTest.approvals[k](...a)})'}}]});await server.listen()
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),reports=[]
await mkdir('outputs/chat-content',{recursive:true})
try{for(const [width,theme,lost]of [[1440,'dark',false],[390,'light',true]]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1:5291\/)/,r=>r.abort())
 await page.goto('http://127.0.0.1:5291/tools/project-chat-content-preview.html?theme='+theme)
 await page.getByRole('button',{name:'Prepare Content',exact:true}).click()
 await page.getByLabel('Content title',{exact:true}).fill('Homepage copy')
 assert.equal(await page.getByLabel('Exact website structure',{exact:true}).inputValue(),'ab000000-0000-4000-8000-000000000009');assert.equal(await page.getByLabel('Page',{exact:true}).inputValue(),'home')
 for(const [label,value]of [['Objective','Explain the service'],['Audience','Visitors'],['Language','English'],['Content text','  Exact approved draft.\nKeep these spaces.  ']])await page.getByLabel(label,{exact:true}).fill(value)
 assert.equal(await page.getByLabel('Content service',{exact:true}).inputValue(),'ab000000-0000-4000-8000-000000000013');await page.getByLabel('Source Content Work',{exact:true}).selectOption({index:2})
 await page.getByRole('button',{name:'Review Content save',exact:true}).click();await page.getByRole('button',{name:'Confirm Content save',exact:true}).waitFor()
 await page.screenshot({path:`outputs/chat-content/${width}-${theme}-proposal.png`,fullPage:true})
 if(!lost){await page.evaluate(()=>{__contentActionTest.state.blocked=true});await page.getByRole('button',{name:'Confirm Content save',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Content text',{exact:true}).inputValue(),'  Exact approved draft.\nKeep these spaces.  ');await page.evaluate(()=>{__contentActionTest.state.blocked=false});await page.getByRole('button',{name:'Review Content save',exact:true}).click()}
 await page.getByRole('button',{name:'Confirm Content save',exact:true}).click();await page.getByRole('button',{name:'Approve version 1',exact:true}).click()
 await page.getByRole('button',{name:'Prepare Design handoff',exact:true}).click()
 for(const [label,suffix]of [['Receiving Design service','014'],['Receiving Design workstream','015'],['Receiving Design Work','007']])assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),'ab000000-0000-4000-8000-000000000'+suffix)
 await page.getByRole('button',{name:'Review Design handoff',exact:true}).click()
 if(lost)await page.evaluate(()=>{__contentActionTest.state.lose=true})
 await page.getByRole('button',{name:'Confirm Design handoff',exact:true}).focus();await page.keyboard.press('Enter')
 if(lost){await page.getByRole('button',{name:'Check saved result',exact:true}).waitFor();await page.getByRole('button',{name:'Reopen conversation',exact:true}).click();await page.getByRole('button',{name:'Check saved result',exact:true}).click()}
 await page.getByRole('article',{name:'Recorded Design handoff',exact:true}).waitFor()
 assert.equal(await page.getByLabel('Chat draft').inputValue(),'Keep my next question')
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 const calls=await page.evaluate(()=>__contentActionTest.state.calls)
 assert.equal(calls.filter(c=>c.name==='apply_project_chat_content_action').length,lost?2:3)
 assert.equal(await page.evaluate(()=>__contentActionTest.state.receipts.length),2)
 await page.screenshot({path:`outputs/chat-content/${width}-${theme}-result.png`,fullPage:true})
 assert.deepEqual(errors,[]);reports.push({width,theme,saveReviewHandoff:true,draftPreserved:true,unknownHandoffRecovered:lost,twoExplicitMutations:true,uniqueDefaultsReviewed:true,noHorizontalOverflow:true})
 await page.close()
}await writeFile('outputs/chat-content/browser-verification.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports))}finally{await browser.close();await server.close()}
