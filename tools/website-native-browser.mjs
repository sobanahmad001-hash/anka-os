import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {bindWebsiteNativeFixture,websiteNativeFixture} from './website-native-fixture.js'
import {compileWebsiteNativeDesign,WEBSITE_NATIVE_TEMPLATES} from '../src/data/websiteNativeDesign.js'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const out=new URL('../outputs/website-native-preview/',import.meta.url);await mkdir(out,{recursive:true})
const packages=new Map()
for(const template of WEBSITE_NATIVE_TEMPLATES){const result=await compileWebsiteNativeDesign(await websiteNativeFixture(template));packages.set('/'+template,result);await writeFile(new URL(template+'-source-package.json',out),JSON.stringify(result,null,2))}
const external=await websiteNativeFixture();external.content.sections.at(-1).action={label:'Connect with Anka',path:'https://ankasphere.com/contact-anka-sphere/'};packages.set('/external',await compileWebsiteNativeDesign(await bindWebsiteNativeFixture(external)));
const long=await websiteNativeFixture();long.content.title='A'.repeat(180);long.content.sections[0].paragraphs=['A long source paragraph with deliberate detail. '.repeat(50).trim()];long.sources.content.version_id='a0000000-0000-4000-8000-000000000999';packages.set('/long',await compileWebsiteNativeDesign(await bindWebsiteNativeFixture(long)))
const server=createServer((req,res)=>{const result=packages.get(req.url);res.writeHead(result?200:404,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(result?.preview||'Not found')})
await new Promise(done=>server.listen(5199,'127.0.0.1',done))
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}),cases=[]
try{for(const template of process.argv.includes('--external-cta')?['external']:[...WEBSITE_NATIVE_TEMPLATES,'long','external'])for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:width===390?'reduce':'no-preference'}),errors=[],external=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>{globalThis.__fixtureCLS=0;new PerformanceObserver(entries=>{for(const entry of entries.getEntries())if(!entry.hadRecentInput)globalThis.__fixtureCLS+=entry.value}).observe({type:'layout-shift',buffered:true})})
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort()}return route.continue()})
 await page.goto('http://127.0.0.1:5199/'+template)
 assert.equal(await page.getByRole('heading',{level:1}).count(),1)
 assert.equal(await page.locator('script,iframe,form,input').count(),0)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(await page.locator('a[href^="#"]').evaluateAll(links=>links.filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash)),[])
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to content')
 await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>location.hash),'#main')
 if(template==='external'){assert.equal(await page.getByRole('link',{name:'Connect with Anka',exact:true}).getAttribute('href'),'https://ankasphere.com/contact-anka-sphere/');await page.getByRole('link',{name:'Connect with Anka',exact:true}).focus();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Connect with Anka')}else{await page.getByRole('link',{name:'Get in touch',exact:true}).click();assert.equal(await page.evaluate(()=>location.hash),'#contact')}
 if(width===390)assert.equal(await page.locator('.anka-reveal').evaluate(n=>getComputedStyle(n).animationName),'none')
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:fileURLToPath(new URL(`${template}-${width}.png`,out)),fullPage:true})
 assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 const layoutShift=await page.evaluate(()=>globalThis.__fixtureCLS);assert.ok(layoutShift<=.1,'Stable initial layout')
 cases.push({template,width,keyboard:true,anchors:true,reducedMotion:width===390,externalRequests:0,layoutShift});await page.close()
}}finally{await browser.close();await new Promise(done=>server.close(done))}
await writeFile(new URL('verification.json',out),JSON.stringify({status:'LOCAL_FUNCTIONAL_SOURCE_PREVIEW',wordpressInstallation:'NOT_RUN',staging:'NOT_CONFIGURED',publication:false,paidCalls:0,cases},null,2))
console.log(JSON.stringify(cases))
