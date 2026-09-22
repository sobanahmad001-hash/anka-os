-- Bind future organization-private AI replies to the exact owner, conversation,
-- and approved model. This migration does not create a dispatch route.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.ai_runs
  add column context_chat_conversation_id uuid,
  add column context_chat_model_configuration_id uuid,
  add constraint ai_runs_context_chat_conversation_fkey
    foreign key (context_chat_conversation_id, organization_id, user_id)
    references public.department_chat_conversations(id, organization_id, owner_id)
    on delete restrict,
  add constraint ai_runs_context_chat_model_fkey
    foreign key (context_chat_model_configuration_id, organization_id)
    references public.context_chat_organization_models(id, organization_id)
    on delete restrict,
  add constraint ai_runs_context_chat_scope_check check (
    (context_chat_conversation_id is null and context_chat_model_configuration_id is null
      and capability <> 'context_chat_answer')
    or (context_chat_conversation_id is not null and context_chat_model_configuration_id is not null
      and department_chat_conversation_id is null and engagement_id is null
      and capability = 'context_chat_answer')
  );
alter table public.ai_runs drop constraint ai_runs_capability_check;
alter table public.ai_runs add constraint ai_runs_capability_check check (capability in (
  'project_pulse', 'daily_brief', 'research_support', 'writing_support',
  'quality_review', 'action_proposal', 'quick_task_chat',
  'department_chat_answer', 'context_chat_answer'
));
create index idx_ai_runs_context_chat_conversation
  on public.ai_runs(context_chat_conversation_id, organization_id, created_at desc)
  where context_chat_conversation_id is not null;

create function private.assert_context_chat_ai_run_scope()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.context_chat_conversation_id is null then return new; end if;
  if not exists (
    select 1 from public.department_chat_conversations conversation
    join public.context_chat_organization_models configuration
      on configuration.id = new.context_chat_model_configuration_id
     and configuration.organization_id = conversation.organization_id
    join public.integration_connections connection
      on connection.id = configuration.connector_connection_id
     and connection.organization_id = configuration.organization_id
    where conversation.id = new.context_chat_conversation_id
      and conversation.organization_id = new.organization_id
      and conversation.owner_id = new.user_id
      and conversation.context_kind = 'organization'
      and configuration.model_id = new.model
      and connection.provider = new.provider
  ) then
    raise exception 'Private conversation AI audit scope or model identity mismatch.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_context_chat_ai_run_scope
  before insert or update of context_chat_conversation_id, context_chat_model_configuration_id,
    organization_id, user_id, model, provider on public.ai_runs
  for each row execute function private.assert_context_chat_ai_run_scope();
revoke all on function private.assert_context_chat_ai_run_scope() from public, anon, authenticated;

alter policy "Leaders can audit organization AI runs" on public.ai_runs
using (
  redacted_at is null and capability <> 'quick_task_chat'
  and department_chat_conversation_id is null
  and context_chat_conversation_id is null
  and public.has_organization_role(organization_id,
    array['system_owner', 'operations_admin', 'executive'])
);
comment on column public.ai_runs.context_chat_conversation_id is
  'Owner-private organization conversation provenance. No provider dispatch is enabled by this column.';
commit;
