-- P9 CHAT-3 - bounded, private Department Chat attachment ingestion and exact per-turn manifests.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'department-chat-attachments', 'department-chat-attachments', false, 5242880,
  array[
    'text/plain', 'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png', 'image/jpeg'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.department_chat_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  engagement_id uuid not null,
  department_id text not null,
  conversation_owner_id uuid not null references auth.users(id) on delete restrict,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  original_name text not null check (char_length(btrim(original_name)) between 1 and 200),
  claimed_mime text not null check (claimed_mime in (
    'text/plain', 'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png', 'image/jpeg'
  )),
  verified_mime text,
  byte_size bigint,
  sha256_hex text,
  staging_path text not null unique,
  final_path text unique,
  orphan_final_path text,
  status text not null default 'awaiting_upload' check (status in (
    'awaiting_upload', 'processing', 'extracted', 'reference_only', 'denied', 'failed', 'discarded'
  )),
  extraction_kind text check (extraction_kind in ('plain_text', 'main_document_text', 'reference_only')),
  extraction_notice text not null default '' check (char_length(extraction_notice) <= 500),
  extracted_text text,
  data_classification text not null check (data_classification in ('public', 'internal', 'confidential', 'restricted')),
  ai_use_allowed boolean not null,
  share_with_recipients boolean not null default false,
  failure_code text not null default '' check (char_length(failure_code) <= 80),
  upload_expires_at timestamptz not null,
  finalized_at timestamptz,
  discarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_chat_attachments_conversation_scope_fkey
    foreign key (conversation_id, organization_id, project_id, engagement_id, department_id, conversation_owner_id)
    references public.department_chat_conversations(id, organization_id, project_id, engagement_id, department_id, owner_id)
    on delete restrict,
  constraint department_chat_attachments_paths_check check (
    staging_path = organization_id::text || '/' || conversation_id::text || '/staging/' || id::text
    and (final_path is null or final_path = organization_id::text || '/' || conversation_id::text || '/final/' || id::text)
    and (orphan_final_path is null or orphan_final_path = organization_id::text || '/' || conversation_id::text || '/final/' || id::text)
  ),
  constraint department_chat_attachments_final_state_check check (
    (status = 'awaiting_upload' and final_path is null and verified_mime is null and byte_size is null
      and sha256_hex is null and extraction_kind is null and extracted_text is null and finalized_at is null and orphan_final_path is null)
    or (status = 'processing' and final_path is null and finalized_at is null and orphan_final_path is null)
    or (status in ('extracted', 'reference_only') and final_path is not null and verified_mime is not null
      and byte_size between 1 and 5242880 and sha256_hex ~ '^[0-9a-f]{64}$'
      and extraction_kind is not null and finalized_at is not null and failure_code = '' and orphan_final_path is null
      and ((status = 'extracted' and extraction_kind in ('plain_text', 'main_document_text')
        and extracted_text is not null and char_length(extracted_text) between 1 and 16000)
       or (status = 'reference_only' and extraction_kind = 'reference_only' and extracted_text is null)))
    or (status in ('denied', 'failed', 'discarded') and final_path is null and finalized_at is null
      and extracted_text is null and discarded_at is not null and failure_code <> ''
      and (status = 'failed' or orphan_final_path is null))
  ),
  constraint department_chat_attachments_ai_check check (
    not ai_use_allowed or data_classification <> 'restricted'
  ),
  constraint department_chat_attachments_sharing_check check (
    data_classification <> 'restricted' or not share_with_recipients
  ),
  constraint department_chat_attachments_verified_type_check check (
    verified_mime is null or verified_mime = claimed_mime
  ),
  constraint department_chat_attachments_extraction_type_check check (
    extraction_kind is null
    or (extraction_kind = 'reference_only' and verified_mime in ('image/png', 'image/jpeg'))
    or (extraction_kind = 'plain_text' and verified_mime in ('text/plain', 'text/markdown'))
    or (extraction_kind = 'main_document_text'
      and verified_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  ),
  constraint department_chat_attachments_docx_size_check check (
    claimed_mime <> 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    or byte_size is null or byte_size <= 4194304
  ),
  unique (id, organization_id)
);

create table public.department_chat_message_attachments (
  message_id uuid not null,
  conversation_id uuid not null,
  organization_id uuid not null,
  attachment_id uuid not null,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  position smallint not null check (position between 1 and 3),
  attachment_sha256_hex text not null check (attachment_sha256_hex ~ '^[0-9a-f]{64}$'),
  original_name text not null,
  verified_mime text not null,
  byte_size bigint not null check (byte_size between 1 and 5242880),
  extraction_kind text not null check (extraction_kind in ('plain_text', 'main_document_text', 'reference_only')),
  extraction_notice text not null,
  data_classification text not null check (data_classification in ('public', 'internal', 'confidential')),
  ai_use_allowed boolean not null check (ai_use_allowed or extraction_kind = 'reference_only'),
  share_with_recipients boolean not null,
  provider_dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (message_id, attachment_id),
  unique (message_id, position),
  constraint department_chat_message_attachments_message_scope_fkey
    foreign key (message_id, organization_id)
    references public.department_chat_messages(id, organization_id) on delete restrict,
  constraint department_chat_message_attachments_attachment_scope_fkey
    foreign key (attachment_id, organization_id)
    references public.department_chat_attachments(id, organization_id) on delete restrict
);

create index idx_department_chat_attachments_actor
  on public.department_chat_attachments(uploaded_by, organization_id, conversation_id, status, created_at desc);
create index idx_department_chat_message_attachments_conversation
  on public.department_chat_message_attachments(conversation_id, organization_id, message_id, position);

alter table public.department_chat_attachments enable row level security;
alter table public.department_chat_message_attachments enable row level security;
revoke all on table public.department_chat_attachments, public.department_chat_message_attachments
  from public, anon, authenticated;
grant all on table public.department_chat_attachments, public.department_chat_message_attachments to service_role;

create function public.reserve_department_chat_attachment(
  p_attachment_id uuid, p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid, p_original_name text,
  p_claimed_mime text, p_data_classification text, p_ai_use_allowed boolean,
  p_share_with_recipients boolean, p_upload_expires_at timestamptz
)
returns public.department_chat_attachments
language plpgsql security invoker set search_path = ''
as $$
declare v_conversation public.department_chat_conversations; v_attachment public.department_chat_attachments;
begin
  v_conversation := private.require_accessible_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, true
  );
  if p_attachment_id is null or p_upload_expires_at <= now()
     or p_upload_expires_at > now() + interval '2 hours 5 minutes' then
    raise exception 'Attachment reservation identity or expiry is invalid.' using errcode = '22023';
  end if;
  insert into public.department_chat_attachments (
    id, conversation_id, organization_id, project_id, engagement_id, department_id,
    conversation_owner_id, uploaded_by, original_name, claimed_mime, staging_path,
    data_classification, ai_use_allowed, share_with_recipients, upload_expires_at
  ) values (
    p_attachment_id, v_conversation.id, v_conversation.organization_id, v_conversation.project_id,
    v_conversation.engagement_id, v_conversation.department_id, v_conversation.owner_id,
    p_actor_id, btrim(p_original_name), p_claimed_mime,
    p_organization_id::text || '/' || p_conversation_id::text || '/staging/' || p_attachment_id::text,
    p_data_classification, p_ai_use_allowed, p_share_with_recipients, p_upload_expires_at
  ) returning * into v_attachment;
  return v_attachment;
