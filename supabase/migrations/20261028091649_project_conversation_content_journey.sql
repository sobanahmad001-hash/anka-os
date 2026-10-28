begin;
create table private.project_content_journeys(
 conversation_id uuid not null references public.department_chat_conversations(id),
 work_item_id uuid not null references public.work_items(id),
 organization_id uuid not null references public.organizations(id),
 project_id uuid not null references public.projects(id),
 source_message_id uuid not null references public.department_chat_messages(id),
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 primary key(conversation_id,work_item_id)
);
create index project_content_journeys_work on private.project_content_journeys(work_item_id);
create index project_content_journeys_org on private.project_content_journeys(organization_id);
create index project_content_journeys_project on private.project_content_journeys(project_id);
create index project_content_journeys_message on private.project_content_journeys(source_message_id);
create index project_content_journeys_actor on private.project_content_journeys(actor_id);
alter table private.project_content_journeys enable row level security;
revoke all on private.project_content_journeys from public,anon,authenticated,service_role;
create trigger project_content_journeys_immutable before update or delete on private.project_content_journeys for each row execute function private.n1b_preserve_receipt();

create function public.bind_project_content_journey(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_work_item_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();existing private.project_content_journeys;
begin
 perform private.n1c_require_scope(p_organization_id,p_project_id,actor);
 perform 1 from public.department_chat_conversations where id=p_conversation_id and organization_id=p_organization_id and project_id=p_project_id and owner_id=actor and context_kind='project_team' and state='active' and archived_at is null for share;
 if not found then raise exception 'Open your active project conversation before adding work' using errcode='42501';end if;
 perform 1 from public.department_chat_messages where id=p_source_message_id and conversation_id=p_conversation_id and organization_id=p_organization_id and project_id=p_project_id and role='user' and author_id=actor for share;
 if not found then raise exception 'Choose your saved human message in this conversation' using errcode='42501';end if;
 perform 1 from public.work_items w join public.engagements e on e.id=w.engagement_id and e.organization_id=w.organization_id
 where w.id=p_work_item_id and w.organization_id=p_organization_id and w.project_id=p_project_id and e.project_id=p_project_id and w.department_id='content' and w.deleted_at is null for share of w,e;
 if not found then raise exception 'Choose original Content work in this project' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('content-journey:'||p_conversation_id::text||':'||p_work_item_id::text,0));
 select * into existing from private.project_content_journeys where conversation_id=p_conversation_id and work_item_id=p_work_item_id;
 if found then
  if existing.source_message_id<>p_source_message_id or existing.actor_id<>actor then raise exception 'Original conversation link retains its saved message' using errcode='23505';end if;
  return to_jsonb(existing);
 end if;
 insert into private.project_content_journeys(conversation_id,work_item_id,organization_id,project_id,source_message_id,actor_id) values(p_conversation_id,p_work_item_id,p_organization_id,p_project_id,p_source_message_id,actor) returning * into existing;
 return to_jsonb(existing);
end;$$;
create function public.read_project_content_journeys(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 perform 1 from public.department_chat_conversations c where c.id=p_conversation_id and c.organization_id=p_organization_id and c.project_id=p_project_id and c.context_kind='project_team' and c.archived_at is null
 and (c.owner_id=auth.uid() or exists(select 1 from public.project_context_chat_shares s where s.conversation_id=c.id and s.recipient_id=auth.uid() and s.revoked_at is null)) for share of c;
 if not found then raise exception 'Current conversation access required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from (select * from private.project_content_journeys where organization_id=p_organization_id and project_id=p_project_id and conversation_id=p_conversation_id order by created_at,work_item_id limit 100) j);
end;$$;
revoke all on function public.bind_project_content_journey(uuid,uuid,uuid,uuid,uuid),public.read_project_content_journeys(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bind_project_content_journey(uuid,uuid,uuid,uuid,uuid),public.read_project_content_journeys(uuid,uuid,uuid) to authenticated;
commit;
