-- One immutable provider-submission claim per private organization conversation turn.
-- The provider route remains disabled; a claim alone never sends a request.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.context_chat_dispatch_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reservation_id uuid not null
    references private.ai_execution_step_budget_reservations(id) on delete restrict,
  conversation_id uuid not null,
  message_id uuid not null,
  model_configuration_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  dispatch_request_id uuid not null,
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default clock_timestamp(),
  unique (reservation_id),
  unique (organization_id, dispatch_request_id),
  unique (organization_id, message_id),
  foreign key (conversation_id, organization_id, actor_id)
    references public.department_chat_conversations(id, organization_id, owner_id) on delete restrict,
  foreign key (message_id, organization_id)
    references public.department_chat_messages(id, organization_id) on delete restrict,
  foreign key (model_configuration_id, organization_id)
    references public.context_chat_organization_models(id, organization_id) on delete restrict
);
create index context_chat_dispatch_claims_org_time
  on private.context_chat_dispatch_claims(organization_id, claimed_at desc);
alter table private.context_chat_dispatch_claims enable row level security;
revoke all on private.context_chat_dispatch_claims from public, anon, authenticated, service_role;
create trigger protect_context_chat_dispatch_claims before update or delete
  on private.context_chat_dispatch_claims for each row
  execute function private.reject_pipeline_template_mutation();

create function public.claim_context_chat_dispatch(
  p_organization_id uuid, p_message_id uuid, p_actor_id uuid,
  p_dispatch_request_id uuid, p_prompt_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reservation private.ai_execution_step_budget_reservations;
  existing private.context_chat_dispatch_claims;
  new_id uuid;
begin
  if p_organization_id is null or p_message_id is null or p_actor_id is null
    or p_dispatch_request_id is null
    or p_prompt_sha256 !~ '^[0-9a-f]{64}$' or p_prompt_sha256 is null then
    raise exception 'Scoped dispatch identity and prompt hash are required.' using errcode = '22023';
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and context_chat_message_id = p_message_id
    for update;
  if not found or reservation.actor_id <> p_actor_id
    or reservation.context_chat_conversation_id is null
    or reservation.context_chat_model_configuration_id is null then
    raise exception 'Owned conversation reservation is required.' using errcode = '42501';
  end if;
  select * into existing from private.context_chat_dispatch_claims
    where reservation_id = reservation.id;
  if found then
    if existing.dispatch_request_id <> p_dispatch_request_id
      or existing.prompt_sha256 <> p_prompt_sha256 then
      raise exception 'Conversation turn already has another dispatch claim.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'already_claimed', 'must_not_submit', true,
      'claim_id', existing.id);
  end if;
  if reservation.status <> 'reserved' then
    raise exception 'Only an unused reservation may be claimed.' using errcode = '55000';
  end if;
  perform public.assert_context_chat_organization_model(
    reservation.context_chat_model_configuration_id, p_organization_id, p_actor_id
  );
  perform 1 from public.department_chat_conversations conversation
    join public.department_chat_messages message
      on message.conversation_id = conversation.id
     and message.organization_id = conversation.organization_id
     and message.owner_id = conversation.owner_id
    where conversation.id = reservation.context_chat_conversation_id
      and conversation.organization_id = p_organization_id
      and conversation.owner_id = p_actor_id
      and conversation.context_kind = 'organization'
      and conversation.state = 'active'
      and message.id = p_message_id
      and message.author_id = p_actor_id
      and message.role = 'user' and message.status = 'completed'
    for share of conversation, message;
  if not found then
    raise exception 'Current owner-controlled human turn is required.' using errcode = '42501';
  end if;
  insert into private.context_chat_dispatch_claims (
    organization_id, reservation_id, conversation_id, message_id,
    model_configuration_id, actor_id, dispatch_request_id, prompt_sha256
  ) values (
    p_organization_id, reservation.id, reservation.context_chat_conversation_id,
    p_message_id, reservation.context_chat_model_configuration_id, p_actor_id,
    p_dispatch_request_id, p_prompt_sha256
  ) returning id into new_id;
  return jsonb_build_object('status', 'claimed', 'must_not_submit', false,
    'claim_id', new_id, 'model_configuration_id',
    reservation.context_chat_model_configuration_id);
end;
$$;
revoke all on function public.claim_context_chat_dispatch(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_context_chat_dispatch(uuid,uuid,uuid,uuid,text)
  to service_role;

create function private.prevent_claimed_context_budget_release()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.context_chat_message_id is not null and new.status = 'released'
    and old.status <> 'released'
    and exists (select 1 from private.context_chat_dispatch_claims claim
      where claim.reservation_id = old.id) then
    raise exception 'Claimed conversation cost requires settlement or explicit independent review.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger trg_prevent_claimed_context_budget_release
  before update of status on private.ai_execution_step_budget_reservations
  for each row execute function private.prevent_claimed_context_budget_release();
revoke all on function private.prevent_claimed_context_budget_release()
  from public, anon, authenticated, service_role;
comment on table private.context_chat_dispatch_claims is
  'Dormant single-use provider-submission claims for private organization conversation turns.';
commit;