end;
$$;

create function public.claim_department_chat_attachment_finalization(
  p_attachment_id uuid, p_conversation_id uuid, p_organization_id uuid,
  p_project_id uuid, p_engagement_id uuid, p_department_id text, p_actor_id uuid
)
returns public.department_chat_attachments
language plpgsql security invoker set search_path = ''
as $$
declare v_attachment public.department_chat_attachments;
begin
  perform private.require_accessible_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, true
  );
  update public.department_chat_attachments set status = 'processing', updated_at = now()
  where id = p_attachment_id and conversation_id = p_conversation_id
    and organization_id = p_organization_id and project_id = p_project_id
    and engagement_id = p_engagement_id and department_id = p_department_id
    and uploaded_by = p_actor_id and status = 'awaiting_upload'
    and upload_expires_at > now()
  returning * into v_attachment;
  if not found then
    raise exception 'Active attachment reservation not found.' using errcode = '42501';
  end if;
  return v_attachment;
end;
$$;

create function public.finish_department_chat_attachment(
  p_attachment_id uuid, p_actor_id uuid, p_verified_mime text, p_byte_size bigint,
  p_sha256_hex text, p_extraction_kind text, p_extraction_notice text, p_extracted_text text
)
returns public.department_chat_attachments
language plpgsql security invoker set search_path = ''
as $$
declare v_attachment public.department_chat_attachments;
begin
  select * into v_attachment from public.department_chat_attachments
  where id = p_attachment_id and uploaded_by = p_actor_id and status = 'processing'
  for update;
  if not found then raise exception 'Attachment finalization was not claimed.' using errcode = '42501'; end if;
  perform private.require_accessible_department_chat_conversation(
    v_attachment.conversation_id, v_attachment.organization_id, v_attachment.project_id,
    v_attachment.engagement_id, v_attachment.department_id, p_actor_id, true
  );
  update public.department_chat_attachments set
    status = case when p_extraction_kind = 'reference_only' then 'reference_only' else 'extracted' end,
    verified_mime = p_verified_mime, byte_size = p_byte_size, sha256_hex = p_sha256_hex,
    final_path = organization_id::text || '/' || conversation_id::text || '/final/' || id::text,
    extraction_kind = p_extraction_kind, extraction_notice = p_extraction_notice,
    extracted_text = p_extracted_text, finalized_at = now(), updated_at = now()
  where id = p_attachment_id and uploaded_by = p_actor_id and status = 'processing'
  returning * into v_attachment;
  return v_attachment;
