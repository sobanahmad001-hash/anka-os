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
  new Function('require', 'module', 'exports', 'React', panelCode)(createRequire(import.meta.url), panelModule, panelModule.exports, React)
  const Panel = panelModule.exports.default
  const source = readFileSync(new URL('../apps/ProjectEngagementWorkspace.jsx', import.meta.url), 'utf8')
  const mount = source.match(/\{tab === 'reviews' && (<_ProjectReviewEvidencePanel[^\n]+?\/>)} /)?.[1]
    || source.match(/\{tab === 'reviews' && (<_ProjectReviewEvidencePanel[^\n]+?\/>)}\s/)?.[1]
  assert.ok(mount, 'Reviews route has a renderable panel mount')
  const code = transformSync(`return (${mount})`, { loader: 'jsx', jsxFactory: 'React.createElement' }).code
  const renderMount = new Function('React', '_ProjectReviewEvidencePanel', 'workspace', code)
  const render = deliverables => renderToStaticMarkup(React.createElement(MemoryRouter, null,
    renderMount(React, Panel, { deliverables })))
  assert.match(render([]), /No deliverable versions recorded/)
  const html = render([{ title: 'Approved artwork', versions: [{ id: 'exact-v1', version_number: 1,
    review_status: 'approved', approvals: [{ approval_type: 'internal_quality', decision: 'approved' }],
    pmConfirmations: [], lifecycleEvents: [] }] }])
  assert.match(html, /Approved artwork/)
  assert.match(html, /Exact version: exact-v1/)
  assert.match(html, /Specialist review/)
  assert.match(html, /href="\/sphere\/my-work\?tab=review"/)
})
