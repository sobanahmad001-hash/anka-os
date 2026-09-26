import test from 'node:test'
import assert from 'node:assert/strict'
import { restrictArtifactTypes } from './departmentChatArtifactTypes.js'
test('opt-in artifact types intersect profile authority and preserve default identity', () => {
  const profile = ['a', 'b']
  assert.equal(restrictArtifactTypes(profile), profile)
  assert.deepEqual(restrictArtifactTypes(profile, ['b', 'foreign', 'b']), ['b'])
  assert.deepEqual(restrictArtifactTypes(profile, []), [])
  assert.deepEqual(restrictArtifactTypes(profile, 'a'), [])
})