end;
$$;

create function public.fail_department_chat_attachment(
  p_attachment_id uuid, p_actor_id uuid, p_status text, p_failure_code text,
  p_orphan_final_path text default null
)
returns public.department_chat_attachments
language plpgsql security invoker set search_path = ''
as $$
declare v_attachment public.department_chat_attachments;
begin
  if p_status not in ('denied', 'failed', 'discarded') then raise exception 'Invalid attachment failure state.' using errcode = '22023'; end if;
  update public.department_chat_attachments set status = p_status, final_path = null,
    orphan_final_path = case when p_status = 'failed' then p_orphan_final_path else null end,
    verified_mime = null, byte_size = null, sha256_hex = null, extraction_kind = null,
    extraction_notice = '', extracted_text = null, finalized_at = null,
    failure_code = left(btrim(coalesce(nullif(p_failure_code, ''), 'attachment_failed')), 80),
    discarded_at = now(), updated_at = now()
  where id = p_attachment_id and uploaded_by = p_actor_id
    and status in ('awaiting_upload', 'processing') returning * into v_attachment;
  if not found then raise exception 'Mutable attachment reservation not found.' using errcode = '42501'; end if;
  if p_orphan_final_path is not null and (
    p_status <> 'failed' or p_orphan_final_path <> v_attachment.organization_id::text || '/' ||
      v_attachment.conversation_id::text || '/final/' || v_attachment.id::text
  ) then raise exception 'Orphan cleanup path is invalid.' using errcode = '22023'; end if;
  return v_attachment;
end;
$$;

create function public.begin_department_chat_turn_with_attachments(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid,
  p_client_request_id uuid, p_prompt text, p_attachment_ids uuid[]
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare v_result jsonb; v_message_id uuid; v_ids uuid[] := coalesce(p_attachment_ids, '{}'::uuid[]);
begin
  if cardinality(v_ids) > 3
     or cardinality(v_ids) <> (select count(distinct item.id) from unnest(v_ids) item(id)) then
    raise exception 'Choose up to three distinct attachments.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.department_chat_message_attachments link
    join public.department_chat_attachments attachment on attachment.id = link.attachment_id
    where link.conversation_id = p_conversation_id and link.organization_id = p_organization_id
      and not private.is_current_department_chat_contributor(
        attachment.organization_id, attachment.project_id, attachment.engagement_id,
        attachment.department_id, attachment.uploaded_by
      )
  ) then
    raise exception 'Conversation contains a source whose contributor authorization was revoked.' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(v_ids) item(id)
    left join public.department_chat_attachments attachment
      on attachment.id = item.id and attachment.conversation_id = p_conversation_id
      and attachment.organization_id = p_organization_id and attachment.project_id = p_project_id
      and attachment.engagement_id = p_engagement_id and attachment.department_id = p_department_id
    where attachment.id is null or attachment.status not in ('extracted', 'reference_only')
      or (attachment.extraction_kind <> 'reference_only' and not attachment.ai_use_allowed)
      or attachment.data_classification = 'restricted'
      or (attachment.uploaded_by <> p_actor_id and not attachment.share_with_recipients)
      or not private.is_current_department_chat_contributor(
        attachment.organization_id, attachment.project_id, attachment.engagement_id,
        attachment.department_id, attachment.uploaded_by
      )
  ) then
    raise exception 'An attachment is unavailable, unsafe for AI use, or no longer authorized.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.department_chat_conversation_shares share
    where share.conversation_id = p_conversation_id and share.organization_id = p_organization_id
      and share.revoked_at is null
  ) and exists (
    select 1 from public.department_chat_attachments attachment
    where attachment.id = any(v_ids) and not attachment.share_with_recipients
  ) then
    raise exception 'Every source used in a shared conversation must be explicitly shareable.' using errcode = '42501';
  end if;
  select public.begin_department_chat_turn(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, p_client_request_id, p_prompt
  ) into v_result;
  v_message_id := (v_result->'message'->>'id')::uuid;
  if coalesce((v_result->>'replayed')::boolean, false) then
    if (select coalesce(array_agg(link.attachment_id order by link.position), '{}'::uuid[])
        from public.department_chat_message_attachments link where link.message_id = v_message_id) <> v_ids then
      raise exception 'client_request_id conflicts with a different attachment manifest.' using errcode = '23505';
    end if;
    return v_result;
  end if;
  insert into public.department_chat_message_attachments (
    message_id, conversation_id, organization_id, attachment_id, uploaded_by, position,
    attachment_sha256_hex, original_name, verified_mime, byte_size, extraction_kind,
    extraction_notice, data_classification, ai_use_allowed, share_with_recipients
  )
  select v_message_id, attachment.conversation_id, attachment.organization_id, attachment.id,
    attachment.uploaded_by, selected.ordinality, attachment.sha256_hex, attachment.original_name, attachment.verified_mime,
    attachment.byte_size, attachment.extraction_kind, attachment.extraction_notice,
    attachment.data_classification, attachment.ai_use_allowed, attachment.share_with_recipients
  from unnest(v_ids) with ordinality selected(id, ordinality)
  join public.department_chat_attachments attachment on attachment.id = selected.id;
  return v_result;
