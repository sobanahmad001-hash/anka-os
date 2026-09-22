import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')

// Installed schema: public.profiles has id/full_name but no email. The route
// must not fetch auth.users email just to render an owner label.
test('all team-profile projections use columns present in the installed schema', () => {
  const repositories = [
    'clientWorkDirectoryRepository.js', 'clientWorkspaceRepository.js',
    'contentStudioRepository.js', 'deliveryRepository.js',
    'internalWorkspaceRepository.js', 'marketingCalendarRepository.js',
    'marketingOverviewRepository.js', 'operatingSpineRepository.js',
    'portfolioWorkspaceRepository.js', 'projectEngagementWorkspaceRepository.js',
    'proofingRepository.js', 'quickTasksRepository.js',
    'workItemExperienceRepository.js',
  ]
  for (const name of repositories) {
    const text = source(name)
    assert.match(text, /from\('profiles'\)/, name)
    assert.doesNotMatch(text, /from\('profiles'\)\s*\.select\('[^']*\bemail\b/, name)
  }
})

// Installed schema has two tasks→projects FKs, two work_items→engagements
// FKs, no direct work_items→projects FK, and multiple deliverable-version
// paths. Each affected route must choose the intended relationship.
test('My Work and adjacent queues use installed relationship identities', () => {
  const text = source('deliveryRepository.js')
  assert.match(text, /projects!tasks_project_organization_fkey\(id, name\)/)
  assert.match(text, /engagements!work_items_engagement_project_organization_fkey\(id, name, projects!engagements_project_organization_fkey\(id, name\)\)/)
  assert.match(text, /deliverable_versions!deliverable_versions_deliverable_id_fkey\(id, organization_id/)
  assert.match(text, /deliverables!deliverable_versions_deliverable_id_fkey\(id, title, deliverable_type, owner_id\)/)
  assert.match(source('contentStudioRepository.js'), /engagements!artifacts_engagement_project_organization_fkey!inner/)
  assert.match(source('designSystemsRepository.js'), /engagements!artifacts_engagement_project_organization_fkey\(name, status\)/)
  assert.doesNotMatch(text, /from\('work_items'\)\s*\.select\('[^']*\bprojects\(id, name\), engagements\(/)
})
