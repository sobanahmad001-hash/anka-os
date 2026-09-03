import assert from 'node:assert/strict'
import test from 'node:test'

import { selectedCampaignBriefSuggestions, validateCampaignBriefDraft } from './marketingStudio.js'

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
