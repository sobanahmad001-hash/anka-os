import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  acceptCampaignPlanSave, campaignPlanContextKey, campaignPlanDraft, campaignPlanSourceOptions,
  canEditCampaignPlan, latestCampaignPlanVersion, validateCampaignPlanDraft, validateCampaignPlanSnapshot,
} from './marketingCampaignPlan.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260911161329_mb04a_campaign_plan_versions.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260911161329_mb04a_campaign_plan_versions.sql', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../../supabase/functions/marketing-studio/index.ts', import.meta.url), 'utf8')
const component = readFileSync(new URL('../components/MarketingCampaignPlan.jsx', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./marketingCampaignPlanRepository.js', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
const concurrency = readFileSync(new URL('../../scripts/mb04a-concurrency.ts', import.meta.url), 'utf8')

test('manual plan draft validates required fields, exact dates, URL and creative requirements', () => {
  const result = validateCampaignPlanDraft({
    title: 'Autumn launch', objective: 'Qualified demand', channels: ['Email', 'Email', 'Search'],
    starts_on: '2026-09-12', ends_on: '2026-10-12', landing_page_url: 'https://example.com/launch',
    creative_requirements: [{ format: 'Static image', intended_placement: 'Homepage hero', due_date: '2026-09-20' }],
  })
  assert.deepEqual(result.channels, ['Email', 'Search'])
  assert.equal(result.creative_requirements[0].intended_placement, 'Homepage hero')
  assert.throws(() => validateCampaignPlanDraft({ title: 'Bad', objective: 'Date', channels: ['Email'], starts_on: '2026-10-01', ends_on: '2026-09-01' }), /cannot precede/)
  assert.throws(() => validateCampaignPlanDraft({ title: 'Bad', objective: 'URL', channels: ['Email'], landing_page_url: 'ftp://example.com' }), /HTTP or HTTPS/)
})

test('history uses exact immutable versions and clones the selected saved source into a new local draft', () => {
  const versions = [
    { id: 'v1', campaign_id: 'campaign-a', version_number: 1, title: 'First', channels: ['Email'] },
    { id: 'v2', campaign_id: 'campaign-a', version_number: 2, title: 'Second', channels: ['Search'] },
  ]
  assert.equal(latestCampaignPlanVersion(versions, 'campaign-a').id, 'v2')
  const draft = campaignPlanDraft(versions[0], [{ plan_version_id: 'v1', position: 1, format: 'Video', intended_placement: 'Social' }])
  assert.equal(draft.title, 'First')
  assert.equal(draft.creative_requirements[0].format, 'Video')
  draft.channels.push('Changed locally')
  assert.deepEqual(versions[0].channels, ['Email'])
})

test('source picker separates approved messages from exact measurement-plan versions', () => {
  const sources = campaignPlanSourceOptions({
    artifacts: [
      { id: 'message', title: 'Message', artifact_type: 'campaign_messaging' },
      { id: 'measure', title: 'Measure', artifact_type: 'measurement_plan' },
    ],
    versions: [
      { id: 'message-v1', artifact_id: 'message', version_number: 1 },
      { id: 'measure-v2', artifact_id: 'measure', version_number: 2 },
    ],
    approvals: [{ artifact_version_id: 'message-v1' }],
  })
  assert.deepEqual(sources.approvedMessages.map(item => item.id), ['message-v1'])
  assert.deepEqual(sources.measurementPlans.map(item => item.id), ['measure-v2'])
})

test('context switch invalidates an old save result', () => {
  const requested = campaignPlanContextKey('org-a', 'eng-a', 'campaign-a')
  assert.deepEqual(acceptCampaignPlanSave({ id: 'v1' }, requested, requested), { id: 'v1' })
  assert.equal(acceptCampaignPlanSave({ id: 'v1' }, requested, campaignPlanContextKey('org-b', 'eng-b', 'campaign-b')), null)
})

test('plan editing mirrors active Marketing-team and leadership authority only', () => {
  assert.equal(canEditCampaignPlan({ member_kind: 'team', status: 'active', role: 'contributor', department_id: 'marketing' }), true)
  assert.equal(canEditCampaignPlan({ member_kind: 'team', status: 'active', role: 'system_owner', department_id: null }), true)
  assert.equal(canEditCampaignPlan({ member_kind: 'team', status: 'active', role: 'contributor', department_id: 'design' }), false)
  assert.equal(canEditCampaignPlan({ member_kind: 'team', status: 'suspended', role: 'system_owner', department_id: null }), false)
})

test('returned plan, requirement, source, and approval rows fail closed outside exact context', () => {
  const scope = { organizationId: 'org-a', engagementId: 'eng-a', campaignId: 'campaign-a' }
  const valid = {
    versions: [{ id: 'plan-v1', organization_id: 'org-a', engagement_id: 'eng-a', campaign_id: 'campaign-a' }],
    requirements: [{ organization_id: 'org-a', plan_version_id: 'plan-v1' }],
    artifacts: [{ id: 'message', organization_id: 'org-a', engagement_id: 'eng-a' }],
    sourceVersions: [{ id: 'message-v1', organization_id: 'org-a', artifact_id: 'message' }],
    approvals: [{ artifact_version_id: 'message-v1' }],
  }
  assert.equal(validateCampaignPlanSnapshot(valid, scope), valid)
  for (const invalid of [
    { ...valid, versions: [{ ...valid.versions[0], organization_id: 'org-b' }] },
    { ...valid, requirements: [{ organization_id: 'org-a', plan_version_id: 'other-plan' }] },
    { ...valid, artifacts: [{ ...valid.artifacts[0], engagement_id: 'eng-b' }] },
    { ...valid, sourceVersions: [{ ...valid.sourceVersions[0], artifact_id: 'other-artifact' }] },
    { ...valid, approvals: [{ artifact_version_id: 'other-version' }] },
  ]) assert.throws(() => validateCampaignPlanSnapshot(invalid, scope), error => error.status === 403 && error.membershipMismatch)
})

test('repository scopes every read and save to the selected organization and exact campaign context', () => {
  assert.match(repository, /if \(!organizationId\) throw new TypeError/)
  assert.match(repository, /from\('marketing_campaign_plan_versions'\)[\s\S]*eq\('organization_id', organizationId\)[\s\S]*eq\('engagement_id', engagementId\)[\s\S]*eq\('campaign_id', campaignId\)/)
  assert.match(repository, /from\('marketing_campaign_plan_creative_requirements'\)[\s\S]*eq\('organization_id', organizationId\)/)
  assert.match(repository, /body: \{ \.\.\.input, action: 'save_campaign_plan', organization_id: organizationId \}/)
  assert.match(repository, /validateCampaignPlanSnapshot/)
})

test('schema is append-only, organization-scoped, server-written and planning-only', () => {
  assert.match(migration, /unique \(campaign_id, version_number\)/)
  assert.doesNotMatch(migration, /marketing_campaign_plan_creative_requirements[\s\S]*unique \(id, organization_id\)/)
  assert.match(migration, /engagement_events_event_type_check[\s\S]*marketing_campaign_plan_version_created/)
  assert.match(migration, /trg_marketing_campaign_plan_versions_immutable[\s\S]*before update or delete/)
  assert.match(migration, /trg_marketing_campaign_plan_requirements_immutable[\s\S]*before update or delete/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /using \(public\.is_team_organization_member\(organization_id\)\)/)
  assert.match(migration, /revoke all on public\.marketing_campaign_plan_versions[\s\S]*from anon, authenticated, service_role/)
  assert.doesNotMatch(migration, /planned_budget|currency_code|insert into public\.work_items|provider_connection/i)
})

test('atomic save enforces context, authority, approved-message sources and optimistic concurrency', () => {
  assert.match(migration, /member_kind = 'team' and status = 'active'/)
  assert.match(migration, /sc\.department_id = 'marketing' and sc\.is_active/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.doesNotMatch(migration, /limit 1 for update/)
  assert.match(migration, /v_latest\.id is distinct from p_expected_latest_version_id/)
  assert.match(migration, /artifact_type in \('campaign_messaging', 'scripts'\)/)
  assert.match(migration, /join public\.artifact_approvals approval/)
  assert.match(migration, /artifact_type = 'measurement_plan'/)
  assert.match(migration, /grant execute on function public\.save_marketing_campaign_plan_draft[\s\S]*to service_role/)
  assert.match(edge, /action === 'save_campaign_plan'/)
  assert.match(edge, /rpc\('save_marketing_campaign_plan_draft'/)
})

test('editor exposes honest draft state, exact preview, revision history and no execution controls', () => {
  assert.match(component, /Save unapproved version/)
  assert.match(component, /Exact saved source and version history/)
  assert.match(component, /lifecycle_status/)
  assert.match(component, /expected_latest_version_id/)
  assert.match(component, /activeKey\.current !== requestedKey/)
  assert.match(component, /Loading campaign plan/)
  assert.match(component, /A previously selected source is no longer readable or eligible/)
  assert.doesNotMatch(component, />Submit for review<|>Approve<|>Publish<|>Launch<|>Apply budget<|>Request content<|>Request design</)
})

test('actual Marketing Studio campaigns tab mounts the organization-scoped repository without replacing campaign budget editing', () => {
  assert.match(studio, /createMarketingCampaignPlanRepository\(activeOrganizationId, \{ signal: requestSignal \}\)/)
  assert.match(studio, /tab === 'campaigns'[\s\S]*<Campaigns[\s\S]*campaignPlans=\{campaignPlans\}/)
  assert.match(studio, /<MarketingCampaignPlan[\s\S]*organizationId=\{workspace\.engagement\.organization_id\}[\s\S]*repository=\{campaignPlans\}[\s\S]*canEdit=\{canEditPlan\}/)
  assert.match(studio, /planned_budget/)
  assert.match(studio, /currency_code/)
  assert.doesNotMatch(studio, /\['campaign-plan',/)
})

test('rollback verifier checks the exact schema, ACL, RLS, immutable and server-source contract', () => {
  for (const check of [
    'plan_versions_table_exists', 'creative_requirements_table_exists', 'plan_versions_rls_enabled',
    'creative_requirements_rls_enabled', 'authenticated_tables_read_only', 'plan_versions_immutable_trigger',
    'requirements_immutable_trigger', 'campaign_version_unique', 'draft_only_lifecycle',
    'save_rpc_exact_signature', 'save_rpc_security_invoker', 'save_rpc_empty_search_path',
    'save_rpc_not_client_callable', 'save_rpc_service_role_execute', 'save_rpc_active_team_check',
    'save_rpc_active_marketing_service_check', 'save_rpc_optimistic_concurrency',
    'save_rpc_no_update_acl_dependency',
    'save_rpc_exact_source_checks', 'save_rpc_scope_boundary', 'service_tables_narrow_write_acl',
    'foreign_key_indexes_present', 'requirements_redundant_composite_unique_absent',
    'engagement_event_type_registered',
    'owner_save_succeeds', 'marketing_member_save_succeeds',
    'other_department_rejected', 'other_organization_rejected', 'suspended_member_rejected',
    'disabled_marketing_service_rejected', 'unapproved_message_source_rejected',
    'wrong_measurement_type_rejected', 'foreign_engagement_source_rejected',
    'creative_message_source_rejected', 'stale_revision_rejected', 'sequential_versions_exact',
    'version_update_immutable', 'version_delete_immutable', 'requirement_update_immutable',
    'requirement_delete_immutable', 'owner_rls_reads_exact_organization',
    'other_org_rls_reads_nothing', 'authenticated_direct_write_rejected',
    'authenticated_rpc_execute_rejected', 'draft_save_has_no_approval_or_work_side_effect',
    'concurrent_save_guard_present',
  ]) assert.match(verifier, new RegExp(check))
  assert.match(concurrency, /MB04A_LOCAL_TEMPLATE_URL/)
  assert.match(concurrency, /concurrent save did not wait on the campaign advisory lock/)
  assert.match(concurrency, /assert\.equal\(stale\?\.code, '40001'\)/)
  assert.match(concurrency, /exact_stale_retry=true/)
  assert.match(concurrency, /version_number: 2, parent_version_id: firstVersion/)
  assert.match(verifier, /raise exception 'MB04A verification failed:/)
  assert.match(verifier, /select 'PASS' as mb04a_final_result/)
  assert.match(verifier, /rollback;/)
})
