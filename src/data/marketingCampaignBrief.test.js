import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { selectedCampaignBriefSuggestions, validateCampaignBriefDraft } from './marketingStudio.js'

const approvalEdge = readFileSync(new URL('../../supabase/functions/artifact-approvals/index.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/20260904090000_mb02_marketing_campaign_briefs.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260904090000_mb02_marketing_campaign_briefs.sql', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
const brief = readFileSync(new URL('../components/MarketingCampaignBrief.jsx', import.meta.url), 'utf8')
const concurrency = readFileSync(new URL('../../scripts/mb02-concurrency.ts', import.meta.url), 'utf8')
const marketingEdge = readFileSync(new URL('../../supabase/functions/marketing-studio/index.ts', import.meta.url), 'utf8')
const departmentEdge = readFileSync(new URL('../../supabase/functions/department-chat/index.ts', import.meta.url), 'utf8')
const departmentUi = readFileSync(new URL('../components/DepartmentChat.jsx', import.meta.url), 'utf8')

test('campaign brief requires only a goal and at least one channel', () => {
  const result = validateCampaignBriefDraft({ campaign_goal: 'Launch', channels: ['Email'] })
  assert.equal(result.campaign_goal, 'Launch')
  assert.deepEqual(result.channels, ['Email'])
  assert.equal(result.measurement_value, null)
  assert.equal(result.measurement_evidence, '')
})

test('campaign brief preserves a missing benchmark and validates measurement units', () => {
  assert.throws(() => validateCampaignBriefDraft({ campaign_goal: 'Launch', channels: ['Email'], measurement_value: '12' }), /unit is required/)
  const result = validateCampaignBriefDraft({ campaign_goal: 'Launch', channels: ['Email'], measurement_value: '12', measurement_unit: '%' })
  assert.equal(result.measurement_value, 12)
  assert.equal(result.measurement_unit, '%')
})

test('selected WCH suggestions change local selected fields only', () => {
  const result = selectedCampaignBriefSuggestions(
    { campaign_goal: 'Keep', audience: 'Original' },
    { campaign_goal: 'Suggested', audience: 'New' },
    ['audience'],
  )
  assert.deepEqual(result, { campaign_goal: 'Keep', audience: 'New' })
})

test('campaign brief one-approver policy is isolated and server-governed', () => {
  assert.match(approvalEdge, /isCampaignBrief \? 1 : 2/)
  assert.match(approvalEdge, /create_marketing_campaign_brief_approval_request/)
  assert.match(migration, /a\.artifact_type = 'campaign_brief'/)
  assert.match(migration, /membership\.role in \('system_owner', 'operations_admin', 'executive'\)/)
  assert.match(migration, /membership\.department_id = 'marketing' and membership\.role = 'department_manager'/)
  assert.match(migration, /cardinality\(p_required_approver_ids\) < 1/)
  assert.match(migration, /revoke all on function public\.create_marketing_campaign_brief_approval_request[\s\S]*from public, anon, authenticated/)
})

test('save RPC expires replay keys atomically and enforces one canonical campaign lineage', () => {
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*save_campaign_brief/)
  assert.match(migration, /delete from public\.marketing_brief_save_requests[\s\S]*expires_at <= pg_catalog\.clock_timestamp\(\)/)
  assert.match(migration, /expires_at > pg_catalog\.clock_timestamp\(\)/)
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*campaign_brief_lineage/)
  assert.match(migration, /uq_marketing_campaign_artifacts_campaign_brief_lineage[\s\S]*where relation_type = 'campaign_brief'/)
  assert.match(migration, /uq_marketing_campaign_artifacts_artifact_lineage[\s\S]*where relation_type = 'campaign_brief'/)
  assert.match(migration, /v_canonical_artifact_id is distinct from p_artifact_id/)
  assert.doesNotMatch(migration, /on conflict \(campaign_id, artifact_id\) do nothing/)
})

