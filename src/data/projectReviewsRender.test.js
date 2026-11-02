import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

test('project Reviews tab renders the actual mount with empty and populated deliverables', () => {
  const panelSource = readFileSync(new URL('../apps/ProjectReviewEvidencePanel.jsx', import.meta.url), 'utf8')
  const panelCode = transformSync(panelSource, { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const panelModule = { exports: {} }
  new Function('require', 'module', 'exports', 'React', panelCode)(name=>name.endsWith('.css')?{}:createRequire(import.meta.url)(name), panelModule, panelModule.exports, React)
  const Panel = panelModule.exports.default
  const source = readFileSync(new URL('../apps/ProjectEngagementWorkspace.jsx', import.meta.url), 'utf8')
  const route = source.split('\n').find(line => line.includes("{tab === 'reviews' &&"))
  const mount = route?.match(/<_ProjectReviewEvidencePanel[^>]+\/>/)?.[0]
  assert.ok(mount, 'Reviews route has a renderable panel mount')
  const code = transformSync(`return (${mount})`, { loader: 'jsx', jsxFactory: 'React.createElement' }).code
  const renderMount = new Function('React', '_ProjectReviewEvidencePanel', 'workspace', 'isNavigationBusy', 'error', code)
  const render = (deliverables,busy=false,error=null) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
    renderMount(React, Panel, { deliverables }, busy, error)))
  assert.match(render([]), /No deliverable versions recorded/)
  for(const [busy,error] of [[true,null],[false,new Error('stale')]]){const blocked=render([],busy,error);assert.doesNotMatch(blocked,/href=/);assert.match(blocked,/<button[^>]*disabled/)}
  const html = render([{ title: 'Approved artwork', versions: [{ id: 'exact-v1', version_number: 1,
    review_status: 'approved', approvals: [{ approval_type: 'internal_quality', decision: 'approved' }],
    pmConfirmations: [], lifecycleEvents: [] }] }])
  const ordered=render([{title:'Exact history',versions:[{id:'one',version_number:1,approvals:[{id:'early',approval_type:'internal_quality',decision:'approved',decided_at:'2026-01-01T00:00:00Z'},{id:'late',approval_type:'internal_quality',decision:'revision_requested',decided_at:'2026-02-01T00:00:00Z'}],pmConfirmations:[{confirmed_at:'2026-01-01T00:00:00Z'},{confirmed_at:'2026-02-01T00:00:00Z'}],lifecycleEvents:[{id:'release-early',event_type:'released',occurred_at:'2026-01-01T00:00:00Z'},{id:'release-late',event_type:'released',occurred_at:'2026-02-01T00:00:00Z'}]}]}])
  assert.match(ordered,/<dt>Specialist review \(latest recorded\)<\/dt><dd>revision requested/);assert.match(ordered,/internal quality · approved/);assert.match(ordered,/internal quality · revision requested/)
  const latestTime=new Date('2026-02-01T00:00:00Z').toLocaleString();assert.ok(ordered.includes('<dt>Project-manager confirmation (latest recorded)</dt><dd>Recorded · '+latestTime));assert.ok(ordered.includes('<dt>Client release (latest recorded event)</dt><dd>Released · '+latestTime))
  assert.match(html, /Approved artwork/)
  assert.match(html, /Exact version: exact-v1/)
  assert.match(html, /Specialist review/)
  assert.match(html, /href="\/sphere\/my-work\?tab=review"/)
})
