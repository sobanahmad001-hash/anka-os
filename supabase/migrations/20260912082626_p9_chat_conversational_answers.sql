-- P9-CHAT-3 - durable ordinary conversational answers.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.ai_runs drop constraint ai_runs_capability_check;
alter table public.ai_runs add constraint ai_runs_capability_check check (capability in (
  'project_pulse', 'daily_brief', 'research_support', 'writing_support',
  'quality_review', 'action_proposal', 'quick_task_chat', 'department_chat_answer'
));

alter table public.department_chat_messages
  drop constraint department_chat_messages_terminal_check,
  add constraint department_chat_messages_terminal_check check (
    (status = 'pending' and role = 'user' and ai_run_id is null and proposal_id is null
      and finished_at is null and error_code = '')
    or (status = 'completed' and ai_run_id is not null and finished_at is not null
      and error_code = '' and role in ('user', 'assistant'))
    or (status in ('failed', 'unsupported') and role = 'user' and ai_run_id is null
      and proposal_id is null and finished_at is not null and error_code <> '')
    or (status = 'unknown' and role = 'user' and ai_run_id is null and proposal_id is null
      and provider_dispatched_at is not null and finished_at is not null
      and error_code = 'outcome_unknown')
  );

create function public.complete_department_chat_answer(
  p_conversation_id uuid, p_message_id uuid,
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid,
  p_department_id text, p_actor_id uuid,
  p_model_configuration_id uuid, p_connector_connection_id uuid, p_model_id text,
  p_context_manifest jsonb, p_output_text text,
  p_latency_ms integer, p_input_tokens integer, p_output_tokens integer,
  p_estimated_cost_microusd bigint
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_conversation public.department_chat_conversations;
  v_user_message public.department_chat_messages;
  v_assistant_message public.department_chat_messages;
  v_ai_run_id uuid;
begin
  select conversation.* into v_conversation
  from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.project_id = p_project_id
    and conversation.engagement_id = p_engagement_id
    and conversation.department_id = p_department_id
  for update;
  if not found then
    raise exception 'Department Chat conversation not found.' using errcode = '42501';
  end if;

  select message.* into v_user_message
  from public.department_chat_messages message
  where message.id = p_message_id
    and message.conversation_id = p_conversation_id
    and message.organization_id = p_organization_id
    and message.project_id = p_project_id
    and message.engagement_id = p_engagement_id
    and message.department_id = p_department_id
    and message.author_id = p_actor_id
    and message.role = 'user'
  for update;
  if not found then
    raise exception 'Department Chat message not found.' using errcode = '42501';
  end if;

  if v_user_message.status = 'completed' and v_user_message.proposal_id is null then
    select message.* into v_assistant_message
    from public.department_chat_messages message
    where message.conversation_id = p_conversation_id
      and message.client_request_id = v_user_message.client_request_id
      and message.role = 'assistant';
    if not found or v_assistant_message.ai_run_id is distinct from v_user_message.ai_run_id
       or v_assistant_message.body is distinct from btrim(p_output_text) then
      raise exception 'Completed Department Chat answer does not match this replay.' using errcode = '23514';
    end if;
    return jsonb_build_object(
      'conversation_id', p_conversation_id, 'user_message_id', v_user_message.id,
      'assistant_message_id', v_assistant_message.id, 'ai_run_id', v_user_message.ai_run_id,
      'model_configuration_id', p_model_configuration_id, 'replayed', true
    );
  end if;
  if v_user_message.status <> 'pending' or v_user_message.provider_dispatched_at is null then
    raise exception 'A dispatched pending Department Chat turn is required.' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_output_text, ''))) not between 1 and 80000 then
    raise exception 'Department Chat answer must be between 1 and 80000 characters.' using errcode = '23514';
  end if;
  if p_latency_ms < 0 or coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0
     or coalesce(p_estimated_cost_microusd, 0) < 0 then
    raise exception 'Department Chat usage metadata is invalid.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.department_chat_model_configurations configuration
    where configuration.id = p_model_configuration_id
      and configuration.organization_id = p_organization_id
      and configuration.department_id = p_department_id
      and configuration.connector_connection_id = p_connector_connection_id
      and configuration.model_id = p_model_id
  ) then
    raise exception 'Department Chat model configuration identity changed.' using errcode = '23514';
  end if;
  if coalesce(p_context_manifest ->> 'department_id', '') <> p_department_id
     or coalesce(p_context_manifest ->> 'connector_connection_id', '') <> p_connector_connection_id::text
     or coalesce(p_context_manifest ->> 'model_configuration_id', '') <> p_model_configuration_id::text
     or coalesce(p_context_manifest ->> 'model_id', '') <> p_model_id
     or char_length(coalesce(p_context_manifest ->> 'context_checksum', '')) <> 64 then
    raise exception 'Department Chat answer context manifest is invalid.' using errcode = '23514';
  end if;

  insert into public.ai_runs (
    organization_id, project_id, engagement_id, user_id, capability, status,
    provider, model, input_text, output_text, context_manifest, proposed_action,
    latency_ms, input_tokens, output_tokens, estimated_cost_microusd, human_decision,
    department_chat_conversation_id, department_chat_conversation_owner_id,
    department_chat_model_configuration_id
  ) values (
    p_organization_id, p_project_id, p_engagement_id, p_actor_id,
    'department_chat_answer', 'completed', 'openai', p_model_id,
    '', '', p_context_manifest, null,
    p_latency_ms, p_input_tokens, p_output_tokens, p_estimated_cost_microusd,
    'not_applicable', p_conversation_id, v_conversation.owner_id,
    p_model_configuration_id
  ) returning id into v_ai_run_id;

  update public.department_chat_messages
  set status = 'completed', ai_run_id = v_ai_run_id, proposal_id = null,
      finished_at = now()
  where id = v_user_message.id returning * into v_user_message;

  insert into public.department_chat_messages (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, author_id, role, body, status, ai_run_id, proposal_id,
    client_request_id, sequence, finished_at
  ) values (
    v_conversation.id, v_conversation.organization_id, v_conversation.project_id,
    v_conversation.engagement_id, v_conversation.department_id,
    v_conversation.owner_id, null, 'assistant', btrim(p_output_text),
    'completed', v_ai_run_id, null, v_user_message.client_request_id,
    v_conversation.next_sequence, now()
  ) returning * into v_assistant_message;

  update public.department_chat_conversations
  set next_sequence = next_sequence + 1, last_activity_at = now(), updated_at = now()
  where id = v_conversation.id;

  return jsonb_build_object(
    'conversation_id', v_conversation.id, 'user_message_id', v_user_message.id,
    'assistant_message_id', v_assistant_message.id, 'ai_run_id', v_ai_run_id,
    'model_configuration_id', p_model_configuration_id, 'replayed', false
  );
end;
$$;

revoke all on function public.complete_department_chat_answer(
  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, text,
  jsonb, text, integer, integer, integer, bigint
) from public, anon, authenticated;
grant execute on function public.complete_department_chat_answer(
  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, text,
  jsonb, text, integer, integer, integer, bigint
) to service_role;

comment on function public.complete_department_chat_answer(
  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, text,
  jsonb, text, integer, integer, integer, bigint
) is 'Atomically persists one ordinary Department Chat answer and its immutable model/run provenance without creating any proposal or official record.';

commit;
