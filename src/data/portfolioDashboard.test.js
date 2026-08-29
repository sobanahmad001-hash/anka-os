import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildPortfolioDashboard,
  filterAndSortPortfolioRows,
} from './portfolioDashboard.js'

const repository = readFileSync(new URL('./operatingSpineRepository.js', import.meta.url), 'utf8')
const portfolioRepository = repository.slice(repository.indexOf('async getPortfolioSnapshot()'), repository.indexOf('async getEngagement('))
const component = readFileSync(new URL('../components/PortfolioDashboard.jsx', import.meta.url), 'utf8')
const operatingSpine = readFileSync(new URL('../apps/OperatingSpine.jsx', import.meta.url), 'utf8')
const verification = readFileSync(new URL('../../supabase/verify_w7_portfolio_dashboard.sql', import.meta.url), 'utf8')
const w5Migration = readFileSync(new URL('../../supabase/migrations/20260829092519_automation_rules.sql', import.meta.url), 'utf8')
const migrationNames = readdirSync(new URL('../../supabase/migrations/', import.meta.url))

test('W7 computes the three fixed risks and live summary from canonical rows', () => {
  const engagements = [
    { id: 'due', organization_id: 'org-a', name: 'Due soon', status: 'active', target_date: '2026-09-05' },
    { id: 'later', organization_id: 'org-a', name: 'Later', status: 'planning', target_date: '2026-09-20' },
    { id: 'complete', organization_id: 'org-a', name: 'Complete', status: 'completed', target_date: '2026-09-01' },
  ]
  const dashboard = buildPortfolioDashboard({
    engagements,
    workItems: [
      { id: 'open', organization_id: 'org-a', engagement_id: 'due', status: 'in_progress', automation_flagged_at: '2026-08-29T00:00:00Z' },
      { id: 'blocked', organization_id: 'org-a', engagement_id: 'due', status: 'blocked', automation_flagged_at: null },
      { id: 'done', organization_id: 'org-a', engagement_id: 'due', status: 'done', automation_flagged_at: null },
    ],
    stages: [
      { id: 'blocked-stage', organization_id: 'org-a', engagement_id: 'due', status: 'blocked' },
      { id: 'complete-stage', organization_id: 'org-a', engagement_id: 'due', status: 'completed' },
    ],
  }, new Date('2026-08-29T00:00:00Z'))

  const due = dashboard.rows.find(row => row.id === 'due')
  assert.deepEqual({ open: due.openWorkItems, blocked: due.blockedWorkItems, incomplete: due.incompleteStages }, { open: 2, blocked: 1, incomplete: 1 })
  assert.deepEqual(due.risks, { targetDate: true, automation: true, blockedStage: true })
  assert.equal(dashboard.rows.find(row => row.id === 'later').risks.targetDate, false)
  assert.equal(dashboard.rows.find(row => row.id === 'complete').risks.targetDate, false)
  assert.deepEqual(dashboard.summary, { activeEngagements: 1, blockedStages: 1, flaggedAutomationItems: 1 })
})

test('W7 rollup ignores child rows outside the visible engagement organisation boundary', () => {
  const dashboard = buildPortfolioDashboard({
    engagements: [{ id: 'visible', organization_id: 'org-a', name: 'Visible', status: 'active' }],
    workItems: [
      { id: 'valid', organization_id: 'org-a', engagement_id: 'visible', status: 'blocked', automation_flagged_at: null },
      { id: 'forged', organization_id: 'org-b', engagement_id: 'visible', status: 'blocked', automation_flagged_at: '2026-08-29T00:00:00Z' },
    ],
    stages: [
      { id: 'valid-stage', organization_id: 'org-a', engagement_id: 'visible', status: 'ready' },
      { id: 'forged-stage', organization_id: 'org-b', engagement_id: 'visible', status: 'blocked' },
    ],
  })
  assert.equal(dashboard.rows.length, 1)
  assert.equal(dashboard.rows[0].blockedWorkItems, 1)
  assert.equal(dashboard.rows[0].flaggedAutomationItems, 0)
  assert.equal(dashboard.rows[0].blockedStages, 0)
})

test('W7 filters status, target date, and lead owner while defaulting to soonest target', () => {
  const rows = [
    { id: 'later', name: 'Later', status: 'active', lead_owner_id: 'b', target_date: '2026-09-20' },
    { id: 'soon', name: 'Soon', status: 'planning', lead_owner_id: 'a', target_date: '2026-09-02' },
    { id: 'none', name: 'None', status: 'active', lead_owner_id: null, target_date: null },
  ]
  assert.deepEqual(filterAndSortPortfolioRows(rows, {}, {}, new Date('2026-08-29T00:00:00Z')).map(row => row.id), ['soon', 'later', 'none'])
  assert.deepEqual(filterAndSortPortfolioRows(rows, { status: 'active' }).map(row => row.id), ['later', 'none'])
  assert.deepEqual(filterAndSortPortfolioRows(rows, { leadOwner: 'a' }).map(row => row.id), ['soon'])
  assert.deepEqual(filterAndSortPortfolioRows(rows, { target: 'next_7_days' }, {}, new Date('2026-08-29T00:00:00Z')).map(row => row.id), ['soon'])
})

test('W7 batch-loads three RLS-protected tables and reuses existing engagement detail navigation', () => {
  assert.match(repository, /async getPortfolioSnapshot\(\)/)
  for (const table of ['engagements', 'work_items', 'engagement_stage_instances']) assert.match(repository, new RegExp(`client\\.from\\('${table}'\\)`))
  assert.match(repository, /Promise\.all/)
  assert.match(repository, /automation_flagged_at/)
  assert.match(repository, /\.is\('deleted_at', null\)/)
  assert.match(operatingSpine, /<PortfolioDashboard[\s\S]*onOpen=\{openEngagement\}/)
  assert.match(component, /onOpen\(row\.id\)/)
  assert.doesNotMatch(component, /new engagement detail|create engagement detail/i)
})

test('W7 repeats cross-organisation isolation under authenticated RLS and remains read-only', () => {
  for (const check of [
    'organization_a_engagement_visible', 'organization_b_engagement_hidden',
    'organization_a_work_visible', 'organization_b_work_hidden',
    'organization_a_stage_visible', 'organization_b_stage_hidden',
    'new_artifact_version_has_only_its_own_field_values',
  ]) assert.match(verification, new RegExp(check))
  assert.match(verification, /artifact_version_two_id[\s\S]*field_value' = 'new-only-value'/)
  assert.match(verification, /version\.content::text not like '%old-only-value%'/)
  assert.match(verification, /set local role authenticated/)
  assert.match(verification, /request\.jwt\.claims/)
  assert.match(verification, /rollback;/)
  assert.doesNotMatch(`${portfolioRepository}\n${component}`, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/i)
  assert.equal(migrationNames.some(name => /portfolio|dashboard/i.test(name)), false)
})

test('W7 uses W5 automation_flagged_at as the sole unacknowledged definition and stores no rollup', () => {
  const model = readFileSync(new URL('./portfolioDashboard.js', import.meta.url), 'utf8')
  assert.match(w5Migration, /automation_flagged_at/)
  assert.match(w5Migration, /set automation_flagged_at = null/)
  assert.match(repository, /automation_flagged_at/)
  assert.match(model, /Boolean\(item\.automation_flagged_at\)/)
  assert.doesNotMatch(`${portfolioRepository}\n${model}`, /localStorage|sessionStorage|materialized|rollup_count/i)
  assert.match(component, /Live read · no cached metrics/)
})
