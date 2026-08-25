import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
const boundary = readFileSync(new URL('../components/AppErrorBoundary.jsx', import.meta.url), 'utf8')
const auth = readFileSync(new URL('../context/AuthContext.jsx', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../hooks/useTheme.jsx', import.meta.url), 'utf8')

test('stale deployment chunks trigger a guarded one-time reload', () => {
  assert.match(main, /vite:preloadError/)
  assert.match(main, /anka:last-chunk-reload/)
  assert.match(main, /Date\.now\(\) - lastReload > 60_000/)
  assert.ok(
    main.indexOf('Date.now() - lastReload > 60_000') < main.indexOf('event.preventDefault()'),
    'preload errors must only be suppressed when a reload will happen'
  )
})

test('unexpected render failures show a visible recovery action', () => {
  assert.match(main, /AppErrorBoundary/)
  assert.match(boundary, /Reload Anka OS/)
  assert.match(boundary, /window\.location\.reload/)
})

test('optional profile and preference records do not emit 406 errors', () => {
  assert.match(auth, /\.maybeSingle\(\)/)
  assert.match(theme, /\.maybeSingle\(\)/)
})
