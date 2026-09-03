import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8')
const department = source('../apps/DepartmentWorkshop.jsx')
const myWork = source('../apps/MyWork.jsx')

test('WKS5 views wait for organization resolution and reset organization-bound state', () => {
  assert.match(department, /if \(organizationLoading \|\| selectionRequired \|\| !activeOrganizationId \|\| !departmentAllowed\) return/)
  assert.match(myWork, /if \(!user\?\.id \|\| organizationLoading \|\| selectionRequired \|\| !activeOrganizationId\) return/)
  assert.match(department, /setWorkspace\(null\); setActiveTab\('tasks'\); setSelectedWorkstreamId\(''\)/)
  assert.match(myWork, /setWorkspace\(null\); setActiveTab\('overview'\)/)
  assert.ok(department.indexOf('organizationLoading || selectionRequired || !activeOrganizationId') < department.indexOf('delivery.getDepartmentWorkspace'))
  assert.ok(myWork.indexOf('organizationLoading || selectionRequired || !activeOrganizationId') < myWork.indexOf('delivery.getMyWork'))
})

test('a delayed organization A response cannot replace organization B state', () => {
  const delayedA = { organizationId: 'org-a', revision: 4, signal: new AbortController().signal }
  const currentB = { organizationId: 'org-b', revision: 5 }
  const isCurrent = (request, current) => Boolean(
    request.organizationId === current.organizationId && request.revision === current.revision && !request.signal.aborted
  )
  assert.equal(isCurrent(delayedA, currentB), false)

  for (const view of [department, myWork]) {
    assert.match(view, /currentScope\.current = \{ organizationId: activeOrganizationId, revision: scopeRevision \}/)
    assert.match(view, /const requestedScope = \{ organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal \}/)
    assert.match(view, /request\.organizationId === current\?\.organizationId/)
    assert.match(view, /request\.revision === current\?\.revision/)
    assert.match(view, /!request\.signal\?\.aborted/)
  }
  assert.match(department, /if \(!isCurrentOrganizationScope\(requestedScope, currentScope\.current\)\) return\s+setWorkspace\(result\)/)
  assert.match(myWork, /if \(isCurrentOrganizationScope\(requestedScope, currentScope\.current\)\) setWorkspace\(next\)/)
})

test('WKS5 deep links retain the selected organization and never switch from fetched data', () => {
  assert.match(department, /delivery\.getDepartmentWorkspace\(departmentId, activeOrganizationId, \{ signal: requestSignal \}\)/)
  assert.match(myWork, /delivery\.getMyWork\(user\.id, activeOrganizationId, \{ signal: requestSignal \}\)/)
  assert.doesNotMatch(department, /selectOrganization/)
  assert.doesNotMatch(myWork, /selectOrganization/)
})
