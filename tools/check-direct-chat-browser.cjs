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

;(async () => {
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
