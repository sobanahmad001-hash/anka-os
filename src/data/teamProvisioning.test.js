import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const inviteFunction = readFileSync(new URL('../../supabase/functions/invite-user/index.ts', import.meta.url), 'utf8')
const profileMigration = readFileSync(new URL('../../supabase/migrations/20260825060000_team_profile_alignment.sql', import.meta.url), 'utf8')
const controls = readFileSync(new URL('../components/OrganizationDeactivation.jsx', import.meta.url), 'utf8')
const management = readFileSync(new URL('./peopleManagement.js', import.meta.url), 'utf8')
const adminScreen = readFileSync(new URL('../apps/UserManagement.jsx', import.meta.url), 'utf8')

test('team invitations are authorized by canonical organization membership', () => {
  assert.match(inviteFunction, /from\('organization_memberships'\)/)
  assert.match(inviteFunction, /system_owner/)
  assert.match(inviteFunction, /operations_admin/)
  assert.doesNotMatch(inviteFunction, /profile\?\.role/)
})

test('invited users use atomic organization setup and never blind-delete failed accounts', () => {
  assert.match(inviteFunction, /auth\.admin\.inviteUserByEmail/)
  assert.match(inviteFunction, /complete_team_invitation/)
  assert.match(inviteFunction, /cleanup_incomplete: true/)
  assert.doesNotMatch(inviteFunction, /auth\.admin\.deleteUser|from\('profiles'\)\.upsert/)
})

test('self-signup metadata cannot create organization membership', () => {
  const triggerBody = profileMigration.slice(profileMigration.indexOf('create or replace function public.handle_new_user'))
  assert.match(triggerBody, /insert into public\.profiles/)
  assert.doesNotMatch(triggerBody, /insert into public\.organization_memberships/)
})

test('team admin supports all canonical departments and roles', () => {
  for (const department of ['content', 'design', 'development', 'marketing']) {
    assert.match(management, new RegExp(`'${department}'`))
    assert.match(profileMigration, new RegExp(`'${department}'`))
  }
  for (const role of ['operations_admin', 'executive', 'department_manager', 'project_owner', 'contributor']) {
    assert.match(management, new RegExp(`'${role}'`))
    assert.match(inviteFunction, new RegExp(`'${role}'`))
  }
})

test('organization deactivation stays server-side and preserves profiles and work', () => {
  assert.match(adminScreen, /AuthorityCompatibilityAdmin/)
  assert.match(controls, /deactivate_organization_member/)
  assert.match(controls, /auth_account_preserved !== true/)
  assert.match(inviteFunction, /deactivate_organization_member/)
  assert.doesNotMatch(adminScreen + management + controls, /from\('profiles'\)\.(delete|update|upsert)/)
})
