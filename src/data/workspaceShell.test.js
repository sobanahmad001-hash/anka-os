import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const header = readFileSync(new URL('../components/Header.jsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../components/Sidebar.jsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

test('workspace shell provides responsive navigation and an accessible visual hierarchy', () => {
  assert.match(header, /showMobileNav/)
  assert.match(header, /aria-label="Open workspace navigation"/)
  assert.match(sidebar, /NavIcon/)
  assert.match(sidebar, /hidden min-h-0 w-60/)
  assert.match(styles, /\.anka-workspace/)
  assert.match(styles, /::selection/)
})
