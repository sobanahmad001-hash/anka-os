-- N5 P9A: per-author unsent composer intent remains bound to its original
-- authorized conversation. Attachments, AI-use consent, and model choice are
-- deliberately not persisted or restored by this table.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.department_chat_unsent_drafts (
  conversation_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  engagement_id uuid not null,
  department_id text not null,
  conversation_owner_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  prompt text not null check (char_length(btrim(prompt)) between 1 and 8000),
  proposal_mode text not null check (proposal_mode in ('answer', 'artifact', 'work_item')),
  artifact_type text not null default '' check (char_length(artifact_type) <= 80),
  work_item_title text not null default '' check (char_length(work_item_title) <= 240),
  work_item_type text not null default '' check (char_length(work_item_type) <= 80),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  language text not null default '' check (char_length(language) <= 120),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (conversation_id, actor_id),
  foreign key (
    conversation_id, organization_id, project_id, engagement_id, department_id, conversation_owner_id
  ) references public.department_chat_conversations(
    id, organization_id, project_id, engagement_id, department_id, owner_id
  ) on delete restrict
);
create index idx_department_chat_unsent_drafts_actor
  on public.department_chat_unsent_drafts(actor_id, organization_id, updated_at desc);
create index idx_department_chat_unsent_drafts_conversation_scope
  on public.department_chat_unsent_drafts(
    conversation_id, organization_id, project_id, engagement_id, department_id, conversation_owner_id
  );

alter table public.department_chat_unsent_drafts enable row level security;
revoke all on public.department_chat_unsent_drafts from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.department_chat_unsent_drafts to service_role;
comment on table public.department_chat_unsent_drafts is
  'Private per-author unsent composer intent; server rechecks original-conversation access before read/save. No files, model choice, or AI-use consent.';
create function public.save_department_chat_unsent_draft(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid,
  p_prompt text, p_proposal_mode text, p_artifact_type text,
  p_work_item_title text, p_work_item_type text, p_priority text, p_language text
) returns public.department_chat_unsent_drafts
language plpgsql security invoker set search_path = '' as $$
declare
  v_conversation public.department_chat_conversations;
  v_draft public.department_chat_unsent_drafts;
begin
  v_conversation := private.require_accessible_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, true
  );
  insert into public.department_chat_unsent_drafts (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    conversation_owner_id, actor_id, prompt, proposal_mode, artifact_type,
    work_item_title, work_item_type, priority, language
  ) values (
    v_conversation.id, v_conversation.organization_id, v_conversation.project_id,
    v_conversation.engagement_id, v_conversation.department_id,
    v_conversation.owner_id, p_actor_id, p_prompt, p_proposal_mode,
    coalesce(p_artifact_type, ''), coalesce(p_work_item_title, ''),
    coalesce(p_work_item_type, ''), coalesce(p_priority, 'medium'),
    coalesce(p_language, '')
  ) on conflict (conversation_id, actor_id) do update set
    prompt = excluded.prompt,
    proposal_mode = excluded.proposal_mode,
    artifact_type = excluded.artifact_type,
    work_item_title = excluded.work_item_title,
    work_item_type = excluded.work_item_type,
    priority = excluded.priority,
    language = excluded.language,
    updated_at = clock_timestamp()
  returning * into v_draft;
  return v_draft;
end;
$$;

create function public.get_department_chat_unsent_draft(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid
) returns public.department_chat_unsent_drafts
language plpgsql security invoker set search_path = '' as $$
declare v_draft public.department_chat_unsent_drafts;
begin
  perform private.require_accessible_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, false
  );
  select * into v_draft from public.department_chat_unsent_drafts
  where conversation_id = p_conversation_id and organization_id = p_organization_id
    and project_id = p_project_id and engagement_id = p_engagement_id
    and department_id = p_department_id and actor_id = p_actor_id;
  return v_draft;
end;
$$;

create function public.discard_department_chat_unsent_draft(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid
) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  -- A revoked author may delete only their own saved intent. Read/save still
  -- require current access to the original conversation.
  delete from public.department_chat_unsent_drafts
  where conversation_id = p_conversation_id and organization_id = p_organization_id
    and project_id = p_project_id and engagement_id = p_engagement_id
    and department_id = p_department_id and actor_id = p_actor_id;
  return found;
end;
$$;

revoke all on function public.save_department_chat_unsent_draft(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.get_department_chat_unsent_draft(
  uuid, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.discard_department_chat_unsent_draft(
  uuid, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.save_department_chat_unsent_draft(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.get_department_chat_unsent_draft(
  uuid, uuid, uuid, uuid, text, uuid
) to service_role;
grant execute on function public.discard_department_chat_unsent_draft(
  uuid, uuid, uuid, uuid, text, uuid
) to service_role;
commit;
