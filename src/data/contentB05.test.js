import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CONTENT_WRITER_OUTPUT_TYPES,
  contentArtifactForMode,
  contentWriterIssues,
  contentWriterPreview,
  newContentWriterDraft,
  serializeContentWriter,
  writerOutputs,
} from './contentWriter.js'
import { buildContentPageTracking } from './contentStudio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const architectureVersions = [{
  id: 'architecture-v2', artifact_id: 'architecture-artifact', version_number: 2,
  content: { pages: [{ page_key: 'page:home', slug: 'home', title: 'Home' }] },
}]

function validDraft(outputType = 'website_page_copy') {
  return {
    ...newContentWriterDraft({ language: 'English' }), output_type: outputType,
    working_title: 'Homepage draft', objective: 'Explain the service', audience: 'Operations leaders',
    body: 'A clear manually authored draft.',
    source_architecture_version_id: outputType === 'website_page_copy' ? 'architecture-v2' : '',
    target_page_key: outputType === 'website_page_copy' ? 'page:home' : '',
    destination: outputType === 'website_page_copy' ? '' : 'September launch',
  }
}

test('B05a exposes exactly the five approved manual text types and one variant', () => {
  assert.deepEqual(CONTENT_WRITER_OUTPUT_TYPES.map(([value]) => value), [
    'website_page_copy', 'blog_article', 'social_copy', 'campaign_copy', 'custom_text',
  ])
  for (const [outputType] of CONTENT_WRITER_OUTPUT_TYPES) {
    const content = serializeContentWriter(validDraft(outputType), architectureVersions)
    assert.equal(content.output_type, outputType)
    assert.equal(content.variant_number, 1)
  }
})

test('B05a website copy requires an exact structure version and page while isolated text does not', () => {
  const website = validDraft()
  assert.deepEqual(contentWriterIssues({ ...website, source_architecture_version_id: '' }, architectureVersions).source_architecture_version_id,
    'Choose an exact accessible Website Architecture version.')
  assert.ok(contentWriterIssues({ ...website, target_page_key: 'page:missing' }, architectureVersions).target_page_key)
  for (const outputType of ['blog_article', 'social_copy', 'campaign_copy', 'custom_text']) {
    const content = serializeContentWriter(validDraft(outputType), [])
    assert.equal(content.source_architecture_version_id, null)
    assert.equal(content.target_page_key, null)
  }
})

test('B05a preview preserves request-local language and tone without provider or approval effects', () => {
  const preview = contentWriterPreview({
    ...validDraft('blog_article'), language: 'Urdu', tone: 'Direct and calm', exclusions: 'guaranteed\nbest ever',
  }, [])
  assert.equal(preview.content.language, 'Urdu')
  assert.equal(preview.content.tone, 'Direct and calm')
  assert.deepEqual(preview.content.exclusions, ['guaranteed', 'best ever'])
  assert.equal(preview.destinationLabel, 'September launch')
  assert.equal(Object.hasOwn(preview.content, 'approved'), false)
  assert.equal(Object.hasOwn(preview.content, 'cost'), false)
})

test('B05a keeps legacy content readers deterministic in empty and mixed artifact lists', () => {
  assert.equal(contentArtifactForMode({}, 'legacy'), null)
  const workspace = {
    artifacts: [
      { id: 'writer-artifact', artifact_type: 'content', title: 'Blog' },
      { id: 'legacy-artifact', artifact_type: 'content', title: 'Website copy' },
    ],
    versions: [
      { id: 'writer-v1', artifact_id: 'writer-artifact', version_number: 1, content: serializeContentWriter(validDraft('blog_article'), []) },
      { id: 'legacy-v1', artifact_id: 'legacy-artifact', version_number: 1, content: { content_strategy: 'Pages', pages: [{ page_path: 'home', page_brief: 'Home', draft_copy: 'Copy', meta_title: 'Home', meta_description: 'Home', primary_cta: 'Book' }] } },
    ],
    approvals: [], contentTasks: [],
  }
  assert.equal(contentArtifactForMode(workspace, 'legacy').id, 'legacy-artifact')
  assert.equal(contentArtifactForMode(workspace, 'writer').id, 'writer-artifact')
  assert.equal(writerOutputs(workspace)[0].artifact.id, 'writer-artifact')
  assert.equal(buildContentPageTracking(workspace).source, 'content')
  const writerOnly = { ...workspace, artifacts: [workspace.artifacts[0]], versions: [workspace.versions[0]] }
  assert.equal(contentArtifactForMode(writerOnly, 'legacy'), null)
  assert.equal(buildContentPageTracking(writerOnly).source, 'website_architecture')
})

test('B05a UI requires preview and explicit unapproved confirmation without a second chat or fake generation', () => {
  const ui = read('src/components/ContentWriterEditor.jsx')
  const studio = read('src/apps/ContentStudio.jsx')
  assert.match(ui, /Preview draft/)
  assert.match(ui, /Confirm unapproved draft/)
  assert.match(ui, /artifact_type: 'content'/)
  assert.match(ui, /ai_use_allowed: false/)
  assert.match(ui, /Variant 1 only/)
  assert.match(ui, /cost estimate unavailable/)
  assert.match(studio, /Production writer/)
  assert.doesNotMatch(ui, /invoke\(['"]department-chat|generate_|localStorage|sessionStorage/)
})
