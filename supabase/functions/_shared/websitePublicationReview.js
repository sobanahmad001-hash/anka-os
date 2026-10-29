// Read-only review contract. Server-resolved inputs only; this grants no authority
// and performs no WordPress operation. Execution needs a separate exact-target approval.
import {uuid, stagingOrigin} from './websiteStagingContracts.js'
import {websiteNativeSnapshotChecksum} from './websiteNativeDesign.js'

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw Error('Exact publication review fields required')
}
function scope(value) {
  exact(value, ['organization_id', 'project_id', 'engagement_id'])
  if (!Object.values(value).every(uuid)) throw Error('Exact publication scope required')
}
function target(value, inspection) {
  exact(value, ['target_id', 'connection_id', 'site_id', 'origin', 'environment', 'connection_revision'])
  validatePublicationInventory(inspection)
  exact(inspection, ['site_id', 'origin', 'environment', 'head', 'inventory_sha256', 'theme_sha256', 'complete', 'posts'])
  if (![value.target_id, value.connection_id, value.site_id].every(uuid) || value.environment !== 'production' || inspection.environment !== 'production' || stagingOrigin(value.origin) !== value.origin || value.origin !== inspection.origin || value.site_id !== inspection.site_id || !Number.isFinite(Date.parse(value.connection_revision)) || (inspection.head !== null && !uuid(inspection.head)) || !hash(inspection.inventory_sha256) || !hash(inspection.theme_sha256) || inspection.complete !== true) throw Error('Exact inspected production target and complete inventory required')
  if (!Array.isArray(inspection.posts) || inspection.posts.length > 5000) throw Error('Bounded complete WordPress post inventory required')
}

export function validatePublicationInventory(inspection) {
  exact(inspection, ['site_id', 'origin', 'environment', 'head', 'inventory_sha256', 'theme_sha256', 'complete', 'posts'])
  if (!uuid(inspection.site_id) || stagingOrigin(inspection.origin) !== inspection.origin || inspection.environment !== 'production' || (inspection.head !== null && !uuid(inspection.head)) || !hash(inspection.inventory_sha256) || !hash(inspection.theme_sha256) || inspection.complete !== true || !Array.isArray(inspection.posts) || inspection.posts.length > 5000) throw Error('Complete exact production inventory required')
  const ids = new Set(), paths = new Set(), pages = new Set()
  for (const post of inspection.posts) {
    exact(post, ['post_id', 'revision', 'path', 'sha256', 'managed_page_id', 'post_type', 'post_status'])
    pagePath(post.path)
    if (typeof post.post_type !== 'string' || !/^[a-z0-9_-]{1,20}$/.test(post.post_type) || !['publish', 'future', 'draft', 'pending', 'private', 'inherit'].includes(post.post_status)) throw Error('Explicit inspected WordPress post type and status required')
    if (!Number.isSafeInteger(post.post_id) || post.post_id <= 0 || !Number.isSafeInteger(post.revision) || post.revision <= 0 || !hash(post.sha256) || (post.managed_page_id !== null && !uuid(post.managed_page_id)) || ids.has(post.post_id) || paths.has(post.path)) throw Error('Exact distinct WordPress post inventory required')
    ids.add(post.post_id); paths.add(post.path)
    if (post.managed_page_id !== null) {
      if (pages.has(post.managed_page_id)) throw Error('Registered page maps to multiple WordPress posts')
      pages.add(post.managed_page_id)
    }
  }
  return structuredClone(inspection)
}
function pagePath(value) {
  if (typeof value !== 'string' || value.length > 240 || (value !== '/' && value.endsWith('/')) || !/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]*$/.test(value)) throw Error('Exact local publication page path required')
}

