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
