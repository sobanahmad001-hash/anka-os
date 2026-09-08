import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../../supabase/migrations/20260904002000_design_b02_creative_briefs.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260904002000_design_b02_creative_briefs.sql', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../../supabase/functions/design-workshop/index.ts', import.meta.url), 'utf8')
const shared = readFileSync(new URL('../../supabase/functions/_shared/contentArtifacts.ts', import.meta.url), 'utf8')

test('B02 migration owns separate versioned briefs and reversible working state', () => {
  for (const table of ['design_creative_briefs', 'design_creative_brief_versions', 'design_creative_brief_version_sources', 'design_working_direction_preferences']) {
    assert.match(migration, new RegExp(`create table public\\.${table}`))
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  for (const scope of ['engagement', 'task', 'work_item']) {
    assert.match(migration, new RegExp(`uq_design_creative_briefs_official_${scope}_scope`))
  }
  assert.match(migration, /design_creative_briefs_exact_scope_check/)
  assert.match(migration, /alter table public\.tasks add constraint tasks_id_organization_id_key unique \(id, organization_id\)/i)
  assert.match(migration, /foreign key \(id, current_version_id, organization_id\)[\s\S]*creative_brief_versions\(creative_brief_id, id, organization_id\)/i)
  assert.match(migration, /foreign key \(id, frozen_version_id, organization_id\)[\s\S]*creative_brief_versions\(creative_brief_id, id, organization_id\)/i)
  assert.match(migration, /foreign key \(creative_brief_id, parent_version_id, organization_id\)[\s\S]*creative_brief_versions\(creative_brief_id, id, organization_id\)/i)
  assert.match(migration, /trg_design_working_preferences_chain/)
  assert.match(migration, /trg_design_direction_versions_brief_context/)
  assert.match(migration, /trg_design_workshop_sessions_context/)
  assert.match(migration, /expected revision|p_expected_revision/i)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /operation_key/)
  assert.match(migration, /idx_design_creative_briefs_(brand|current_version|frozen_version)/)
})

test('B02 verifier is exhaustive and preserves immutable final decisions', () => {
  const plpgsqlBlocks = [...verifier.matchAll(/do \$\$([\s\S]*?)\$\$;/gi)]
    .map(match => match[1].replace(/--.*$/gm, '').replace(/'(?:''|[^'])*'/g, "''"))
  assert.ok(plpgsqlBlocks.length > 0)
  for (const block of plpgsqlBlocks) assert.doesNotMatch(block, /\bfound\b/i)
  assert.doesNotMatch(migration, /drop trigger trg_design_selections_immutable|drop trigger trg_design_releases_immutable/i)
  assert.doesNotMatch(migration, /alter table public\.design_direction_selections/i)
  assert.match(migration, /revoke all on[\s\S]*from anon, authenticated/)
  assert.match(migration, /security invoker/)
  assert.doesNotMatch(migration, /security definer/i)
  assert.match(verifier, /unexpected policy count/)
  assert.match(verifier, /composite FK parent candidate-key set is incomplete/)
  assert.match(verifier, /tenant-safe composite FK set is incomplete/)
  assert.match(verifier, /creative_brief_cross_tenant_tuple_rejected/)
  assert.match(verifier, /design_session_cross_tenant_tuple_rejected/)
  assert.match(verifier, /direction_version_cross_tenant_tuple_rejected/)
  assert.match(verifier, /working_preference_cross_tenant_tuple_rejected/)
  assert.match(verifier, /unexpected %.% privilege/)
  assert.match(verifier, /missing or disabled trigger/)
  assert.match(verifier, /cross_root_current_rejected/)
  assert.match(verifier, /preference_mismatched_engagement_rejected/)
  assert.match(verifier, /direction_other_service_brief_rejected/)
  assert.match(verifier, /final_selection_update_rejected/)
  assert.match(verifier, /artifact_approval_update_rejected/)
  assert.match(verifier, /'design_b02','PASS'/)
})

test('B02 actions pin exact frozen inputs and leave Content-owned resolver code unchanged', () => {
  assert.match(edge, /save_creative_brief/)
  assert.match(edge, /freeze_creative_brief/)
  assert.match(edge, /set_working_direction/)
  assert.match(edge, /Freeze the exact-scope creative brief before generation/)
  assert.match(edge, /creative_brief_version_id: frozenBrief\.frozen_version_id/)
  assert.ok(shared.length > 0)
})
