import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260828145700_artifact_version_proofing_layer.sql')
const migrationCp5 = read('supabase/migrations/20260831231112_cp5_proofing_relations.sql')
const edge = read('supabase/functions/proofing-layer/index.ts')
const edgeTest = read('supabase/functions/proofing-layer/index.test.ts')
const repository = read('src/data/proofingRepository.js')

test('D1 proofing has one table and exactly one organization-consistent target', () => {
  assert.equal((migration.match(/create table public\./g) || []).length, 1)
  assert.match(migration, /create table public\.artifact_version_comments/)
  assert.match(migration, /artifact_version_comments_exactly_one_target/)
  assert.match(migration, /artifact_version_id is not null[\s\S]*design_direction_version_id is not null[\s\S]*= 1/)
  assert.match(migration, /foreign key \(artifact_version_id, organization_id\)[\s\S]*references public\.artifact_versions\(id, organization_id\)/)
  assert.match(migration, /foreign key \(design_direction_version_id, organization_id\)[\s\S]*references public\.design_direction_versions\(id, organization_id\)/)
})

test('proofing target shape for CP5 adds content requests', () => {
  assert.match(migrationCp5, /content_request_id/)
  assert.match(migrationCp5, /artifact_version_comments_content_request_fk/)
  assert.match(migrationCp5, /artifact_version_comments_exactly_one_target/)
  assert.match(migrationCp5, /\+ \(content_request_id is not null\)\:\:integer/)
})

test('proofing rows are RLS-scoped and browser read-only', () => {
  assert.match(migration, /alter table public\.artifact_version_comments enable row level security/)
  assert.match(migrationCp5, /public\.is_team_organization_member\(organization_id\)/)
  assert.match(migration, /revoke all on public\.artifact_version_comments from anon, authenticated/)
  assert.match(migration, /grant select on public\.artifact_version_comments to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete)\(.*\) authenticated/i)
})

test('comment content and targets are append-only while resolution is one-way', () => {
  assert.match(migrationCp5, /enforce_artifact_version_comment_append_only/)
  assert.match(migration, /new\.body is distinct from old\.body/)
  assert.match(migration, /new\.comment_position is distinct from old\.comment_position/)
  assert.match(migration, /new\.artifact_version_id is distinct from old\.artifact_version_id/)
  assert.match(migrationCp5, /new\.design_direction_version_id is distinct from old\.design_direction_version_id/)
  assert.match(migrationCp5, /new\.content_request_id is distinct from old\.content_request_id/)
  assert.match(migration, /if old\.resolved or not new\.resolved/)
  assert.doesNotMatch(edge, /delete\(|remove_comment|edit_comment|update_comment/)
})

test('resolution is server-authorized and independent from approval', () => {
  assert.match(edge, /hasResolveAuthority/)
  assert.match(edge, /comment\.author_id === actorId/)
  assert.match(edge, /department_manager/)
  assert.match(edge, /\.eq\('resolved', false\)/)
  assert.doesNotMatch(edge, /artifact_approvals|approve_artifact|approval_id/)
  assert.doesNotMatch(migration, /artifact_approvals/)
  assert.match(edgeTest, /proofing requires exactly one/)
})

test('the reusable proofing panel covers Content, Marketing, Design direction, and Content request versions', () => {
  const component = read('src/components/VersionProofingPanel.jsx')
  const content = read('src/apps/ContentStudio.jsx')
  const marketing = read('src/apps/MarketingStudio.jsx')
  const design = read('src/apps/DesignWorkshop.jsx')
  assert.match(component, /Unresolved only/)
  assert.match(component, /Comments cannot be edited or deleted/)
  assert.match(content, /targetKind="artifact"[\s\S]*regionsByVersion/)
  assert.match(marketing, /targetKind="artifact"/)
  assert.match(design, /targetKind="design_direction"/)
  assert.match(design, /cursor-crosshair/)
  assert.match(component, /targetKind === 'content_request'/)
  assert.match(read('src/components/GeneralContentRequestsPanel.jsx'), /ContentRequestReviewPanels/)
  assert.match(read('src/components/ContentRequestPanel.jsx'), /ContentRequestReviewPanels/)
})

test('comments remain exact target, include content requests, and are never copied on revision', () => {
  assert.match(repository, /\.eq\(targetColumn, versionId\)/)
  assert.match(repository, /content_request_id/)
  assert.match(repository, /content_request_id/)
  assert.match(edge, /content_request_id/)
  assert.match(edgeTest, /content_request_id/)
  assert.doesNotMatch(repository, /parent_version_id|copy|clone|migrate/)
  assert.doesNotMatch(edge, /parent_version_id|copy_comment|clone_comment/)
  assert.doesNotMatch(migrationCp5, /parent_version_id/)
})
