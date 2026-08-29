import { assertEquals } from 'jsr:@std/assert@1.0.14'
import { hasDevelopmentAuthority } from './index.ts'

Deno.test('Development writes stay inside Development and leadership roles', () => {
  assertEquals(hasDevelopmentAuthority({ role: 'contributor', department_id: 'development' }), true)
  assertEquals(hasDevelopmentAuthority({ role: 'department_manager', department_id: 'development' }), true)
  assertEquals(hasDevelopmentAuthority({ role: 'executive', department_id: null }), true)
  assertEquals(hasDevelopmentAuthority({ role: 'contributor', department_id: 'content' }), false)
})
