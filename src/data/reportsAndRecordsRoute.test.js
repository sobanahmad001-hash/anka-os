import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('reports and records is a first-class Sphere route', () => {
  const app = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const nav = fs.readFileSync(new URL('../config/environmentNav.js', import.meta.url), 'utf8')
  assert.match(app, /sphere\/reports/)
  assert.match(app, /ReportsAndRecords/)
  assert.match(nav, /Reports & Records/)
})
