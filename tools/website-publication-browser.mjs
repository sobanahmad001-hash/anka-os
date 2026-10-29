import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {startPublicationPreview} from './website-publication-preview.mjs'
const {chromium}=createRequire(import.meta.url)('C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),out=new URL('../outputs/website-publication-preview/',import.meta.url)
await mkdir(out,{recursive:true});const server=await startPublicationPreview(),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),cases=[]
try{for(const width of [1440,390])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')route.continue();else{external.push(route.request().url());route.abort()}})
 await page.goto('http://127.0.0.1:5242/tools/website-publication-preview.html?theme='+theme,{waitUntil:'domcontentloaded',timeout:60000})
 const panel=page.getByRole('region',{name:'Controlled website publication and rollback',exact:true})
 await panel.getByLabel('Publication target',{exact:true}).selectOption({index:1});await panel.getByRole('button',{name:'Inspect current publication inventory',exact:true}).click()
 await panel.getByRole('checkbox',{name:/home/}).check();await panel.getByLabel(/Publication operation/).selectOption('create');await panel.getByLabel('Publication theme operation',{exact:true}).selectOption('replace')
 assert.equal(await panel.getByRole('button',{name:'Review exact publication',exact:true}).isDisabled(),true)
 await panel.getByLabel('Reviewed site-wide theme impact',{exact:true}).check();await panel.getByRole('button',{name:'Review exact publication',exact:true}).click()
 assert.equal(await panel.getByLabel('Confirm exact live operation',{exact:true}).isChecked(),false);assert.equal(await panel.getByRole('button',{name:'Publish reviewed pages',exact:true}).isDisabled(),true)
 await panel.getByText('Full exact source, target and impact review',{exact:true}).click()
 await panel.getByRole('region',{name:'Exact live operation review',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(width+'-'+theme+'-review.png',out))})
 await panel.getByLabel('Confirm exact live operation',{exact:true}).focus();await page.keyboard.press('Space');await page.keyboard.press('Tab');assert.equal(await panel.getByRole('button',{name:'Publish reviewed pages',exact:true}).evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Enter')
 await panel.getByText(/An original live request needs recovery/).waitFor();assert.equal(await page.getByRole('button',{name:'Switch preview context',exact:true}).isDisabled(),true)
 await panel.getByRole('button',{name:'Recover original live request',exact:true}).click();await panel.getByText(/Original publication succeeded/).waitFor()
 await panel.getByText('Retained publication and rollback history',{exact:true}).click();await panel.getByRole('button',{name:'Select publication for rollback review',exact:true}).click()
 assert.equal(await panel.getByRole('button',{name:'Review selected rollback',exact:true}).isDisabled(),true)
 await panel.getByLabel('Reviewed site-wide theme impact',{exact:true}).check();await panel.getByRole('button',{name:'Review selected rollback',exact:true}).click()
 assert.equal(await panel.getByLabel('Confirm exact live operation',{exact:true}).isChecked(),false)
 await panel.getByRole('region',{name:'Exact live operation review',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(width+'-'+theme+'-rollback.png',out))})
 await panel.getByLabel('Confirm exact live operation',{exact:true}).check();await panel.getByRole('button',{name:'Restore reviewed original backup',exact:true}).click();await panel.getByText(/Original rollback succeeded/).waitFor()
 assert.deepEqual(await page.evaluate(()=>globalThis.__publication.counts),{publication:1,rollback:1,recover:1,review:2})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 await page.getByRole('button',{name:'Switch preview context',exact:true}).click();assert.equal(await panel.count(),0)
 cases.push({width,theme,exactReview:true,uncheckedConfirmation:true,keyboardFocus:true,lostReplyRecoveryNoResend:true,rollback:true,externalRequests:0,productionWrites:0});await page.close()
}}finally{await browser.close();await server.close()}
await writeFile(new URL('verification.json',out),JSON.stringify({synthetic:true,cases},null,2));console.log(JSON.stringify(cases))
