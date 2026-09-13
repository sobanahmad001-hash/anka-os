import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL(
  '../../supabase/migrations/20260913152101_p9_department_chat_proposal_execution_metadata.sql',
  import.meta.url,
), 'utf8')
const verifier = readFileSync(new URL(
  '../../supabase/verify_20260913152101_p9_department_chat_proposal_execution_metadata.sql',
  import.meta.url,
), 'utf8')
const behaviorVerifier = readFileSync(new URL(
  '../../supabase/verify_20260913152101_p9_department_chat_proposal_execution_metadata_behavior.sql',
  import.meta.url,
), 'utf8')
const edge = readFileSync(new URL(
  '../../supabase/functions/department-chat/index.ts',
  import.meta.url,
), 'utf8')

test('P9 proposal telemetry uses only atomic wrappers over the existing canonical stores', () => {
  assert.match(migration, /create function public\.save_department_chat_proposal_with_execution_metadata\(/)
  assert.match(migration, /create function public\.save_department_chat_conversation_proposal_with_execution_metadata\(/)
  assert.match(migration, /public\.save_department_chat_proposal_with_model\(/)
  assert.match(migration, /public\.save_department_chat_conversation_proposal_with_model\(/)
  assert.match(migration, /private\.apply_department_chat_execution_metadata\(/)
  assert.doesNotMatch(migration, /create table|alter table/)
  assert.doesNotMatch(edge, /\.from\('ai_runs'\)\s*\.update|save_department_chat_.*with_model'/)
})

test('P9 proposal telemetry preserves selected versus actual model and true tool arrays on one exact AI run', () => {
  for (const field of ['selected_model_id', 'actual_model_id', 'requested_tools', 'executed_tools']) {
    assert.match(migration, new RegExp("'" + field + "'"))
  }
  assert.match(migration, /where id = v_ai_run_id[\s\S]*organization_id = p_organization_id[\s\S]*model = btrim\(p_selected_model_id\)[\s\S]*department_chat_model_configuration_id is not distinct from p_model_configuration_id/)
  assert.match(migration, /get diagnostics v_updated = row_count[\s\S]*v_updated <> 1/)
  assert.match(migration, /context_manifest \?& array\[[\s\S]*'selected_model_id'[\s\S]*'actual_model_id'[\s\S]*'requested_tools'[\s\S]*'executed_tools'[\s\S]*jsonb_build_object\([\s\S]*\) = v_execution_metadata/)
  assert.doesNotMatch(migration, /context_manifest @> v_execution_metadata/)
  assert.match(verifier, /any replay must match every telemetry field exactly/)
  assert.match(edge, /p_model_configuration_id: input\.provider\.configurationId \|\| null/)
  assert.match(edge, /p_actual_model_id: input\.executionMetadata\.actual_model_id/)
  assert.match(edge, /p_requested_tools: input\.executionMetadata\.requested_tools/)
  assert.match(edge, /p_executed_tools: input\.executionMetadata\.executed_tools/)
})

test('P9 proposal telemetry RPCs are invoker-only and browser-closed with rollback verification', () => {
  assert.equal((migration.match(/security invoker/g) || []).length, 3)
  assert.equal((migration.match(/set search_path = ''/g) || []).length, 3)
  assert.match(migration, /revoke all on function private\.apply_department_chat_execution_metadata[\s\S]*from public, anon, authenticated/)
  assert.equal((migration.match(/revoke all on function public\.save_department_chat_/g) || []).length, 2)
  assert.equal((migration.match(/to service_role;/g) || []).length, 3)
  assert.match(verifier, /^begin;/m)
  assert.match(verifier, /^rollback;/m)
  assert.match(behaviorVerifier, /^begin;/m)
  assert.match(behaviorVerifier, /^rollback;/m)
  for (const replayCheck of [
    'identical_replay_same_run',
    'removed_tool_replay_rejected',
    'changed_tool_replay_rejected',
    'empty_tool_replay_rejected',
    'invalid_telemetry_atomic_rollback',
  ]) {
    assert.match(behaviorVerifier, new RegExp("'" + replayCheck + "'"))
  }
  for (const check of ['service_rpc_acl', 'private_helper_acl', 'canonical_atomic_wrappers', 'exact_run_metadata_contract']) {
    assert.match(verifier, new RegExp("'" + check + "'"))
  }
})
