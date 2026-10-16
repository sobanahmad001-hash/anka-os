begin;
set local lock_timeout='5s';
create table public.design_chat_brief_turns(
 organization_id uuid not null,actor_id uuid not null,conversation_id uuid not null,message_id uuid not null,request_id uuid not null,
 binding jsonb not null,status text not null default 'pending' check(status in ('pending','saved','question_only','conflict','invalid')),
 proposal jsonb,result jsonb,created_at timestamptz not null default now(),completed_at timestamptz,
 primary key(organization_id,actor_id,message_id),unique(organization_id,actor_id,request_id),
 foreign key(conversation_id,organization_id) references public.department_chat_conversations(id,organization_id) on delete restrict
);
alter table public.design_chat_brief_turns enable row level security;
revoke all on public.design_chat_brief_turns from public,anon,authenticated;
grant select,insert,update on public.design_chat_brief_turns to service_role;
create function private.require_design_chat_brief_turn_context(p_org uuid,p_actor uuid,p_conversation uuid,p_message uuid,p_binding jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.department_chat_conversations; b public.design_creative_briefs; member_role text; member_department text;
begin
 select m.role,m.department_id into member_role,member_department from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and m.member_kind='team' and o.status='active' for share of m,o;
 if not found then raise exception 'Current Design team authority required' using errcode='42501';end if;
 if member_role not in ('system_owner','operations_admin','executive') and member_department is distinct from 'design' then
  perform 1 from public.organization_department_memberships where organization_id=p_org and user_id=p_actor and department_id='design' and status='active' for share;
  if not found then raise exception 'Current Design department authority required' using errcode='42501';end if;
 end if;
 select * into c from public.department_chat_conversations where id=p_conversation and organization_id=p_org and department_id='design' and state='active' for share;
 if not found then raise exception 'Active Design conversation required' using errcode='42501';end if;
 perform 1 from public.department_chat_messages where id=p_message and conversation_id=p_conversation and organization_id=p_org and author_id=p_actor and role='user' for share;
 if not found then raise exception 'Exact actor message required' using errcode='42501';end if;
 if p_binding->>'visibility'='private' then
  if c.context_kind<>'department_private' or c.owner_id<>p_actor or c.project_id is not null or c.engagement_id is not null
   or p_binding->>'engagement_id' is not null or p_binding->>'brand_id' is not null or p_binding->>'engagement_service_id' is not null then raise exception 'Exact owner-private Design context required' using errcode='42501';end if;
 else
  if p_binding->>'visibility' is distinct from 'official' or c.context_kind is distinct from 'department_project' or c.engagement_id is null or c.engagement_id::text is distinct from p_binding->>'engagement_id' then raise exception 'Exact engagement context required' using errcode='42501';end if;
  perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id join public.engagements e on e.id=es.engagement_id and e.organization_id=es.organization_id join public.projects p on p.id=e.project_id and p.organization_id=e.organization_id
  where es.id=(p_binding->>'engagement_service_id')::uuid and es.organization_id=p_org and es.engagement_id=c.engagement_id and es.status='active' and sc.department_id='design' and sc.is_active
   and e.status in ('planning','active') and e.brand_id::text=p_binding->>'brand_id' and p.id=c.project_id and p.archived_at is null for share of es,sc,e,p;
  if not found then raise exception 'Current exact Design service required' using errcode='42501';end if;
 end if;
 if p_binding->>'creative_brief_id' is not null then
  select * into b from public.design_creative_briefs where id=(p_binding->>'creative_brief_id')::uuid and organization_id=p_org;
  if not found or b.visibility is distinct from p_binding->>'visibility' or b.engagement_id::text is distinct from p_binding->>'engagement_id' or b.brand_id::text is distinct from p_binding->>'brand_id' or b.engagement_service_id::text is distinct from p_binding->>'engagement_service_id'
   or(b.visibility='private' and b.created_by<>p_actor) or b.project_task_id is not null or b.engagement_work_item_id is not null then raise exception 'Exact existing brief context required' using errcode='42501';end if;
 end if;
end;$$;
revoke all on function private.require_design_chat_brief_turn_context(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.require_design_chat_brief_turn_context(uuid,uuid,uuid,uuid,jsonb) to service_role;
create function private.design_chat_brief_has_prior_execution(p_org uuid,p_message uuid)
returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.department_chat_messages where organization_id=p_org and in_reply_to_message_id=p_message)
 or exists(select 1 from public.ai_runs where organization_id=p_org and context_chat_message_id=p_message)
 or exists(select 1 from private.context_chat_dispatch_claims where organization_id=p_org and message_id=p_message)
 or exists(select 1 from private.workshop_chat_dispatch_claims where organization_id=p_org and message_id=p_message);
$$;
revoke all on function private.design_chat_brief_has_prior_execution(uuid,uuid) from public,anon,authenticated;
grant execute on function private.design_chat_brief_has_prior_execution(uuid,uuid) to service_role;
create function public.begin_design_chat_brief_turn(p_org uuid,p_actor uuid,p_conversation uuid,p_message uuid,p_request uuid,p_binding jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.design_chat_brief_turns; n integer;
begin
 if p_request is null or jsonb_typeof(p_binding) is distinct from 'object' or pg_column_size(p_binding)>64000
 or (select array_agg(k order by k) from jsonb_object_keys(p_binding) k) is distinct from array['brand_id','content','creative_brief_id','engagement_id','engagement_service_id','expected_revision','source_manifest','source_version_ids','visibility']::text[]
 or jsonb_typeof(p_binding->'content') is distinct from 'object' or jsonb_typeof(p_binding->'source_version_ids') is distinct from 'array' or jsonb_array_length(p_binding->'source_version_ids')>50
 or jsonb_typeof(p_binding->'source_manifest') is distinct from 'object' or coalesce(p_binding->>'expected_revision','') !~ '^[0-9]+$' then raise exception 'Exact bounded brief binding required' using errcode='22023';end if;
 perform private.require_design_chat_brief_turn_context(p_org,p_actor,p_conversation,p_message,p_binding);
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_actor::text||':'||p_message::text,0));
 select * into t from public.design_chat_brief_turns where organization_id=p_org and actor_id=p_actor and message_id=p_message for update;
 if found then
  if t.request_id<>p_request or t.conversation_id<>p_conversation or t.binding<>p_binding then raise exception 'Brief turn replay conflicts' using errcode='23505';end if;
  return to_jsonb(t);
 end if;
 if private.design_chat_brief_has_prior_execution(p_org,p_message) then raise exception 'Existing chat execution cannot acquire a new brief binding' using errcode='55000';end if;
 if p_binding->>'creative_brief_id' is null then n:=0;else select revision into n from public.design_creative_briefs where id=(p_binding->>'creative_brief_id')::uuid;end if;
 if n is distinct from (p_binding->>'expected_revision')::integer then raise exception 'Brief revision changed before Send' using errcode='40001';end if;
 insert into public.design_chat_brief_turns(organization_id,actor_id,conversation_id,message_id,request_id,binding) values(p_org,p_actor,p_conversation,p_message,p_request,p_binding) returning * into t;
 return to_jsonb(t);
