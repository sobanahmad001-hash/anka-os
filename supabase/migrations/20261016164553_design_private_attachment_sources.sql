begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Separate owner-private records. Existing project attachments and historical rows
-- retain their project foreign keys, source-kind engagement guards and policies.
create table public.design_private_attachments (
 id uuid primary key,
 organization_id uuid not null,
 conversation_id uuid not null,
 owner_id uuid not null,
 original_name text not null check(length(original_name) between 1 and 200),
 claimed_mime text not null check(claimed_mime in ('text/plain','text/markdown','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg')),
 declared_bytes integer not null check(declared_bytes between 1 and 5242880),
 expected_sha256 text not null check(expected_sha256 ~ '^[0-9a-f]{64}$'),
 classification text not null check(classification in ('public','internal','confidential')),
 ai_use_allowed boolean not null,
 status text not null default 'reserved' check(status in ('reserved','ready','revoked')),
 verified_mime text,
 extraction_kind text check(extraction_kind in ('plain_text','main_document_text','pdf_text','reference_only')),
 extracted_text text check(length(extracted_text) between 1 and 16000),
 extraction_notice text not null default '' check(length(extraction_notice)<=500),
 created_at timestamptz not null default clock_timestamp(),
 finalized_at timestamptz,
 revoked_at timestamptz,
 unique(id,organization_id,conversation_id,owner_id),
 foreign key(conversation_id,organization_id,owner_id)
 references public.department_chat_conversations(id,organization_id,owner_id) on delete restrict,
 check(claimed_mime <> 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or declared_bytes<=4194304),
 check(claimed_mime in ('image/png','image/jpeg') or ai_use_allowed),
 check(status <> 'ready' or (verified_mime=claimed_mime and finalized_at is not null and extraction_kind is not null
  and ((extraction_kind='reference_only' and extracted_text is null and verified_mime in ('image/png','image/jpeg'))
    or (extraction_kind<>'reference_only' and extracted_text is not null and ai_use_allowed))))
);
create index design_private_attachments_scope on public.design_private_attachments(conversation_id,created_at,id);
alter table public.design_private_attachments enable row level security;
revoke all on public.design_private_attachments from public,anon,authenticated,service_role;
grant select,insert,update on public.design_private_attachments to service_role;

create table public.design_private_message_sources (
 message_id uuid not null references public.department_chat_messages(id) on delete restrict,
 organization_id uuid not null,
 conversation_id uuid not null,
 owner_id uuid not null,
 attachment_id uuid not null,
 position integer not null check(position between 1 and 3),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_mime text not null,
 extraction_kind text not null,
 extraction_revision text not null default 'design-attachment-v1' check(extraction_revision='design-attachment-v1'),
 classification text not null,
 ai_use_allowed boolean not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(message_id,attachment_id),unique(message_id,position),
 foreign key(attachment_id,organization_id,conversation_id,owner_id)
 references public.design_private_attachments(id,organization_id,conversation_id,owner_id) on delete restrict
);
alter table public.design_private_message_sources enable row level security;
revoke all on public.design_private_message_sources from public,anon,authenticated,service_role;
grant select,insert on public.design_private_message_sources to service_role;
create trigger design_private_sources_immutable before update or delete on public.design_private_message_sources
 for each row execute function private.reject_pipeline_template_mutation();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('design-private-attachments','design-private-attachments',false,5242880,
 array['text/plain','text/markdown','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg']);
-- No object policies: service-mediated signed no-overwrite upload only.

