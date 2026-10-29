-- Explicit owner-reviewed project access reuses the canonical mapping, not connector configuration.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if (select md5(prosrc) from pg_proc where oid='private.website_block_actor(uuid,uuid,uuid,uuid,boolean)'::regprocedure)<>'8f5dc822d22c66f39116226f85f935aa' then raise exception 'Reviewed Website authority prerequisite differs';end if;
end$$;

create table private.website_staging_connection_links(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,
 connection_id uuid not null,department_id text not null default 'development' check(department_id='development'),
 connection_revision timestamptz not null,base_url text not null,link_existed boolean not null,
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(created_by,request_id),
 foreign key(connection_id,organization_id) references public.integration_connections(id,organization_id),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id)
);
create index website_staging_connection_links_scope on private.website_staging_connection_links(engagement_id,project_id,organization_id);
create index website_staging_connection_links_connection on private.website_staging_connection_links(connection_id,organization_id);
alter table private.website_staging_connection_links enable row level security;
revoke all on private.website_staging_connection_links from public,anon,authenticated,service_role;
create trigger website_staging_connection_link_immutable before update or delete on private.website_staging_connection_links for each row execute function private.website_native_immutable();

create function private.website_staging_link_actor(o uuid,p uuid,e uuid,a uuid,w boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.website_block_actor(o,p,e,a,w);
 perform 1 from public.organization_memberships where organization_id=o and user_id=a and member_kind='team' and status='active' and role in ('system_owner','operations_admin') for share;
 if not found then raise exception 'Current organization owner or operations admin must link WordPress to a project' using errcode='42501';end if;
end$$;

create function public.get_website_staging_connection_links(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare choices jsonb;
begin
 perform private.website_staging_link_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),true);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into choices from(
  select c.id,c.display_name,rtrim(c.base_url,'/') as base_url,c.updated_at as revision,
  exists(select 1 from public.integration_connection_engagements m where m.organization_id=p_organization_id and m.connection_id=c.id and m.engagement_id=p_engagement_id and m.department_id='development') as project_linked
  from public.integration_connections c where c.organization_id=p_organization_id and c.provider='wordpress' and c.status='verified' and c.last_check_status='passed' and c.archived_at is null and c.secret_name~'^ANKA_WORDPRESS_[A-Z0-9_]+$'
  and exists(select 1 from public.integration_connection_departments d where d.organization_id=p_organization_id and d.connection_id=c.id and d.department_id='development')
  order by c.display_name,c.id limit 100
 )x;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'connections',choices);
end$$;

create function public.link_website_staging_connection(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_connection_id uuid,p_connection_revision timestamptz,p_base_url text,p_confirmed boolean,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.integration_connections;prior private.website_staging_connection_links;row private.website_staging_connection_links;digest text;existed boolean;
begin
 perform private.website_staging_link_actor(p_organization_id,p_project_id,p_engagement_id,actor,true);
 if p_connection_id is null or p_connection_revision is null or p_base_url is null or length(p_base_url)>500 or p_confirmed is distinct from true or p_request_id is null then raise exception 'Explicit reviewed connection and project link required' using errcode='22023';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(p_organization_id,p_project_id,p_engagement_id,p_connection_id,p_connection_revision,p_base_url)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('website-staging-link-request:'||actor::text||':'||p_request_id::text,0));
 select * into prior from private.website_staging_connection_links where created_by=actor and request_id=p_request_id;
 if found then
  if prior.request_sha256<>digest then raise exception 'Original WordPress project-link request has different inputs' using errcode='23505';end if;
  return to_jsonb(prior);
 end if;
 select * into c from public.integration_connections where id=p_connection_id and organization_id=p_organization_id and provider='wordpress' and status='verified' and last_check_status='passed' and archived_at is null for share;
 if c.id is null or c.updated_at is distinct from p_connection_revision or rtrim(c.base_url,'/') is distinct from p_base_url or c.secret_name is null or c.secret_name!~'^ANKA_WORDPRESS_[A-Z0-9_]+$' then raise exception 'Verified WordPress connection changed; review its current project link' using errcode='40001';end if;
 perform 1 from public.integration_connection_departments where organization_id=p_organization_id and connection_id=c.id and department_id='development' for share;
 if not found then raise exception 'Existing Development department access is required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-staging-project-link:'||p_organization_id::text||':'||c.id::text||':'||p_engagement_id::text,0));
 perform 1 from public.integration_connection_engagements where connection_id=c.id and organization_id=p_organization_id and engagement_id=p_engagement_id and department_id='development' for share;
 existed:=found;
 if not existed then
  insert into public.integration_connection_engagements(connection_id,organization_id,engagement_id,department_id,created_by)
  values(c.id,p_organization_id,p_engagement_id,'development',actor) on conflict(connection_id,engagement_id,department_id) do nothing;
  existed:=not found;
 end if;
 insert into private.website_staging_connection_links(organization_id,project_id,engagement_id,connection_id,connection_revision,base_url,link_existed,request_id,request_sha256,created_by)
 values(p_organization_id,p_project_id,p_engagement_id,c.id,c.updated_at,p_base_url,existed,p_request_id,digest,actor) returning * into row;
 return to_jsonb(row);
end$$;

create function public.get_website_staging_connection_link(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare row private.website_staging_connection_links;
begin
 perform private.website_staging_link_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),false);
 perform pg_advisory_xact_lock(hashtextextended('website-staging-link-request:'||auth.uid()::text||':'||p_request_id::text,0));
 select * into row from private.website_staging_connection_links where created_by=auth.uid() and request_id=p_request_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id;
 return case when row.id is null then null else to_jsonb(row) end;
end$$;

revoke all on function private.website_staging_link_actor(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_website_staging_connection_links(uuid,uuid,uuid),public.link_website_staging_connection(uuid,uuid,uuid,uuid,timestamptz,text,boolean,uuid),public.get_website_staging_connection_link(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_website_staging_connection_links(uuid,uuid,uuid),public.link_website_staging_connection(uuid,uuid,uuid,uuid,timestamptz,text,boolean,uuid),public.get_website_staging_connection_link(uuid,uuid,uuid,uuid) to authenticated;
commit;
