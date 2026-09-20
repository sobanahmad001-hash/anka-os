begin;
set local lock_timeout='5s';
alter table public.comments drop constraint n3_internal_project_comment_shape;
alter table public.comments add constraint n3_internal_project_comment_shape check (
 entity_type <> 'project' or visibility <> 'internal_only' or
 (project_id is not null and entity_id=project_id and client_contact_id is null
  and jsonb_typeof(anchor)='object' and (anchor='{}'::jsonb or
   (jsonb_typeof(anchor->'links')='array' and jsonb_array_length(anchor->'links')<=10
    )))
);
create function private.n3_discussion_link_label(p_org uuid,p_project uuid,p_kind text,p_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
 case p_kind
 when 'member' then select coalesce(nullif(trim(p.full_name),''),m.user_id::text) into result
   from public.organization_memberships m join auth.users u on u.id=m.user_id and u.deleted_at is null
   left join public.profiles p on p.id=m.user_id
   where m.organization_id=p_org and m.user_id=p_id and m.member_kind='team' and m.status='active';
 when 'project_task' then select t.title into result from public.tasks t
   where t.id=p_id and t.organization_id=p_org and t.project_id=p_project and t.archived_at is null;
 when 'deliverable_version' then select d.title||' · v'||v.version_number into result
   from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id
     and d.organization_id=v.organization_id and d.project_id=v.project_id
   where v.id=p_id and v.organization_id=p_org and v.project_id=p_project
     and v.withdrawn_at is null and d.archived_at is null;
 when 'file' then select f.file_name into result from public.files f
   where f.id=p_id and f.organization_id=p_org and f.project_id=p_project and f.archived_at is null;
 else raise exception 'Unsupported discussion reference.' using errcode='22023';
 end case;
 return result;
end; $$;
revoke all on function private.n3_discussion_link_label(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.get_project_discussion_reference_options(p_organization_id uuid,p_project_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare options jsonb;
begin
 perform private.n3_require_project_member(p_organization_id,p_project_id);
 select coalesce(jsonb_agg(jsonb_build_object('kind',x.kind,'id',x.id,'label',x.label)
   order by x.kind,x.label,x.id),'[]'::jsonb) into options from (
  select 'member'::text kind,m.user_id id,coalesce(nullif(trim(p.full_name),''),m.user_id::text) label
    from public.organization_memberships m join auth.users u on u.id=m.user_id and u.deleted_at is null
    left join public.profiles p on p.id=m.user_id
    where m.organization_id=p_organization_id and m.member_kind='team' and m.status='active'
  union all select 'project_task',t.id,t.title from public.tasks t
    where t.organization_id=p_organization_id and t.project_id=p_project_id and t.archived_at is null
  union all select 'deliverable_version',v.id,d.title||' · v'||v.version_number
    from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id
    and d.organization_id=v.organization_id and d.project_id=v.project_id
    where v.organization_id=p_organization_id and v.project_id=p_project_id
      and v.withdrawn_at is null and d.archived_at is null
  union all select 'file',f.id,f.file_name from public.files f
    where f.organization_id=p_organization_id and f.project_id=p_project_id and f.archived_at is null
 ) x;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'options',options);
end; $$;

create function public.post_project_discussion_message_with_links(
 p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_content text,
 p_parent_comment_id uuid,p_links jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.comments%rowtype;
 link jsonb; normalized jsonb; kind text; target uuid; parent public.comments%rowtype;
 message text:=trim(coalesce(p_content,''));
begin
 perform private.n3_require_project_member(p_organization_id,p_project_id);
 if p_request_id is null or length(message) not between 1 and 8000
   or p_links is null or jsonb_typeof(p_links)<>'array' or jsonb_array_length(p_links)>10 then
   raise exception 'Valid message, request ID, and up to ten links required.' using errcode='22023'; end if;
 begin
   for link in select value from jsonb_array_elements(p_links) loop
     if jsonb_typeof(link)<>'object' or link->>'kind' not in
       ('member','project_task','deliverable_version','file')
       or (select count(*) from jsonb_object_keys(link))<>2 then
       raise exception 'Invalid discussion link.' using errcode='22023'; end if;
     target:=(link->>'id')::uuid;
     if target is null then raise exception 'Link ID required.' using errcode='22023'; end if;
   end loop;
 exception when invalid_text_representation then raise exception 'Invalid link ID.' using errcode='22023';
 end;
 select coalesce(jsonb_agg(jsonb_build_object('kind',x->>'kind','id',((x->>'id')::uuid)::text)
   order by x->>'kind',(x->>'id')::uuid),'[]'::jsonb) into normalized
   from jsonb_array_elements(p_links) x;
 if (select count(*) from jsonb_array_elements(normalized)) <>
    (select count(distinct (x->>'kind',x->>'id')) from jsonb_array_elements(normalized) x) then
    raise exception 'Duplicate discussion link.' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('n3-discussion:'||p_request_id::text,0));
 select * into existing from public.comments where id=p_request_id;
 if found then
   if existing.organization_id is distinct from p_organization_id
    or existing.project_id is distinct from p_project_id or existing.entity_type<>'project'
    or existing.entity_id is distinct from p_project_id or existing.visibility<>'internal_only'
    or existing.user_id is distinct from actor or existing.content is distinct from message
    or existing.parent_comment_id is distinct from p_parent_comment_id
    or coalesce(existing.anchor->'links','[]'::jsonb)<>normalized then
     raise exception 'Request ID already used with different message inputs.' using errcode='23505'; end if;
   return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
     'request_id',p_request_id,'comment_id',p_request_id,'replayed',true);
 end if;
 for link in select value from jsonb_array_elements(normalized) loop
   kind:=link->>'kind'; target:=(link->>'id')::uuid;
   if private.n3_discussion_link_label(p_organization_id,p_project_id,kind,target) is null then
     raise exception 'Discussion link is unavailable.' using errcode='22023'; end if;
 end loop;
 if p_parent_comment_id is not null then
   select * into parent from public.comments where id=p_parent_comment_id and organization_id=p_organization_id
     and project_id=p_project_id and entity_type='project' and entity_id=p_project_id
     and visibility='internal_only' and parent_comment_id is null for share;
   if not found then raise exception 'Same-project root discussion message required.' using errcode='42501'; end if;
 end if;
 insert into public.comments(id,organization_id,project_id,user_id,entity_type,entity_id,
   content,visibility,parent_comment_id,anchor)
 values(p_request_id,p_organization_id,p_project_id,actor,'project',p_project_id,
   message,'internal_only',p_parent_comment_id,jsonb_build_object('links',normalized));
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
   'request_id',p_request_id,'comment_id',p_request_id,'replayed',false);
