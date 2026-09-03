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

test('reports and records consumes the active organization and isolates stale project loads', () => {
  const screen = fs.readFileSync(new URL('../apps/ReportsAndRecords.jsx', import.meta.url), 'utf8')
  assert.match(screen, /useOrganization/)
  assert.match(screen, /listProjects\(activeOrganizationId/)
  assert.match(screen, /getProjectWorkspace\(projectId, activeOrganizationId/)
  assert.match(screen, /controller\.abort\(\)/)
  assert.match(screen, /setWorkspace\(null\)/)
  assert.doesNotMatch(screen, /delivery\.listProjects\(\)/)
})
