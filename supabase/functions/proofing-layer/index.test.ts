import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { exactTarget, hasResolveAuthority, normalizeCommentPosition } from './index.ts'

Deno.test('proofing requires exactly one immutable version target', () => {
  assertEquals(exactTarget({ artifact_version_id: 'artifact-version' }), {
    artifactVersionId: 'artifact-version', directionVersionId: null,
  })
  assertEquals(exactTarget({ design_direction_version_id: 'direction-version' }), {
    artifactVersionId: null, directionVersionId: 'direction-version',
  })
  assertThrows(() => exactTarget({}), Error, 'exactly one')
  assertThrows(() => exactTarget({ artifact_version_id: 'a', design_direction_version_id: 'd' }), Error, 'exactly one')
})

Deno.test('comment positions accept regions or normalized visual coordinates only', () => {
  assertEquals(normalizeCommentPosition(null), null)
  assertEquals(normalizeCommentPosition({ region: 'page:/services' }), { region: 'page:/services' })
  assertEquals(normalizeCommentPosition({ x: 0.123456, y: 0.75 }), { x: 0.1235, y: 0.75 })
  assertThrows(() => normalizeCommentPosition({ x: -1, y: 0.5 }), Error, 'normalized')
  assertThrows(() => normalizeCommentPosition({ region: 'hero', x: 0.2 }), Error, 'either')
})

Deno.test('resolution matches artifact approval authority without changing approval flow', () => {
  assertEquals(hasResolveAuthority({ role: 'contributor', department_id: 'content' }, 'marketing', true), true)
  assertEquals(hasResolveAuthority({ role: 'department_manager', department_id: 'content' }, 'content', false), true)
  assertEquals(hasResolveAuthority({ role: 'department_manager', department_id: 'content' }, 'marketing', false), false)
  assertEquals(hasResolveAuthority({ role: 'executive', department_id: null }, 'design', false), true)
  assertEquals(hasResolveAuthority({ role: 'contributor', department_id: 'design' }, 'design', false), false)
})