end; $$;

create or replace function public.get_project_discussion(
 p_organization_id uuid,p_project_id uuid,p_before_created_at timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare messages jsonb; more boolean; oldest jsonb;
begin
 perform private.n3_require_project_member(p_organization_id,p_project_id);
 if (p_before_created_at is null) <> (p_before_id is null) then
   raise exception 'Complete discussion cursor required.' using errcode='22023'; end if;
 with page as (
   select c.id,c.user_id,c.content,c.parent_comment_id,c.created_at,c.anchor,
     coalesce(nullif(trim(p.full_name),''),c.user_id::text) as author_name
   from public.comments c left join public.profiles p on p.id=c.user_id
   where c.organization_id=p_organization_id and c.project_id=p_project_id
     and c.entity_type='project' and c.entity_id=p_project_id and c.visibility='internal_only'
     and (p_before_id is null or (c.created_at,c.id)<(p_before_created_at,p_before_id))
   order by c.created_at desc,c.id desc limit 51
 ), selected as (select * from page order by created_at desc,id desc limit 50)
 select coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'author_id',s.user_id,
   'author_name',s.author_name,'content',s.content,'parent_comment_id',s.parent_comment_id,
   'created_at',s.created_at,'links',coalesce((select jsonb_agg(jsonb_build_object(
      'kind',x->>'kind','id',x->>'id','label',
      private.n3_discussion_link_label(p_organization_id,p_project_id,x->>'kind',(x->>'id')::uuid),
      'available',private.n3_discussion_link_label(p_organization_id,p_project_id,x->>'kind',(x->>'id')::uuid) is not null)
      order by x->>'kind',x->>'id') from jsonb_array_elements(coalesce(s.anchor->'links','[]'::jsonb)) x),'[]'::jsonb))
   order by s.created_at,s.id) from selected s),'[]'::jsonb),
   (select count(*)>50 from page),
   (select jsonb_build_object('created_at',s.created_at,'id',s.id) from selected s
     order by s.created_at,s.id limit 1)
   into messages,more,oldest;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
   'messages',messages,'has_older',more,'cursor',oldest);
end; $$;
revoke all on function public.get_project_discussion_reference_options(uuid,uuid),
 public.post_project_discussion_message_with_links(uuid,uuid,uuid,text,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.get_project_discussion_reference_options(uuid,uuid),
 public.post_project_discussion_message_with_links(uuid,uuid,uuid,text,uuid,jsonb)
 to authenticated;
commit;
