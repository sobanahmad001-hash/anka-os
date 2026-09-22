-- Append only audited, settled private organization conversation output.
-- The future provider route can call this after reconciliation; no provider path is added.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.department_chat_messages
  add column in_reply_to_message_id uuid,
  add constraint department_chat_messages_reply_source_fkey
    foreign key (in_reply_to_message_id, organization_id)
    references public.department_chat_messages(id, organization_id) on delete restrict,
  add constraint department_chat_messages_reply_role_check
    check (in_reply_to_message_id is null or role = 'assistant');
create unique index department_chat_messages_one_reply_per_source
  on public.department_chat_messages(organization_id, in_reply_to_message_id)
  where in_reply_to_message_id is not null;

create function public.append_context_chat_audited_reply(
  p_organization_id uuid, p_message_id uuid, p_actor_id uuid
) returns public.department_chat_messages
language plpgsql security definer set search_path = '' as $$
declare
  conversation public.department_chat_conversations;
  source public.department_chat_messages;
  reservation private.ai_execution_step_budget_reservations;
  claim private.context_chat_dispatch_claims;
  run public.ai_runs;
  existing public.department_chat_messages;
  reply public.department_chat_messages;
  output_body text;
begin
  if p_organization_id is null or p_message_id is null or p_actor_id is null then
    raise exception 'Exact private reply scope is required.' using errcode = '22023';
  end if;
  select * into source from public.department_chat_messages
    where id = p_message_id and organization_id = p_organization_id
      and owner_id = p_actor_id and author_id = p_actor_id
      and role = 'user' and status = 'completed';
  if not found then raise exception 'Completed owner-authored turn is required.' using errcode = '42501'; end if;
  select * into conversation from public.department_chat_conversations
    where id = source.conversation_id and organization_id = p_organization_id
      and owner_id = p_actor_id and context_kind = 'organization'
    for update;
  if not found then raise exception 'Private organization conversation is unavailable.' using errcode = '42501'; end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and context_chat_message_id = source.id
      and context_chat_conversation_id = conversation.id
      and actor_id = p_actor_id and status = 'settled';
  if not found or reservation.ai_run_id is null then
    raise exception 'Settled conversation reservation is required.' using errcode = '55000';
  end if;
  select * into claim from private.context_chat_dispatch_claims
    where reservation_id = reservation.id and organization_id = p_organization_id
      and message_id = source.id and actor_id = p_actor_id
      and conversation_id = conversation.id
      and model_configuration_id = reservation.context_chat_model_configuration_id;
  if not found then raise exception 'Exact single-use claim is required.' using errcode = '55000'; end if;
  select * into run from public.ai_runs
    where id = reservation.ai_run_id and organization_id = p_organization_id
      and user_id = p_actor_id and status = 'completed'
      and capability = 'context_chat_answer'
      and context_chat_message_id = source.id
      and context_chat_conversation_id = conversation.id
      and context_chat_model_configuration_id = claim.model_configuration_id;
  if not found then raise exception 'Matching completed AI audit is required.' using errcode = '55000'; end if;
  output_body := btrim(coalesce(run.output_text, ''));
  if length(output_body) not between 1 and 80000 then
    raise exception 'Audited reply body is invalid.' using errcode = '22023';
  end if;
  select * into existing from public.department_chat_messages
    where organization_id = p_organization_id and in_reply_to_message_id = source.id;
  if found then
    if existing.conversation_id <> conversation.id or existing.owner_id <> p_actor_id
      or existing.ai_run_id is distinct from run.id
      or existing.client_request_id <> claim.id or existing.body <> output_body
      or existing.status <> 'completed' then
      raise exception 'A different reply already exists for this turn.' using errcode = '23505';
    end if;
    return existing;
  end if;
  insert into public.department_chat_messages (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, author_id, role, body, status, ai_run_id,
    client_request_id, sequence, finished_at, in_reply_to_message_id
  ) values (
    conversation.id, conversation.organization_id, conversation.project_id,
    conversation.engagement_id, conversation.department_id, conversation.owner_id,
    null, 'assistant', output_body, 'completed', run.id,
    claim.id, conversation.next_sequence, clock_timestamp(), source.id
  ) returning * into reply;
  update public.department_chat_conversations
    set next_sequence = next_sequence + 1,
      last_activity_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = conversation.id;
  return reply;
end;
$$;
revoke all on function public.append_context_chat_audited_reply(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.append_context_chat_audited_reply(uuid,uuid,uuid)
  to service_role;
comment on column public.department_chat_messages.in_reply_to_message_id is
  'Exact owner-authored turn for a settled, audited private assistant reply.';
commit;
