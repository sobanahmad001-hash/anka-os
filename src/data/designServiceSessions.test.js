import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const migration = read('supabase/migrations/20260831162128_ds1_service_aware_sessions.sql')
const verifier = read('supabase/verify_20260831162128_ds1_service_aware_sessions.sql')
const edge = read('supabase/functions/design-workshop/index.ts')
const edgeTest = read('supabase/functions/design-workshop/index.test.ts')
const repository = read('src/data/designWorkshopRepository.js')
const ui = read('src/apps/DesignWorkshop.jsx')

test('DS1 adds only the nullable organization-safe service link and bounded direction slots', () => {
  assert.match(migration, /alter table public\.design_workshop_sessions[\s\S]*add column engagement_service_id uuid/)
  assert.match(migration, /foreign key \(engagement_service_id, organization_id\)[\s\S]*references public\.engagement_services\(id, organization_id\) on delete restrict/)
  assert.match(migration, /idx_design_workshop_sessions_engagement_service/)
  assert.match(migration, /drop constraint design_directions_direction_slot_check/)
  assert.match(migration, /check \(direction_slot between 1 and 12\)/)
  assert.doesNotMatch(migration, /engagement_service_id uuid not null|update public\.design_workshop_sessions[\s\S]*engagement_service_id/)
  assert.doesNotMatch(migration, /drop column output_family|alter column output_family/)
  assert.deepEqual([...migration.matchAll(/alter table public\.([a-z_]+)/g)].map(match => match[1]).sort(),
    ['design_directions', 'design_directions', 'design_workshop_sessions', 'design_workshop_sessions'].sort())
})

test('session creation accepts only an active Design service from the same engagement', () => {
  assert.match(edge, /requireActiveDesignService\(admin, engagementId, engagementServiceId\)/)
  assert.match(edge, /from\('engagement_services'\)[\s\S]*eq\('engagement_id', engagementId\)[\s\S]*eq\('status', 'active'\)/)
  assert.match(edge, /eq\('service_catalog\.department_id', 'design'\)[\s\S]*eq\('service_catalog\.is_active', true\)/)
  assert.match(edge, /engagement_service_id: engagementServiceId[\s\S]*output_family: outputFamily/)
  assert.match(edgeTest, /rejects inactive service[\s\S]*status: 'planned'[\s\S]*Expected inactive engagement service to be rejected/)
  assert.match(edgeTest, /combines active service enforcement with optional event linking[\s\S]*brand_visual_identity[\s\S]*campaign_creative/)
  assert.match(edge, /requireActiveDesignService\(admin, engagementId, engagementServiceId\)[\s\S]*engagement_service_id: engagementServiceId[\s\S]*designEventLink\(session\.id, externalEventId, actorId\)/)
})

test('all eight seeded Design services retain the current three-direction flow', () => {
  for (const slug of [
    'brand_visual_identity', 'design_systems', 'website_ux_ui', 'campaign_creative',
    'social_assets', 'advertising_assets', 'video_concepts_storyboards', 'visual_production',
  ]) assert.match(edge, new RegExp(`\\['${slug}',`))
  assert.match(edge, /for \(let index = 0; index < LANES\.length; index \+= 1\)/)
  assert.match(edge, /direction_slot: index \+ 1/)
  assert.match(ui, /Generate three directions/)
  // DS1 keeps the three-direction flow for every Design service. Later phases may
  // add downstream workflows, but must not replace that shared generation path.
  assert.doesNotMatch(edge, /storyboard sequence|design system library|production handoff/i)
})

test('the UI and repository expose active engagement services instead of an output-family picker', () => {
  assert.match(repository, /engagement_services!inner\(id, status, service_catalog!inner\(name, department_id, is_active\)\)/)
  assert.match(repository, /service_catalog!inner\(id, name, slug, department_id, is_active\)/)
  assert.match(repository, /eq\('service_catalog\.department_id', 'design'\)/)
  assert.match(ui, /Active Design service/)
  assert.match(ui, /engagement_service_id: serviceId/)
  assert.match(ui, /external_event_id: externalEventId \|\| null/)
  assert.match(repository, /designServices, sessions, externalEvents/)
  assert.doesNotMatch(ui, /Field label="Output family"/)
})

test('rollback verification covers schema, RLS continuity, active link, and both slot bounds', () => {
  for (const check of [
    'engagement_service_id_nullable', 'service_fk_is_organization_safe', 'service_fk_index_exists',
    'direction_slot_remains_bounded_to_12', 'output_family_remains_present', 'existing_rls_policies_remain',
    'active_service_session_persists_link', 'direction_slots_1_through_12_allowed', 'direction_slot_13_rejected',
  ]) assert.match(verifier, new RegExp(`'${check}'`))
  assert.match(verifier, /rollback;/)
})
