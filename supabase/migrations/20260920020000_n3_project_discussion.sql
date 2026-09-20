-- N3 first slice: project discussion reuses canonical comments, not private Workshop chat.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
alter table public.comments add constraint n3_internal_project_comment_shape check (
  entity_type <> 'project' or visibility <> 'internal_only' or
  (project_id is not null and entity_id=project_id and client_contact_id is null and anchor='{}'::jsonb)
);

-- Keep legacy client and task comment policies; make internal project discussion append-only.
drop policy "Team can manage comments" on public.comments;
create policy n3_team_read_comments on public.comments for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy n3_team_insert_other_comments on public.comments for insert to authenticated
  with check (public.is_team_organization_member(organization_id)
    and (entity_type <> 'project' or visibility <> 'internal_only'));
create policy n3_team_update_other_comments on public.comments for update to authenticated
  using (public.is_team_organization_member(organization_id)
    and (entity_type <> 'project' or visibility <> 'internal_only'))
  with check (public.is_team_organization_member(organization_id)
    and (entity_type <> 'project' or visibility <> 'internal_only'));
create policy n3_team_delete_other_comments on public.comments for delete to authenticated
  using (public.is_team_organization_member(organization_id)
    and (entity_type <> 'project' or visibility <> 'internal_only'));
create index n3_project_discussion_page on public.comments
  (organization_id,project_id,created_at desc,id desc)
  where entity_type='project' and visibility='internal_only';

create function private.n3_require_project_member(p_org uuid,p_project uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or p_org is null or p_project is null then
    raise exception 'Authenticated project discussion required.' using errcode='42501'; end if;
  perform 1 from public.projects p join public.organizations o on o.id=p.organization_id
    join public.organization_memberships m on m.organization_id=p.organization_id and m.user_id=actor
    where p.id=p_project and p.organization_id=p_org and p.archived_at is null
      and o.status='active' and m.member_kind='team' and m.status='active' for share of p,o,m;
  if not found then raise exception 'Active same-organization project membership required.' using errcode='42501'; end if;
end; $$;
revoke all on function private.n3_require_project_member(uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_project_discussion(
  p_organization_id uuid,p_project_id uuid,p_before_created_at timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare messages jsonb; more boolean; oldest jsonb;
begin
  perform private.n3_require_project_member(p_organization_id,p_project_id);
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Complete discussion cursor required.' using errcode='22023'; end if;
  with page as (
    select c.id,c.user_id,c.content,c.parent_comment_id,c.created_at,
      coalesce(nullif(trim(p.full_name),''),c.user_id::text) as author_name
    from public.comments c left join public.profiles p on p.id=c.user_id
    where c.organization_id=p_organization_id and c.project_id=p_project_id
      and c.entity_type='project' and c.entity_id=p_project_id and c.visibility='internal_only'
      and (p_before_id is null or (c.created_at,c.id)<(p_before_created_at,p_before_id))
    order by c.created_at desc,c.id desc limit 51
  ), selected as (select * from page order by created_at desc,id desc limit 50)
  select coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'author_id',s.user_id,
      'author_name',s.author_name,'content',s.content,'parent_comment_id',s.parent_comment_id,
      'created_at',s.created_at) order by s.created_at,s.id) from selected s),'[]'::jsonb),
    (select count(*)>50 from page),
    (select jsonb_build_object('created_at',s.created_at,'id',s.id) from selected s
      order by s.created_at,s.id limit 1)
    into messages,more,oldest;
  return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'messages',messages,'has_older',more,'cursor',oldest);
end; $$;

create function public.post_project_discussion_message(
  p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_content text,p_parent_comment_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.comments%rowtype; parent public.comments%rowtype;
  message text:=trim(coalesce(p_content,''));
begin
  perform private.n3_require_project_member(p_organization_id,p_project_id);
  if p_request_id is null or length(message) not between 1 and 8000 then
    raise exception 'A message of 1 to 8000 characters and request ID are required.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('n3-discussion:'||p_request_id::text,0));
  select * into existing from public.comments where id=p_request_id;
  if found then
    if existing.organization_id is distinct from p_organization_id or existing.project_id is distinct from p_project_id
      or existing.entity_type<>'project' or existing.entity_id is distinct from p_project_id
      or existing.visibility<>'internal_only' or existing.user_id is distinct from actor
      or existing.parent_comment_id is distinct from p_parent_comment_id or existing.content is distinct from message then
      raise exception 'Request ID already used with different message inputs.' using errcode='23505'; end if;
    return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
      'comment_id',existing.id,'request_id',p_request_id,'replayed',true);
  end if;
  if p_parent_comment_id is not null then
    select * into parent from public.comments where id=p_parent_comment_id and organization_id=p_organization_id
      and project_id=p_project_id and entity_type='project' and entity_id=p_project_id
      and visibility='internal_only' and parent_comment_id is null for share;
    if not found then raise exception 'Same-project root discussion message required.' using errcode='42501'; end if;
  end if;
  insert into public.comments(id,organization_id,project_id,user_id,entity_type,entity_id,
    content,visibility,parent_comment_id,anchor)
  values(p_request_id,p_organization_id,p_project_id,actor,'project',p_project_id,
    message,'internal_only',p_parent_comment_id,'{}'::jsonb);
  return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'comment_id',p_request_id,'request_id',p_request_id,'replayed',false);
end; $$;
revoke all on function public.get_project_discussion(uuid,uuid,timestamptz,uuid),
  public.post_project_discussion_message(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_project_discussion(uuid,uuid,timestamptz,uuid),
  public.post_project_discussion_message(uuid,uuid,uuid,text,uuid) to authenticated;
commit;