end;$$;
create function public.recover_design_chat_brief_turn(p_org uuid,p_actor uuid,p_conversation uuid,p_message uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.design_chat_brief_turns;
begin
 select * into t from public.design_chat_brief_turns where organization_id=p_org and actor_id=p_actor and conversation_id=p_conversation and message_id=p_message and (p_request is null or request_id=p_request);
 if not found then raise exception 'Original brief turn not found' using errcode='P0002';end if;
 perform private.require_design_chat_brief_turn_context(p_org,p_actor,p_conversation,p_message,t.binding);
 return to_jsonb(t);
end;$$;
create function public.finalize_design_chat_brief_turn(p_org uuid,p_actor uuid,p_conversation uuid,p_message uuid,p_request uuid,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.design_chat_brief_turns; b jsonb; saved jsonb; n integer; content jsonb; ids uuid[]; state text;
begin
 select * into t from public.design_chat_brief_turns where organization_id=p_org and actor_id=p_actor and conversation_id=p_conversation and message_id=p_message and request_id=p_request for update;
 if not found then raise exception 'Original brief turn not found' using errcode='P0002';end if;
 b:=t.binding;
 perform private.require_design_chat_brief_turn_context(p_org,p_actor,p_conversation,p_message,b);
 if t.status<>'pending' then
  if t.proposal is distinct from p_result then raise exception 'Different reply for original turn' using errcode='23505';end if;
  return to_jsonb(t);
 end if;
 if p_result='{"invalid":true}'::jsonb then state:='invalid';saved:='{"reason":"Invalid structured reply; no draft changed"}'::jsonb;
 else
  if jsonb_typeof(p_result) is distinct from 'object' or pg_column_size(p_result)>64000 or jsonb_typeof(p_result->'patch') is distinct from 'object'
   or (select array_agg(k order by k) from jsonb_object_keys(p_result) k) is distinct from array['assistant_text','content','content_checksum','patch','questions','validation']::text[]
   or exists(select 1 from jsonb_object_keys(p_result->'patch') k where k<>all(array['title','purpose','output_type','audience','objective','placement_destination','instructions','exclusions_constraints','rights_notes','requested_outputs']))
   or coalesce(p_result->>'content_checksum','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p_result->'questions') is distinct from 'array' or jsonb_array_length(p_result->'questions')>5 or length(p_result->>'assistant_text') not between 1 and 2000 then raise exception 'Validated reply required' using errcode='22023';end if;
  content:=p_result->'content';
  -- Source pointers are never generated by the model.
  if content->'media_references' is distinct from b#>'{content,media_references}' then raise exception 'Pinned references changed' using errcode='22023';end if;
  if b->>'creative_brief_id' is null then n:=0;else select revision into n from public.design_creative_briefs where id=(b->>'creative_brief_id')::uuid for update;end if;
  if n is distinct from (b->>'expected_revision')::integer then state:='conflict';saved:=jsonb_build_object('reason','Brief changed; retained reply did not overwrite edits');
  elsif nullif(btrim(content->>'title'),'') is null then state:='question_only';saved:='{}'::jsonb;
  else
   select coalesce(array_agg(v::uuid),array[]::uuid[]) into ids from jsonb_array_elements_text(b->'source_version_ids') v;
   saved:=public.save_design_creative_brief_version(p_org,p_actor,(b->>'creative_brief_id')::uuid,b->>'visibility',(b->>'engagement_id')::uuid,(b->>'brand_id')::uuid,(b->>'engagement_service_id')::uuid,null,null,n,p_request,content,p_result->>'content_checksum',p_result->'validation',ids);
   state:='saved';
  end if;
  saved:=saved||jsonb_build_object('assistant_text',p_result->'assistant_text','questions',p_result->'questions','patch',p_result->'patch');
 end if;
 update public.design_chat_brief_turns set status=state,proposal=p_result,result=saved,completed_at=clock_timestamp() where organization_id=p_org and actor_id=p_actor and message_id=p_message returning * into t;
 return to_jsonb(t);
end;$$;
revoke all on function public.begin_design_chat_brief_turn(uuid,uuid,uuid,uuid,uuid,jsonb),public.recover_design_chat_brief_turn(uuid,uuid,uuid,uuid,uuid),public.finalize_design_chat_brief_turn(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_design_chat_brief_turn(uuid,uuid,uuid,uuid,uuid,jsonb),public.recover_design_chat_brief_turn(uuid,uuid,uuid,uuid,uuid),public.finalize_design_chat_brief_turn(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
commit;
