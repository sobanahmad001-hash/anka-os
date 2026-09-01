import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { splitArtifactRelations } from './artifactRelations.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260829083706_artifact_relations.sql')
const verification = read('supabase/verify_20260829083706_artifact_relations.sql')
const edge = read('supabase/functions/artifact-relations/index.ts')
const sharedRelation = read('supabase/functions/_shared/artifactRelations.ts')
const repository = read('src/data/artifactRelationsRepository.js')
const panel = read('src/components/ArtifactRelationsPanel.jsx')

test('D3 adds only the exact generic artifact relation schema', () => {
  assert.equal((migration.match(/create table public\./g) || []).length, 1)
  assert.match(migration, /create table public\.artifact_relations/)
  for (const type of ['feeds_into', 'derived_from', 'referenced_by']) assert.match(migration, new RegExp(type))
  assert.match(migration, /foreign key \(source_artifact_id, organization_id\)[\s\S]*references public\.artifacts\(id, organization_id\)/)
  assert.match(migration, /foreign key \(target_artifact_id, organization_id\)[\s\S]*references public\.artifacts\(id, organization_id\)/)
  assert.match(migration, /check \(source_artifact_id <> target_artifact_id\)/)
  assert.match(migration, /unique \(source_artifact_id, target_artifact_id, relation_type\)/)
  assert.doesNotMatch(migration, /alter table public\.(artifact_versions|artifact_approvals|artifact_version_comments)/)
})

test('D3 relation reads require both endpoint artifacts and keep browser writes closed', () => {
  assert.match(migration, /alter table public\.artifact_relations enable row level security/)
  assert.match(migration, /public\.is_team_organization_member\(organization_id\)/)
  assert.equal((migration.match(/from public\.artifacts (source|target)/g) || []).length, 2)
  assert.match(migration, /revoke all on public\.artifact_relations from anon, authenticated/)
  assert.match(migration, /grant select on public\.artifact_relations to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*authenticated/i)
  assert.match(verification, /inaccessible_target_hidden_from_rollup/)
  assert.match(verification, /v_source_visible = 1 and v_target_visible = 0 and v_rollup_visible = 0/)
})

test('D3 write path checks artifact readability and never mutates an existing table', () => {
  assert.match(sharedRelation, /loadReadablePair\(/)
  assert.match(sharedRelation, /Both artifacts must be visible/)
  assert.match(sharedRelation, /\.from\('artifact_relations'\)\.insert/)
  assert.match(edge, /\.from\('artifact_relations'\)[\s\S]*\.delete\(\)/)
  assert.doesNotMatch(edge, /\.from\('(artifacts|artifact_versions|artifact_approvals|artifact_version_comments)'\)\.(insert|update|upsert|delete)/)
})

test('D3 rollup is bidirectional, live, and has no cached summary', () => {
  const rows = [{
    id: 'out', source_artifact_id: 'current', target_artifact_id: 'other', relation_type: 'feeds_into',
    source: { id: 'current' }, target: { id: 'other' },
  }, {
    id: 'in', source_artifact_id: 'third', target_artifact_id: 'current', relation_type: 'referenced_by',
    source: { id: 'third' }, target: { id: 'current' },
  }]
  assert.deepEqual(splitArtifactRelations('current', rows), {
    outgoing: [{ ...rows[0], relatedArtifact: rows[0].target, targetKind: 'artifact' }],
    incoming: [{ ...rows[1], relatedArtifact: rows[1].source, targetKind: 'artifact' }],
  })
  assert.match(repository, /source:artifacts!artifact_relations_source_artifact_fkey/)
  assert.match(repository, /target:artifacts!artifact_relations_target_artifact_fkey/)
  assert.match(repository, /source_artifact_id\.eq\.\$\{artifactId\},target_artifact_id\.eq\.\$\{artifactId\}/)
  assert.doesNotMatch(`${migration}\n${repository}`, /related_count|incoming_count|outgoing_count|cached_rollup/)
})

test('W6 connection rollup drops a relation when an endpoint is not visible', () => {
  const hiddenTarget = {
    id: 'hidden', source_artifact_id: 'current', target_artifact_id: 'restricted', relation_type: 'feeds_into',
    source: { id: 'current', title: 'Visible source' }, target: null,
  }
  const hiddenSource = {
    id: 'hidden-source', source_artifact_id: 'restricted', target_artifact_id: 'current', relation_type: 'derived_from',
    source: null, target: { id: 'current', title: 'Visible target' },
  }
  assert.deepEqual(splitArtifactRelations('current', [hiddenTarget, hiddenSource]), { outgoing: [], incoming: [] })
  assert.match(read('src/components/WorkItemConnections.jsx'), /splitArtifactRelations/)
  assert.match(verification, /inaccessible_target_hidden_from_rollup/)
})

test('D3 exposes one reusable artifact-detail relation panel across department surfaces', () => {
  assert.match(panel, /Used in \/ related/)
  assert.match(panel, /This artifact relates to/)
  assert.match(panel, /Artifacts relating here/)
  assert.match(panel, /Search visible artifacts by title or type/)
  for (const file of [
    'src/apps/ContentStudio.jsx',
    'src/apps/MarketingStudio.jsx',
    'src/apps/DesignWorkshop.jsx',
    'src/components/DevelopmentTrackingPanel.jsx',
  ]) assert.match(read(file), /ArtifactRelationsPanel/)
  assert.match(read('src/App.jsx'), /path="sphere\/artifacts\/:artifactId"/)
})

test('D3 contains no dependency graph or W-series implementation', () => {
  const d3 = `${migration}\n${edge}\n${repository}\n${panel}`
  assert.doesNotMatch(d3, /work_items|work_item_dependencies|cycle detection|recursive query/i)
  assert.doesNotMatch(`${migration}\n${edge}`, /artifact_versions|artifact_approvals|artifact_version_comments/)
})
