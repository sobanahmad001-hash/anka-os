import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {startUxPreview} from './os-uiux-preview.mjs'
const {chromium}=createRequire(import.meta.url)('C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const out=new URL('../outputs/studio-shell/',import.meta.url);await mkdir(out,{recursive:true})
const server=await startUxPreview({port:5265})
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const cases=[]
try {
 for(const width of [1440,1024,768,390,320]) for(const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],external=[]
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort()}return route.continue()})
  await page.goto(`http://127.0.0.1:5265/tools/project-chat-integration-preview.html?panel=project-navigation&surface=project&state=populated&theme=${theme}`)
  const chat=page.getByRole('region',{name:'Connected delivery preview · Project AI',exact:true})
  await chat.getByLabel('Message',{exact:true}).waitFor()
  assert.deepEqual(await page.getByRole('tablist',{name:'Project workspace sections'}).getByRole('tab').allTextContents(),['Chat','Work','Assets','Delivery','Overview'])
  const canonical=await page.evaluate(()=>globalThis.__integration.canonical)
  await chat.getByLabel('Message',{exact:true}).fill('Retained Studio draft')
  if(width>=1280){
   const rail=page.getByRole('complementary',{name:'Project context'});assert.equal(await page.getByRole('button',{name:'Project details',exact:true}).isVisible(),false);assert((await rail.boundingBox()).y<600)
   await rail.getByLabel('Linked work').selectOption({label:'Website copy'})
   await rail.getByText('Reviewed Website content',{exact:true}).waitFor()
   assert((await rail.getByRole('link').getAttribute('href')).includes('engagement_work_item'))
   await rail.getByRole('button',{name:'Hide details'}).click();await rail.getByRole('button',{name:'Show details'}).click()
  } else {
   const opener=page.getByRole('button',{name:'Project details',exact:true});await opener.click()
   const drawer=page.getByRole('dialog',{name:'Project details'})
   await drawer.getByLabel('Linked work').selectOption({label:'Website copy'})
   await drawer.getByText('Reviewed Website content',{exact:true}).waitFor()
   await drawer.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Shift+Tab')
   assert(await drawer.evaluate(node=>node.contains(document.activeElement)))
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert(await opener.evaluate(node=>node===document.activeElement))
  }
  assert.equal(await chat.getByLabel('Message',{exact:true}).inputValue(),'Retained Studio draft')
  await page.screenshot({path:new URL(`context-${width}-${theme}.png`,out).pathname.replace(/^\/C:/,'C:'),fullPage:true})
  await chat.getByLabel('Message',{exact:true}).fill('')
  await page.getByRole('tab',{name:'Chat',exact:true}).focus();await page.keyboard.press('End')
  await page.getByRole('tab',{name:'Overview',exact:true,selected:true}).waitFor()
  await page.keyboard.press('Home');await chat.getByLabel('Message',{exact:true}).waitFor()
  await page.screenshot({path:new URL(`chat-${width}-${theme}.png`,out).pathname.replace(/^\/C:/,'C:'),fullPage:true})
  for(const tab of ['Work','Assets','Delivery']) {await page.getByRole('tab',{name:tab,exact:true}).click();if(tab==='Work'){for(const view of ['Pipeline','List','Board']){await page.getByRole('group',{name:'Work view',exact:true}).getByRole('button',{name:view,exact:true}).click();await page.getByText('Website copy',{exact:true}).waitFor();await page.getByText('Completed original task',{exact:true}).waitFor()}}assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${tab} overflow at ${width}`)}
  assert.equal(await page.evaluate(()=>JSON.stringify({tasks:globalThis.__directChatPreview.projectWorkspace.projectTasks,work:globalThis.__directChatPreview.projectWorkspace.engagementWorkItems,outputs:globalThis.__directChatPreview.projectWorkspace.workshopArtifacts})),canonical)
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  cases.push({width,theme,tabs:true,context:true,draftRetained:true,keyboard:true,noOverflow:true,canonicalUnchanged:true});console.log({width,theme,passed:true});await page.close()
 }
} finally {await browser.close();await server.close()}
await writeFile(new URL('verification.json',out),JSON.stringify({synthetic:true,productionAcceptance:false,providerCalls:0,cases},null,2))
