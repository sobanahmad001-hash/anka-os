-- Candidate only. Existing private attachment lifecycle/paths/retention retained.
-- No new table, authenticated grants, Storage policy or provider eligibility.
begin;
alter table public.department_chat_attachments
  add column source_kind text not null default 'department_chat',
  add column import_inspection jsonb,
  alter column engagement_id drop not null,
  alter column department_id drop not null;
alter table public.department_chat_attachments
  add constraint department_chat_attachments_source_kind_check check (
    source_kind = 'department_chat' and engagement_id is not null and department_id is not null
      and import_inspection is null
      and claimed_mime in ('text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg')
    or source_kind = 'project_spreadsheet' and engagement_id is null and department_id is null
      and not ai_use_allowed and not share_with_recipients
      and claimed_mime in ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      and (byte_size is null or byte_size <= 2097152)
      and extracted_text is null
      and (extraction_kind is null or extraction_kind = 'reference_only')
  ),
  add constraint department_chat_attachments_import_inspection_check check (
    import_inspection is null or source_kind = 'project_spreadsheet'
      and jsonb_typeof(import_inspection) = 'object'
      and octet_length(import_inspection::text) <= 32768
  ),
  add constraint department_chat_attachments_project_owner_scope_fkey
    foreign key (conversation_id, organization_id, project_id, conversation_owner_id)
    references public.department_chat_conversations(id, organization_id, project_id, owner_id)
    on delete restrict;