test('two-session concurrency harness is disposable and refuses remote databases', () => {
  assert.match(concurrency, /MB02_LOCAL_TEMPLATE_URL/)
  assert.match(concurrency, /localhost.*127\.0\.0\.1.*\[::1\]/)
  assert.match(concurrency, /CREATE DATABASE[\s\S]*TEMPLATE/)
  assert.match(concurrency, /DROP DATABASE/)
  assert.match(concurrency, /Promise\.allSettled/)
  assert.match(concurrency, /Promise\.all\(/)
  assert.match(concurrency, /already has a canonical campaign brief/)
  assert.match(concurrency, /expired_key_race=one_write_one_replay/)
  assert.match(concurrency, /campaign_brief_rebind_race=1_winner/)
  assert.match(concurrency, /non_brief_multi_campaign=2_links/)
})

test('both campaign brief bypasses fail closed before mutation and official confirmation', () => {
  const legacySave = marketingEdge.slice(marketingEdge.indexOf('async function saveArtifact'), marketingEdge.indexOf('async function saveCampaignBrief'))
  assert.match(legacySave, /artifactType === 'campaign_brief'/)
  assert.ok(legacySave.indexOf("artifactType === 'campaign_brief'") < legacySave.indexOf("from('artifacts').insert"))

  const confirmation = departmentEdge.slice(departmentEdge.indexOf('export async function confirmProposal'), departmentEdge.indexOf('export async function rejectProposal'))
  assert.match(confirmation, /proposal\.department_id === 'marketing'[\s\S]*proposal\.proposal_kind === 'artifact_version'[\s\S]*proposal\.target_key === 'campaign_brief'/)
  assert.ok(confirmation.indexOf("proposal.target_key === 'campaign_brief'") < confirmation.indexOf("rpc('confirm_department_chat_proposal'"))
  assert.match(departmentUi, /suggestionsOnly[\s\S]*!suggestionsOnly[\s\S]*Confirm official draft/)
  assert.match(departmentUi, /suggestionsOnly[\s\S]*governed campaign brief editor/)
  assert.match(departmentUi, /onClick=\{onReject\}[\s\S]*>Reject</)
})

test('rollback verifier is exhaustive, named, fail-closed, and ends in PASS', () => {
  for (const check of [
    'ledger_exact_columns_types_defaults', 'ledger_defaults_exact', 'ledger_checks_exact',
    'ledger_foreign_keys_exact', 'ledger_uniqueness_exact', 'ledger_expiry_index_exact',
    'canonical_lineage_indexes_exact', 'ledger_rls_and_policies_exact', 'ledger_acl_exact',
    'ledger_is_metadata_only', 'rpc_exact_signatures_exist',
    'rpc_owner_invoker_search_path_volatility_exact', 'rpc_acl_exact',
    'generic_two_approver_rpc_preserved', 'expiry_and_concurrency_guards_present',
    'first_save_is_single_unapproved_lineage', 'unexpired_request_replays_exact_version',
    'expired_request_does_not_replay_and_key_is_reusable',
    'reused_key_replays_new_version_under_lock', 'conflicting_unexpired_reuse_rejected',
    'duplicate_first_save_rejected', 'artifact_rebind_rejected',
    'campaign_brief_relation_rebind_rejected', 'non_brief_multi_campaign_relation_allowed',
    'cross_tenant_save_rejected',
    'foreign_asset_version_rejected', 'immutable_version_update_rejected',
    'campaign_brief_one_eligible_approver_succeeds',
    'campaign_brief_ineligible_approver_rejected', 'generic_one_approver_still_rejected',
    'sequential_lineage_cardinality_exact',
  ]) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /where not passed/)
  assert.match(verifier, /raise exception 'MB02B verification failed:/)
  assert.match(verifier, /select 'PASS' as mb02b_final_result/)
  assert.match(verifier, /rollback;/)
})

test('unsaved brief uses the router blocker for every SPA transition and beforeunload for document exit', () => {
  assert.match(main, /createBrowserRouter/)
  assert.match(main, /<RouterProvider router=\{router\}/)
  assert.match(studio, /useBlocker\(briefDirty\)/)
  assert.match(studio, /navigationBlocker\.reset\(\)/)
  assert.equal((studio.match(/navigationBlocker\.proceed\(\)/g) || []).length, 2)
  assert.doesNotMatch(studio, /setPendingNavigation|runNavigation/)
  assert.match(studio, /<Link to="\/sphere\/marketing"/)
  assert.match(studio, /<WorkshopContextShell[\s\S]*returnTarget=\{returnTarget\}/)
  assert.match(brief, /beforeunload/)
})