export async function reviewWebsitePublication(input) {
  exact(input, ['scope', 'target', 'inspection', 'site_version_id', 'pages', 'theme_change'])
  scope(input.scope); target(input.target, input.inspection)
  if (!uuid(input.site_version_id) || !Array.isArray(input.pages) || input.pages.length < 1 || input.pages.length > 100) throw Error('Bounded exact page selection required')
  exact(input.theme_change, ['mode', 'expected_sha256', 'reviewed_sha256', 'sitewide_impact_acknowledged', 'affected_posts'])
  if (!['retain', 'replace'].includes(input.theme_change.mode) || typeof input.theme_change.sitewide_impact_acknowledged !== 'boolean' || input.theme_change.expected_sha256 !== input.inspection.theme_sha256 || !hash(input.theme_change.reviewed_sha256) || (input.theme_change.mode === 'retain' && input.theme_change.reviewed_sha256 !== input.inspection.theme_sha256) || (input.theme_change.mode === 'replace' && input.theme_change.sitewide_impact_acknowledged !== true)) throw Error('Explicit exact theme impact review required')
  if (!Array.isArray(input.theme_change.affected_posts)) throw Error('Explicit complete theme impact manifest required')
  const affected = input.theme_change.affected_posts
  if (input.theme_change.mode === 'retain') {
    if (affected.length !== 0) throw Error('Retained theme cannot include a replacement impact manifest')
  } else {
    if (affected.length !== input.inspection.posts.length) throw Error('Theme replacement impacts every existing WordPress post')
    const seen = new Set()
    for (const post of affected) {
      exact(post, ['post_id', 'revision', 'sha256'])
      const current = input.inspection.posts.find(row => row.post_id === post.post_id)
      if (!current || seen.has(post.post_id) || post.revision !== current.revision || post.sha256 !== current.sha256) throw Error('Theme impact manifest must match the complete inspected inventory')
      seen.add(post.post_id)
    }
  }
  const pageIds = new Set(), pageKeys = new Set(), paths = new Set(), posts = new Set()
  for (const page of input.pages) {
    exact(page, ['page_id', 'page_key', 'path', 'job_id', 'package_sha256', 'source_review_sha256', 'site_version_id', 'qa', 'release_approval', 'operation', 'post_id', 'expected_post_revision', 'expected_post_sha256'])
    if (![page.page_id, page.job_id].every(uuid) || typeof page.page_key !== 'string' || page.page_key.length < 1 || page.page_key.length > 1208 || /[\u0000-\u001f\u007f]/.test(page.page_key) || !hash(page.package_sha256) || !hash(page.source_review_sha256) || page.site_version_id !== input.site_version_id) throw Error('Exact page package and shared site version required')
    pagePath(page.path)
    if (/^\/(?:wp-admin|wp-json|wp-content|wp-includes)(?:\/|$)/.test(page.path)) throw Error('WordPress system routes cannot be publication destinations')
    if (pageIds.has(page.page_id) || pageKeys.has(page.page_key) || paths.has(page.path)) throw Error('Duplicate registered page or destination path')
    pageIds.add(page.page_id); pageKeys.add(page.page_key); paths.add(page.path)
    exact(page.qa, ['receipt_id', 'artifact_version_id', 'run_id', 'page_id', 'package_sha256', 'current'])
    if (![page.qa.receipt_id, page.qa.artifact_version_id, page.qa.run_id].every(uuid) || page.qa.page_id !== page.page_id || page.qa.package_sha256 !== page.package_sha256 || page.qa.current !== true) throw Error('Current exact saved QA acceptance required')
    exact(page.release_approval, ['id', 'artifact_version_id', 'decision', 'current'])
    if (!uuid(page.release_approval.id) || page.release_approval.artifact_version_id !== page.qa.artifact_version_id || page.release_approval.decision !== 'approved' || page.release_approval.current !== true) throw Error('Existing exact deliverable approval required')
    if (page.operation === 'create') {
      if (page.path === '/') throw Error('New front-page creation needs separate site-settings review; choose an inspected existing front page')
      if (page.post_id !== null || page.expected_post_revision !== null || page.expected_post_sha256 !== null || input.inspection.posts.some(post => post.path === page.path || post.managed_page_id === page.page_id)) throw Error('New pages cannot overwrite or duplicate an existing WordPress post')
    } else if (page.operation === 'replace') {
      if (!Number.isSafeInteger(page.post_id) || page.post_id <= 0 || !Number.isSafeInteger(page.expected_post_revision) || page.expected_post_revision <= 0 || !hash(page.expected_post_sha256) || posts.has(page.post_id)) throw Error('Exact distinct WordPress post revision and checksum required')
      const existing = input.inspection.posts.find(post => post.post_id === page.post_id)
      if (!existing || existing.post_type !== 'page' || existing.path !== page.path || existing.revision !== page.expected_post_revision || existing.sha256 !== page.expected_post_sha256 || (existing.managed_page_id !== null && existing.managed_page_id !== page.page_id)) throw Error('Inspected WordPress post no longer matches the exact replacement')
      posts.add(page.post_id)
    } else throw Error('Explicit create or replace decision required')
  }
  const snapshot = structuredClone(input)
  return {protocol: 'anka-publication-review-v1', kind: 'publication', snapshot, review_sha256: await websiteNativeSnapshotChecksum(snapshot), requires_live_target_approval: true, executable: false, published: false}
}

