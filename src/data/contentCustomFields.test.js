import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { customFieldDraftValue, customFieldValueFromInput } from './contentCustomFields.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260829101716_content_custom_fields.sql')
const verification = read('supabase/verify_20260829101716_content_custom_fields.sql')
const edge = read('supabase/functions/content-studio/index.ts')
const repository = read('src/data/contentCustomFieldsRepository.js')
const settings = read('src/components/ContentCustomFieldSettings.jsx')
const panel = read('src/components/ContentCustomFieldsPanel.jsx')

test('D5 adds only definition and exact-version value tables', () => {
  assert.equal((migration.match(/create table public\./g) || []).length, 2)
  assert.match(migration, /create table public\.artifact_custom_field_defs/)
  assert.match(migration, /create table public\.artifact_custom_field_values/)
  assert.match(migration, /foreign key \(artifact_version_id, organization_id\)[\s\S]*references public\.artifact_versions\(id, organization_id\)/)
  assert.match(migration, /unique \(artifact_version_id, field_def_id\)/)
  assert.doesNotMatch(migration, /alter table public\.(artifacts|artifact_versions|artifact_approvals)/)
})

test('D5 supports all Content artifact types and seeds only the requested content fields', () => {
  for (const artifactType of [
    'discovery', 'vision', 'audience', 'website_architecture',
    'keyword_strategy', 'content', 'campaign_messaging', 'scripts',
  ]) assert.match(migration, new RegExp(`'${artifactType}'`))
  for (const name of ['word_count', 'seo_score', 'target_keyword', 'channel']) {
    assert.match(migration, new RegExp(`'${name}'`))
  }
  assert.match(migration, /\["blog", "social", "email", "landing_page"\]/)
  assert.match(migration, /select organization\.id, 'content'/)
})

test('database validation rejects malformed and cross-type values', () => {
  assert.match(migration, /jsonb_typeof\(new\.value\) <> 'number'/)
  assert.match(migration, /Single-select value must be one of the defined options/)
  assert.match(migration, /version_artifact_type <> definition\.artifact_type/)
  assert.match(verification, /number_field_rejects_text/)
  assert.match(verification, /single_select_rejects_unknown_option/)
  assert.match(verification, /content_field_rejects_campaign_brief_version/)
  assert.match(verification, /new_version_custom_fields_start_empty/)
  assert.match(verification, /artifact_version_id = v_content_version_2_id/)
  assert.match(verification, /not exists \([\s\S]*artifact_custom_field_values[\s\S]*v_content_version_2_id/)
})

test('RLS exposes organization reads but browser writes stay closed', () => {
  assert.equal((migration.match(/enable row level security/g) || []).length, 2)
  assert.equal((migration.match(/public\.is_team_organization_member\(organization_id\)/g) || []).length, 2)
  assert.match(migration, /revoke all on public\.artifact_custom_field_defs from anon, authenticated/)
  assert.match(migration, /grant select on public\.artifact_custom_field_defs, public\.artifact_custom_field_values to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*authenticated/i)
  assert.match(verification, /browser_is_read_only/)
  assert.match(verification, /grant select, insert on d5_runtime_checks to authenticated/)
})

test('writes use the Content authority path and never mutate approvals', () => {
  assert.match(edge, /create_artifact_custom_field_definition/)
  assert.match(edge, /save_artifact_custom_field_value/)
  assert.match(repository, /functions\.invoke\('content-studio'/)
  const writeSources = `${migration}\n${repository}`
  assert.doesNotMatch(writeSources, /(?:from\('|into public\.|update public\.|delete from public\.)artifact_approvals/)
  assert.match(verification, /custom_value_write_does_not_approve/)
})

test('settings and version detail provide typed field editing without carry-forward', () => {
  assert.match(read('src/apps/Settings.jsx'), /ContentCustomFieldSettings/)
  assert.match(read('src/apps/ContentStudio.jsx'), /ContentCustomFieldsPanel/)
  assert.match(settings, /Artifact custom fields/)
  assert.match(settings, />Type<select/)
  assert.match(panel, /Typed custom metadata/)
  assert.match(panel, /not copied to revisions/)
  assert.match(panel, /field_type === 'number' \? 'number'/)
  assert.match(panel, /field_type === 'date' \? 'date'/)
  assert.match(panel, /type="checkbox"/)
})

test('custom-field input helpers preserve JSON types', () => {
  assert.equal(customFieldValueFromInput('number', '12.5'), 12.5)
  assert.equal(customFieldValueFromInput('number', ''), null)
  assert.equal(customFieldValueFromInput('checkbox', true), true)
  assert.deepEqual(customFieldValueFromInput('multi_select', ['blog']), ['blog'])
  assert.throws(() => customFieldValueFromInput('number', 'nope'), /valid number/)
  assert.equal(customFieldDraftValue({ field_type: 'number' }, 42), '42')
  assert.deepEqual(customFieldDraftValue({ field_type: 'multi_select' }, undefined), [])
})

test('D5 does not implement Work Item fields or computed formulas', () => {
  const d5 = `${migration}\n${edge}\n${repository}\n${settings}\n${panel}`
  assert.doesNotMatch(d5, /work_items|work_item_dependencies/)
  assert.doesNotMatch(d5, /computed_field|formula_expression|automatic_word_count|automatic_seo_score/i)
})
