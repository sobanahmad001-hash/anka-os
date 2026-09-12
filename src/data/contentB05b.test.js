import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  checkContentQuality,
  contentCounts,
  contentQualityConfiguration,
  contentQualityConfigurationIssues,
  unresolvedPlaceholders,
} from './contentQualityChecks.js'
import {
  contentWriterPreview,
  newContentWriterDraft,
  serializeContentWriter,
} from './contentWriter.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

function validIsolatedDraft() {
  return {
    ...newContentWriterDraft({ language: 'Urdu' }),
    output_type: 'blog_article',
    working_title: 'Operations article',
    destination: 'September launch',
    objective: 'Explain the service',
    audience: 'Operations leaders',
    body: '# Summary\nAnka Sphere helps teams. Book a call.\n# Sources\nClient brief v2',
    cta: 'Book a call.',
  }
}

const byId = report => Object.fromEntries(report.checks.map(item => [item.id, item]))

test('B05b factual counts remain distinct from unconfigured advisory rules', () => {
  assert.deepEqual(contentCounts('Hello café'), { words: 2, characters: 10 })
  const report = checkContentQuality({ body: 'Hello café' })
  const checks = byId(report)
  assert.equal(report.counts.words, 2)
  assert.equal(checks.required_sections.status, 'not_configured')
  assert.equal(checks.length.status, 'not_configured')
  assert.equal(checks.required_terms.status, 'not_configured')
  assert.equal(checks.cta.status, 'not_configured')
  assert.equal(checks.citations.status, 'not_configured')
  assert.equal(checks.placeholders.status, 'pass')
  assert.equal(Object.hasOwn(report, 'seo_score'), false)
})

test('B05b checks only explicitly configured structural and phrase presence', () => {
  const form = {
    ...validIsolatedDraft(),
    required_sections: 'Summary\nSources',
    length_unit: 'words',
    min_length: '8',
    max_length: '20',
    required_terms: 'Anka Sphere\nteams',
    require_source_citations: true,
    source_citations: 'Client brief v2',
  }
  const quality = contentQualityConfiguration(form)
  const report = checkContentQuality({ body: form.body, cta: form.cta, ...quality })
  assert.equal(report.attention, 0)
  for (const id of ['required_sections', 'length', 'required_terms', 'placeholders', 'cta', 'citations']) {
    assert.equal(byId(report)[id].status, 'pass', id)
  }
  assert.match(byId(report).required_sections.detail, /does not assess meaning/)
  assert.match(byId(report).required_terms.detail, /does not assess semantic use/)
  assert.match(byId(report).citations.detail, /Accuracy, accessibility, and support are not assessed/)
})

test('B05b reports each deterministic attention condition without changing text', () => {
  const body = '# Summary\n# Sources\nTBD {{client_name}}'
  const content = {
    body,
    cta: 'Book a call.',
    quality_requirements: {
      required_sections: ['Summary'],
      length_unit: 'words',
      min_length: 20,
      max_length: 30,
      required_terms: ['Anka Sphere'],
      require_source_citations: true,
    },
    source_citations: [],
  }
  const report = checkContentQuality(content)
  const checks = byId(report)
  for (const id of ['required_sections', 'length', 'required_terms', 'placeholders', 'cta', 'citations']) {
    assert.equal(checks[id].status, 'attention', id)
  }
  assert.deepEqual(unresolvedPlaceholders(body), ['TBD', '{{client_name}}'])
  assert.equal(content.body, body)
})

test('B05b bounds optional quality configuration before preview or save', () => {
  assert.match(contentQualityConfigurationIssues({ length_unit: 'words' }).length_rule, /at least one/)
  assert.match(contentQualityConfigurationIssues({ length_unit: 'words', min_length: '20', max_length: '10' }).length_rule, /cannot exceed/)
  assert.match(contentQualityConfigurationIssues({ length_unit: 'characters', max_length: '120001' }).length_rule, /cannot exceed/)
  assert.match(contentQualityConfigurationIssues({ required_sections: Array.from({ length: 31 }, (_, index) => `Section ${index}`).join('\n') }).required_sections, /at most 30/)
  assert.match(contentQualityConfigurationIssues({ required_terms: 'x'.repeat(201) }).required_terms, /200 characters/)
  assert.match(contentQualityConfigurationIssues({ source_citations: 'x'.repeat(1001) }).source_citations, /1,000 characters|1000 characters/)
  assert.match(contentQualityConfigurationIssues({ source_citations: 'x' }).source_citations, /at least 3 characters/)
  assert.match(contentQualityConfigurationIssues({ source_citations: 'ftp://example.test/source' }).source_citations, /valid HTTP\(S\) URL/)
})

test('B05b persists request-local rules for isolated content without a structure dependency', () => {
  const form = {
    ...validIsolatedDraft(),
    required_sections: 'Summary',
    length_unit: 'characters',
    max_length: '500',
    required_terms: 'Anka Sphere',
    require_source_citations: true,
    source_citations: 'Client brief v2',
  }
  const content = serializeContentWriter(form, [])
  assert.equal(content.source_architecture_version_id, null)
  assert.equal(content.target_page_key, null)
  assert.deepEqual(content.quality_requirements, {
    required_sections: ['Summary'],
    length_unit: 'characters',
    min_length: null,
    max_length: 500,
    required_terms: ['Anka Sphere'],
    require_source_citations: true,
  })
  assert.deepEqual(content.source_citations, ['Client brief v2'])
})

test('B05b quality configuration participates in preview identity and has no side-effect path', () => {
  const form = validIsolatedDraft()
  const first = contentWriterPreview(form, [])
  const second = contentWriterPreview({ ...form, required_terms: 'Anka Sphere' }, [])
  assert.notEqual(first.signature, second.signature)
  const ui = read('src/components/ContentWriterEditor.jsx')
  const checker = read('src/data/contentQualityChecks.js')
  assert.match(ui, /Check content/)
  assert.match(ui, /function setField[\s\S]*setPreview\(null\)[\s\S]*setCheckReport\(null\)[\s\S]*setForm/)
  assert.match(ui, /source_architecture_version_id: event\.target\.value[\s\S]*target_page_key: ''/)
  assert.match(ui, /Not configured/)
  assert.match(ui, /No SEO score, AI assessment, approval, release, or publication is created/)
  assert.doesNotMatch(checker, /fetch\(|invoke\(|seo_score|approved|published/)
})
