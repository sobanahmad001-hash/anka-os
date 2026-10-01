// Provider-free visual assertions against the isolated localhost fixture only.
// Windows example: node tools/check-direct-chat-browser.cjs <playwright-module> <output-directory>
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.argv[2] || 'playwright')
const output = process.argv[3]
assert(output, 'An evidence output directory is required')
const base = 'http://127.0.0.1:5188/tools/direct-chat-preview.html'
async function drawerAssertions(page, label, opener) {
  const drawer = page.getByRole('dialog', { name: label, exact: true })
  await drawer.waitFor()
  assert.equal(await drawer.getAttribute('aria-modal'), 'true')
  const focusables = await drawer.locator('button, input, select, textarea, a[href]').evaluateAll(nodes => nodes.filter(node => !node.disabled && node.getClientRects().length).map(node => node.textContent || node.getAttribute('aria-label')))
  assert(focusables.length > 0)
  assert(await drawer.evaluate(node => node.contains(document.activeElement)))
  await page.keyboard.press('Shift+Tab')
  assert(await drawer.evaluate(node => node.contains(document.activeElement)), 'Shift Tab escaped the modal')
  await page.keyboard.press('Tab')
  assert(await drawer.evaluate(node => node.contains(document.activeElement)), 'Tab escaped the modal')
  await page.keyboard.press('Escape')
  assert.equal(await drawer.count(), 0)
  assert(await opener.evaluate(node => document.activeElement === node), 'Escape did not restore opener focus')
  return { initialFocus: true, shiftTabContained: true, tabContained: true, escapeClosed: true, openerFocusRestored: true }
}
async function writerAssertions(browser) {
  const results = []
  const recoveryOnly = process.argv.includes('--writer-recovery')
  for (const [width, height, theme] of (recoveryOnly ? [[1440,900,'dark']] : [[1440,900,'light'],[1440,900,'dark'],[390,900,'light'],[390,900,'dark']])) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    const errors = [], blocked = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    await page.route('**/*', route => { const url = new URL(route.request().url()); if (url.hostname === '127.0.0.1' && url.port === '5188') return route.continue(); blocked.push(url.origin); return route.abort() })
    await page.goto(`${base}?panel=writer&surface=content&state=empty&theme=${theme}`)
    const chatComposer = page.getByRole('textbox', { name: /^Message/ })
    await chatComposer.waitFor()
    const composerBounds = await chatComposer.boundingBox()
    assert(composerBounds && composerBounds.y >= 0 && composerBounds.y + composerBounds.height <= height, 'Shared engagement composer extends below viewport')
    assert(await page.locator('.department-chat-messages').evaluate(node => node.getBoundingClientRect().height >= 80))
    await chatComposer.fill('Keep this unsent engagement message')
    await page.getByRole('button', { name: 'Open Content writer beside chat', exact: true }).click()
    const pane = page.getByRole(width <= 900 ? 'dialog' : 'complementary', { name: 'Canonical Content side editor', exact: true })
    await pane.getByRole('heading', { name: 'Content writer · canonical versions', exact: true }).waitFor()
    assert(await pane.evaluate(node => node.contains(document.activeElement)))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const draftBounds = await pane.getByLabel(/Draft text/).boundingBox()
    assert(draftBounds && draftBounds.y >= 0 && draftBounds.y + 40 < height, 'Editable text not visible on opening')
    assert(await pane.getByRole('button', { name: 'Back to chat', exact: true }).isVisible())
    const openScreenshot = `b3-content-writer-open-${theme}-${width}x${height}.png`
    if (!recoveryOnly) await page.screenshot({ path: path.join(output, openScreenshot) })
    await pane.getByRole('combobox', { name: 'Saved writer output', exact: true }).selectOption({ label: 'Existing article · v1' })
    const body = pane.getByLabel(/Draft text/)
    assert.equal(await body.inputValue(), 'Keep alpha and omega.')
    await body.evaluate(node => { node.focus(); node.setSelectionRange(5,10) })
    await pane.getByRole('button', { name: 'Use selected text', exact: true }).click()
    await pane.getByLabel(/Replacement/).fill('beta')
    await pane.getByRole('button', { name: 'Apply to working draft', exact: true }).click()
    assert.equal(await body.inputValue(), 'Keep beta and omega.')
    assert.equal(await page.evaluate(() => globalThis.__directChatPreview.fixture.writerWrites), 0)
    await pane.getByRole('button', { name: 'Preview draft', exact: true }).click()
    const saveScreenshot = `b3-content-writer-save-preview-${theme}-${width}x${height}.png`
    await pane.getByRole('button', { name: 'Confirm unapproved draft', exact: true }).scrollIntoViewIfNeeded()
    if (!recoveryOnly) await page.screenshot({ path: path.join(output, saveScreenshot) })
    await pane.getByRole('button', { name: 'Confirm unapproved draft', exact: true }).click()
    await page.waitForFunction(() => globalThis.__directChatPreview.fixture.writerWrites === 1)
    const canonical = await page.evaluate(() => ({ writes: globalThis.__directChatPreview.fixture.writerWrites, versions: globalThis.__directChatPreview.fixture.contentWorkspace.versions.map(version => ({ id: version.id, parent: version.parent_version_id, number: version.version_number, body: version.content.body })) }))
    assert.equal(canonical.versions.length, 2)
    assert.equal(canonical.versions[0].body, 'Keep alpha and omega.')
    assert.equal(canonical.versions[1].parent, canonical.versions[0].id)
    assert.equal(canonical.versions[1].body, 'Keep beta and omega.')
    assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
    results.push({ viewport: { width, height }, theme, focusMovedToPane: true, editableTextVisibleOnOpen: true, persistentReturnControl: true, noHorizontalOverflow: true, boundedReplacementPreservesOtherText: true, previewDoesNotWrite: true, oneExactParentImmutableSave: true, sourceVersionUnchanged: true, writerWrites: canonical.writes, pageErrors: errors, blockedRemoteRequests: blocked, screenshots: [openScreenshot, saveScreenshot] })
    await page.waitForFunction(() => document.querySelector('.content-chat-writer textarea')?.value === '')
    if (recoveryOnly) {
      await pane.getByRole('combobox', { name: 'Saved writer output', exact: true }).selectOption({ label: 'Existing article · v2' })
      await body.fill('Keep gamma and omega.')
      await page.evaluate(() => { globalThis.__directChatPreview.fixture.writerUncertainAfterSave = true })
      await pane.getByRole('button', { name: 'Preview draft', exact: true }).click()
      await pane.getByRole('button', { name: 'Confirm unapproved draft', exact: true }).click()
      await pane.getByText('The save outcome needs review.', { exact: false }).waitFor()
      assert(await pane.getByRole('button', { name: 'Confirm unapproved draft', exact: true }).isDisabled())
      assert.equal(await page.evaluate(() => globalThis.__directChatPreview.fixture.writerWrites), 2)
      await pane.getByText('Saved versions and copy options', { exact: true }).click()
      await pane.getByRole('button', { name: 'Refresh outputs', exact: true }).click()
      await pane.getByRole('button', { name: 'Continue from exact v3', exact: true }).waitFor()
      await pane.getByRole('button', { name: 'Back to chat', exact: true }).click()
      assert.equal(await chatComposer.inputValue(), 'Keep this unsent engagement message')
      await page.getByRole('button', { name: 'Open Content writer beside chat', exact: true }).click()
      await pane.getByRole('combobox', { name: 'Saved writer output', exact: true }).selectOption({ label: 'Existing article · v3' })
      assert.equal(await pane.getByLabel(/Draft text/).inputValue(), 'Keep gamma and omega.')
      assert.equal(await page.evaluate(() => globalThis.__directChatPreview.fixture.writerWrites), 2)
      results.at(-1).uncertainSaveRecovery = { committedVersionInspected: true, blindRetryBlocked: true, twoIntentionalWrites: true, editorReopenedAtExactLatest: true, chatDraftPreserved: true }
    }
    if (width <= 900) results.at(-1).editorDrawer = await drawerAssertions(page, 'Canonical Content side editor', page.getByRole('button', { name: 'Open Content writer beside chat', exact: true }))
    if (width > 900) await pane.getByRole('button', { name: 'Back to chat', exact: true }).click()
    assert.equal(await chatComposer.inputValue(), 'Keep this unsent engagement message')
    results.at(-1).actualEngagementComposerPreserved = true
    results.at(-1).sharedChatComposerWithinViewport = true
    await context.close()
    console.log('VERIFY canonical writer', width, height, theme)
  }
  if (recoveryOnly) {
    const file = path.join(output, 'b3-content-writer-browser-evidence.json')
    const existing = JSON.parse(await fs.readFile(file, 'utf8')); existing.recoveryResults = results; await fs.writeFile(file, JSON.stringify(existing, null, 2))
  } else {
  const file = path.join(output, 'b3-content-writer-browser-evidence.json')
  let existing = {}; try { existing = JSON.parse(await fs.readFile(file, 'utf8')) } catch { /* First evidence write. */ }
  await fs.writeFile(file, JSON.stringify({ ...existing, source: 'tools/check-direct-chat-browser.cjs --writer', scope: 'Actual engagement Chat and canonical side writer/shell; isolated backend metadata and canonical save fixture. No provider request, production write or installed acceptance. Chat send is separately mocked and labelled in sharedChat.', results }, null, 2))
  }
  console.log(JSON.stringify({ writerCasesPassed: results.length }))
}

