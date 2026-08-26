import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260825090000_ai_audit_and_human_control.sql', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../../supabase/functions/ai-chat/index.ts', import.meta.url), 'utf8')
const screen = readFileSync(new URL('../apps/AnkaAssistant.jsx', import.meta.url), 'utf8')
const float = readFileSync(new URL('../components/AssistantFloat.jsx', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./aiRepository.js', import.meta.url), 'utf8')
const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')
const departmentConnectors = readFileSync(new URL('../components/DepartmentConnectors.jsx', import.meta.url), 'utf8')

test('AI audit is RLS-protected and browser writes are unavailable', () => {
  assert.match(migration, /alter table public\.ai_runs enable row level security/)
  assert.match(migration, /Users can read own AI runs/)
  assert.match(migration, /Leaders can audit organization AI runs/)
  assert.match(migration, /grant select on public\.ai_runs to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete).*public\.ai_runs to authenticated/)
})

test('AI context is retrieved server-side through the caller RLS client', () => {
  assert.match(edge, /const userClient = createClient/)
  assert.match(edge, /Authorization: authorization/)
  for (const table of ['projects', 'workstreams', 'tasks', 'research_records', 'deliverables', 'requests', 'living_project_documents']) {
    assert.match(edge, new RegExp(`userClient\\.from\\('${table}'\\)`))
  }
  assert.doesNotMatch(screen, /\.from\(/)
  assert.doesNotMatch(screen, /as_/)
})

test('provider secrets remain server-only and authenticated JWT verification stays enabled', () => {
  assert.match(edge, /Deno\.env\.get\('OPENAI_API_KEY'\)/)
  assert.match(edge, /Deno\.env\.get\('ANTHROPIC_API_KEY'\)/)
  assert.doesNotMatch(screen, /OPENAI_API_KEY|ANTHROPIC_API_KEY|VITE_OPENAI/)
  assert.match(config, /\[functions\.ai-chat\][\s\S]*verify_jwt = true/)
})

test('department AI resolves verified connector mappings on the server', () => {
  assert.match(edge, /integration_connection_departments!inner\(department_id\)/)
  assert.match(edge, /\.eq\('status', 'verified'\)/)
  assert.match(edge, /No verified OpenAI connector is assigned to this department/)
  assert.match(edge, /manifest\.connector_connection_id/)
  assert.match(edge, /manifest\.credential_source/)
  assert.match(repository, /departmentId/)
  assert.match(repository, /body: \{ capability, projectId, departmentId, input \}/)
})

test('assistant requires a valid operating department and active project workstream', () => {
  assert.match(edge, /Unknown operating department/)
  assert.match(edge, /The selected department is not active on this project/)
  assert.match(edge, /This department assistant is restricted to its team and organization leadership/)
  assert.match(edge, /LEADER_ROLES/)
  assert.match(screen, /Operating department/)
  assert.match(screen, /useSearchParams/)
  assert.match(screen, /verified connector assigned to the operating department/)
  assert.match(departmentConnectors, /\/assistant\?department=\$\{departmentId\}/)
})

test('OpenAI generation uses Responses API with non-retained and structured action output', () => {
  assert.match(edge, /api\.openai\.com\/v1\/responses/)
  assert.match(edge, /instructions: systemPrompt/)
  assert.match(edge, /store: false/)
  assert.match(edge, /safety_identifier: await safetyIdentifier\(actorId\)/)
  assert.match(edge, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(edge, /type: 'json_schema'/)
  assert.match(edge, /input_tokens/)
  assert.match(edge, /output_tokens/)
  assert.doesNotMatch(edge, /api\.openai\.com\/v1\/chat\/completions/)
})

test('AI proposals cannot execute until a separate human confirmation', () => {
  assert.match(edge, /ACTIONS = new Set\(\['create_task', 'create_research_record'\]\)/)
  assert.match(edge, /human_decision: proposal \? 'pending' : 'not_applicable'/)
  assert.match(screen, /Confirm and create record/)
  assert.match(screen, /aiRepository\.recordDecision\(result\.run_id, 'accepted'/)
  assert.match(screen, /aiRepository\.recordDecision\(result\.run_id, 'rejected'/)
  assert.doesNotMatch(edge, /from\('tasks'\)\.insert|from\('research_records'\)\.insert/)
})

test('AI runs capture provider, usage, context manifest, latency, and optional estimated cost', () => {
  for (const field of ['provider', 'model', 'context_manifest', 'latency_ms', 'input_tokens', 'output_tokens', 'estimated_cost_microusd']) {
    assert.match(migration, new RegExp(field))
  }
  assert.match(edge, /AI_OPENAI/)
  assert.match(edge, /INPUT_USD_PER_MILLION/)
  assert.match(edge, /Hourly AI run limit reached/)
  assert.match(edge, /Organization AI budget has been reached/)
})

test('the floating assistant no longer runs an unaudited mini-chat', () => {
  assert.doesNotMatch(float, /sendAiMessage|fetch\(|functions\.invoke/)
  assert.match(float, /navigate\('\/assistant'\)/)
  assert.match(repository, /functions\.invoke\('ai-chat'/)
})
