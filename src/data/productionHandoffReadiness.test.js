import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  productionHandoffContextKey,
  productionHandoffPackageEvidence,
  productionHandoffReadiness,
} from './productionHandoffReadiness.js'

const release = { id: 'release-1', direction_version_id: 'version-2' }
const version = { id: 'version-2', version_number: 2, content_checksum: 'checksum-2' }
const image = {
  id: 'asset-image', design_direction_version_id: 'version-2', content_request_id: null,
  media_type: 'image', status: 'ready', storage_path: 'org/version-2/image.png',
}
const video = {
  id: 'asset-video', design_direction_version_id: 'version-2', content_request_id: null,
  media_type: 'video', status: 'unavailable', storage_path: null,
}
const variant = {
  id: 'variant-1', source_direction_version_id: 'version-2', variant_format: 'square_1x1',
  status: 'ready', design_media_asset_id: 'asset-image',
}

test('handoff readiness pins the loaded exact released version and canonical source rows', () => {
  const result = productionHandoffReadiness({
    release, directionVersions: [version, { id: 'version-1' }],
    mediaAssets: [image, video, { ...image, id: 'other', design_direction_version_id: 'version-1' }],
    variants: [variant],
  })
  assert.equal(result.ready, true)
  assert.equal(result.version.id, 'version-2')
  assert.deepEqual(result.assets.map(item => item.id), ['asset-image', 'asset-video'])
  assert.deepEqual(result.variants.map(item => item.id), ['variant-1'])
})

test('missing exact version and unavailable source objects fail closed without substituting versions', () => {
  const missingVersion = productionHandoffReadiness({
    release, directionVersions: [{ id: 'version-1' }], mediaAssets: [], variants: [],
  })
  assert.equal(missingVersion.ready, false)
  assert.match(missingVersion.blockers.join(' '), /exact released direction version/)

  const missingObject = productionHandoffReadiness({
    release, directionVersions: [version], mediaAssets: [{ ...image, storage_path: null }], variants: [],
  })
  assert.equal(missingObject.ready, false)
  assert.match(missingObject.blockers.join(' '), /stored source object asset-i/)
})

test('revoked or incomplete variant access blocks preparation on the exact release', () => {
  const result = productionHandoffReadiness({
    release, directionVersions: [version], mediaAssets: [image],
    variants: [{ ...variant, status: 'failed' }, { ...variant, id: 'variant-2', design_media_asset_id: 'revoked-asset' }],
  })
  assert.equal(result.ready, false)
  assert.match(result.blockers.join(' '), /ready variant square_1x1/)
  assert.match(result.blockers.join(' '), /variant source asset revoked-/)
})

test('ready archives remain downloadable when a current source row is no longer visible', () => {
  const result = productionHandoffPackageEvidence({
    id: 'package-1', status: 'ready', included_asset_ids: ['asset-image', 'no-longer-visible'],
  }, [image])
  assert.equal(result.canDownload, true)
  assert.deepEqual(result.visible.map(item => item.id), ['asset-image'])
  assert.deepEqual(result.unavailableIds, ['no-longer-visible'])
})

test('release context key invalidates local recovery state on exact target change', () => {
  assert.equal(productionHandoffContextKey(release), 'release-1:version-2')
  assert.notEqual(
    productionHandoffContextKey(release),
    productionHandoffContextKey({ id: 'release-2', direction_version_id: 'version-3' }),
  )
})

test('handoff UI retains native keyboard controls, adjacent errors, and read-only recovery', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const root = path.resolve(here, '../..')
  const panel = fs.readFileSync(path.join(root, 'src/components/ProductionHandoffPanel.jsx'), 'utf8')
  const workshop = fs.readFileSync(path.join(root, 'src/apps/DesignWorkshop.jsx'), 'utf8')
  assert.match(panel, /aria-expanded=\{detailsOpen\}/)
  assert.match(panel, /role="alert"/)
  assert.match(panel, /aria-live="polite"/)
  assert.match(panel, /Refresh exact handoff status/)
  assert.match(panel, /No package was rebuilt/)
  assert.match(workshop, /key=\{productionHandoffContextKey\(release\)\}/)
  assert.match(workshop, /handoffUncertainTarget === productionHandoffContextKey\(release\)/)
  assert.match(panel, /window\.setTimeout\(\(\) => setClock\(Date\.now\(\)\), delay \+ 25\)/)
  assert.match(panel, /event\.preventDefault\(\)[\s\S]*Refresh exact handoff status before opening/)
})
