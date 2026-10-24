begin;
set local lock_timeout='5s';
create table public.design_video_references (
 id uuid primary key,
 organization_id uuid not null,
 conversation_id uuid not null,
 owner_id uuid not null,
 original_name text not null check(length(original_name) between 1 and 200),
 claimed_mime text not null check(claimed_mime in ('video/mp4','video/quicktime')),
 declared_bytes integer not null check(declared_bytes between 1 and 20971520),
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
 check(not ai_use_allowed),
 check(extracted_text is null),
 check(extraction_kind is null or extraction_kind='reference_only'),
 check(status <> 'ready' or coalesce((verified_mime=claimed_mime and finalized_at is not null and extraction_kind='reference_only'),false))
);
create index design_video_references_scope on public.design_video_references(conversation_id,created_at,id);
alter table public.design_video_references enable row level security;
revoke all on public.design_video_references from public,anon,authenticated,service_role;
grant select,insert,update on public.design_video_references to service_role;


insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('design-video-references','design-video-references',false,20971520,array['video/mp4','video/quicktime']);
create function private.require_design_video_reference_owner(p_org uuid,p_conversation uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.department_chat_conversations;
begin
 perform 1 from public.organizations where id=p_org and status='active' for share;
 if not found then raise exception 'Active organization required' using errcode='42501';end if;
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=p_actor and status='active' and member_kind='team' for share;
 if not found then raise exception 'Active membership required' using errcode='42501';end if;
 select * into c from public.department_chat_conversations where id=p_conversation and organization_id=p_org and owner_id=p_actor and department_id='design' and state='active' for update;
 if not found then raise exception 'Saved active owned Design chat required' using errcode='42501';end if;
 if c.context_kind='department_private' and c.project_id is null and c.engagement_id is null then
  perform private.require_design_private_attachment_owner(p_org,p_conversation,p_actor);
 elsif c.context_kind='department_project' and c.project_id is not null and c.engagement_id is not null then
  perform private.require_accessible_department_chat_conversation(c.id,p_org,c.project_id,c.engagement_id,'design',p_actor,true);
  perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and m.member_kind='team' and o.status='active' for share of m,o;
  if not found then raise exception 'Current team membership required' using errcode='42501';end if;
  perform 1 from public.projects p join public.engagements e on e.project_id=p.id and e.organization_id=p.organization_id join public.engagement_services es on es.engagement_id=e.id and es.organization_id=e.organization_id join public.service_catalog sc on sc.id=es.service_id
  where p.id=c.project_id and p.organization_id=p_org and p.archived_at is null and e.id=c.engagement_id and e.status in ('planning','active') and es.status='active' and sc.department_id='design' and sc.is_active for share of p,e,es,sc;
  if not found then raise exception 'Active Design project engagement required' using errcode='42501';end if;
 else raise exception 'Exact Design conversation scope required' using errcode='42501';end if;
end;$$;
revoke all on function private.require_design_video_reference_owner(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.require_design_video_reference_owner(uuid,uuid,uuid) to service_role;

create function public.reserve_design_video_reference(p_org uuid,p_conversation uuid,p_actor uuid,p_id uuid,p_name text,p_mime text,p_bytes integer,p_sha text,p_classification text,p_consent boolean)
returns public.design_video_references language plpgsql security invoker set search_path='' as $$
declare a public.design_video_references;
begin
 perform private.require_design_video_reference_owner(p_org,p_conversation,p_actor);
 -- Serialize per-conversation quota and same-key reservations.
 perform 1 from public.department_chat_conversations where id=p_conversation for update;
 select * into a from public.design_video_references where id=p_id;
 if found then
  if a.organization_id is distinct from p_org or a.conversation_id is distinct from p_conversation or a.owner_id is distinct from p_actor
   or a.original_name is distinct from p_name or a.claimed_mime is distinct from p_mime or a.declared_bytes is distinct from p_bytes
   or a.expected_sha256 is distinct from p_sha or a.classification is distinct from p_classification or a.ai_use_allowed is distinct from p_consent then
   raise exception 'Upload request already used with different inputs' using errcode='23505';
  end if;
  if a.status='revoked' then raise exception 'Upload revoked' using errcode='42501'; end if;
  return a;
 end if;
 if (select count(*) from public.design_video_references where conversation_id=p_conversation)>=100 then
  raise exception 'Conversation attachment limit reached' using errcode='23514';
 end if;
 insert into public.design_video_references(id,organization_id,conversation_id,owner_id,original_name,claimed_mime,declared_bytes,expected_sha256,classification,ai_use_allowed)
 values(p_id,p_org,p_conversation,p_actor,p_name,p_mime,p_bytes,p_sha,p_classification,p_consent) returning * into a;
 return a;
end; $$;
revoke all on function public.reserve_design_video_reference(uuid,uuid,uuid,uuid,text,text,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.reserve_design_video_reference(uuid,uuid,uuid,uuid,text,text,integer,text,text,boolean) to service_role;

create function public.read_design_video_references(p_org uuid,p_conversation uuid,p_actor uuid)
returns setof public.design_video_references language plpgsql security invoker set search_path='' as $$
begin
 perform private.require_design_video_reference_owner(p_org,p_conversation,p_actor);
 return query select * from public.design_video_references where organization_id=p_org and conversation_id=p_conversation and owner_id=p_actor order by created_at,id limit 100;
end; $$;
revoke all on function public.read_design_video_references(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_design_video_references(uuid,uuid,uuid) to service_role;

create function public.finalize_design_video_reference(p_org uuid,p_conversation uuid,p_actor uuid,p_id uuid,p_sha text,p_bytes integer,p_mime text,p_kind text,p_text text,p_notice text)
returns public.design_video_references language plpgsql security invoker set search_path='' as $$
declare a public.design_video_references;
begin
 perform private.require_design_video_reference_owner(p_org,p_conversation,p_actor);
 select * into a from public.design_video_references where id=p_id and organization_id=p_org and conversation_id=p_conversation and owner_id=p_actor for update;
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
 update public.design_video_references set status='ready',verified_mime=p_mime,extraction_kind=p_kind,extracted_text=p_text,extraction_notice=p_notice,finalized_at=clock_timestamp()
 where id=p_id returning * into a;
 return a;
end; $$;
revoke all on function public.finalize_design_video_reference(uuid,uuid,uuid,uuid,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.finalize_design_video_reference(uuid,uuid,uuid,uuid,text,integer,text,text,text,text) to service_role;

create function public.revoke_design_video_reference(p_org uuid,p_conversation uuid,p_actor uuid,p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform private.require_design_video_reference_owner(p_org,p_conversation,p_actor);
 update public.design_video_references set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp())
 where id=p_id and organization_id=p_org and conversation_id=p_conversation and owner_id=p_actor;
 if not found then raise exception 'Upload unavailable' using errcode='42501'; end if;
end; $$;
revoke all on function public.revoke_design_video_reference(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_design_video_reference(uuid,uuid,uuid,uuid) to service_role;

create function private.protect_design_video_reference_original() returns trigger
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
revoke all on function private.protect_design_video_reference_original() from public,anon,authenticated,service_role;
create trigger protect_design_video_reference_original before update or delete on public.design_video_references
for each row execute function private.protect_design_video_reference_original();

commit;
