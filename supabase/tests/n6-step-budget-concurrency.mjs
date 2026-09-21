import { spawn } from 'node:child_process'
const [bin, port] = process.argv.slice(2)
if (!bin || !/^\d+$/.test(port)) throw new Error('Pass local psql path and port')
const org = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'
const first = "select private.n6_reserve_step_budget('" + org + "','88888888-8888-4888-8888-888888888888','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','" + actor + "',60)"
const second = "select private.n6_reserve_step_budget('" + org + "','99999999-9999-4999-8999-999999999999','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','" + actor + "',60)"
function run(sql) {
  return new Promise(resolve => {
    const p = spawn(bin, ['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-t','-A','-c',sql], { windowsHide: true })
    let output = ''
    p.stdout.on('data', data => { output += data })
    p.stderr.on('data', data => { output += data })
    p.on('exit', code => resolve({ code, output }))
  })
}
const a = run('begin; ' + first + '; select pg_sleep(1); commit;')
await new Promise(resolve => setTimeout(resolve, 150))
const b = run(second)
const [firstResult, secondResult] = await Promise.all([a, b])
const count = await run('select count(*) from private.ai_execution_step_budget_reservations')
if (firstResult.code !== 0 || secondResult.code === 0 || !secondResult.output.includes('organization monthly cap') || count.output.trim() !== '1') {
  throw new Error(JSON.stringify({ firstResult, secondResult, count }))
}
process.stdout.write('Two-session organization cap serialization passed; exactly one reservation persisted.\n')
