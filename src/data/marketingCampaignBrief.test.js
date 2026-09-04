import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { selectedCampaignBriefSuggestions, validateCampaignBriefDraft } from './marketingStudio.js'

const approvalEdge = readFileSync(new URL('../../supabase/functions/artifact-approvals/index.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/20260904090000_mb02_marketing_campaign_briefs.sql', import.meta.url), 'utf8')

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
