-- Expand the canonical saved-conversation tables to carry distinct OS, workshop,
-- and project-team contexts. Existing department engagement rows retain their
-- default context and all existing RPC contracts.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.department_chat_conversations
  add column context_kind text not null default 'department_project',
  alter column project_id drop not null,
  alter column engagement_id drop not null,
  alter column department_id drop not null,
  add constraint department_chat_conversations_context_kind_check check (
    (context_kind = 'department_project'
      and project_id is not null and engagement_id is not null and department_id is not null)
    or (context_kind = 'department_private'
      and project_id is null and engagement_id is null
      and department_id in ('content', 'design', 'marketing'))
    or (context_kind = 'organization'
      and project_id is null and engagement_id is null and department_id is null)
    or (context_kind = 'project_team'
      and project_id is not null and engagement_id is null and department_id is null)
  ),
  add constraint department_chat_conversations_project_scope_fkey
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  add constraint department_chat_conversations_id_org_owner_key
    unique (id, organization_id, owner_id);

create index idx_department_chat_conversations_context
  on public.department_chat_conversations
  (organization_id, context_kind, project_id, department_id, owner_id, last_activity_at desc);

alter table public.department_chat_messages
  alter column project_id drop not null,
  alter column engagement_id drop not null,
  alter column department_id drop not null,
  add constraint department_chat_messages_parent_identity_fkey
    foreign key (conversation_id, organization_id, owner_id)
    references public.department_chat_conversations(id, organization_id, owner_id)
    on delete restrict;

-- The legacy composite FK checks all fully scoped department rows. This trigger
-- also checks new rows whose optional context columns cause that FK to skip.
create function private.assert_department_chat_message_context()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare parent public.department_chat_conversations;
begin
  select * into parent
  from public.department_chat_conversations conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id
    and conversation.owner_id = new.owner_id;
  if not found
     or new.project_id is distinct from parent.project_id
     or new.engagement_id is distinct from parent.engagement_id
     or new.department_id is distinct from parent.department_id then
    raise exception 'Conversation message context mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_department_chat_messages_context
before insert or update on public.department_chat_messages
for each row execute function private.assert_department_chat_message_context();

alter table public.department_chat_messages
  drop constraint department_chat_messages_terminal_check,
  add constraint department_chat_messages_terminal_check check (
    (status = 'pending' and role = 'user' and ai_run_id is null
      and proposal_id is null and finished_at is null and error_code = '')
    or (status = 'completed' and ai_run_id is not null
      and finished_at is not null and error_code = '' and role in ('user', 'assistant'))
    or (status = 'completed' and role = 'user' and ai_run_id is null
      and proposal_id is null and provider_dispatched_at is null
      and finished_at is not null and error_code = '')
    or (status in ('failed', 'unsupported') and role = 'user'
      and ai_run_id is null and proposal_id is null
      and finished_at is not null and error_code <> '')
    or (status = 'unknown' and role = 'user'
      and ai_run_id is null and proposal_id is null
      and provider_dispatched_at is not null
      and finished_at is not null and error_code = 'outcome_unknown')
  );

comment on column public.department_chat_conversations.context_kind is
  'department_project preserves the existing chat contract; department_private, organization, and project_team are owner-private until explicitly shared.';

commit;
