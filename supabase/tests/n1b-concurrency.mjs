// Fresh synthetic localhost cluster only; invoked by run-n1-local.ps1.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
const run = promisify(execFile)
const [bin, port] = process.argv.slice(2)
if (!/^\d+$/.test(port || '') || Number(port) < 1024) throw new Error('Local unprivileged test port required')
const executable = join(bin, 'psql.exe')
const args = ['-X', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
const query = async sql => (await run(executable, [...args, '-c', sql], { timeout: 15000 })).stdout.trim()
const identity = "set role authenticated; select set_config('request.jwt.claim.sub',md5('owner')::uuid::text,false);"
const token = (await query(identity + "select public.get_authority_administration(md5('org-a')::uuid,md5('alice')::uuid)->>'token';")).split('\n').at(-1).trim()
const command = (value, request) => "select public.change_authority_compatibility(md5('org-a')::uuid,md5('alice')::uuid,'set_designation','" + value + "','" + token + "',md5('" + request + "')::uuid);"
let firstFailure
const first = query("set application_name='n1b-concurrent-first'; begin; " + identity + command('intern', 'concurrent-first') + ' select pg_sleep(2); commit;')
  .catch(error => { firstFailure = error })
let observed = false
for (let index = 0; index < 60; index++) {
  if (firstFailure) throw firstFailure
  const state = await query("select count(*) from pg_stat_activity where application_name='n1b-concurrent-first' and wait_event='PgSleep';")
  if (state === '1') { observed = true; break }
  await new Promise(resolve => setTimeout(resolve, 25))
}
assert.ok(observed, 'first edit must hold the transaction open before second edit')
await assert.rejects(query(identity + command('executive', 'concurrent-second')), error => /40001/.test(error.stderr), 'concurrent second edit is stale, not silently applied')
await first
if (firstFailure) throw firstFailure
assert.equal(await query("select count(*) from public.organization_contributor_designations where user_id=md5('alice')::uuid and status='active' and designation='intern';"), '1')
assert.equal(await query("select count(*) from private.n1b_authority_requests where request_id=md5('concurrent-second')::uuid;"), '0', 'failed stale command has no receipt')
const replay = await query(identity + command('intern', 'concurrent-first'))
assert.match(replay, /"replayed": true/)
// Revoke the caller after the original request. A replay cannot bypass current authorization.
await query("update public.organization_memberships set status='revoked' where user_id=md5('owner')::uuid;")
await assert.rejects(query(identity + command('intern', 'concurrent-first')), error => /42501/.test(error.stderr))
console.log('N1-B concurrency passed: stale simultaneous edit rejected, winner retained, replay idempotent and reauthorized.')
