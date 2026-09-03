import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const rootFile = (path) => new URL(`../../${path}`, import.meta.url)
const read = (path) => readFileSync(rootFile(path), 'utf8')
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const packageJson = JSON.parse(read('package.json'))
const config = read('supabase/config.toml')
const ci = read('.github/workflows/ci.yml')

const integratedFunctions = [
  { name: 'department-chat', gate: 'docs/release/WCH2_DEPARTMENT_PROFILES_CONTEXT_REVIEW_GATE.md' },
  { name: 'recurring-plans', gate: 'docs/release/RET1_RECURRING_PLAN_FOUNDATION_REVIEW_GATE.md' },
  { name: 'quick-tasks', gate: 'docs/review-gates/QTS1_PRIVATE_CORE.md' },
]

test('OAI1 keeps integrated function config, CI, deployment, and gates converged', () => {
  const deployScript = packageJson.scripts['supabase:deploy:functions']
  assert.equal(typeof deployScript, 'string')

  for (const { name, gate } of integratedFunctions) {
    const escaped = escapeRegex(name)
    const blocks = config.match(new RegExp(`^\\[functions\\.${escaped}\\][\\s\\S]*?(?=^\\[functions\\.|(?![\\s\\S]))`, 'gm')) ?? []
    assert.equal(blocks.length, 1, `${name} must have one config block`)
    assert.match(blocks[0], /^enabled = true$/m)
    assert.match(blocks[0], /^verify_jwt = true$/m)
    assert.match(blocks[0], new RegExp(`^entrypoint = "\\./functions/${escaped}/index\\.ts"$`, 'm'))

    const deploys = deployScript.match(new RegExp(`supabase functions deploy ${escaped}(?=\\s|$)`, 'g')) ?? []
    assert.equal(deploys.length, 1, `${name} must have one deployment step`)

    assert.match(ci, new RegExp(`deno test --frozen[^\\n]*supabase/functions/${escaped}/index\\.test\\.ts`))
    assert.match(ci, new RegExp(`deno check --frozen[^\\n]*supabase/functions/${escaped}/index\\.ts`))
    assert.match(ci, new RegExp(`deno check --frozen[^\\n]*supabase/functions/${escaped}/index\\.test\\.ts`))
    assert.ok(existsSync(rootFile(`supabase/functions/${name}/index.ts`)))
    assert.ok(existsSync(rootFile(`supabase/functions/${name}/index.test.ts`)))
    assert.ok(existsSync(rootFile(gate)), `${gate} must remain present`)
  }
})

test('OAI1 retains every merged ownership and workspace review gate', () => {
  for (const gate of [
    'docs/release/OAF2_CANONICAL_OWNERSHIP_CONVERGENCE_REVIEW_GATE.md',
    'docs/release/OAF2A_COMPOSITE_FK_INDEXES_REVIEW_GATE.md',
    'docs/release/WKS1_WORKSPACE_SHELL_PORTFOLIO_REVIEW_GATE.md',
    'docs/release/WKS2_PROJECT_ENGAGEMENT_WORKSPACE_REVIEW_GATE.md',
    'docs/release/WKS3_CLIENT_WORKSPACE_REVIEW_GATE.md',
  ]) {
    assert.ok(existsSync(rootFile(gate)), `${gate} must remain present`)
  }
})

test('OAI1 keeps migration identities unique and QTS1 after RET1', () => {
  const files = readdirSync(rootFile('supabase/migrations/'))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  const timestamps = files.map((name) => name.slice(0, 14))

  assert.equal(new Set(timestamps).size, timestamps.length, 'migration timestamps must be unique')

  const ret = '20260903071706_ret1_recurring_plan_foundation.sql'
  const qts = '20260903071848_qts1_private_core.sql'
  assert.ok(files.includes(ret))
  assert.ok(files.includes(qts))
  assert.ok(ret.localeCompare(qts) < 0, 'QTS1 must remain ordered after RET1')
})
