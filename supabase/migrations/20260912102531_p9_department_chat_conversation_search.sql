-- P9 Shared Workshop Chat - permission-filtered saved-conversation search.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index idx_department_chat_conversations_search
  on public.department_chat_conversations using gin (
    to_tsvector('simple', coalesce(title, ''))
  );
create index idx_department_chat_messages_search
  on public.department_chat_messages using gin (
    to_tsvector('simple', coalesce(body, ''))
  );
create index idx_department_chat_conversations_context_activity
  on public.department_chat_conversations (
    organization_id, project_id, engagement_id, department_id,
    state, last_activity_at desc, id
  );

create function public.search_department_chat_conversations(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid,
  p_department_id text, p_actor_id uuid, p_query text default null,
  p_include_archived boolean default false, p_limit integer default 25,
  p_before_last_activity_at timestamptz default null, p_before_id uuid default null
)
returns table (
  id uuid, organization_id uuid, project_id uuid, engagement_id uuid,
  department_id text, owner_id uuid, title text, state text,
  last_activity_at timestamptz, archived_at timestamptz,
  created_at timestamptz, updated_at timestamptz, access_role text,
  has_pending_run boolean, has_failed_run boolean
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_query text := nullif(btrim(p_query), '');
  v_tsquery tsquery;
begin
  if p_actor_id is null then
    raise exception 'Conversation search actor is required.' using errcode = '22023';
  end if;
  if p_department_id not in ('content', 'design', 'marketing') then
    raise exception 'Saved conversation context is unsupported.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Conversation search page size must be between 1 and 50.' using errcode = '22023';
  end if;
  if (p_before_last_activity_at is null) <> (p_before_id is null) then
    raise exception 'Conversation search cursor is incomplete.' using errcode = '22023';
  end if;
  if v_query is not null then
    if char_length(v_query) > 160 then
      raise exception 'Conversation search text is too long.' using errcode = '22023';
    end if;
    v_tsquery := plainto_tsquery('simple', v_query);
    if numnode(v_tsquery) = 0 then return; end if;
  end if;

  -- Return nothing for inaccessible context instead of confirming whether a
  -- conversation or matching message exists there.
  if not private.is_current_department_chat_contributor(
    p_organization_id, p_project_id, p_engagement_id, p_department_id, p_actor_id
  ) then return; end if;

  return query
  select
    conversation.id, conversation.organization_id, conversation.project_id,
    conversation.engagement_id, conversation.department_id, conversation.owner_id,
    conversation.title, conversation.state, conversation.last_activity_at,
    conversation.archived_at, conversation.created_at, conversation.updated_at,
    case when conversation.owner_id = p_actor_id then 'owner' else 'recipient' end,
    exists (
      select 1 from public.department_chat_messages pending_message
      where pending_message.conversation_id = conversation.id
        and pending_message.organization_id = conversation.organization_id
        and pending_message.status = 'pending'
    ),
    exists (
      select 1 from public.department_chat_messages failed_message
      where failed_message.conversation_id = conversation.id
        and failed_message.organization_id = conversation.organization_id
        and failed_message.status in ('failed', 'unknown')
    )
  from public.department_chat_conversations conversation
  where conversation.organization_id = p_organization_id
    and conversation.project_id = p_project_id
    and conversation.engagement_id = p_engagement_id
    and conversation.department_id = p_department_id
    and (p_include_archived or conversation.state = 'active')
    and (
      conversation.owner_id = p_actor_id
      or exists (
        select 1 from public.department_chat_conversation_shares share
        where share.conversation_id = conversation.id
          and share.organization_id = conversation.organization_id
          and share.project_id = conversation.project_id
          and share.engagement_id = conversation.engagement_id
          and share.department_id = conversation.department_id
          and share.owner_id = conversation.owner_id
          and share.recipient_id = p_actor_id and share.revoked_at is null
      )
    )
    and (
      v_query is null
      or to_tsvector('simple', coalesce(conversation.title, '')) @@ v_tsquery
      or exists (
        select 1 from public.department_chat_messages message
        where message.conversation_id = conversation.id
          and message.organization_id = conversation.organization_id
          and message.project_id = conversation.project_id
          and message.engagement_id = conversation.engagement_id
          and message.department_id = conversation.department_id
          and message.owner_id = conversation.owner_id
          and to_tsvector('simple', coalesce(message.body, '')) @@ v_tsquery
      )
    )
    and (
      p_before_last_activity_at is null
      or conversation.last_activity_at < p_before_last_activity_at
      or (conversation.last_activity_at = p_before_last_activity_at and conversation.id > p_before_id)
    )
  order by conversation.last_activity_at desc, conversation.id
  limit p_limit;
end;
$$;

revoke all on function public.search_department_chat_conversations(
  uuid, uuid, uuid, text, uuid, text, boolean, integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.search_department_chat_conversations(
  uuid, uuid, uuid, text, uuid, text, boolean, integer, timestamptz, uuid
) to service_role;

comment on function public.search_department_chat_conversations(
  uuid, uuid, uuid, text, uuid, text, boolean, integer, timestamptz, uuid
) is
  'Returns only currently accessible saved conversations matching permitted title/message text, without snippets or match counts, using bounded keyset pagination.';

commit;
