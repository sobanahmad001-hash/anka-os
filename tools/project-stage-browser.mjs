import {createServer} from 'vite'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const {chromium}=createRequire(import.meta.url)('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const server=await createServer({server:{host:'127.0.0.1',port:5282},logLevel:'error'})
await server.listen()
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
await mkdir('outputs/project-stages',{recursive:true})
const results=[]
try{for(const [width,height,theme] of [[1440,1040,'dark'],[390,844,'dark'],[1440,1040,'light'],[390,844,'light']]){
 const page=await browser.newPage({viewport:{width,height}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:5282\/)/,r=>r.abort())
 await page.goto(`http://127.0.0.1:5282/tools/project-stage-preview.html?theme=${theme}`)
 await page.getByRole('region',{name:'Project stage plan'}).waitFor()
 assert.equal(await page.getByText('Not configured',{exact:true}).count(),5)
 await page.getByRole('button',{name:/^Website/}).click()
 await page.getByRole('button',{name:/Keyword research & search intent Not configured/}).click()
 await page.getByRole('region',{name:'Stage details: Keyword research & search intent'}).waitFor()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
 await page.screenshot({path:`outputs/project-stages/${width}-${theme}-unconfigured.png`,fullPage:true})
 await page.getByRole('button',{name:'Continue in Chat',exact:false}).click()
 assert.match(await page.getByRole('status').innerText(),/Keyword research.*No message sent/)
 assert.deepEqual(errors,[])
 results.push({width,height,theme,unconfigured:true,stageSelection:true,noAutomaticSend:true})
 await page.close()
}
for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1040}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:5282\/)/,r=>r.abort());
 await page.goto('http://127.0.0.1:5282/tools/project-stage-preview.html?theme=dark&state=recorded');
 await page.getByRole('button',{name:/^Website/}).click();await page.getByRole('button',{name:/Page content Done/}).click();
 const detail=page.getByRole('region',{name:'Stage details: Page content'});
 assert.match(await detail.innerText(),/2 of 2 current required items complete/);
 assert.match(await detail.innerText(),/Only 1 loaded partition; not a whole-project total/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.screenshot({path:'outputs/project-stages/'+width+'-dark-recorded.png',fullPage:true});
 await detail.getByRole('button',{name:/Recorded content/}).click();assert.match(await page.getByRole('status').innerText(),/Exact output selected: cc000000-0000-4000-8000-000000000041/);
 assert.deepEqual(errors,[]);results.push({width,recordedNativeFixture:true,partitionScoped:true,exactOutputCallback:true});await page.close();
}
await writeFile('outputs/project-stages/presentation-verification.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results))}finally{await browser.close();await server.close()}
