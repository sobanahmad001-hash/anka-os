import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import {
  contentArtifactEditor,
  keywordDuplicateWarnings,
  keywordStrategyIssues,
  keywordTargetsChanged,
  normalizeKeywordWhitespace,
  serializeContentArtifact,
} from './contentStudio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const pageKeyword = (overrides = {}) => ({
  term: 'Strategy agency', locale: 'en-PK', intent: 'commercial', topic_group: '', priority: '',
  evidence_source: '', search_volume: '', difficulty: '', observation_date: '',
  target_kind: 'page', target_id: 'page:home', target_page_slug: 'home', notes: '', ...overrides,
})

test('B04 normalizes whitespace and preserves unavailable metrics as null', () => {
  assert.equal(normalizeKeywordWhitespace('  strategy\n  agency  '), 'strategy agency')
  const content = serializeContentArtifact('keyword_strategy', {
    source_architecture_version_id: 'architecture-v2', keywords: [pageKeyword()],
  })
  assert.equal(content.schema_version, 2)
  assert.equal(content.keywords[0].search_volume, null)
  assert.equal(content.keywords[0].difficulty, null)
  assert.equal(content.keywords[0].observation_date, null)
})

test('B04 warns duplicate phrase and locale rows without merging distinct intents', () => {
  const rows = [pageKeyword(), pageKeyword({ term: ' strategy   agency ', locale: 'EN-pk', intent: 'informational' })]
  const warnings = keywordDuplicateWarnings(rows)
  assert.equal(warnings.size, 2)
  assert.equal(serializeContentArtifact('keyword_strategy', { source_architecture_version_id: 'v1', keywords: rows }).keywords.length, 2)
})

test('B04 blocks missing evidence, stale targets, and page targets without an exact source version', () => {
  const metricIssues = keywordStrategyIssues({ source_architecture_version_id: 'v1', keywords: [pageKeyword({ search_volume: '100' })] }, {
    pageTargetIds: new Set(['page:home']), contentRequestIds: new Set(),
  })
  assert.match(metricIssues.get(0), /Evidence source is required/)
  const staleIssues = keywordStrategyIssues({ source_architecture_version_id: 'v1', keywords: [pageKeyword()] }, {
    pageTargetIds: new Set(['page:other']), contentRequestIds: new Set(),
  })
  assert.match(staleIssues.get(0), /not in the exact Website architecture version/)
  assert.match(keywordStrategyIssues({ keywords: [pageKeyword()] }).get(0), /exact Website architecture version/)
})

test('B04 permits an existing standalone request target without website structure', () => {
  const record = pageKeyword({ target_kind: 'content_request', target_id: 'request-1', target_page_slug: '' })
  const issues = keywordStrategyIssues({ source_architecture_version_id: '', keywords: [record] }, {
    pageTargetIds: new Set(), contentRequestIds: new Set(['request-1']),
  })
  assert.equal(issues.size, 0)
  const keyword = serializeContentArtifact('keyword_strategy', { keywords: [record] }).keywords[0]
  assert.equal(keyword.target_content_request_id, 'request-1')
  assert.equal(keyword.target_page_key, null)
})

test('B04 legacy keyword versions remain readable and require deliberate target reselection', () => {
  const editor = contentArtifactEditor('keyword_strategy', { keywords: [{
    term: 'Legacy term', category: 'industry', search_volume: 10, target_page_slug: 'home', notes: '',
  }] })
  assert.equal(editor.keywords[0].target_kind, 'page')
  assert.equal(editor.keywords[0].target_id, '')
  assert.equal(editor.keywords[0].target_page_slug, 'home')
  assert.match(keywordStrategyIssues(editor).get(0), /Language or locale is required.*Choose an existing target/)
})

test('B04 target change detection is intent-aware and never rewrites rows', () => {
  const before = [pageKeyword()]
  assert.equal(keywordTargetsChanged(before, [pageKeyword()]), false)
  assert.equal(keywordTargetsChanged(before, [pageKeyword({ target_id: 'page:services' })]), true)
  assert.equal(keywordTargetsChanged(before, [pageKeyword({ intent: 'informational' })]), true)
})

test('B04 renders real keyword controls, warnings, and unavailable labels', async () => {
  const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: KeywordStrategyEditor } = await vite.ssrLoadModule('/src/components/KeywordStrategyEditor.jsx')
    const records = [pageKeyword(), pageKeyword({ intent: 'informational' })]
    const html = renderToStaticMarkup(React.createElement(KeywordStrategyEditor, {
      field: { label: 'Keyword strategy', addLabel: 'Add keyword', recordFields: [
        ['term', 'Keyword phrase', 'text'], ['locale', 'Language or locale', 'text'],
        ['search_volume', 'Search volume', 'number_optional'], ['target_kind', 'Target type', 'select', [{ value: 'page', label: 'Existing structure page' }]],
        ['target_id', 'Target', 'keyword_target'],
      ] },
      records,
      architectureVersion: { content: { pages: [{ page_key: 'page:home', slug: 'home', title: 'Home' }] } },
      issues: new Map(), warnings: keywordDuplicateWarnings(records), inputClass: 'input', buttonClass: 'button',
      onAdd() {}, onChange() {}, onRemove() {},
    }))
    assert.match(html, /Add keyword/)
    assert.match(html, /Not available/)
    assert.match(html, /Duplicate phrase in this locale/)
    assert.match(html, /page:home/)
  } finally {
    await vite.close()
  }
})

test('B04 keeps unsupported import and downstream behavior explicit and adds no schema', () => {
  const ui = read('src/apps/ContentStudio.jsx')
  const edge = read('supabase/functions/_shared/contentArtifacts.ts')
  assert.match(ui, /Import is unavailable because no supported keyword import format is configured/)
  assert.match(ui, /standalone blog target remains unavailable until a blog or article content-request format is approved/)
  assert.match(ui, /no draft is rewritten or retargeted automatically/)
  assert.match(edge, /target_content_request_id/)
  assert.match(edge, /source_architecture_version_id/)
  const repository = read('src/data/contentStudioRepository.js')
  assert.match(repository, /from\('content_requests'\)[\s\S]*eq\('organization_id', organizationId\)\.eq\('brand_id', engagement\.brand_id\)/)
  assert.match(repository, /mode !== 'general' && request\.engagement_id !== engagementId/)
  assert.doesNotMatch(ui, /parseCsv|accept="\.csv"|bulk import/i)
  assert.doesNotMatch(edge, /create table|alter table|create policy/i)
})
