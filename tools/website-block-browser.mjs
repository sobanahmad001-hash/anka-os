import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {startBlockPreview} from './website-block-preview.mjs'
const {chromium}=createRequire(import.meta.url)('C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),out=new URL('../outputs/website-block-preview/',import.meta.url)
await mkdir(out,{recursive:true});const server=await startBlockPreview(),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),cases=[]
try{for(const width of [1440,390])for(const theme of ['light','dark']){
 console.log({width,theme});const page=await browser.newPage({viewport:{width,height:900}}),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')route.continue();else{external.push(route.request().url());route.abort()}})
 await page.goto('http://127.0.0.1:5208/tools/website-block-preview.html?theme='+theme)
 const panel=page.getByRole('region',{name:'Native WordPress build',exact:true});await panel.getByLabel('Saved Website design for build',{exact:true}).waitFor()
 const before=await page.evaluate(()=>JSON.stringify(globalThis.__blockPreview.fixture.canonical))
 await panel.getByLabel('Saved Website design for build',{exact:true}).selectOption({label:'home · v2 · Home Website design'})
 await panel.getByRole('button',{name:'Review native package',exact:true}).click();await panel.getByRole('region',{name:'Review native block build',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>globalThis.__blockPreview.fixture.counts.build),0)
 await panel.getByRole('button',{name:'Build private review package',exact:true}).click();await panel.getByText(/New builds remain blocked/).waitFor()
 assert.equal(await page.getByRole('button',{name:'Switch preview context',exact:true}).isDisabled(),true)
 await panel.getByRole('button',{name:'Recover original native build',exact:true}).click();await panel.getByText('Original native build recovered without another write.',{exact:true}).waitFor()
 await panel.getByText('Native package and source history',{exact:true}).click();await panel.getByRole('button',{name:'Verify package download',exact:true}).click()
 await panel.getByRole('link',{name:/Download verified package/}).waitFor();assert.match(await panel.getByRole('link',{name:/Download verified package/}).getAttribute('href'),/\/native-block\.zip\?token=synthetic$/)
 await page.evaluate(()=>globalThis.__blockPreview.fixture.flags.stale=true);await panel.getByRole('button',{name:'Review native package',exact:true}).click()
 await panel.getByText(/Source review needed: Content/).waitFor();assert.equal(await panel.getByRole('button',{name:'Build private review package',exact:true}).isDisabled(),true)
 assert.equal(await page.evaluate(()=>JSON.stringify(globalThis.__blockPreview.fixture.canonical)),before)
 assert.equal(await page.evaluate(()=>globalThis.__blockPreview.fixture.counts.build),1)
 await panel.getByRole('heading',{name:'Native WordPress block-theme build',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(width+'-'+theme+'.png',out))})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 await page.getByRole('button',{name:'Switch preview context',exact:true}).click();assert.equal(await page.getByRole('region',{name:'Native WordPress build',exact:true}).count(),0)
 cases.push({width,theme,manualSelection:true,reviewOnlyBeforeBuild:true,originalRecovery:true,canonicalHistoryUnchanged:true,staleBuildBlocked:true,verifiedDownload:true,contextReset:true});await page.close()
}}finally{await browser.close();await server.close()}
await writeFile(new URL('verification.json',out),JSON.stringify({synthetic:true,providerCalls:0,productionWrites:0,cases},null,2));console.log(JSON.stringify(cases))
