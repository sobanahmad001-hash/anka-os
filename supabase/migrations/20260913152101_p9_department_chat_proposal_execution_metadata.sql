-- P9 proposal execution metadata. The wrappers keep proposal/message creation,
-- model-configuration binding, and execution telemetry in one transaction.
-- They do not add a second telemetry store or expose a browser mutation path.

create function private.apply_department_chat_execution_metadata(
  p_saved jsonb,
  p_organization_id uuid,
  p_model_configuration_id uuid,
  p_selected_model_id text,
  p_actual_model_id text,
  p_requested_tools text[],
  p_executed_tools text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ai_run_id uuid;
  v_execution_metadata jsonb;
  v_updated integer;
begin
  if jsonb_typeof(p_saved) <> 'object'
     or coalesce(p_saved ->> 'ai_run_id', '') = '' then
    raise exception 'Saved Department Chat proposal run identity is required.' using errcode = '23514';
  end if;
  begin
    v_ai_run_id := (p_saved ->> 'ai_run_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'Saved Department Chat proposal run identity is invalid.' using errcode = '23514';
  end;
  if char_length(btrim(coalesce(p_selected_model_id, ''))) not between 1 and 120
     or (p_actual_model_id is not null
       and char_length(btrim(p_actual_model_id)) not between 1 and 120)
     or p_requested_tools is null or p_executed_tools is null
     or cardinality(p_requested_tools) > 50 or cardinality(p_executed_tools) > 50
     or exists (select 1 from unnest(p_requested_tools) tool
       where tool is null or char_length(btrim(tool)) not between 1 and 100)
     or exists (select 1 from unnest(p_executed_tools) tool
       where tool is null or char_length(btrim(tool)) not between 1 and 100) then
    raise exception 'Department Chat execution metadata is invalid.' using errcode = '23514';
  end if;

  v_execution_metadata := jsonb_build_object(
    'selected_model_id', btrim(p_selected_model_id),
    'actual_model_id', case when p_actual_model_id is null then null else btrim(p_actual_model_id) end,
    'requested_tools', to_jsonb(p_requested_tools),
    'executed_tools', to_jsonb(p_executed_tools)
  );
  update public.ai_runs
  set context_manifest = coalesce(context_manifest, '{}'::jsonb) || v_execution_metadata
  where id = v_ai_run_id
    and organization_id = p_organization_id
    and model = btrim(p_selected_model_id)
    and department_chat_model_configuration_id is not distinct from p_model_configuration_id
    and (
      not coalesce(context_manifest ?| array[
        'selected_model_id', 'actual_model_id', 'requested_tools', 'executed_tools'
      ], false)
      or (
        context_manifest ?& array[
          'selected_model_id', 'actual_model_id', 'requested_tools', 'executed_tools'
        ]
        and jsonb_build_object(
          'selected_model_id', context_manifest -> 'selected_model_id',
          'actual_model_id', context_manifest -> 'actual_model_id',
          'requested_tools', context_manifest -> 'requested_tools',
          'executed_tools', context_manifest -> 'executed_tools'
        ) = v_execution_metadata
      )
    );
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Department Chat proposal run metadata target changed.' using errcode = '23514';
  end if;
  return p_saved;
end;
$$;

create function public.save_department_chat_proposal_with_execution_metadata(
  p_organization_id uuid, p_engagement_id uuid, p_project_id uuid,
  p_department_id text, p_actor_id uuid, p_proposal_kind text,
  p_target_key text, p_artifact_id uuid, p_engagement_stage_instance_id uuid,
  p_validated_payload jsonb, p_preview_payload jsonb,
  p_safe_prompt_metadata jsonb, p_context_artifact_version_ids uuid[],
  p_context_checksum text, p_connector_connection_id uuid, p_model_id text,
  p_idempotency_key uuid, p_input_text text, p_output_text text,
  p_latency_ms integer, p_input_tokens integer, p_output_tokens integer,
  p_estimated_cost_microusd bigint, p_model_configuration_id uuid,
  p_actual_model_id text, p_requested_tools text[], p_executed_tools text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v_saved jsonb;
begin
  if p_model_configuration_id is null then
    v_saved := public.save_department_chat_proposal(
      p_organization_id, p_engagement_id, p_project_id, p_department_id,
      p_actor_id, p_proposal_kind, p_target_key, p_artifact_id,
      p_engagement_stage_instance_id, p_validated_payload, p_preview_payload,
      p_safe_prompt_metadata, p_context_artifact_version_ids, p_context_checksum,
      p_connector_connection_id, p_model_id, p_idempotency_key, p_input_text,
      p_output_text, p_latency_ms, p_input_tokens, p_output_tokens,
      p_estimated_cost_microusd
    );
  else
    v_saved := public.save_department_chat_proposal_with_model(
      p_model_configuration_id, p_organization_id, p_engagement_id, p_project_id,
      p_department_id, p_actor_id, p_proposal_kind, p_target_key, p_artifact_id,
      p_engagement_stage_instance_id, p_validated_payload, p_preview_payload,
      p_safe_prompt_metadata, p_context_artifact_version_ids, p_context_checksum,
      p_connector_connection_id, p_model_id, p_idempotency_key, p_input_text,
      p_output_text, p_latency_ms, p_input_tokens, p_output_tokens,
      p_estimated_cost_microusd
    );
  end if;
  return private.apply_department_chat_execution_metadata(
    v_saved, p_organization_id, p_model_configuration_id, p_model_id,
    p_actual_model_id, p_requested_tools, p_executed_tools
  );
end;
$$;

create function public.save_department_chat_conversation_proposal_with_execution_metadata(
  p_conversation_id uuid, p_message_id uuid,
  p_organization_id uuid, p_engagement_id uuid, p_project_id uuid,
  p_department_id text, p_actor_id uuid, p_proposal_kind text,
  p_target_key text, p_artifact_id uuid, p_engagement_stage_instance_id uuid,
  p_validated_payload jsonb, p_preview_payload jsonb,
  p_safe_prompt_metadata jsonb, p_context_artifact_version_ids uuid[],
  p_context_checksum text, p_connector_connection_id uuid, p_model_id text,
  p_idempotency_key uuid, p_input_text text, p_output_text text,
  p_latency_ms integer, p_input_tokens integer, p_output_tokens integer,
  p_estimated_cost_microusd bigint, p_model_configuration_id uuid,
  p_actual_model_id text, p_requested_tools text[], p_executed_tools text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v_saved jsonb;
begin
  if p_model_configuration_id is null then
    v_saved := public.save_department_chat_conversation_proposal(
      p_conversation_id, p_message_id, p_organization_id, p_engagement_id,
      p_project_id, p_department_id, p_actor_id, p_proposal_kind, p_target_key,
      p_artifact_id, p_engagement_stage_instance_id, p_validated_payload,
      p_preview_payload, p_safe_prompt_metadata, p_context_artifact_version_ids,
      p_context_checksum, p_connector_connection_id, p_model_id,
      p_idempotency_key, p_input_text, p_output_text, p_latency_ms,
      p_input_tokens, p_output_tokens, p_estimated_cost_microusd
    );
  else
    v_saved := public.save_department_chat_conversation_proposal_with_model(
      p_model_configuration_id, p_conversation_id, p_message_id,
      p_organization_id, p_engagement_id, p_project_id, p_department_id,
      p_actor_id, p_proposal_kind, p_target_key, p_artifact_id,
      p_engagement_stage_instance_id, p_validated_payload, p_preview_payload,
      p_safe_prompt_metadata, p_context_artifact_version_ids, p_context_checksum,
      p_connector_connection_id, p_model_id, p_idempotency_key, p_input_text,
      p_output_text, p_latency_ms, p_input_tokens, p_output_tokens,
      p_estimated_cost_microusd
    );
  end if;
  return private.apply_department_chat_execution_metadata(
    v_saved, p_organization_id, p_model_configuration_id, p_model_id,
    p_actual_model_id, p_requested_tools, p_executed_tools
  );
end;
$$;

revoke all on function private.apply_department_chat_execution_metadata(
  jsonb, uuid, uuid, text, text, text[], text[]
) from public, anon, authenticated;
grant execute on function private.apply_department_chat_execution_metadata(
  jsonb, uuid, uuid, text, text, text[], text[]
) to service_role;

revoke all on function public.save_department_chat_proposal_with_execution_metadata(
  uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint, uuid, text, text[], text[]
) from public, anon, authenticated;
grant execute on function public.save_department_chat_proposal_with_execution_metadata(
  uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint, uuid, text, text[], text[]
) to service_role;

revoke all on function public.save_department_chat_conversation_proposal_with_execution_metadata(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint, uuid, text, text[], text[]
) from public, anon, authenticated;
grant execute on function public.save_department_chat_conversation_proposal_with_execution_metadata(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint, uuid, text, text[], text[]
) to service_role;

comment on function public.save_department_chat_proposal_with_execution_metadata(
  uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint, uuid, text, text[], text[]
) is 'Atomically saves a Department Chat proposal and its truthful provider execution metadata.';

comment on function public.save_department_chat_conversation_proposal_with_execution_metadata(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint, uuid, text, text[], text[]
) is 'Atomically completes a saved conversation proposal turn with truthful provider execution metadata.';
