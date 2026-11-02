import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {startUxPreview} from './os-uiux-preview.mjs'
import {SERVICE_CATALOGUE} from '../src/data/serviceCatalogue.js'
import {serviceBusinessCatalogue} from '../src/data/serviceBusinessGroups.js'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const groups=serviceBusinessCatalogue({leaves:SERVICE_CATALOGUE}).groups
const shared=groups[0].services.find(leaf=>groups[1].services.includes(leaf))
assert(shared,'Fixture must exercise the same canonical service in two business groups')
const out=new URL('../outputs/studio-services/',import.meta.url);await mkdir(out,{recursive:true})
const server=await startUxPreview({port:5268}),browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})}),cases=[]
try{for(const width of [1440,1024,768,390,320])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],external=[];page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort()}return route.continue()})
 await page.goto(`http://127.0.0.1:5268/tools/project-chat-integration-preview.html?panel=project-navigation&surface=project&state=populated&theme=${theme}`)
 await page.getByRole('textbox',{name:'Message',exact:true}).waitFor()
 await page.evaluate(()=>{const setup=globalThis.__integration.setup,original=setup.snapshot,review=setup.delivery.review;setup.snapshot=async()=>{const s=await original();return {...s,leaves:[...s.leaves,{...s.leaves[0],id:'a0000000-0000-4000-8000-000000009999',name:'Custom unmapped service'}]}};setup.delivery.review=async(s,p)=>{globalThis.__reviewedServicePlan=structuredClone(p);const result=await review(s,p);result.data.draft.unmapped=[{scope_id:'fixture-unmapped',name:'Unmapped template example',planning_issue:'No reviewed pipeline template is mapped.'}];return result}})
 await page.getByRole('button',{name:'Set up project',exact:true}).click()
 const setup=page.getByRole('region',{name:'Project setup proposal',exact:true}),nav=setup.getByRole('navigation',{name:'Service business groups'}),available=setup.getByLabel('Available services',{exact:true})
 await setup.getByRole('button',{name:'Select manually',exact:true}).click()
 await nav.getByRole('button',{name:'All services (123)',exact:true}).waitFor()
 assert.equal(await available.getByRole('checkbox').count(),123)
 const checkbox=()=>available.locator('label').filter({hasText:shared.name}).getByRole('checkbox')
 await nav.getByRole('button',{name:/^Branding /}).click();await checkbox().check()
 const quantity=setup.getByLabel('Quantity '+shared.name,{exact:true});await quantity.fill('13')
 const field=quantity.locator('xpath=ancestor::fieldset[1]');await field.getByRole('combobox').first().selectOption('monthly')
 await nav.getByRole('button',{name:/^Website /}).click();assert(await checkbox().isChecked());assert.equal(await quantity.inputValue(),'13');assert.equal(await field.getByRole('combobox').first().inputValue(),'monthly')
 assert.equal(await setup.getByLabel('Quantity '+shared.name,{exact:true}).count(),1)
 await nav.getByRole('button',{name:'Unmapped (1)',exact:true}).click();await available.getByRole('checkbox',{name:/Custom unmapped service/}).check();await setup.getByText('2 selected across all groups. Switching groups keeps your proposal.',{exact:true}).waitFor();await available.getByRole('checkbox',{name:/Custom unmapped service/}).uncheck()
 await nav.getByRole('button',{name:/^Marketing /}).click();await setup.getByLabel('Search setup services').fill('no matching service 999');await setup.getByText('No services match these filters.',{exact:true}).waitFor();assert.equal(await quantity.inputValue(),'13');await setup.getByLabel('Search setup services').fill('')
 await nav.getByRole('button',{name:'All services (123)',exact:true}).click();assert(await checkbox().isChecked());assert.equal(await available.getByRole('checkbox').count(),123)
 assert.deepEqual(await page.evaluate(()=>__integration.state.calls),[])
 await nav.scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(`${width}-${theme}.png`,out))})
 await setup.getByRole('button',{name:'Review combined setup',exact:true}).click();await setup.getByText(/Unmapped template example: No reviewed pipeline template is mapped/).waitFor()
 const plan=await page.evaluate(()=>__reviewedServicePlan);assert.equal(plan.items.length,1);assert.equal(plan.items[0].service_id,shared.id);assert.equal(plan.items[0].quantity,13);assert.equal(plan.items[0].cadence,'monthly');assert.notEqual(plan.items[0].pipeline,'branding');assert.deepEqual(await page.evaluate(()=>__integration.state.calls),['review'])
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 cases.push({width,theme,all123Visible:true,crossGroupIdentity:true,quantityCadenceRetained:true,unknownVisible:true,reviewOnly:true,unmappedGuardVisible:true});console.log({width,theme,passed:true});await page.close()
}await writeFile(new URL('verification.json',out),JSON.stringify({synthetic:true,providerCalls:0,cases},null,2))}finally{await browser.close();await server.close()}
