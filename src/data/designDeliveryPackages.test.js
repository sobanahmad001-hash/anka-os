import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  activePackageDestinations, designPackageTargetKey, emptyDesignPackageDraft,
  designPackageDraftWork, isCurrentPackageResponse, packageReadState, validateDesignPackageDraft,
} from './designDeliveryPackages.js'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260912201144_design_b06a_review_delivery_packages.sql')
const edge = read('supabase/functions/design-workshop/packageDelivery.ts')
const ui = read('src/components/DesignDeliveryPackagePanel.jsx')

const context = {
  organizationId: 'org-1', engagementId: 'eng-1', brandId: 'brand-1', activeServiceId: 'design-service-1',
  workRecord: { kind: 'project_task', id: 'task-1' },
}

function complete(destination = 'website') {
  return {
    ...emptyDesignPackageDraft(), title: 'Launch package', destination_type: destination,
    placement_label: destination === 'website' ? 'Homepage hero' : 'Launch post',
    website_page_section: destination === 'website' ? 'Home / Hero' : '',
    social_platform: destination === 'social' ? 'LinkedIn company post' : '',
    width: destination === 'website' ? '1440' : '1080', height: destination === 'website' ? '900' : '1080',
    usage_instructions: 'Use this exact version without cropping.', selected_version_ids: ['version-1'],
  }
}

test('B06a validates bounded website and social package metadata', () => {
  assert.equal(validateDesignPackageDraft(complete('website'), context).valid, true)
  assert.equal(validateDesignPackageDraft(complete('social'), context).valid, true)
  assert.deepEqual(validateDesignPackageDraft({ ...complete(), website_page_section: '' }, context).missing, ['website page or section'])
  assert.equal(validateDesignPackageDraft(complete(), { ...context, workRecord: null }).missing.includes('existing typed work destination'), true)
})

test('B06a exact target key invalidates preview on context, placement, asset, and latest-version changes', () => {
  const draft = complete()
  const base = designPackageTargetKey(context, draft, 'package-v1')
  assert.notEqual(base, designPackageTargetKey({ ...context, engagementId: 'eng-2' }, draft, 'package-v1'))
  assert.notEqual(base, designPackageTargetKey(context, { ...draft, placement_label: 'Footer' }, 'package-v1'))
  assert.notEqual(base, designPackageTargetKey(context, { ...draft, selected_version_ids: ['version-2'] }, 'package-v1'))
  assert.notEqual(base, designPackageTargetKey(context, draft, 'package-v2'))
  assert.equal(isCurrentPackageResponse(3, 3, base, base), true)
  assert.equal(isCurrentPackageResponse(2, 3, base, base), false)
  assert.equal(isCurrentPackageResponse(3, 3, base, `${base}:changed`), false)
})

test('B06a reopened drafts retain immutable stored work until explicitly relinked', () => {
  const retained = { ...complete(), source_work_kind: 'project_task', source_work_id: 'task-original' }
  assert.deepEqual(designPackageDraftWork(retained, context), {
    kind: 'project_task', id: 'task-original', retained: true,
  })
  assert.notEqual(designPackageTargetKey(context, retained, 'package-v1'),
    designPackageTargetKey(context, { ...retained, source_work_id: 'task-1' }, 'package-v1'))
})

test('B06a destination list exposes only current active Content, Marketing, or Development contracts', () => {
  const services = [
    { id: 'content-1', status: 'active', service_catalog: { name: 'Copy', department_id: 'content', is_active: true } },
    { id: 'design-1', status: 'active', service_catalog: { name: 'Design', department_id: 'design', is_active: true } },
    { id: 'marketing-1', status: 'planned', service_catalog: { name: 'Social', department_id: 'marketing', is_active: true } },
    { id: 'dev-1', status: 'active', service_catalog: { name: 'Build', department_id: 'development', is_active: false } },
  ]
  assert.deepEqual(activePackageDestinations(services).map(item => item.id), ['content-1'])
})

test('B06a distinguishes loading, empty, denied, and error read states', () => {
  assert.equal(packageReadState({ loading: true }), 'loading')
  assert.equal(packageReadState({ denied: true }), 'denied')
  assert.equal(packageReadState({ error: new Error('offline') }), 'error')
  assert.equal(packageReadState({ rows: [] }), 'empty')
  assert.equal(packageReadState({ rows: [{}] }), 'ready')
})

test('B06a keeps one artifact version truth and narrow exact-reference/work links', () => {
  assert.match(migration, /'design_delivery_package'/)
  assert.match(migration, /references public\.artifact_versions\(artifact_id, id, organization_id\)/)
  assert.match(migration, /references public\.design_asset_versions\(asset_id, id, organization_id\)/)
  assert.match(migration, /project_task_id[\s\S]*engagement_work_item_id/)
  assert.match(migration, /for key share of asset/)
  assert.match(migration, /trg_design_assets_package_reference_archive_guard/)
  assert.match(migration, /trg_design_delivery_package_version_insert/)
  assert.match(migration, /trg_design_delivery_package_version_complete/)
  assert.match(migration, /exact-version references are sealed/)
  assert.doesNotMatch(migration, /create table public\.design_delivery_packages\b|create table public\.design_delivery_package_versions\b/)
  assert.doesNotMatch(migration, /delete\s+from\s+(?:storage\.)?objects/i)
})

test('B06a preview checks private objects and UI remains explicitly unapproved', () => {
  assert.match(edge, /createSignedUrls\(paths, 300\)/)
  assert.match(edge, /saveDeliveryPackage[\s\S]*await temporaryPreviews\(admin, versions\)/)
  assert.match(edge, /from\('tasks'\)[\s\S]*archived_at/)
  assert.match(edge, /from\('work_items'\)[\s\S]*deleted_at/)
  assert.match(edge, /planning_blocked/)
  assert.match(ui, /Save unapproved version/)
  assert.match(ui, /Preview package/)
  assert.match(ui, /requestSequence/)
  assert.match(ui, /setOperationKey\(''\); setBusy\(''\)/)
  assert.match(ui, /storedContext\?\.project_task_id/)
  assert.match(ui, /Relink draft to current work/)
  assert.match(ui, /No approval, release, publication, or delivery occurred/)
  assert.doesNotMatch(ui, /ArtifactApprovalPanel|VersionProofingPanel/)
})
