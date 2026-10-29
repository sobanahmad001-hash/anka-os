import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {startStagingPreview} from './website-staging-preview.mjs'

const {chromium} = createRequire(import.meta.url)('C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const out = new URL('../outputs/website-qa-acceptance/', import.meta.url)
await mkdir(out, {recursive: true})
const server = await startStagingPreview({port: 5228, cacheDir: fileURLToPath(new URL('vite-cache/', out))})
let browser
const cases = []
try {
  browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'})
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({viewport: {width, height: 1000}}), errors = [], external = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue()
      external.push(route.request().url()); return route.abort()
    })
    await page.goto('http://127.0.0.1:5228/tools/website-staging-preview.html?theme=' + theme)
    await page.getByLabel('Page preview for QA', {exact: true}).waitFor()
    const canonical = await page.evaluate(() => JSON.stringify(globalThis.__blockPreview.fixture.canonical))
    // Seed only the in-memory synthetic repository. No auth or external transport.
    await page.evaluate(async () => {
      const f = globalThis.__blockPreview.fixture.staging
      const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0')
      f.jobs[0].artifact_sha256 = 'c'.repeat(64)
      const snapshot = await f.repository.workspace()
      const target = {organization_id: snapshot.organization_id, project_id: snapshot.project_id, engagement_id: snapshot.engagement_id, id: id(91), site_id: id(94), base_url: 'https://staging.example.test', current: true, version_number: 1, display_name: 'Synthetic staging'}
      f.targets.push(target)
      const job = f.jobs[0]
      const run = {organization_id: target.organization_id, project_id: target.project_id, engagement_id: target.engagement_id, id: id(92), request_id: id(93), target_id: target.id, job_id: job.id, page_id: job.page_id, page_key: job.page_key, created_at: '2026-10-29T08:00:00Z', status: 'staged', stale_sources: [], evidence: {environment: 'staging', published: false, preview_verified: true, package_sha256: job.artifact_sha256, base_url: target.base_url, preview_url: target.base_url + '/?anka_staging_preview=' + id(93), unresolved_paths: []}}
      f.runs.push(run)
      const qaState = {saves: 0, recovers: 0, record: null}
      globalThis.__qaAcceptance = qaState
      f.repository.qaReview = async (_scope, selectedRun, artifactId) => ({snapshot: {organization_id: target.organization_id, project_id: target.project_id, engagement_id: target.engagement_id, run_id: selectedRun, artifact_id: artifactId, artifact_version_id: null, page_id: job.page_id, package_sha256: job.artifact_sha256, publication_authorized: false},review_sha256: 'a'.repeat(64),artifacts: [],records: []})
      f.repository.qaSave = async (scope, input) => {qaState.saves++;qaState.record = {organization_id: scope.organizationId,project_id: scope.projectId,engagement_id: scope.engagementId,created_by: scope.actorId,id:id(96),run_id:input.runId,request_id:input.requestId,artifact_version_id:id(97)};throw Error('Synthetic QA response lost')}
      f.repository.qaRecover = async () => {qaState.recovers++;return qaState.record}

      const workspace = f.repository.workspace
      f.repository.workspace = async (...args) => ({...await workspace(...args), offset: 0})
    })
    await page.getByRole('button', {name: 'Refresh staging history', exact: true}).click()
    const qa = page.getByRole('region', {name: 'Website page QA review', exact: true})
    assert.equal(await qa.getByRole('link').count(), 0)
    await qa.getByLabel('Page preview for QA', {exact: true}).selectOption({index: 1})
    await qa.getByText('Receipt checked: Exact saved package', {exact: true}).waitFor()
    assert.equal(await qa.getByRole('link', {name: 'Open this authenticated QA preview', exact: true}).count(), 1)
    const form = qa.getByRole('region', {name: 'Save page QA acceptance', exact: true})
    await form.getByRole('button', {name: 'Review exact QA acceptance inputs', exact: true}).click()
    assert.equal(await form.getByRole('checkbox').isChecked(), false)
    for (const label of ['Desktop and mobile layout','Keyboard navigation and focus','Headings and image descriptions','Reduced-motion behavior','Links and page metadata','Assets and security checks','Performance measurements and budget']) await form.getByLabel(label, {exact: true}).fill('Manual QA evidence on this exact preview; synthetic fixture only.')
    assert.equal(await form.getByRole('button', {name:'Record reviewed QA acceptance',exact:true}).isDisabled(),true)
    assert.equal(await page.getByRole('button', {name:'Switch preview context',exact:true}).isDisabled(),true)
    await form.getByRole('checkbox').check()
    await form.getByRole('button', {name:'Record reviewed QA acceptance',exact:true}).click()
    await form.getByRole('button', {name:'Recover original QA save',exact:true}).waitFor()
    assert.equal(await page.getByRole('button', {name:'Dry run staging',exact:true}).isDisabled(),true)
    await form.scrollIntoViewIfNeeded()
    await page.screenshot({path:fileURLToPath(new URL(`${width}-${theme}-pending.png`,out))})
    await form.getByRole('button', {name:'Recover original QA save',exact:true}).click()
    await form.getByText(/QA acceptance recorded in an immutable/).waitFor()
    assert.deepEqual(await page.evaluate(() => ({saves:globalThis.__qaAcceptance.saves,recovers:globalThis.__qaAcceptance.recovers})),{saves:1,recovers:1})
    assert.equal(await page.getByRole('button', {name:'Switch preview context',exact:true}).isDisabled(),false)
    await form.scrollIntoViewIfNeeded()
    await page.screenshot({path:fileURLToPath(new URL(`${width}-${theme}-saved.png`,out))})
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    assert.deepEqual(await page.evaluate(() => globalThis.__blockPreview.fixture.staging.counts), {inspect: 0, bind: 0, dryRun: 0, deploy: 0, recover: 0, issue: 0})
    assert.equal(await page.evaluate(() => JSON.stringify(globalThis.__blockPreview.fixture.canonical)), canonical)
    assert.deepEqual(errors, []); assert.deepEqual(external, [])
    cases.push({width, theme, manualSelection: true, explicitConfirmation: true, lostResponseRecovery: true, saves: 1, recoveryReads: 1, overflow: false, providerCalls: 0, productionWrites: 0})
    await page.close()
  }
} finally {await browser?.close(); await server.close()}
await writeFile(new URL('verification.json', out), JSON.stringify({synthetic: true, cases}, null, 2))
console.log(JSON.stringify(cases))