async function sharedChatAssertions(browser) {
 const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
 const page = await context.newPage(); page.setDefaultTimeout(15000)
 const errors=[], blocked=[]; page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/*',route=>{ const url=new URL(route.request().url()); if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue(); blocked.push(url.origin); return route.abort() })
 await page.goto(`${base}?panel=writer&answer=fixture&surface=content&state=empty&theme=light`)
 const composer=page.getByRole('textbox',{name:/^Message/})
 const form=page.locator('.department-chat-main')
 await composer.fill('First offline question')
 await form.evaluate(node=>{ node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})) })
 await page.getByRole('dialog',{name:'Confirm AI data sharing',exact:true}).waitFor()
 await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
 await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.engagementMessages.length===2 && document.querySelector('.department-chat-prompt textarea')?.value==='')
 await composer.fill('Follow-up offline question')
 await form.evaluate(node=>{ node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})) })
 await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.engagementMessages.length===4 && document.querySelector('.department-chat-prompt textarea')?.value==='')
 assert.equal(await page.getByRole('dialog',{name:'Confirm AI data sharing',exact:true}).count(),0)
 const turns=await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementTurns)
 assert.equal(turns.length,2); assert.notEqual(turns[0].client_request_id,turns[1].client_request_id)
 assert.equal(turns[0].prompt,'First offline question'); assert.equal(turns[1].prompt,'Follow-up offline question')
 await composer.fill('Keep unsent after saved answers')
 await page.getByRole('link',{name:'Home',exact:true}).click()
 const draft=page.getByRole('dialog',{name:'Unsent chat draft',exact:true}); await draft.waitFor()
 await draft.getByRole('button',{name:'Stay',exact:true}).click()
 assert.equal(await composer.inputValue(),'Keep unsent after saved answers')
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
 const file=path.join(output,'b3-content-writer-browser-evidence.json'), evidence=JSON.parse(await fs.readFile(file,'utf8'))
 evidence.sharedChat={scope:'Actual compact workbench in one existing saved conversation, mock answer persistence only; fresh-chat atomic creation and live provider acceptance not exercised',firstAndFollowupSingleFlight:true,oneConsentForUnchangedScope:true,distinctDurableRequestIds:true,savedMessages:4,routeStayPreservesUnsentDraft:true,providerCalls:0,productionWrites:0,pageErrors:errors,blockedRemoteRequests:blocked}
 await fs.writeFile(file,JSON.stringify(evidence,null,2));await context.close();console.log('VERIFY actual shared Chat: two local turns, duplicate submissions suppressed, consent reused, route draft preserved')
}

async function videoBriefPrototypeAssertions(browser) {
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?panel=video-brief&surface=design&state=populated&theme=${theme}`)
  const pane=page.getByRole('region',{name:'Versioned video brief',exact:true}),preview=page.getByRole('button',{name:'Preview complete video brief',exact:true})
  await pane.waitFor();assert(await preview.isDisabled())
  const fields={'Purpose':'Explain the launch','Audience':'Returning clients','Channel / placement':'Organic social','Source assets / reuse plan':'None — text-to-video only','Script / storyboard':'Show the product, then three benefits','Brand constraints':'No unlicensed marks','Required text':'Launch date: 10 October'}
  for(const [name,value] of Object.entries(fields))await pane.getByRole('textbox',{name,exact:true}).fill(value)
  await preview.click();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),0)
  const review=page.getByRole('region',{name:'Confirm exact video brief',exact:true});await review.waitFor()
  assert((await review.innerText()).includes('Launch date: 10 October'))
  assert(await review.evaluate(node=>node.contains(document.activeElement)))
  const screenshot=`b3-video-brief-prototype-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,screenshot)})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const confirm=page.getByRole('button',{name:'Confirm video brief version',exact:true})
  await confirm.evaluate(node=>{node.click();node.click()})
  await pane.getByText('Exact brief v1 confirmed.',{exact:false}).waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),1)
  await pane.getByRole('textbox',{name:'Required text',exact:true}).fill('Launch date: 18 October')
  assert.equal(await pane.getByText('Exact brief v1 confirmed.',{exact:false}).count(),0)
  await preview.click();await page.evaluate(()=>{globalThis.__directChatPreview.fixture.briefLostResponse=true});await confirm.click()
  await pane.getByText('Original confirmation response lost',{exact:false}).waitFor();assert(await preview.isDisabled())
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),2)
  await page.getByRole('button',{name:'Check saved brief',exact:true}).click()
  await pane.getByText('Exact brief v2 confirmed.',{exact:false}).waitFor()
  const evidence=await page.evaluate(()=>{const f=globalThis.__directChatPreview.fixture;return {writes:f.briefWrites,versions:f.data.videoBriefVersions.map(v=>({id:v.id,parent:v.parent_version_id,text:v.content.video_brief.required_text})),reads:f.briefReads,generationCalls:f.videoGenerationCalls}})
  assert.equal(evidence.writes,2);assert.equal(evidence.versions[0].text,'Launch date: 10 October');assert.equal(evidence.versions[1].text,'Launch date: 18 October');assert.equal(evidence.versions[1].parent,evidence.versions[0].id);assert.equal(evidence.generationCalls,0);assert(evidence.reads.at(-1).operation_key)
  await pane.getByRole('textbox',{name:'Purpose',exact:true}).fill('Keep my unsaved refreshed brief')
  await page.reload();await pane.waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Purpose"]')?.value==='Keep my unsaved refreshed brief')
  assert.equal(await pane.getByRole('textbox',{name:'Required text',exact:true}).inputValue(),'Launch date: 18 October');assert.equal(await pane.getByText('Exact brief v2 confirmed.',{exact:false}).count(),0)
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.data.videoBriefVersions.length),2);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.videoGenerationCalls),0)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({viewport:{width,height},theme,screenshot,currentDraftSurvivesRefresh:true,noNewVersionOnRefresh:true,allBriefFieldsExplicit:true,previewWrites:0,firstDoubleConfirmWrites:1,editInvalidatesConfirmation:true,twoIntentionalMockVersions:true,exactParentSourceRetained:true,lostResponseRecoveryReadOnly:true,generationCalls:0,pageErrors:errors,blockedRemoteRequests:blocked})
  await context.close();console.log('VERIFY video brief prototype',width,height,theme)
 }
 const file=path.join(output,'b3-content-writer-browser-evidence.json'),existing=JSON.parse(await fs.readFile(file,'utf8'));existing.videoBriefPrototype={...existing.videoBriefPrototype,scope:'Standalone real DesignVideoBriefEditor; saved canonical versions and recovery are fixture-only. No native database, installed contract, Generate integration or provider acceptance.',results};await fs.writeFile(file,JSON.stringify(existing,null,2))
}

async function designBridgeAssertions(browser) {
 const results=[]
 for (const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]) {
  const context=await browser.newContext({viewport:{width,height}}), page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?surface=design&state=empty&theme=${theme}`)
  const message=page.getByRole('textbox',{name:'Message',exact:true}), videoButton=page.getByRole('button',{name:'Video tools',exact:true})
  await message.waitFor();assert(await videoButton.isDisabled());assert.equal(await page.getByRole('region',{name:'Private Design video tools',exact:true}).count(),0)
  await message.fill('Private Design exploration')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.data.counters.run===1)
  await videoButton.click()
  const workbench=page.getByRole('region',{name:'Private video workbench',exact:true})
  await workbench.getByRole('heading',{name:'Video · Higgsfield Seedance 2.5',exact:true}).waitFor()
  await workbench.getByText('No video jobs recorded for this private conversation.',{exact:true}).waitFor()
  assert(await workbench.getByRole('button',{name:'Generate one video',exact:true}).isDisabled())
  assert(await workbench.getByRole('button',{name:'Back to chat',exact:true}).evaluate(node => node === document.activeElement))
  const openingBounds=await workbench.getByRole('button',{name:'Back to chat',exact:true}).boundingBox();assert(openingBounds && openingBounds.y>=100 && openingBounds.y<300,`Video return control not visible near opening: ${JSON.stringify(openingBounds)}`)
  const openScreenshot=`b3-design-private-video-open-${theme}-${width}x${height}.png`
  await page.screenshot({path:path.join(output,openScreenshot)})
  await workbench.getByRole('textbox',{name:'Script / storyboard',exact:true}).fill('Unsent private video brief')
  await workbench.getByRole('button',{name:'Check exact quote',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.videoQuotes.length===1)
  assert(await workbench.getByRole('button',{name:'Generate one video',exact:true}).isDisabled())
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.videoGenerationCalls),0)
  const screenshot=`b3-design-private-video-${theme}-${width}x${height}.png`
  await page.screenshot({path:path.join(output,screenshot)})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await workbench.getByRole('button',{name:'Back to chat',exact:true}).click()
  assert.equal(await workbench.isVisible(),false)
  assert(await videoButton.evaluate(node=>node===document.activeElement))
  await page.getByRole('combobox',{name:'Conversation context',exact:true}).selectOption('chat')
  await page.getByRole('button',{name:'Stay in current context',exact:true}).click()
  await videoButton.click()
  assert.equal(await workbench.getByRole('textbox',{name:'Script / storyboard',exact:true}).inputValue(),'Unsent private video brief')
  await workbench.getByRole('textbox',{name:'Script / storyboard',exact:true}).fill('')
  await workbench.getByRole('button',{name:'Back to chat',exact:true}).click()
  await message.fill('Text follow-up stays separate')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.data.counters.run===2)
  const evidence=await page.evaluate(()=>{const f=globalThis.__directChatPreview.fixture;return {counters:f.data.counters,conversationId:f.data.rows[0].id,videoReads:f.videoReads,videoQuotes:f.videoQuotes,generationCalls:f.videoGenerationCalls}})
  assert.equal(evidence.counters.created,1);assert.equal(evidence.counters.messages,2);assert.equal(evidence.generationCalls,0)
  assert.deepEqual([...new Set(evidence.videoReads)],[evidence.conversationId]);assert.equal(evidence.videoQuotes[0].private_conversation_id,evidence.conversationId)
  for(const key of ['project_id','engagement_id','messages','history','attachments'])assert(!(key in evidence.videoQuotes[0]))
  await videoButton.click()
  const brief=workbench.getByRole('region',{name:'Versioned video brief',exact:true}),business={'Purpose':'Explain the private launch','Audience':'Returning clients','Channel / placement':'Organic social','Source assets / reuse plan':'None — text-to-video only','Script / storyboard':'Product then three benefits','Brand constraints':'No unlicensed marks','Required text':'Launch date: 10 October'}
  for(const [name,value] of Object.entries(business))await brief.getByRole('textbox',{name,exact:true}).fill(value)
  await brief.getByRole('button',{name:'Preview complete video brief',exact:true}).click();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),0)
  await brief.getByRole('button',{name:'Confirm video brief version',exact:true}).click();await brief.getByText('Exact brief v1 confirmed.',{exact:false}).waitFor()
  const providerPrompt=workbench.getByRole('textbox',{name:'Video prompt',exact:true});assert.equal(await providerPrompt.getAttribute('readonly'),'');assert((await providerPrompt.inputValue()).includes('Required text:\nLaunch date: 10 October'))
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),1);assert(await workbench.getByRole('button',{name:'Generate one video',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.videoGenerationCalls),0)
  await providerPrompt.scrollIntoViewIfNeeded();const confirmedScreenshot=`b3-design-confirmed-brief-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,confirmedScreenshot)})
  await brief.getByRole('textbox',{name:'Required text',exact:true}).fill('Launch date: 18 October');assert.equal(await brief.getByText('Exact brief v1 confirmed.',{exact:false}).count(),0);assert.equal(await providerPrompt.inputValue(),'');assert(await workbench.getByRole('button',{name:'Generate one video',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.data.videoBriefVersions.length),1)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({viewport:{width,height},theme,screenshot,openScreenshot,confirmedScreenshot,actualCanonicalBriefEditorIntegrated:true,completePromptReadOnly:true,previewZeroWrites:true,oneImmutableMockConfirmation:true,editInvalidatesGenerate:true,noGenerationOnConfirmation:true,actualPrivateVideoUi:true,onePrivateChatTwoTextSends:true,explicitSeparateVideoTools:true,videoBriefPreservedOnCloseAndStay:true,exactPrivateAnchor:true,quoteOnlyGenerationDisabled:true,generationCalls:0,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked})
  await context.close();console.log('VERIFY Design private bridge',width,height,theme)
 }
 const file=path.join(output,'b3-content-writer-browser-evidence.json'),existing=JSON.parse(await fs.readFile(file,'utf8'))
 existing.designPrivateBridge={scope:'Actual Direct Chat, shared shell, PrivateDesignVideoTools and DesignVideoCapabilities against isolated localhost repositories. Quote makes no provider call; no verified Higgsfield connection and paid execution disabled. Actual generation, signed preview and project promotion are not accepted by this browser check.',results}
 await fs.writeFile(file,JSON.stringify(existing,null,2));console.log(JSON.stringify({designBridgeCasesPassed:results.length}))
}

async function widerDirectAssertions(browser){
 const results=[]
 for(const surface of ['organization','marketing']){
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?surface=${surface}&state=empty&theme=light`)
  const input=page.getByRole('textbox',{name:'Message',exact:true});await input.fill('Scoped '+surface+' first message')
  await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.data.counters.run===1&&document.querySelector('.direct-chat-composer textarea').value==='')
  await input.fill('Scoped '+surface+' follow-up');await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.data.counters.run===2)
  await page.reload();await input.waitFor();await page.getByRole('button',{name:new RegExp('Scoped '+surface+' first message')}).click();await page.waitForFunction(()=>document.querySelectorAll('.direct-chat-messages article').length>=2)
  const data=await page.evaluate(()=>globalThis.__directChatPreview.fixture.data)
  assert.equal(data.counters.created,1);assert.equal(data.counters.messages,2);assert.equal(data.counters.run,2)
  const row=data.rows.find(row=>row.context_kind===(surface==='organization'?'organization':'department_private'))
  assert.equal(row.project_id,null);assert.equal(row.department_id,surface==='organization'?null:'marketing')
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({surface,oneConversation:true,twoDistinctMessagesAndMockRuns:true,reloadDispatchesNothing:true,scope:row.context_kind,projectId:row.project_id,departmentId:row.department_id,providerCalls:0,productionWrites:0,pageErrors:errors,blockedRemoteRequests:blocked});await context.close()
 }
 const file=path.join(output,'b3-content-writer-browser-evidence.json'),evidence=JSON.parse(await fs.readFile(file,'utf8'));evidence.widerDirectChat={scope:'Actual shared DirectContextChat organization and Marketing-private paths with isolated backend; application bindings checked separately',results};await fs.writeFile(file,JSON.stringify(evidence,null,2));console.log(JSON.stringify({widerDirectCases:results}))
}

async function engagementFirstSendAssertions(browser) {
 const results=[]
 for (const [width,theme,uncertain] of [[1440,'light',false],[390,'dark',false],[1440,'dark',true]]) {
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage()
  page.setDefaultTimeout(15000);const errors=[],blocked=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?panel=writer&answer=fixture&surface=content&state=empty&theme=${theme}`)
  const composer=page.getByRole('textbox',{name:/^Message/}),form=page.locator('.department-chat-main')
  await page.getByRole('button',{name:'New chat',exact:true}).click()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementConversations.length),1)
  await composer.fill('Fresh local first direction')
  const metrics=await form.evaluate(node=>({form:node.getBoundingClientRect().toJSON(),footer:node.querySelector('.department-chat-footer').getBoundingClientRect().toJSON(),send:node.querySelector('.department-chat-submit').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth}))
  assert(!metrics.overflow);assert(metrics.footer.bottom<=metrics.form.bottom+1);assert(metrics.form.bottom<=900);assert(metrics.send.bottom<=metrics.form.bottom+1)
  await page.screenshot({path:path.join(output,`b3-engagement-new-${theme}-${width}x900.png`)})
  if(uncertain)await page.evaluate(()=>{const f=globalThis.__directChatPreview.fixture;f.engagementAnswerUncertain=true;f.engagementReadUnavailable=true})
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
  if(width===1440&&!uncertain)await page.evaluate(()=>{
   globalThis.__savedStorageSetItem=Storage.prototype.setItem
   Storage.prototype.setItem=function(key,value){if(key.startsWith('anka:engagement-first-send:'))throw new Error('Offline storage denied');return globalThis.__savedStorageSetItem.call(this,key,value)}
  })
  await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
  if(width===1440&&!uncertain){
   await page.getByText('First Send recovery storage is unavailable. No request was sent.',{exact:true}).waitFor()
   assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementTurns.length),0)
   await page.evaluate(()=>{Storage.prototype.setItem=globalThis.__savedStorageSetItem;globalThis.__directChatPreview.fixture.firstSendNoReservation=true})
   await form.evaluate(node=>node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
   await page.getByText('Offline reservation denied before saving',{exact:true}).waitFor()
   assert.equal(await composer.inputValue(),'Fresh local first direction')
   assert.equal(await page.getByRole('button',{name:'Recover first Send',exact:true}).count(),0)
   assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementConversations.length),1)
   await page.evaluate(()=>globalThis.__directChatPreview.fixture.firstSendNoReservation=false)
   await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
  }
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.engagementTurns.length===1)
  if(uncertain){
   await page.getByRole('button',{name:'Recover first Send',exact:true}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true)
   await page.reload()
   await page.getByRole('button',{name:'Recover first Send',exact:true}).click()
   await page.getByText('Recovered the saved first Send. No provider request was dispatched by recovery.',{exact:true}).waitFor()
  } else await page.waitForFunction(()=>document.querySelector('.department-chat-prompt textarea')?.value==='')
  const before=await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementTurns)
  assert.equal(before.length,1);assert.equal(before[0].start_new,true)
  assert.deepEqual(before[0].attachment_ids,[]);assert.deepEqual(before[0].selected_artifact_version_ids,[])
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementConversations.length),2)
  assert.equal(await page.getByRole('button',{name:'Recover first Send',exact:true}).count(),0)
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('anka:engagement-first-send:')).length),0)
  await composer.fill('Fresh local follow-up')
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
  if(uncertain)await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.engagementTurns.length===2&&document.querySelector('.department-chat-prompt textarea')?.value==='')
  const turns=await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementTurns)
  assert.equal(turns[1].start_new,undefined);assert.equal(turns[0].conversation_id,turns[1].conversation_id);assert.notEqual(turns[0].client_request_id,turns[1].client_request_id)
  assert.equal(await page.getByRole('dialog',{name:'Confirm AI data sharing',exact:true}).count(),0)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  assert.equal(await page.getByText('OFFLINE SAVED ANSWER · Fresh local follow-up',{exact:true}).count(),1)
  const transcript=await page.locator('.department-chat-messages').boundingBox()
  assert(transcript.height >= (width>900?180:140),'Transcript must have primary readable space: '+width+' '+transcript.height)
  const optionalSave=page.getByRole('button',{name:'Save draft to this conversation',exact:true})
  assert.equal(await optionalSave.isVisible(),false)
  await page.getByText('Conversation details and sharing',{exact:true}).click()
  assert.equal(await optionalSave.isVisible(),true)
  await page.getByText('Optional: save unsent text for later without asking AI. Send already saves each submitted message.',{exact:true}).waitFor()
  await page.getByText('Conversation details and sharing',{exact:true}).click()
  let historyDrawer=null
  if(width<901){
   const history=page.getByRole('button',{name:'History',exact:true})
   await history.click();historyDrawer=await drawerAssertions(page,'Workshop history',history)
  }else{
   assert.equal(await page.locator('.workshop-conversation-rail').isVisible(),true)
   const search=page.getByRole('textbox',{name:'Search engagement conversations',exact:true})
   await search.fill('Fresh local first')
   await page.waitForFunction(()=>![...document.querySelectorAll('.workshop-conversation-rail button')].some(node=>node.textContent.includes('Page brief · separate project history')))
   await search.fill('')
   await page.getByRole('button',{name:/Page brief · separate project history/}).waitFor()
  }

  const savedMetrics=await form.evaluate(node=>({form:node.getBoundingClientRect().toJSON(),send:node.querySelector('.department-chat-submit').getBoundingClientRect().toJSON()}))
  assert(savedMetrics.send.bottom<=savedMetrics.form.bottom+1);assert(savedMetrics.send.height>25)
  await page.screenshot({path:path.join(output,`b3-engagement-saved-${theme}-${width}x900.png`)})
  results.push({viewport:{width,height:900},theme,lostResponseAndReloadRecovery:uncertain,storageDeniedSendsNothingAndConfirmedRollbackAllowsCorrection:width===1440&&!uncertain,newDraftCreatesZeroRecords:true,oneFirstSendAndOneFollowup:true,firstSendUsesNoInheritedFilesOrSources:true,sameConversationDistinctRequests:true,transcriptHeight:transcript.height,secondarySaveHiddenByDefault:true,desktopGroupedHistory:width>900,mobileHistoryDrawer:historyDrawer,providerCalls:0,productionWrites:0,pageErrors:errors,blockedRemoteRequests:blocked})
  await context.close()
 }
 const file=path.join(output,'b3-content-writer-browser-evidence.json'), evidence=JSON.parse(await fs.readFile(file,'utf8'))
 evidence.engagementFirstSend={scope:'Actual workbench with isolated mock backend; native SQL and Edge security checked separately; no live provider acceptance',results}
 await fs.writeFile(file,JSON.stringify(evidence,null,2));console.log(JSON.stringify({engagementFirstSendCases:results.length,results}))
}

;async function pipelineGroupAssertions(browser,declared=false) {
 const results=[]
 for (const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]) {
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1' && url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?panel=pipelines&theme=${theme}${declared ? '&stage-contracts=1' : ''}`)
  const panel=page.getByRole('region',{name:'Project pipeline configuration',exact:true}),choice=page.getByRole('combobox',{name:'Pipeline selection',exact:true})
  await choice.waitFor();await page.waitForFunction(()=>!document.body.textContent.includes('Loading project configurations'))
  const identities=await page.evaluate(()=>({website:globalThis.__directChatPreview.pipeline.website,marketing:globalThis.__directChatPreview.pipeline.marketing}))
  await choice.selectOption(identities.website);assert.match(await panel.textContent(),/Active revision 2 · page_brief/);assert.doesNotMatch(await panel.textContent(),/Revision 3 · activated/)
  await choice.selectOption(identities.marketing);assert.match(await panel.textContent(),/Active revision 3 · campaign_plan/);assert.doesNotMatch(await panel.textContent(),/Revision 2 · activated/)
  await choice.selectOption('');assert.match(await panel.textContent(),/Active revision 9 · original_brief/)
  await panel.getByText('Create an independent pipeline',{exact:true}).click()
  await page.getByRole('textbox',{name:'Pipeline name',exact:true}).fill('Second website')
  await page.getByRole('combobox',{name:'Independent pipeline preset',exact:true}).selectOption({label:'Website delivery · execution v1'})
  await page.getByRole('button',{name:'Review pipeline creation',exact:true}).click()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.calls.length),0)
  await page.getByRole('button',{name:'Confirm independent pipeline',exact:true}).scrollIntoViewIfNeeded()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const reviewScreenshot=`b2-pipeline-review-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,reviewScreenshot)})
  await page.getByRole('button',{name:'Confirm independent pipeline',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Choose steps and review activation separately'))
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.calls.length),1)
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.runCalls.length),0)
  await panel.getByRole('combobox',{name:'Published execution definition',exact:true}).selectOption({label:'Website delivery · v1'})
  if(declared){
   await panel.getByRole('combobox',{name:'Page brief decision',exact:true}).selectOption('reuse');await panel.getByRole('combobox',{name:'Page copy decision',exact:true}).selectOption('run');await panel.getByRole('spinbutton',{name:'Page copy quantity',exact:true}).fill('3')
   await panel.getByRole('combobox',{name:'Additional proof decision',exact:true}).selectOption('omit');await panel.getByRole('textbox',{name:'Additional proof omission reason',exact:true}).fill('Existing approved article supplies the evidence')
   await panel.getByRole('button',{name:'Preview stages before creation',exact:true}).click();assert.equal(await panel.getByRole('button',{name:'Confirm draft revision',exact:true}).isEnabled(),false);assert.match(await panel.textContent(),/Missing or incompatible input/);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.configCalls.length),0)
   await panel.getByRole('button',{name:'Find approved versions',exact:true}).click();const exactVersion=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.artifact.artifact_version_id)
   await panel.getByRole('combobox',{name:'Page brief approved version',exact:true}).selectOption(exactVersion);await panel.getByRole('combobox',{name:'Page copy input Approved source article',exact:true}).selectOption(exactVersion)
  }else {await panel.getByRole('spinbutton',{name:'Page brief quantity',exact:true}).fill('1');await panel.getByRole('spinbutton',{name:'Page copy quantity',exact:true}).fill('3')}

  await panel.getByRole('button',{name:'Preview stages before creation',exact:true}).click()
  const stageReview=panel.getByRole('region',{name:'Review pipeline stages',exact:true});await stageReview.waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.configCalls.length),0)
  assert.match(await stageReview.textContent(),/Dependencies: page_brief/);if(declared){assert.match(await stageReview.textContent(),/Approved launch source · exact v2/);assert.match(await stageReview.textContent(),/Reason: Existing approved article supplies the evidence/);assert.match(await stageReview.textContent(),/Output: Page copy/)}else {assert.match(await stageReview.textContent(),/Output: not specified/);assert.match(await stageReview.textContent(),/Required inputs: not specified/)}
  const stageScreenshot=`b2-pipeline-${declared ? 'stage-fulfilment' : 'stages'}-${theme}-${width}x${height}.png`;await stageReview.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,stageScreenshot)})
  await panel.getByRole('button',{name:'Confirm draft revision',exact:true}).click();await page.waitForFunction(()=>globalThis.__directChatPreview.pipeline.configCalls.length===1)
  const exactConfiguration=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.configCalls[0]);assert.deepEqual(exactConfiguration.selectedSteps,[{key:'page_brief',quantity:1},{key:'page_copy',quantity:3}]);assert.equal(exactConfiguration.maxAiCostMicrousd,0);assert.notEqual(exactConfiguration.pipelineGroupId,identities.website)
  if(declared){const version=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.artifact.artifact_version_id);assert.deepEqual(exactConfiguration.stageDecisions,[{key:'page_brief',action:'reuse',artifact_version_id:version},{key:'page_copy',action:'run',quantity:3,inputs:[{key:'article',artifact_version_id:version}]},{key:'extra_proof',action:'omit',reason:'Existing approved article supplies the evidence'}]);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.artifact.version_number),2)}
  const runChoice=page.getByRole('combobox',{name:'Run pipeline',exact:true});await runChoice.selectOption(identities.marketing)
  const run=page.getByRole('button',{name:'Request manual run review',exact:true});await run.scrollIntoViewIfNeeded();assert.equal(await run.isEnabled(),true)
  const runScreenshot=`b2-pipeline-run-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,runScreenshot)})
  await run.click();await page.waitForFunction(()=>globalThis.__directChatPreview.pipeline.runCalls.length===1)
  await page.getByText('Pipeline: Launch campaign',{exact:true}).waitFor()
  const call=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.runCalls[0]);assert.equal(call.pipelineGroupId,identities.marketing)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({viewport:{width,height},theme,independentWebsiteMarketingLegacy:true,reviewZeroWrites:true,creationOneCommandNoRun:true,stageReviewZeroWrites:true,stageConfirmationOneExactDraft:true,publishedMetadataGapsExplicit:!declared,declaredOutputsAndMissingInputs:declared,exactApprovedVersionReuse:declared,optionalOmissionReason:declared,noNewSourceVersion:declared,runOneExactGroupReviewRequest:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshots:[reviewScreenshot,stageScreenshot,runScreenshot]})
  await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json');const evidence=JSON.parse(await fs.readFile(packet,'utf8'));const target=declared ? (evidence.stageFulfilment ||= {}) : evidence.independentPipelineGroups;target.browser={source:'tools/check-direct-chat-browser.cjs '+(declared ? '--stage-fulfilment' : '--pipeline-groups'),scope:'Actual configuration/run panels in existing Layout; provider-free synthetic published sources; no publisher journey or production writes',results};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({pipelineGroupsPassed:results.length,evidence:packet}))
}

async function pipelineDefinitionAssertions(browser){
 const results=[]
 for(const [width,theme] of [[1440,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),page=await context.newPage(),errors=[],blocked=[]
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1' && u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=definitions&theme=${theme}`)
  const pipeline=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.definitionCatalog.publications[0].id)
  await page.getByLabel('Definition published preset',{exact:true}).selectOption(pipeline);await page.getByLabel('Execution version name',{exact:true}).fill('Website stages')
  await page.getByLabel('Step 1 key',{exact:true}).fill('article');await page.getByLabel('Step 1 label',{exact:true}).fill('Launch article');await page.getByLabel('Step 1 service',{exact:true}).selectOption(pipeline)
  await page.getByLabel('Step 1 declare output and inputs',{exact:true}).check();await page.getByLabel('Step 1 expected output',{exact:true}).fill('Approved launch article');await page.getByLabel('Step 1 allow approved source',{exact:true}).check();await page.getByLabel('Step 1 exact output type',{exact:true}).fill('blog_article');await page.getByLabel('Step 1 optional stage',{exact:true}).check()
  await page.getByRole('button',{name:'Add required input',exact:true}).click();await page.getByLabel('Input key',{exact:true}).fill('audience');await page.getByLabel('Input label',{exact:true}).fill('Target audience')
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.definitionCalls.length),0)
  await page.getByLabel('Step 1 expected output',{exact:true}).scrollIntoViewIfNeeded()
  const screenshot=`b2-pipeline-definition-${theme}-${width}x900.png`;await page.screenshot({path:path.join(output,screenshot)})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.getByRole('button',{name:'Save draft version',exact:true}).click();await page.getByRole('status').filter({hasText:/Execution definition v1 saved/}).waitFor()
  const calls=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.definitionCalls)
  assert.equal(calls.length,1);assert.deepEqual(calls[0].steps[0].stage_contract,{optional:true,output_label:'Approved launch article',reuse_allowed:true,artifact_type:'content',output_type:'blog_article',required_inputs:[{key:'audience',label:'Target audience',kind:'manual'}]})
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.definitionRecords.approvals.length+globalThis.__directChatPreview.pipeline.definitionRecords.publications.length),0);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({theme,viewport:{width,height:900},explicitTypedMetadata:true,unsavedZeroWrites:true,oneExactImmutableDraft:true,noImplicitApprovalOrPublication:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshot});await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json'),evidence=JSON.parse(await fs.readFile(packet,'utf8'));evidence.publishedStageContracts.browser={source:'tools/check-direct-chat-browser.cjs --stage-definitions',scope:'Actual definition author in existing Layout; synthetic local fixture; no distinct-human publication acceptance',results};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({stageDefinitionsPassed:results.length,evidence:packet}))
}


async function pipelineInputAssertions(browser){
 const results=[]
 for(const [width,theme] of [[1440,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],blocked=[]
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1' && u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=stage-inputs&theme=${theme}`);await page.getByText('Exact reviewed stage inputs',{exact:true}).click()
  const inputs=page.getByLabel('Exact reviewed stage inputs',{exact:true});await inputs.getByText(/Startup owners/).waitFor();assert.match(await inputs.textContent(),/AI use permitted/);assert.match(await inputs.textContent(),/existing approval; no regeneration/);assert.match(await inputs.textContent(),/Existing approved source supplies evidence/)
  await page.getByText(/^Run card ·/).click();assert.match(await page.locator('body').textContent(),/No regeneration or provider reservation/);assert.match(await page.locator('body').textContent(),/reviewed stage inputs shown above/)
  assert.equal(await page.getByRole('button',{name:'Acknowledge exact inputs',exact:true}).isDisabled(),true)
  await inputs.scrollIntoViewIfNeeded();const screenshot=`b2-pipeline-inputs-${theme}-${width}x900.png`;await page.screenshot({path:path.join(output,screenshot)})
  const stats=await page.evaluate(()=>({calls:globalThis.__directChatPreview.pipeline.runCalls.length+globalThis.__directChatPreview.pipeline.configCalls.length+globalThis.__directChatPreview.pipeline.calls.length,overflow:document.documentElement.scrollWidth>innerWidth}));assert.equal(stats.calls,0);assert.equal(stats.overflow,false);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({theme,viewport:{width,height:900},exactManualAndCanonicalVersionScopeBeforeConsent:true,reuseExcludedFromRegeneration:true,omissionReasonPreserved:true,reviewZeroWrites:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshot});await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json'),evidence=JSON.parse(await fs.readFile(packet,'utf8'));evidence.stageFulfilment.aiInputs.browser={source:'tools/check-direct-chat-browser.cjs --stage-inputs',scope:'Actual run/consent display in shared Layout; synthetic source fixture; no human consent or providers',results};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({stageInputsPassed:results.length,evidence:packet}))
}

(async () => {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = []
  const cases = [
    ['project', 'empty', 'light', 1440, 900],
    ['project', 'output-open', 'light', 1440, 900],
    ['content', 'populated', 'dark', 1280, 720],
    ['content', 'empty', 'system', 390, 900],
    ['content', 'output-open', 'dark', 390, 900],
    ['project', 'uncertain', 'system', 390, 900],
    ['content', 'empty', 'system', 320, 900],
  ]
  try {
    if(process.argv.includes('--stage-inputs')){await pipelineInputAssertions(browser);return}
    if(process.argv.includes('--stage-definitions')){await pipelineDefinitionAssertions(browser);return}
    if(process.argv.includes('--stage-fulfilment')){await pipelineGroupAssertions(browser,true);return}
    if (process.argv.includes('--pipeline-groups')) {await pipelineGroupAssertions(browser);return}
    if (process.argv.includes('--video-brief')) {await videoBriefPrototypeAssertions(browser);return}
    if (process.argv.includes('--design-bridge')) {await designBridgeAssertions(browser);return}
    if (process.argv.includes('--wider-direct')) {await widerDirectAssertions(browser);return}
    if (process.argv.includes('--engagement-first-send')) { await engagementFirstSendAssertions(browser); return }
    if (process.argv.includes('--shared-chat')) { await sharedChatAssertions(browser); return }
    if (process.argv.includes('--writer') || process.argv.includes('--writer-recovery')) { await writerAssertions(browser); return }
    for (const [surface, state, theme, width, height] of cases) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light' })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      page.setDefaultNavigationTimeout(15000)
      console.log('VERIFY', surface, state, theme, width, height)
      const errors = [], blocked = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1' && url.port === '5188') return route.continue()
        blocked.push(url.origin); return route.abort()
      })
      await page.goto(`${base}?surface=${surface}&state=${state}&theme=${theme}`)
      await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ state: 'attached' })
      if (state === 'output-open' && width < 901) await page.getByRole('dialog', { name: 'Saved reply output' }).waitFor()
      await page.waitForFunction(() => globalThis.__directChatPreview && document.querySelector('.direct-chat').style.getPropertyValue('--direct-chat-height'))
      const metrics = await page.evaluate(() => ({
        header: document.querySelector('.shell-header').getBoundingClientRect().toJSON(),
        messages: document.querySelector('.direct-chat-messages').getBoundingClientRect().toJSON(),
        composer: document.querySelector('.direct-chat-composer').getBoundingClientRect().toJSON(),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      }))
      assert(!metrics.horizontalOverflow)
      assert(metrics.composer.bottom <= height && metrics.composer.x >= 0 && metrics.composer.right <= width)
      assert(metrics.messages.height >= 150, 'Too little readable message space')
      if (width < 768) assert(metrics.header.height <= 110, 'Mobile shell header is too tall')
      assert.equal(await page.locator('.direct-chat button').filter({ hasText: /^New chat$/ }).count(), 1)
      const screenshot = `b3-refinement-${surface}-${state}-${theme}-${width}x${height}.png`
      await page.screenshot({ path: path.join(output, screenshot) })
      const result = { surface, state, theme, viewport: { width, height }, ...metrics, screenshot, singleCreationControl: true }
      if (width < 901 && state === 'output-open') {
        result.outputDrawer = await drawerAssertions(page, 'Saved reply output', page.getByRole('button', { name: 'Open reply', exact: true }))
      }
      if (width < 901 && state !== 'uncertain') {
        const history = page.getByRole('button', { name: 'History', exact: true })
        await history.click()
        result.historyDrawer = await drawerAssertions(page, 'Chat history', history)
      }
      if (width > 900 && surface === 'content') {
        await page.getByRole('button', { name: 'Website Content', exact: true }).click()
        await page.getByRole('button', { name: /Page brief · separate project history/ }).waitFor()
        const search = page.getByRole('textbox', { name: 'Search engagement conversations', exact: true })
        await search.fill('no matching title')
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(node => node.textContent.includes('Page brief · separate project history')))
        await search.fill('Page brief')
        await page.getByRole('button', { name: /Page brief · separate project history/ }).waitFor()
        assert.equal(await page.getByRole('region', { name: 'Private history', exact: true }).count(), 1)
        result.groupedHistory = { privateSectionPreserved: true, projectGroupPreserved: true, engagementExpansion: true, scopedSearchExcludesThenRestores: true }
      }
      if (theme === 'system' && state === 'empty') {
        const background = () => page.locator('.anka-shell').evaluate(node => getComputedStyle(node).backgroundColor)
        const light = await background()
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.waitForFunction(previous => getComputedStyle(document.querySelector('.anka-shell')).backgroundColor !== previous, light)
        const dark = await background()
        await page.emulateMedia({ colorScheme: 'light' })
        await page.waitForFunction(previous => getComputedStyle(document.querySelector('.anka-shell')).backgroundColor === previous, light)
        result.systemAppearance = { light, dark, followsPreferenceChanges: true, restoredLight: true }
      }
      assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
      result.pageErrors = errors; result.blockedRemoteRequests = blocked
      results.push(result)
      await context.close()
    }
    await fs.writeFile(path.join(output, 'b3-refinement-browser-evidence.json'), JSON.stringify({ source: 'tools/check-direct-chat-browser.cjs', scope: 'provider-free localhost fixture; no installed-schema or provider acceptance', results }, null, 2))
    console.log(JSON.stringify({ passed: results.length, assertions: ['bounds', 'message space', 'single creation', 'grouped search', 'System media changes', 'drawer Tab/ShiftTab/Escape/focus'], evidence: path.join(output, 'b3-refinement-browser-evidence.json') }))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
