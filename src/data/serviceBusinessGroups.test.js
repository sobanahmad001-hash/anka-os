import test from 'node:test'
import assert from 'node:assert/strict'
import {SERVICE_CATALOGUE} from './serviceCatalogue.js'
import {serviceBusinessCatalogue, SERVICE_BUSINESS_GROUP_MAPPINGS} from './serviceBusinessGroups.js'

test('business grouping retains canonical service identity, departmental context and scope defaults', () => {
  const original = JSON.stringify(SERVICE_CATALOGUE)
  const grouped = serviceBusinessCatalogue({leaves:SERVICE_CATALOGUE})
  assert.deepEqual(grouped.groups.map(g => g.id), ['branding','website','marketing'])
  assert.equal(grouped.unmapped.length, 0)
  assert.equal(new Set(grouped.groups.flatMap(g => g.services.map(s => s.id))).size, SERVICE_CATALOGUE.length)
  for (const group of grouped.groups) for (const row of group.services) assert.equal(row, SERVICE_CATALOGUE.find(s => s.id === row.id))
  assert.equal(JSON.stringify(SERVICE_CATALOGUE), original)
  const research = SERVICE_CATALOGUE.find(s => s.slug === 'setup_content_audience_research')
  assert.ok(grouped.groups.every(g => g.services.includes(research)))
})

test('unknown or custom services stay visible without guessed business scope or executable capability', () => {
  const custom = {...SERVICE_CATALOGUE[0], id:'custom-service', department_id:'development', name:'Paid campaign launch'}
  const grouped = serviceBusinessCatalogue({leaves:[custom]})
  assert.deepEqual(grouped.unmapped, [custom])
  assert.ok(grouped.groups.every(g => g.services.length === 0))
  assert.deepEqual(Object.keys(grouped), ['version','groups','unmapped'])
})

test('metadata disagreements and duplicate canonical identities fail before a reviewed choice is shown', () => {
  const leaf=SERVICE_CATALOGUE[0], expected=SERVICE_BUSINESS_GROUP_MAPPINGS.find(m => m.service_id===leaf.id)
  assert.doesNotThrow(() => serviceBusinessCatalogue({leaves:[{...leaf,business_group_version:1,business_groups:[...expected.groups]}]}))
  for (const fields of [{business_group_version:2,business_groups:expected.groups},{business_group_version:1,business_groups:['marketing']},{business_group_version:1},{business_groups:expected.groups}]) {
    assert.throws(() => serviceBusinessCatalogue({leaves:[{...leaf,...fields}]}), /mapping changed/)
  }
  assert.throws(() => serviceBusinessCatalogue({leaves:[leaf,leaf]}), /Distinct canonical/)
})

test('business group filtering uses only the supplied authorized snapshot, including empty catalogues', () => {
  const leaf=SERVICE_CATALOGUE.find(s => s.slug === 'setup_design_logo_design')
  const grouped=serviceBusinessCatalogue({leaves:[leaf]})
  assert.deepEqual(grouped.groups.find(g => g.id==='branding').services,[leaf])
  assert.ok(grouped.groups.filter(g => g.id!=='branding').every(g => g.services.length===0))
  assert.ok(serviceBusinessCatalogue({leaves:[]}).groups.every(g => g.services.length===0))
  assert.throws(() => serviceBusinessCatalogue({}), /Current project/)
})