export async function reviewWebsiteRollback(input) {
  exact(input, ['scope', 'target', 'inspection', 'retained', 'theme_change'])
  scope(input.scope); target(input.target, input.inspection)
  exact(input.retained, ['publication_id', 'scope', 'target_id', 'site_id', 'origin', 'published_head', 'published_theme_sha256', 'backup_snapshot_sha256', 'posts'])
  scope(input.retained.scope)
  if (Object.keys(input.scope).some(key => input.scope[key] !== input.retained.scope[key]) || input.retained.target_id !== input.target.target_id || input.retained.site_id !== input.target.site_id || input.retained.origin !== input.target.origin || !uuid(input.retained.publication_id) || !uuid(input.retained.published_head) || input.inspection.head !== input.retained.published_head || input.retained.published_theme_sha256 !== input.inspection.theme_sha256 || !hash(input.retained.backup_snapshot_sha256) || !Array.isArray(input.retained.posts) || input.retained.posts.length < 1 || input.retained.posts.length > 100) throw Error('Exact retained publication and unchanged current head required for rollback review')
  const pages = new Set(), posts = new Set()
  for (const post of input.retained.posts) {
    exact(post, ['page_id', 'post_id', 'revision', 'sha256', 'operation'])
    const current = input.inspection.posts.find(row => row.post_id === post.post_id)
    if (!['create', 'replace'].includes(post.operation) || !uuid(post.page_id) || !current || current.managed_page_id !== post.page_id || current.revision !== post.revision || current.sha256 !== post.sha256 || pages.has(post.page_id) || posts.has(post.post_id)) throw Error('A live page changed after publication; rollback needs a new review')
    pages.add(post.page_id); posts.add(post.post_id)
  }
  exact(input.theme_change, ['mode', 'expected_sha256', 'reviewed_sha256', 'sitewide_impact_acknowledged', 'affected_posts'])
  const change = input.theme_change
  if (change.mode !== 'restore' || change.expected_sha256 !== input.inspection.theme_sha256 || !hash(change.reviewed_sha256) || change.sitewide_impact_acknowledged !== true || !Array.isArray(change.affected_posts) || change.affected_posts.length !== input.inspection.posts.length) throw Error('Explicit complete rollback theme impact required')
  const affected = new Set()
  for (const post of change.affected_posts) {
    exact(post, ['post_id', 'revision', 'sha256']); const current = input.inspection.posts.find(row => row.post_id === post.post_id)
    if (!current || affected.has(post.post_id) || current.revision !== post.revision || current.sha256 !== post.sha256) throw Error('Rollback theme impact differs from current complete inventory')
    affected.add(post.post_id)
  }
  const snapshot = structuredClone(input)
  return {protocol: 'anka-publication-review-v1', kind: 'rollback', snapshot, review_sha256: await websiteNativeSnapshotChecksum(snapshot), requires_live_target_approval: true, executable: false, published: false}
}