alter table public.department_chat_attachments drop constraint department_chat_attachments_claimed_mime_check;
alter table public.department_chat_attachments add constraint department_chat_attachments_claimed_mime_check check (
  claimed_mime in ('text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg',
    'text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
);
alter table public.department_chat_attachments drop constraint department_chat_attachments_extraction_type_check;
alter table public.department_chat_attachments add constraint department_chat_attachments_extraction_type_check check (
  extraction_kind is null
  or extraction_kind = 'reference_only' and (
    verified_mime in ('image/png','image/jpeg') and source_kind = 'department_chat'
    or verified_mime in ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') and source_kind = 'project_spreadsheet')
  or extraction_kind = 'plain_text' and verified_mime in ('text/plain','text/markdown') and source_kind = 'department_chat'
  or extraction_kind = 'main_document_text' and verified_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and source_kind = 'department_chat'
);

-- This exact owner check is independent of Project Chat sharing. Canonical
-- draft confirmation will separately recheck Content write authority.
create function private.require_owned_project_import_chat(p_conversation_id uuid, p_organization_id uuid, p_actor_id uuid)
returns public.department_chat_conversations language plpgsql security invoker set search_path = '' as $$
declare conversation public.department_chat_conversations;
begin
  select c.* into conversation from public.department_chat_conversations c
    join public.organizations o on o.id=c.organization_id and o.status='active'
    join public.projects p on p.id=c.project_id and p.organization_id=c.organization_id and p.archived_at is null
    join public.organization_memberships m on m.organization_id=c.organization_id
      and m.user_id=p_actor_id and m.member_kind='team' and m.status='active'
    where c.id=p_conversation_id and c.organization_id=p_organization_id
      and c.owner_id=p_actor_id and c.context_kind='project_team' and c.state='active'
    for share of c,o,p,m;
  if not found then raise exception 'Active owned Project Chat required' using errcode='42501'; end if;
  return conversation;
end; $$;

create function private.guard_project_import_attachment_source()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare conversation public.department_chat_conversations;
begin
  if tg_op='UPDATE' and (
    new.source_kind is distinct from old.source_kind or new.conversation_id is distinct from old.conversation_id
    or new.organization_id is distinct from old.organization_id or new.project_id is distinct from old.project_id
    or new.engagement_id is distinct from old.engagement_id or new.department_id is distinct from old.department_id
    or new.conversation_owner_id is distinct from old.conversation_owner_id or new.uploaded_by is distinct from old.uploaded_by
    or new.original_name is distinct from old.original_name or new.claimed_mime is distinct from old.claimed_mime
    or new.data_classification is distinct from old.data_classification or new.ai_use_allowed is distinct from old.ai_use_allowed
    or new.share_with_recipients is distinct from old.share_with_recipients
  ) and (old.source_kind='project_spreadsheet' or new.source_kind='project_spreadsheet') then
    raise exception 'Private import source identity is immutable' using errcode='23514';
  end if;
  -- Existing failure/orphan cleanup must remain possible after revocation.
  -- Access is required for reservation and successful finalization, while
  -- immutable identity applies to every transition.
  if new.source_kind='project_spreadsheet' and (tg_op='INSERT' or new.status='reference_only') then
    conversation:=private.require_owned_project_import_chat(new.conversation_id,new.organization_id,new.uploaded_by);
    if new.project_id is distinct from conversation.project_id or new.conversation_owner_id is distinct from conversation.owner_id then
      raise exception 'Import project must derive from its owned conversation' using errcode='42501';
    end if;
  end if;
  return new;
end; $$;
create trigger project_import_attachment_source_guard before insert or update
  on public.department_chat_attachments for each row execute function private.guard_project_import_attachment_source();

create function public.reserve_project_chat_import_attachment(
  p_attachment_id uuid,p_conversation_id uuid,p_organization_id uuid,p_actor_id uuid,
  p_original_name text,p_claimed_mime text,p_data_classification text,p_upload_expires_at timestamptz
) returns public.department_chat_attachments language plpgsql security invoker set search_path = '' as $$
declare conversation public.department_chat_conversations; attachment public.department_chat_attachments;
begin
  conversation:=private.require_owned_project_import_chat(p_conversation_id,p_organization_id,p_actor_id);
  if p_attachment_id is null or p_upload_expires_at is null or p_upload_expires_at<=now()
    or p_upload_expires_at>now()+interval '2 hours 5 minutes' then
    raise exception 'Exact import reservation identity and bounded expiry required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':project-import-source:'||p_attachment_id::text,0));
  select * into attachment from public.department_chat_attachments where id=p_attachment_id;
  if found then
    if attachment.source_kind<>'project_spreadsheet' or attachment.conversation_id<>conversation.id
      or attachment.organization_id<>p_organization_id or attachment.uploaded_by<>p_actor_id
      or attachment.original_name is distinct from btrim(p_original_name)
      or attachment.claimed_mime is distinct from p_claimed_mime
      or attachment.data_classification is distinct from p_data_classification
      or attachment.upload_expires_at is distinct from p_upload_expires_at then
      raise exception 'Import reservation UUID has different original input' using errcode='23505';
    end if;
    return attachment;
  end if;
  insert into public.department_chat_attachments(
    id,conversation_id,organization_id,project_id,conversation_owner_id,uploaded_by,
    original_name,claimed_mime,staging_path,data_classification,ai_use_allowed,share_with_recipients,upload_expires_at,source_kind
  ) values(p_attachment_id,conversation.id,p_organization_id,conversation.project_id,conversation.owner_id,p_actor_id,
    btrim(p_original_name),p_claimed_mime,p_organization_id::text||'/'||conversation.id::text||'/staging/'||p_attachment_id::text,
    p_data_classification,false,false,p_upload_expires_at,'project_spreadsheet') returning * into attachment;
  return attachment;
end; $$;

create function public.claim_project_chat_import_attachment(p_attachment_id uuid,p_organization_id uuid,p_actor_id uuid)
returns public.department_chat_attachments language plpgsql security invoker set search_path = '' as $$
declare attachment public.department_chat_attachments;
begin
  select * into attachment from public.department_chat_attachments where id=p_attachment_id
    and organization_id=p_organization_id and uploaded_by=p_actor_id and source_kind='project_spreadsheet';
  if not found then raise exception 'Private import source unavailable' using errcode='42501'; end if;
  perform private.require_owned_project_import_chat(attachment.conversation_id,p_organization_id,p_actor_id);
  select * into attachment from public.department_chat_attachments where id=p_attachment_id for update;
  if attachment.status='reference_only' then return attachment; end if;
  if attachment.status<>'awaiting_upload' or attachment.upload_expires_at<=now() then
    raise exception 'Import source is expired or processing; recover the original receipt' using errcode='55000';
  end if;
  update public.department_chat_attachments set status='processing',updated_at=now()
    where id=p_attachment_id returning * into attachment;
  return attachment;
end; $$;

create function public.finish_project_chat_import_attachment(
  p_attachment_id uuid,p_organization_id uuid,p_actor_id uuid,p_verified_mime text,
  p_byte_size bigint,p_sha256_hex text,p_inspection jsonb,p_notice text
) returns public.department_chat_attachments language plpgsql security invoker set search_path = '' as $$
declare attachment public.department_chat_attachments;
begin
  -- Trusted parser must verify exact bytes before this service-only call. The
  -- inspection is bounded private metadata, never provider context or memory.
  if p_byte_size is null or p_byte_size<1 or p_byte_size>2097152
    or p_sha256_hex is null or p_sha256_hex !~ '^[0-9a-f]{64}$'
    or p_inspection is null or jsonb_typeof(p_inspection)<>'object'
    or octet_length(p_inspection::text)>32768 or p_notice is null or char_length(p_notice)>500 then
    raise exception 'Bounded verified source and inspection required' using errcode='22023';
  end if;
  select * into attachment from public.department_chat_attachments where id=p_attachment_id
    and organization_id=p_organization_id and uploaded_by=p_actor_id and source_kind='project_spreadsheet';
  if not found then raise exception 'Private import source unavailable' using errcode='42501'; end if;
  perform private.require_owned_project_import_chat(attachment.conversation_id,p_organization_id,p_actor_id);
  select * into attachment from public.department_chat_attachments where id=p_attachment_id for update;
  if attachment.status='reference_only' then
    if attachment.verified_mime is distinct from p_verified_mime or attachment.byte_size is distinct from p_byte_size
      or attachment.sha256_hex is distinct from p_sha256_hex or attachment.import_inspection is distinct from p_inspection
      or attachment.extraction_notice is distinct from p_notice then
      raise exception 'Finalized import has different original bytes or inspection' using errcode='23505';
    end if;
    return attachment;
  end if;
  if attachment.status<>'processing' or attachment.claimed_mime is distinct from p_verified_mime then
    raise exception 'Exact claimed source/type required' using errcode='42501';
  end if;
  update public.department_chat_attachments set status='reference_only',verified_mime=p_verified_mime,
    byte_size=p_byte_size,sha256_hex=p_sha256_hex,extraction_kind='reference_only',extracted_text=null,
    extraction_notice=p_notice,import_inspection=p_inspection,
    final_path=organization_id::text||'/'||conversation_id::text||'/final/'||id::text,
    finalized_at=now(),updated_at=now()
    where id=p_attachment_id returning * into attachment;
  return attachment;
end; $$;

-- Existing bucket remains private and its current five-MB cap is not increased.
do $$ begin
  if not exists(select 1 from storage.buckets where id='department-chat-attachments'
    and public=false and file_size_limit=5242880) then
    raise exception 'Expected private attachment bucket contract changed';
  end if;
end; $$;
update storage.buckets set allowed_mime_types=array(
  select distinct mime from unnest(allowed_mime_types||array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) mime
) where id='department-chat-attachments';

revoke all on function private.require_owned_project_import_chat(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function private.guard_project_import_attachment_source() from public,anon,authenticated;
revoke all on function public.reserve_project_chat_import_attachment(uuid,uuid,uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_project_chat_import_attachment(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_project_chat_import_attachment(uuid,uuid,uuid,text,bigint,text,jsonb,text) from public,anon,authenticated;
grant execute on function private.require_owned_project_import_chat(uuid,uuid,uuid),private.guard_project_import_attachment_source(),
  public.reserve_project_chat_import_attachment(uuid,uuid,uuid,uuid,text,text,text,timestamptz),
  public.claim_project_chat_import_attachment(uuid,uuid,uuid),
  public.finish_project_chat_import_attachment(uuid,uuid,uuid,text,bigint,text,jsonb,text) to service_role;
commit;
