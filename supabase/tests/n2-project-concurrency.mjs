import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const [psql, port] = process.argv.slice(2)
if (!psql || !port) throw new Error('Pass the local psql path and port')
const args = ['-X', '-A', '-t', '-q', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-']
const organization = "'00000000-0000-4000-8000-000000000001'"
const request = "'50000000-0000-4000-8000-000000000099'"
const actor = "'10000000-0000-4000-8000-000000000001'"
const command = 'select (public.create_draft_project(' + organization + ',' + request
  + ",'Concurrent draft','','internal',null,null,null,null,null,'','')->>'replayed')::text;"
const session = "set role authenticated; select set_config('request.jwt.claim.sub'," + actor + ',false);'

function run(sql, onOutput) {
  const child = spawn(psql, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  let error = ''
  child.stdout.on('data', chunk => {
    output += chunk.toString()
    onOutput?.(output)
  })
  child.stderr.on('data', chunk => { error += chunk.toString() })
  child.stdin.end(sql)
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(error || output || 'psql failed')))
  })
}

let signal
const created = new Promise(resolve => { signal = resolve })
const first = run(session + '\nbegin;\n' + command + '\n\\echo N2_FIRST_CREATED\nselect pg_sleep(2);\ncommit;\n',
  output => { if (output.includes('N2_FIRST_CREATED')) signal() })
await Promise.race([created, new Promise((_, reject) => setTimeout(() => reject(new Error('First session did not reach the lock point')), 10000))])
const second = run(session + '\n' + command + '\n')
const [firstResult, secondResult] = await Promise.all([first, second])
assert.ok(firstResult.split(/\r?\n/).includes('false'))
assert.ok(secondResult.split(/\r?\n/).includes('true'))
const count = await run("select count(*) from public.projects where name='Concurrent draft';\n")
assert.ok(count.split(/\r?\n/).includes('1'))
console.log('N2 concurrent create replay produced one draft and one receipt replay.')