create function private.require_design_private_attachment_owner(p_org uuid,p_conversation uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare m public.organization_memberships;
begin
 perform 1 from public.organizations where id=p_org and status='active' for share;
 if not found then raise exception 'Active organization required' using errcode='42501'; end if;
 select * into m from public.organization_memberships where organization_id=p_org and user_id=p_actor
 and status='active' and member_kind='team' for share;
 if not found then raise exception 'Active team membership required' using errcode='42501'; end if;
 if not coalesce(m.role in ('system_owner','operations_admin','executive'),false) and m.department_id is distinct from 'design' then
  perform 1 from public.organization_department_memberships where organization_id=p_org and user_id=p_actor and department_id='design' and status='active' for share;
  if not found then raise exception 'Current Design access required' using errcode='42501'; end if;
 end if;
 perform 1 from public.department_chat_conversations where id=p_conversation and organization_id=p_org and owner_id=p_actor
 and context_kind='department_private' and department_id='design' and project_id is null and engagement_id is null and state='active' for update;
 if not found then raise exception 'Active owner-private Design conversation required' using errcode='42501'; end if;
end; $$;
revoke all on function private.require_design_private_attachment_owner(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.require_design_private_attachment_owner(uuid,uuid,uuid) to service_role;

-- Disclosed Upload uses the existing create_context_conversation endpoint with
-- this stable ID. A retry cannot adopt another owner/scope or create a duplicate.
create function public.create_design_private_upload_conversation(p_org uuid,p_actor uuid,p_id uuid)
returns public.department_chat_conversations language plpgsql security invoker set search_path='' as $$
declare c public.department_chat_conversations;
begin
 if p_id is null or p_actor is null or p_org is null then raise exception 'Exact conversation identity required' using errcode='22023'; end if;
 insert into public.department_chat_conversations(id,organization_id,owner_id,context_kind,department_id,title)
 values(p_id,p_org,p_actor,'department_private','design','New conversation') on conflict(id) do nothing;
 perform private.require_design_private_attachment_owner(p_org,p_id,p_actor);
 select * into c from public.department_chat_conversations where id=p_id;
 return c;
end; $$;
revoke all on function public.create_design_private_upload_conversation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_design_private_upload_conversation(uuid,uuid,uuid) to service_role;

create function public.reserve_design_private_attachment(p_org uuid,p_conversation uuid,p_actor uuid,p_id uuid,p_name text,p_mime text,p_bytes integer,p_sha text,p_classification text,p_consent boolean)
returns public.design_private_attachments language plpgsql security invoker set search_path='' as $$
declare a public.design_private_attachments;
begin
 perform private.require_design_private_attachment_owner(p_org,p_conversation,p_actor);
 -- Serialize per-conversation quota and same-key reservations.
 perform 1 from public.department_chat_conversations where id=p_conversation for update;
 select * into a from public.design_private_attachments where id=p_id;
 if found then
  if a.organization_id is distinct from p_org or a.conversation_id is distinct from p_conversation or a.owner_id is distinct from p_actor
   or a.original_name is distinct from p_name or a.claimed_mime is distinct from p_mime or a.declared_bytes is distinct from p_bytes
   or a.expected_sha256 is distinct from p_sha or a.classification is distinct from p_classification or a.ai_use_allowed is distinct from p_consent then
   raise exception 'Upload request already used with different inputs' using errcode='23505';
  end if;
  if a.status='revoked' then raise exception 'Upload revoked' using errcode='42501'; end if;
  return a;
 end if;
 if (select count(*) from public.design_private_attachments where conversation_id=p_conversation)>=100 then
  raise exception 'Conversation attachment limit reached' using errcode='23514';
 end if;
 insert into public.design_private_attachments(id,organization_id,conversation_id,owner_id,original_name,claimed_mime,declared_bytes,expected_sha256,classification,ai_use_allowed)
 values(p_id,p_org,p_conversation,p_actor,p_name,p_mime,p_bytes,p_sha,p_classification,p_consent) returning * into a;
 return a;
end; $$;
revoke all on function public.reserve_design_private_attachment(uuid,uuid,uuid,uuid,text,text,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.reserve_design_private_attachment(uuid,uuid,uuid,uuid,text,text,integer,text,text,boolean) to service_role;

create function public.read_design_private_attachments(p_org uuid,p_conversation uuid,p_actor uuid)
returns setof public.design_private_attachments language plpgsql security invoker set search_path='' as $$
begin
 perform private.require_design_private_attachment_owner(p_org,p_conversation,p_actor);
 return query select * from public.design_private_attachments where organization_id=p_org and conversation_id=p_conversation and owner_id=p_actor order by created_at,id limit 100;
end; $$;
revoke all on function public.read_design_private_attachments(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_design_private_attachments(uuid,uuid,uuid) to service_role;

create function public.finalize_design_private_attachment(p_org uuid,p_conversation uuid,p_actor uuid,p_id uuid,p_sha text,p_bytes integer,p_mime text,p_kind text,p_text text,p_notice text)
returns public.design_private_attachments language plpgsql security invoker set search_path='' as $$
declare a public.design_private_attachments;
begin
 perform private.require_design_private_attachment_owner(p_org,p_conversation,p_actor);
 select * into a from public.design_private_attachments where id=p_id and organization_id=p_org and conversation_id=p_conversation and owner_id=p_actor for update;
 if not found or a.status='revoked' then raise exception 'Upload unavailable' using errcode='42501'; end if;
 if a.expected_sha256 is distinct from p_sha or a.declared_bytes is distinct from p_bytes or a.claimed_mime is distinct from p_mime then
  raise exception 'Immutable source checksum, length or MIME mismatch' using errcode='23514';
 end if;
 if a.status='ready' then
  if a.extraction_kind is distinct from p_kind or a.extracted_text is distinct from p_text or a.extraction_notice is distinct from p_notice then
   raise exception 'Finalized extraction mismatch' using errcode='23505';
  end if;
  return a;
 end if;
 update public.design_private_attachments set status='ready',verified_mime=p_mime,extraction_kind=p_kind,extracted_text=p_text,extraction_notice=p_notice,finalized_at=clock_timestamp()
 where id=p_id returning * into a;
 return a;
end; $$;
revoke all on function public.finalize_design_private_attachment(uuid,uuid,uuid,uuid,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.finalize_design_private_attachment(uuid,uuid,uuid,uuid,text,integer,text,text,text,text) to service_role;

create function public.revoke_design_private_attachment(p_org uuid,p_conversation uuid,p_actor uuid,p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform private.require_design_private_attachment_owner(p_org,p_conversation,p_actor);
 update public.design_private_attachments set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp())
 where id=p_id and organization_id=p_org and conversation_id=p_conversation and owner_id=p_actor;
 if not found then raise exception 'Upload unavailable' using errcode='42501'; end if;
end; $$;
revoke all on function public.revoke_design_private_attachment(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_design_private_attachment(uuid,uuid,uuid,uuid) to service_role;

create function public.append_design_private_message_sources(p_org uuid,p_conversation uuid,p_actor uuid,p_request uuid,p_body text,p_ids uuid[])
returns public.department_chat_messages language plpgsql security invoker set search_path='' as $$
declare msg public.department_chat_messages; a public.design_private_attachments; n integer:=0; chars integer:=0; existing uuid[]; source_id uuid;
begin
 if p_ids is null or cardinality(p_ids)>3 or array_position(p_ids,null) is not null
 or cardinality(p_ids)<>(select count(distinct v) from unnest(p_ids) v) then raise exception 'Choose up to three distinct sources' using errcode='22023'; end if;
 perform private.require_design_private_attachment_owner(p_org,p_conversation,p_actor);
 perform 1 from public.department_chat_conversations where id=p_conversation for update;
 select * into msg from public.department_chat_messages where conversation_id=p_conversation and client_request_id=p_request and role='user';
 if found then
  select coalesce(array_agg(attachment_id order by position),'{}'::uuid[]) into existing from public.design_private_message_sources where message_id=msg.id;
  if existing is distinct from p_ids or msg.body is distinct from btrim(p_body) or msg.author_id is distinct from p_actor then
   raise exception 'Message retry differs from original request' using errcode='23505';
  end if;
  return msg;
 end if;
 -- Lock in deterministic order; revocation that commits first denies dispatch.
 perform 1 from public.design_private_attachments where id=any(p_ids) order by id for share;
 foreach source_id in array p_ids loop
  select * into a from public.design_private_attachments where id=source_id and organization_id=p_org and conversation_id=p_conversation and owner_id=p_actor and status='ready';
  if not found then raise exception 'Selected source unavailable' using errcode='42501'; end if;
  chars:=chars+coalesce(length(a.extracted_text),0);
 end loop;
 if chars>24000 then raise exception 'Selected source text exceeds turn limit; nothing truncated' using errcode='23514'; end if;
 msg:=public.append_context_chat_human_message(p_conversation,p_org,p_actor,p_request,p_body);
 foreach source_id in array p_ids loop
  select * into a from public.design_private_attachments where id=source_id;
  n:=n+1;
  insert into public.design_private_message_sources(message_id,organization_id,conversation_id,owner_id,attachment_id,position,source_sha256,source_mime,extraction_kind,classification,ai_use_allowed)
  values(msg.id,p_org,p_conversation,p_actor,a.id,n,a.expected_sha256,a.verified_mime,a.extraction_kind,a.classification,a.ai_use_allowed);
 end loop;
 return msg;
end; $$;
revoke all on function public.append_design_private_message_sources(uuid,uuid,uuid,uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.append_design_private_message_sources(uuid,uuid,uuid,uuid,text,uuid[]) to service_role;

-- The immutable existing claim remains the dispatch boundary. This additive
-- trigger takes source locks in the same transaction, before the claim exists.
create function private.guard_design_private_source_dispatch() returns trigger language plpgsql security invoker set search_path='' as $$
declare s record;
begin
 for s in select m.*,a.status,a.expected_sha256 from public.design_private_message_sources m join public.design_private_attachments a on a.id=m.attachment_id
 where m.message_id=new.message_id order by a.id for share of a loop
  if s.organization_id<>new.organization_id or s.owner_id<>new.actor_id or s.conversation_id<>new.conversation_id or s.status<>'ready' or s.source_sha256<>s.expected_sha256 then
   raise exception 'Selected Design source revoked or changed' using errcode='42501';
  end if;
  -- Current actor scope is already locked and checked by claim_context_chat_dispatch.
 end loop;
 return new;
end; $$;
revoke all on function private.guard_design_private_source_dispatch() from public,anon,authenticated,service_role;
create trigger design_private_source_dispatch_guard before insert on private.context_chat_dispatch_claims for each row execute function private.guard_design_private_source_dispatch();

-- Source identity is immutable even to the service role. Only one verified
-- finalization and a monotonic revocation are permitted; originals are retained.
create function private.protect_design_private_attachment_original() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Original Design sources are retained' using errcode='42501'; end if;
 if (to_jsonb(new)-array['status','verified_mime','extraction_kind','extracted_text','extraction_notice','finalized_at','revoked_at'])
 is distinct from (to_jsonb(old)-array['status','verified_mime','extraction_kind','extracted_text','extraction_notice','finalized_at','revoked_at']) then
  raise exception 'Original Design source identity is immutable' using errcode='42501';
 end if;
 if old.status in ('ready','revoked') and
 (new.verified_mime,new.extraction_kind,new.extracted_text,new.extraction_notice,new.finalized_at)
 is distinct from (old.verified_mime,old.extraction_kind,old.extracted_text,old.extraction_notice,old.finalized_at) then
  raise exception 'Verified Design extraction is immutable' using errcode='42501';
 end if;
 if old.status='revoked' and new is distinct from old or old.status='ready' and new.status not in ('ready','revoked') then
  raise exception 'Design source cannot be revived' using errcode='42501';
 end if;
 return new;
end;$$;
revoke all on function private.protect_design_private_attachment_original() from public,anon,authenticated,service_role;
create trigger protect_design_private_attachment_original before update or delete on public.design_private_attachments
for each row execute function private.protect_design_private_attachment_original();

commit;
