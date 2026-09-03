import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

test('major application surfaces are loaded as independent route chunks', () => {
  assert.match(app, /import \{ lazy, Suspense \} from 'react'/)
  for (const moduleName of [
    'AgencyCommandCenter',
    'OperatingSpine',
    'PortfolioWorkspace',
    'DepartmentWorkshop',
    'ContentStudio',
    'MarketingStudio',
    'MyWork',
    'AnkaSpherePortal',
    'AnkaAssistant',
    'ReportsAndRecords',
  ]) {
    assert.match(app, new RegExp(`const ${moduleName} = lazy`))
  }
  assert.match(app, /<Suspense fallback={<RouteFallback \/>}>/)
})
