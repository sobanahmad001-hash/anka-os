import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment, elements} from './testSupport/designVideoDom.js'
import {websiteQaReview} from './websiteQaReview.js'

const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0')
const scope = {organizationId: id(1), projectId: id(2), engagementId: id(3)}
const identity = {organization_id: id(1), project_id: id(2), engagement_id: id(3)}
function fixture() {
  const target = {...identity, id: id(4), current: true, site_id: id(9), base_url: 'https://stage.example.test'}
  const job = {id: id(5), page_id: id(6), artifact_sha256: 'b'.repeat(64), stale_sources: []}
  const run = {...identity, id: id(10), request_id: id(11), target_id: target.id, job_id: job.id, page_id: job.page_id, page_key: 'home', status: 'staged', created_at: '2026-10-29T08:00:00Z', stale_sources: [], evidence: {environment: 'staging', published: false, preview_verified: true, package_sha256: job.artifact_sha256, base_url: target.base_url, preview_url: target.base_url + '/?anka_staging_preview=' + id(11), unresolved_paths: []}}
  return {...identity, targets: [target], jobs: [job], runs: [run], issues: [], offset: 0, has_more: false}
}
const check = (data, name) => websiteQaReview(data, scope, id(10)).checks.find(row => row.id === name).status

test('receipt review retains exact identity and never authorizes publication or invents a rollback', () => {
  const d = fixture(), review = websiteQaReview(d, scope, id(10))
  assert.equal(review.valid, true)
  assert.equal(review.publicationAuthorized, false)
  assert.equal(review.previewUrl, d.runs[0].evidence.preview_url)
  assert.equal(check(d, 'package'), 'verified')
  assert.equal(check(d, 'predecessor'), 'needs_review')
})
test('foreign scope, foreign run, unknown and duplicate selections fail closed', () => {
  for (const mutate of [d => d.project_id = id(90), d => d.runs[0].organization_id = id(90), d => d.runs.push({...d.runs[0]}), d => d.runs[0].page_id = null, d => d.issues.push(null)]) {
    const d = fixture(); mutate(d)
    assert.equal(websiteQaReview(d, scope, id(10)).valid, false)
  }
  assert.equal(websiteQaReview(fixture(), scope, id(99)).valid, false)
})
test('checksum, page and changed source mismatches remain review blockers', () => {
  const d = fixture(); d.jobs[0].artifact_sha256 = 'c'.repeat(64)
  assert.equal(check(d, 'package'), 'needs_review')
  d.jobs[0].page_id = id(90)
  assert.equal(check(d, 'sources'), 'needs_review')
  const changed = fixture(); changed.runs[0].stale_sources = ['content_version']
  assert.equal(check(changed, 'sources'), 'needs_review')
  delete changed.runs[0].stale_sources
  assert.equal(check(changed, 'sources'), 'needs_review')
})
test('malformed, redirected, published and unverified preview evidence is never linked', () => {
  for (const patch of [{preview_url: 'https://evil.example.test'}, {published: true}, {environment: 'production'}, {preview_verified: false}, {base_url: 'https://other.example.test'}]) {
    const d = fixture(); Object.assign(d.runs[0].evidence, patch)
    assert.equal(websiteQaReview(d, scope, id(10)).previewUrl, null)
  }
  const d = fixture(); d.runs[0].status = 'processing'
  assert.equal(websiteQaReview(d, scope, id(10)).previewUrl, null)
})
test('partial history and newer or tied retained versions cannot establish current revision', () => {
  for (const patch of [{has_more: true}, {offset: 20}, {has_more: undefined}]) {
    const d = Object.assign(fixture(), patch)
    assert.equal(check(d, 'revision'), 'needs_review')
    assert.equal(check(d, 'issues'), 'needs_review')
  }
  const d = fixture(); d.runs.push({...d.runs[0], id: id(12), created_at: '2026-10-29T08:01:00Z'})
  assert.equal(check(d, 'revision'), 'needs_review')
  d.runs[1].created_at = d.runs[0].created_at
  assert.equal(check(d, 'revision'), 'needs_review')
})
test('issue resolution must reference the exact opening event on the selected run and page', () => {
  const d = fixture(), opened = {id: id(20), issue_id: id(21), run_id: id(10), page_id: id(6), kind: 'opened'}
  d.issues = [opened]
  assert.equal(check(d, 'issues'), 'needs_review')
  d.issues.push({id: id(22), issue_id: id(21), run_id: id(10), page_id: id(6), kind: 'resolved', previous_event_id: id(20)})
  assert.equal(check(d, 'issues'), 'verified')
  d.issues[1].run_id = id(99)
  assert.equal(check(d, 'issues'), 'needs_review')
  d.issues[1].run_id = id(10); d.issues[1].previous_event_id = id(99)
  assert.equal(check(d, 'issues'), 'needs_review')
})
test('a predecessor from another target or page cannot become a rollback reference', () => {
  const d = fixture(); d.runs[0].previous_run_id = id(12)
  d.runs.push({...d.runs[0], id: id(12), created_at: '2026-10-28T08:00:00Z', previous_run_id: null})
  assert.equal(check(d, 'predecessor'), 'verified')
  d.runs[1].target_id = id(90)
  assert.equal(check(d, 'predecessor'), 'needs_review')
})

test('mounted QA requires manual selection, recomputes changed receipts and removes inaccessible preview links', async t => {
  const env = mountedEnvironment(), names = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'], old = Object.fromEntries(names.map(name => [name, globalThis[name]]))
  Object.assign(globalThis, {window: env.window, document: env.document, IS_REACT_ACT_ENVIRONMENT: true})
  const native = createRequire(import.meta.url), module = {exports: {}}, code = transformSync(readFileSync(new URL('../components/WebsiteQaReviewPanel.jsx', import.meta.url), 'utf8'), {loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement'}).code
  new Function('require', 'module', 'exports', 'React', code)(name => name.includes('websiteQaReview') ? {websiteQaReview} : native(name), module, module.exports, React)
  const root = createRoot(env.container), Component = module.exports.default, d = fixture()
  t.after(async () => {await act(async () => root.unmount()); Object.assign(globalThis, old)})
  const render = async data => act(async () => root.render(React.createElement(Component, {data, scope})))
  await render(d)
  assert.equal(elements(env.container, 'a').length, 0)
  const select = elements(env.container, 'select')[0], props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
  await act(async () => props(select).onChange({target: {value: id(10)}}))
  assert.equal(elements(env.container, 'a').length, 1)
  assert.match(env.container.textContent, /Manual QA evidence still required/)
  assert.equal(elements(env.container, 'button').length, 0)
  await render({...d, runs: []})
  assert.equal(elements(env.container, 'a').length, 0)
  assert.match(env.container.textContent, /unavailable in the current project/)
})