end;
$$;

create function private.block_unsafe_department_chat_share()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.revoked_at is null and exists (
    select 1 from public.department_chat_message_attachments link
    where link.conversation_id = new.conversation_id
      and link.organization_id = new.organization_id and not link.share_with_recipients
  ) then
    raise exception 'Conversation contains sources that were not approved for recipient sharing.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger department_chat_share_source_guard
before insert or update of revoked_at on public.department_chat_conversation_shares
for each row execute function private.block_unsafe_department_chat_share();

create function private.guard_department_chat_attachment_dispatch()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.provider_dispatched_at is null and new.provider_dispatched_at is not null and exists (
    select 1 from public.department_chat_message_attachments link
    join public.department_chat_attachments attachment on attachment.id = link.attachment_id
    where link.message_id = new.id
      and (attachment.status not in ('extracted', 'reference_only')
        or attachment.sha256_hex <> link.attachment_sha256_hex
        or not private.is_current_department_chat_contributor(
          attachment.organization_id, attachment.project_id, attachment.engagement_id,
          attachment.department_id, attachment.uploaded_by
        ))
  ) then
    raise exception 'An attachment source is no longer available for dispatch.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger department_chat_attachment_dispatch_guard
before update of provider_dispatched_at on public.department_chat_messages
for each row execute function private.guard_department_chat_attachment_dispatch();

create function private.mark_department_chat_attachment_dispatch()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.provider_dispatched_at is null and new.provider_dispatched_at is not null then
    update public.department_chat_message_attachments
    set provider_dispatched_at = new.provider_dispatched_at
    where message_id = new.id and extraction_kind <> 'reference_only'
      and provider_dispatched_at is null;
  end if;
  return new;
end;
$$;
create trigger department_chat_attachment_dispatch_marker
after update of provider_dispatched_at on public.department_chat_messages
for each row execute function private.mark_department_chat_attachment_dispatch();

create function private.protect_department_chat_attachment_records()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Department Chat attachment records are retained as provenance.' using errcode = '23514'; end if;
  if old.status in ('extracted', 'reference_only') and new is distinct from old then
    raise exception 'Finalized Department Chat attachment identity is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger department_chat_attachment_record_protector
before update or delete on public.department_chat_attachments
for each row execute function private.protect_department_chat_attachment_records();

create function private.protect_department_chat_attachment_manifest()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Department Chat attachment manifests are append-only.' using errcode = '23514'; end if;
  if (to_jsonb(new) - 'provider_dispatched_at') <> (to_jsonb(old) - 'provider_dispatched_at')
     or old.provider_dispatched_at is not null or new.provider_dispatched_at is null then
    raise exception 'Department Chat attachment manifest is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger department_chat_attachment_manifest_protector
before update or delete on public.department_chat_message_attachments
for each row execute function private.protect_department_chat_attachment_manifest();

revoke all on function public.reserve_department_chat_attachment(uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_department_chat_attachment_finalization(uuid, uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_department_chat_attachment(uuid, uuid, text, bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fail_department_chat_attachment(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.begin_department_chat_turn_with_attachments(uuid, uuid, uuid, uuid, text, uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.reserve_department_chat_attachment(uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, boolean, boolean, timestamptz) to service_role;
grant execute on function public.claim_department_chat_attachment_finalization(uuid, uuid, uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.finish_department_chat_attachment(uuid, uuid, text, bigint, text, text, text, text) to service_role;
grant execute on function public.fail_department_chat_attachment(uuid, uuid, text, text, text) to service_role;
grant execute on function public.begin_department_chat_turn_with_attachments(uuid, uuid, uuid, uuid, text, uuid, uuid, text, uuid[]) to service_role;

comment on table public.department_chat_attachments is
  'Server-only private CHAT-3 source records. Final objects are immutable and separate from signed-upload staging paths.';
comment on table public.department_chat_message_attachments is
  'Immutable exact per-turn attachment manifest, including hash, classification, extraction scope and source-sharing choice.';
commit;
