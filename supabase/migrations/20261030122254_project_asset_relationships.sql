-- Relationships only. Original assets, work, conversations, outputs and execution remain canonical.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
create table private.project_asset_relation_revisions(
 organization_id uuid not null references public.organizations(id),project_id uuid not null references public.projects(id),
 subject_kind text not null check(subject_kind in ('project_task','engagement_work_item','conversation')),
 subject_id uuid not null,revision bigint not null check(revision>0),assets jsonb not null check(jsonb_typeof(assets)='array' and jsonb_array_length(assets)<=50),
 actor_id uuid not null references auth.users(id),request_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 primary key(project_id,subject_kind,subject_id,revision)
);
create index project_asset_relation_org on private.project_asset_relation_revisions(organization_id,project_id);
create table private.project_asset_relation_commands(
 organization_id uuid not null references public.organizations(id),project_id uuid not null references public.projects(id),
 actor_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(organization_id,actor_id,request_id)
);
create index project_asset_relation_command_project on private.project_asset_relation_commands(project_id);
do $$declare t text;begin
 foreach t in array array['project_asset_relation_revisions','project_asset_relation_commands'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_relation before update or delete on private.%I for each row execute function private.n1b_preserve_receipt()',t);
 end loop;
end;$$;

create function private.asset_relation_subject(p_org uuid,p_project uuid,p_kind text,p_id uuid,p_write boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.tasks;w public.work_items;c public.department_chat_conversations;actor uuid:=auth.uid();
begin
 perform private.n1c_require_scope(p_org,p_project,actor);
 if p_kind='project_task' then
 select * into t from public.tasks where id=p_id and organization_id=p_org and project_id=p_project and archived_at is null for share;
 if not found then raise exception 'Current same-project task required' using errcode='42501';end if;
 if p_write and (coalesce(private.n1c_can_assign_department(p_org,p_project,t.department_id,actor),false) or t.user_id=actor or t.assigned_to=actor) is not true then raise exception 'Existing task authority required' using errcode='42501';end if;
 return jsonb_build_object('kind',p_kind,'id',t.id,'row_version',t.row_version);
 elsif p_kind='engagement_work_item' then
 select x.* into w from public.work_items x join public.engagements e on e.id=x.engagement_id and e.organization_id=x.organization_id
 where x.id=p_id and x.organization_id=p_org and x.project_id=p_project and e.project_id=p_project and x.deleted_at is null for share of x,e;
 if not found then raise exception 'Current same-project work required' using errcode='42501';end if;
 if p_write and (coalesce(private.n1c_can_assign_department(p_org,p_project,w.department_id,actor),false) or w.created_by=actor or w.assignee_id=actor) is not true then raise exception 'Existing work authority required' using errcode='42501';end if;
 return jsonb_build_object('kind',p_kind,'id',w.id,'row_version',w.row_version);
 elsif p_kind='conversation' then
 select * into c from public.department_chat_conversations where id=p_id and organization_id=p_org and project_id=p_project and context_kind='project_team' and archived_at is null and state='active' for share;
 if not found or (c.owner_id<>actor and (p_write or not exists(select 1 from public.project_context_chat_shares s where s.conversation_id=c.id and s.recipient_id=actor and s.revoked_at is null))) then raise exception 'Current authorized project conversation required; private histories stay private' using errcode='42501';end if;
 if c.owner_id<>actor then perform 1 from public.project_context_chat_shares where conversation_id=c.id and recipient_id=actor and revoked_at is null for share;if not found then raise exception 'Conversation access changed' using errcode='42501';end if;end if;
 return jsonb_build_object('kind',p_kind,'id',c.id,'row_version',null);
 end if;
 raise exception 'Choose a typed original work or conversation record' using errcode='22023';
end;$$;

create function private.asset_relation_assets(p_org uuid,p_project uuid,p_assets jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;page public.project_website_pages;asset public.project_campaign_assets;result jsonb:='[]';
begin
 if p_assets is null or jsonb_typeof(p_assets)<>'array' or jsonb_array_length(p_assets)>50 then raise exception 'Choose zero to fifty explicit existing assets' using errcode='22023';end if;
 for a in select value from jsonb_array_elements(p_assets) loop
 if jsonb_typeof(a)<>'object' or (select count(*) from jsonb_object_keys(a))<>2 or not a ?& array['kind','id'] or jsonb_typeof(a->'id')<>'string' or not coalesce(a->>'kind' in ('website_page','campaign_asset'),false) then raise exception 'Exact typed asset identifiers required' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(result) r where r->>'kind'=a->>'kind' and (r->>'id')::uuid=(a->>'id')::uuid) then raise exception 'Duplicate asset reference' using errcode='22023';end if;
 if a->>'kind'='website_page' then
 select * into page from public.project_website_pages where id=(a->>'id')::uuid and organization_id=p_org and project_id=p_project for share;
 if not found then raise exception 'Registered same-project page required' using errcode='42501';end if;
 else
 select * into asset from public.project_campaign_assets where id=(a->>'id')::uuid and organization_id=p_org and project_id=p_project for share;
 if not found then raise exception 'Registered same-project campaign asset required' using errcode='42501';end if;
 perform private.campaign_asset_source(p_org,p_project,asset.brand_id,asset.source_kind,asset.source_version_id);
 end if;
 result:=result||jsonb_build_array(jsonb_build_object('kind',a->>'kind','id',(a->>'id')::uuid));
 end loop;
 return (select coalesce(jsonb_agg(x order by x->>'kind',x->>'id'),'[]') from jsonb_array_elements(result) x);
end;$$;

create function public.read_project_asset_relations(p_organization_id uuid,p_project_id uuid,p_subject_kind text,p_subject_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare subject jsonb;history jsonb;head jsonb;labels jsonb;
begin
 subject:=private.asset_relation_subject(p_organization_id,p_project_id,p_subject_kind,p_subject_id,false);
 select coalesce(jsonb_agg(to_jsonb(r) order by revision desc),'[]') into history from (select * from private.project_asset_relation_revisions where organization_id=p_organization_id and project_id=p_project_id and subject_kind=p_subject_kind and subject_id=p_subject_id order by revision desc limit 50) r;
 head:=history->0;
 select coalesce(jsonb_agg(jsonb_build_object('kind',r->>'kind','id',r->>'id','label',case when r->>'kind'='website_page' then coalesce((select p.page_key from public.project_website_pages p where p.id=(r->>'id')::uuid and p.organization_id=p_organization_id and p.project_id=p_project_id),'Website page unavailable') else coalesce((select a.source_descriptor->>'title' from public.project_campaign_assets a where a.id=(r->>'id')::uuid and a.organization_id=p_organization_id and a.project_id=p_project_id),'Marketing asset') end) order by r->>'kind',r->>'id'),'[]') into labels from jsonb_array_elements(coalesce(head->'assets','[]')) r;
 return jsonb_build_object('subject',subject,'revision',coalesce((head->>'revision')::bigint,0),'assets',coalesce(head->'assets','[]'),'asset_labels',labels,'history',history,'history_limit',50);
end;$$;

create function public.review_project_asset_relations(p_organization_id uuid,p_project_id uuid,p_subject_kind text,p_subject_id uuid,p_expected_revision bigint,p_expected_row_version bigint,p_assets jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare subject jsonb;assets jsonb;current_revision bigint;draft jsonb;before_assets jsonb;
begin
 subject:=private.asset_relation_subject(p_organization_id,p_project_id,p_subject_kind,p_subject_id,true);
 assets:=private.asset_relation_assets(p_organization_id,p_project_id,p_assets);
 select coalesce(max(revision),0) into current_revision from private.project_asset_relation_revisions where organization_id=p_organization_id and project_id=p_project_id and subject_kind=p_subject_kind and subject_id=p_subject_id;
 if p_expected_revision is distinct from current_revision or p_expected_row_version is distinct from (subject->>'row_version')::bigint then raise exception 'Relationship or work changed; review the current original record' using errcode='40001';end if;
 select r.assets into before_assets from private.project_asset_relation_revisions r where r.organization_id=p_organization_id and r.project_id=p_project_id and r.subject_kind=p_subject_kind and r.subject_id=p_subject_id and r.revision=current_revision;
 draft:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'subject',subject,'expected_revision',current_revision,'before_assets',coalesce(before_assets,'[]'),'assets',assets);
 return jsonb_build_object('draft',draft,'review_sha256',encode(sha256(convert_to(draft::text,'UTF8')),'hex'));
end;$$;

create function public.save_project_asset_relations(p_organization_id uuid,p_project_id uuid,p_subject_kind text,p_subject_id uuid,p_expected_revision bigint,p_expected_row_version bigint,p_assets jsonb,p_review_sha256 text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();payload jsonb;previous private.project_asset_relation_commands;review jsonb;saved private.project_asset_relation_revisions;result jsonb;
begin
 -- Project before all shared locks: same order for writes and authority revocation.
 perform 1 from public.projects where id=p_project_id and organization_id=p_organization_id and archived_at is null for update;
 perform private.asset_relation_subject(p_organization_id,p_project_id,p_subject_kind,p_subject_id,true);
 if p_request_id is null or p_review_sha256 is null then raise exception 'Original request and exact review required' using errcode='22023';end if;
 payload:=jsonb_build_object('project_id',p_project_id,'kind',p_subject_kind,'id',p_subject_id,'revision',p_expected_revision,'row_version',p_expected_row_version,'assets',p_assets,'review',p_review_sha256);
 perform pg_advisory_xact_lock(hashtextextended('asset-relation:'||p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
 select * into previous from private.project_asset_relation_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then
 if previous.payload is distinct from payload then raise exception 'Original request retains its exact payload' using errcode='23505';end if;
 return previous.result;
 end if;
 review:=public.review_project_asset_relations(p_organization_id,p_project_id,p_subject_kind,p_subject_id,p_expected_revision,p_expected_row_version,p_assets);
 if review->>'review_sha256'<>p_review_sha256 then raise exception 'Reviewed relationship differs' using errcode='40001';end if;
 insert into private.project_asset_relation_revisions(organization_id,project_id,subject_kind,subject_id,revision,assets,actor_id,request_id)
 values(p_organization_id,p_project_id,p_subject_kind,p_subject_id,p_expected_revision+1,review->'draft'->'assets',actor,p_request_id) returning * into saved;
 result:=to_jsonb(saved);
 insert into private.project_asset_relation_commands(organization_id,project_id,actor_id,request_id,payload,result) values(p_organization_id,p_project_id,actor,p_request_id,payload,result);
 return result;
end;$$;

create function public.recover_project_asset_relations(p_organization_id uuid,p_project_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare command private.project_asset_relation_commands;
begin
 perform private.n1c_require_scope(p_organization_id,p_project_id,auth.uid());
 select * into command from private.project_asset_relation_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=auth.uid() and request_id=p_request_id;
 if not found then return jsonb_build_object('status','not_found');end if;
 perform private.asset_relation_subject(p_organization_id,p_project_id,command.payload->>'kind',(command.payload->>'id')::uuid,false);
 return jsonb_build_object('status','applied','original_result',command.result);
end;$$;

create function public.list_project_asset_relation_options(p_organization_id uuid,p_project_id uuid,p_search text default '',p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare results jsonb;begin
 perform private.n1c_require_scope(p_organization_id,p_project_id,auth.uid());
 if p_search is null or length(p_search)>120 or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Bounded asset search required' using errcode='22023';end if;
 with options as (
 select 'website_page'::text kind,id,page_key label from public.project_website_pages where organization_id=p_organization_id and project_id=p_project_id
 union all select 'campaign_asset',id,coalesce(source_descriptor->>'title',id::text) from public.project_campaign_assets where organization_id=p_organization_id and project_id=p_project_id
 ), filtered as (select * from options where position(lower(p_search) in lower(label))>0 order by kind,label,id offset p_offset limit 51)
 select coalesce(jsonb_agg(to_jsonb(f)),'[]') into results from filtered f;
 return jsonb_build_object('options',case when jsonb_array_length(results)>50 then results-50 else results end,'has_more',jsonb_array_length(results)>50,'offset',p_offset);
end;$$;

create function public.list_project_asset_work_links(p_organization_id uuid,p_project_id uuid,p_asset_kind text,p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record;result jsonb:='[]';subject jsonb;begin
 perform private.n1c_require_scope(p_organization_id,p_project_id,auth.uid());
 perform private.asset_relation_assets(p_organization_id,p_project_id,jsonb_build_array(jsonb_build_object('kind',p_asset_kind,'id',p_asset_id)));
 for r in select * from (select distinct on(subject_kind,subject_id) * from private.project_asset_relation_revisions where organization_id=p_organization_id and project_id=p_project_id and subject_kind<>'conversation' order by subject_kind,subject_id,revision desc) latest where assets @> jsonb_build_array(jsonb_build_object('kind',p_asset_kind,'id',p_asset_id)) order by subject_kind,subject_id limit 500 loop
 begin
 subject:=private.asset_relation_subject(p_organization_id,p_project_id,r.subject_kind,r.subject_id,false);
 result:=result||jsonb_build_array(jsonb_build_object('subject',subject,'revision',r.revision));
 exception when insufficient_privilege then null;
 end;
 end loop;
 return jsonb_build_object('links',result,'limit',500);
end;$$;

create function public.list_project_asset_conversations(p_organization_id uuid,p_project_id uuid,p_asset_kind text,p_asset_id uuid,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record;result jsonb:='[]';visible jsonb:='[]';subject jsonb;begin
 perform private.n1c_require_scope(p_organization_id,p_project_id,auth.uid());
 if p_offset is null or p_offset not between 0 and 10000 then raise exception 'Bounded conversation page required' using errcode='22023';end if;
 perform private.asset_relation_assets(p_organization_id,p_project_id,jsonb_build_array(jsonb_build_object('kind',p_asset_kind,'id',p_asset_id)));
 -- Filter owner/current explicit recipient BEFORE pagination or title projection.
 for r in select x.subject_id,c.title from (select distinct on(subject_id) * from private.project_asset_relation_revisions where organization_id=p_organization_id and project_id=p_project_id and subject_kind='conversation' order by subject_id,revision desc) x
 join public.department_chat_conversations c on c.id=x.subject_id and c.organization_id=p_organization_id and c.project_id=p_project_id
 where x.assets @> jsonb_build_array(jsonb_build_object('kind',p_asset_kind,'id',p_asset_id)) and c.context_kind='project_team' and c.state='active' and c.archived_at is null
 and (c.owner_id=auth.uid() or exists(select 1 from public.project_context_chat_shares s where s.conversation_id=c.id and s.recipient_id=auth.uid() and s.revoked_at is null)) order by x.subject_id offset p_offset limit 51 loop
 begin
 subject:=private.asset_relation_subject(p_organization_id,p_project_id,'conversation',r.subject_id,false);
 visible:=visible||jsonb_build_array(jsonb_build_object('id',r.subject_id,'title',r.title));
 exception when insufficient_privilege then null;
 end;
 end loop;
 result:=case when jsonb_array_length(visible)>50 then visible-50 else visible end;
 return jsonb_build_object('conversations',result,'has_more',jsonb_array_length(visible)>50,'offset',p_offset);
end;$$;
revoke all on function public.list_project_asset_conversations(uuid,uuid,text,uuid,integer),public.list_project_asset_relation_options(uuid,uuid,text,integer),public.list_project_asset_work_links(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_project_asset_conversations(uuid,uuid,text,uuid,integer),public.list_project_asset_relation_options(uuid,uuid,text,integer),public.list_project_asset_work_links(uuid,uuid,text,uuid) to authenticated;
revoke all on function private.asset_relation_subject(uuid,uuid,text,uuid,boolean),private.asset_relation_assets(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.read_project_asset_relations(uuid,uuid,text,uuid),public.review_project_asset_relations(uuid,uuid,text,uuid,bigint,bigint,jsonb),public.save_project_asset_relations(uuid,uuid,text,uuid,bigint,bigint,jsonb,text,uuid),public.recover_project_asset_relations(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_project_asset_relations(uuid,uuid,text,uuid),public.review_project_asset_relations(uuid,uuid,text,uuid,bigint,bigint,jsonb),public.save_project_asset_relations(uuid,uuid,text,uuid,bigint,bigint,jsonb,text,uuid),public.recover_project_asset_relations(uuid,uuid,uuid) to authenticated;
commit;
