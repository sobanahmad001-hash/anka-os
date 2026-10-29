import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {startStagingPreview} from './website-staging-preview.mjs'
const {chromium}=createRequire(import.meta.url)('C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const out=new URL('../outputs/website-project-link/',import.meta.url);await mkdir(out,{recursive:true})
const server=await startStagingPreview({port:5232,cacheDir:fileURLToPath(new URL('vite-cache/',out))});let browser;const cases=[]
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 for(const width of [1440,390])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],external=[]
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external.push(route.request().url());return route.abort()})
  await page.goto('http://127.0.0.1:5232/tools/website-staging-preview.html?projectLink=1&theme='+theme)
  const access=page.getByRole('group',{name:'WordPress project access'})
  await page.getByText('Link WordPress to this project',{exact:true}).click()
  const canonical=await page.evaluate(()=>JSON.stringify(globalThis.__blockPreview.fixture.canonical))
  await page.getByLabel('WordPress connection to link',{exact:true}).selectOption({label:'Anka Sphere synthetic Hostinger staging · https://staging.example.test'})
  await page.getByRole('button',{name:'Review project link',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Save reviewed project link',exact:true}).isDisabled(),true)
  await page.getByRole('checkbox',{name:'I confirm this WordPress connection for this project.',exact:true}).check()
  await page.getByRole('button',{name:'Save reviewed project link',exact:true}).click()
  await page.getByRole('button',{name:'Recover original project link',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Switch preview context',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Dry run staging',exact:true}).isDisabled(),true)
  await access.scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(`${width}-${theme}-pending.png`,out))})
  await page.getByRole('button',{name:'Recover original project link',exact:true}).click()
  await page.getByText(/WordPress is linked to this project/).waitFor()
  assert.equal(await page.getByRole('button',{name:'Review project link',exact:true}).isDisabled(),true)
  assert.deepEqual(await page.evaluate(()=>({save:globalThis.__projectLink.save,recover:globalThis.__projectLink.recover})),{save:1,recover:1})
  assert.equal(await page.getByRole('button',{name:'Switch preview context',exact:true}).isDisabled(),false)
  await page.getByText('Bind an authorized staging target',{exact:true}).click()
  await page.getByLabel('Staging connection',{exact:true}).selectOption({label:'Anka Sphere synthetic Hostinger staging · https://staging.example.test'})
  await page.getByRole('button',{name:'Inspect staging identity',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Bind reviewed staging target',exact:true}).isDisabled(),true)
  await page.getByRole('checkbox',{name:'I confirm this exact isolated staging site for this project.',exact:true}).check()
  await page.getByRole('button',{name:'Bind reviewed staging target',exact:true}).click()
  await page.getByText(/Exact isolated staging target bound/).waitFor()
  assert.deepEqual(await page.evaluate(()=>globalThis.__blockPreview.fixture.staging.counts),{inspect:1,bind:1,dryRun:0,deploy:0,recover:0,issue:0})
  assert.equal(await page.evaluate(()=>JSON.stringify(globalThis.__blockPreview.fixture.canonical)),canonical)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  await page.getByText('Bind an authorized staging target',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(`${width}-${theme}-bound.png`,out))})
  cases.push({width,theme,explicitProjectLink:true,readOnlyLostResponseRecovery:true,linkSaves:1,linkRecoveryReads:1,explicitSeparateIdentityBinding:true,stagingDeploys:0,connectionRetests:0,productionWrites:0,externalRequests:0,overflow:false});await page.close()
 }
 await writeFile(new URL('verification.json',out),JSON.stringify({cases,auth:'synthetic',database:'synthetic in-memory',wordpress:'synthetic inspection/bind',providerCalls:0},null,2));console.log(JSON.stringify({cases:cases.length,externalRequests:0,productionWrites:0}))
}finally{await browser?.close();await server.close()}
