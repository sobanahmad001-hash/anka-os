-- Reversible lifecycle and conservative, catalog-driven empty-project deletion.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Deliberately no foreign keys: a successful deletion must retain its receipt.
create table private.project_lifecycle_commands (
  organization_id uuid not null, actor_id uuid not null, request_id uuid not null,
  payload jsonb not null, result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, actor_id, request_id)
);
create table private.project_deletion_previews (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  project_id uuid not null, actor_id uuid not null, project_name text not null,
  expires_at timestamptz not null default (clock_timestamp() + interval '5 minutes')
);
alter table private.project_lifecycle_commands enable row level security;
alter table private.project_deletion_previews enable row level security;
revoke all on private.project_lifecycle_commands, private.project_deletion_previews
  from public, anon, authenticated, service_role;
create trigger project_lifecycle_commands_immutable before update or delete
  on private.project_lifecycle_commands for each row execute function private.n1b_preserve_receipt();

-- Direct API writes cannot bypass preview, authority locks or the activity trail.
revoke delete, update on public.projects from public, anon, authenticated, service_role;
do $$ declare columns text;
begin
  -- Preserve existing editing of unrelated project fields, excluding lifecycle state.
  select string_agg(format('%I', attname), ', ' order by attnum) into columns
  from pg_catalog.pg_attribute where attrelid='public.projects'::regclass
    and attnum>0 and not attisdropped and attname<>'archived_at';
  execute format('grant update (%s) on public.projects to authenticated, service_role', columns);
  revoke update (archived_at) on public.projects from public, anon, authenticated, service_role;
end $$;

create function private.project_lifecycle_authority(p_org uuid, p_project uuid, p_admin boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); role_name text;
begin
  select m.role into role_name from public.organization_memberships m
  join public.organizations o on o.id=m.organization_id
  where m.organization_id=p_org and m.user_id=actor and m.member_kind='team'
    and m.status='active' and o.status='active' for share of m,o;
  if not found then raise exception 'Active team authority required.' using errcode='42501'; end if;
  if role_name is null or role_name not in ('system_owner','operations_admin') then
    if p_admin then raise exception 'Organization admin required.' using errcode='42501'; end if;
    perform 1 from public.project_manager_bindings b where b.organization_id=p_org
      and b.project_id=p_project and b.user_id=actor and b.status='active' for share;
    if not found then raise exception 'Exact active project-manager binding required.' using errcode='42501'; end if;
  end if;
  return actor;
end $$;

-- Serialize no-FK project references per project ID without relation-wide write locks.
-- Writers take parent key-share locks; deletion takes FOR UPDATE before its catalog recheck.
create function private.lock_project_soft_reference_write()
returns trigger language plpgsql set search_path='' as $$
begin
  -- A writer queued behind deletion must not create an orphan after the parent commits.
  if new.project_id is not null then
    perform 1 from public.projects p where p.id=new.project_id for key share;
    if not found then
      raise exception 'Project reference is unavailable.' using errcode='23503';
    end if;
  end if;
  return new;
end $$;

-- Install per-row guards only on soft-reference relations; FK-backed inserts already
-- take a key-share lock on projects.id and are serialized by the project row lock.
do $$ declare ref record;
begin
  for ref in
    select distinct n.nspname,t.relname
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class t on t.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=t.relnamespace
    where a.attname='project_id' and a.atttypid='pg_catalog.uuid'::regtype
      and a.attnum>0 and not a.attisdropped and n.nspname in ('public','private')
      and t.relkind='r'
      and t.oid not in ('public.projects'::regclass,'private.project_deletion_previews'::regclass)
      and not exists (
        select 1 from pg_catalog.pg_constraint fk
        where fk.contype='f' and fk.conrelid=a.attrelid
          and a.attnum=any(fk.conkey)
      )
    order by n.nspname,t.relname
  loop
    execute format('create trigger trg_project_lifecycle_softref_lock before insert or update of project_id on %I.%I for each row execute function private.lock_project_soft_reference_write()',
      ref.nspname,ref.relname);
  end loop;
end $$;

-- Follow FK-column identities from projects.id, including indirect descendants.
-- Add only genuinely no-FK UUID project_id soft references in public/private.
-- Composite keys and multiple project references in one row must not double count.
-- At READ COMMITTED, default VOLATILE gives each count a fresh snapshot after the parent row lock.
create function private.project_lifecycle_dependencies(p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare child record; row_count bigint; counts jsonb:='[]'::jsonb;
begin
  for child in
    with recursive project_columns(table_id,attnum) as (
      select a.attrelid,a.attnum from pg_catalog.pg_attribute a
      where a.attrelid='public.projects'::regclass and a.attname='id'
      union
      select c.conrelid,k.child_att
      from project_columns root
      join pg_catalog.pg_constraint c on c.confrelid=root.table_id and c.contype='f'
      cross join lateral unnest(c.conkey,c.confkey) as k(child_att,parent_att)
      where k.parent_att=root.attnum
    ), refs as (
      select a.attrelid as table_id,a.attname
      from project_columns root
      join pg_catalog.pg_attribute a on a.attrelid=root.table_id and a.attnum=root.attnum
      union
      select a.attrelid as table_id, a.attname
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class t on t.oid=a.attrelid
      join pg_catalog.pg_namespace n on n.oid=t.relnamespace
      where a.attname='project_id' and a.atttypid='pg_catalog.uuid'::regtype
        and a.attnum>0 and not a.attisdropped and n.nspname in ('public','private')
        and not exists (
          select 1 from pg_catalog.pg_constraint fk
          where fk.contype='f' and fk.conrelid=a.attrelid
            and a.attnum=any(fk.conkey)
        )
    )
    select n.nspname, t.relname,
      string_agg(distinct format('%I = $1', refs.attname), ' OR ') as predicate
    from refs
    join pg_catalog.pg_class t on t.oid=refs.table_id
    join pg_catalog.pg_namespace n on n.oid=t.relnamespace
    where n.nspname !~ '^pg_' and n.nspname<>'information_schema'
      and t.relkind in ('r','p')
      and t.oid not in ('public.projects'::regclass,'private.project_deletion_previews'::regclass)
    group by n.nspname,t.relname order by n.nspname,t.relname
  loop
    if child.nspname='public' and child.relname='living_project_documents' then
      -- Ignore only the untouched identity scaffold created automatically for every project.
      -- Any snapshot is scanned separately; any edited/expanded projection remains a blocker.
      execute $q$
        select count(*) from public.living_project_documents d
        join public.projects p on p.id=d.project_id
        where d.project_id=$1 and (
          d.source_version<>1
          or d.client_projection is distinct from '{}'::jsonb
          or d.internal_projection is distinct from pg_catalog.jsonb_build_object(
            'identity',pg_catalog.jsonb_build_object(
              'project_id',p.id,'name',p.name,'engagement_type',p.engagement_type))
        )
      $q$ into row_count using p_project;
    else
      execute format('select count(*) from %I.%I where %s',child.nspname,child.relname,child.predicate)
        into row_count using p_project;
    end if;
    counts:=counts || jsonb_build_array(jsonb_build_object('schema',child.nspname,
      'table',child.relname,'count',row_count));
  end loop;
  return counts;
end $$;

create function public.set_project_archived(p_organization_id uuid,p_project_id uuid,
  p_archived boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' set statement_timeout='120s' as $$
declare actor uuid; project public.projects%rowtype; receipt private.project_lifecycle_commands%rowtype;
  payload jsonb; result jsonb; stamp timestamptz;
begin
  if p_request_id is null or p_archived is null then raise exception 'Complete lifecycle command required.' using errcode='22023'; end if;
  actor:=private.project_lifecycle_authority(p_organization_id,p_project_id,false);
  payload:=jsonb_build_object('command','archive','project_id',p_project_id,'archived',p_archived);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'project-lifecycle:'||p_organization_id::text||actor::text||p_request_id::text,0));
  select * into receipt from private.project_lifecycle_commands where organization_id=p_organization_id
    and actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.payload is distinct from payload then raise exception 'Request ID already used.' using errcode='23505'; end if;
    return receipt.result || jsonb_build_object('replayed',true);
  end if;
  select * into project from public.projects where id=p_project_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Project unavailable.' using errcode='42501'; end if;
  perform private.project_lifecycle_authority(p_organization_id,p_project_id,false);
  stamp:=case when p_archived then coalesce(project.archived_at,clock_timestamp()) else null end;
  if project.archived_at is distinct from stamp then
    update public.projects set archived_at=stamp where id=p_project_id;
    insert into public.activity_events(organization_id,project_id,actor_id,action,target_type,target_id,visibility)
    values(p_organization_id,p_project_id,actor,case when p_archived then 'project.archived' else 'project.restored' end,
      'project',p_project_id,'internal_only');
  end if;
  result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'request_id',p_request_id,'archived_at',stamp,'status',project.status,'replayed',false);
  insert into private.project_lifecycle_commands values(p_organization_id,actor,p_request_id,payload,result,clock_timestamp());
  return result;
end $$;

create function public.list_project_lifecycle(p_organization_id uuid,p_archived boolean)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' set statement_timeout='120s' as $$
begin
  perform private.project_lifecycle_authority(p_organization_id,null,true);
  return jsonb_build_object('organization_id',p_organization_id,'projects',coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'status',p.status,'archived_at',p.archived_at) order by p.name,p.id)
    from public.projects p where p.organization_id=p_organization_id
      and case when p_archived then p.archived_at is not null else p.archived_at is null and p.status='planning' end
  ),'[]'::jsonb));
end $$;

create function public.preview_project_deletion(p_organization_id uuid,p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' set statement_timeout='120s' as $$
declare actor uuid; project public.projects%rowtype; counts jsonb; eligible boolean;
  preview private.project_deletion_previews%rowtype;
begin
  actor:=private.project_lifecycle_authority(p_organization_id,p_project_id,true);
  select * into project from public.projects where id=p_project_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Project unavailable.' using errcode='42501'; end if;
  counts:=private.project_lifecycle_dependencies(p_project_id);
  eligible:=project.archived_at is null and project.status='planning'
    and not exists(select 1 from jsonb_array_elements(counts) c where (c->>'count')::bigint>0);
  if eligible then
    delete from private.project_deletion_previews where expires_at<=clock_timestamp();
    insert into private.project_deletion_previews(organization_id,project_id,actor_id,project_name)
      values(p_organization_id,p_project_id,actor,project.name) returning * into preview;
  end if;
  return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'project_name',project.name,'eligible',eligible,'dependencies',counts,
    'preview_id',preview.id,'expires_at',preview.expires_at);
end $$;

create function public.delete_empty_project(p_organization_id uuid,p_project_id uuid,
  p_preview_id uuid,p_confirmation text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' set statement_timeout='120s' as $$
declare actor uuid; project public.projects%rowtype; preview private.project_deletion_previews%rowtype;
  receipt private.project_lifecycle_commands%rowtype; payload jsonb; result jsonb; counts jsonb;
begin
  -- The post-wait dependency recheck must see writers committed while acquiring the parent lock.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Project deletion requires READ COMMITTED isolation.' using errcode='25001';
  end if;
  if p_request_id is null or p_preview_id is null or p_confirmation is null then
    raise exception 'Preview, exact project name and request ID required.' using errcode='22023'; end if;
  actor:=private.project_lifecycle_authority(p_organization_id,p_project_id,true);
  payload:=jsonb_build_object('command','delete','project_id',p_project_id,
    'preview_id',p_preview_id,'confirmation_sha256',
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_confirmation,'UTF8'),'sha256'),'hex'));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'project-lifecycle:'||p_organization_id::text||actor::text||p_request_id::text,0));
  select * into receipt from private.project_lifecycle_commands where organization_id=p_organization_id
    and actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.payload is distinct from payload then raise exception 'Request ID already used.' using errcode='23505'; end if;
    return receipt.result || jsonb_build_object('replayed',true);
  end if;
  -- Serialize FK and no-FK writers on the parent before the VOLATILE catalog recheck.
  select * into project from public.projects where id=p_project_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Project unavailable.' using errcode='42501'; end if;
  perform private.project_lifecycle_authority(p_organization_id,p_project_id,true);
  select * into preview from private.project_deletion_previews where id=p_preview_id
    and organization_id=p_organization_id and project_id=p_project_id and actor_id=actor for update;
  if not found or preview.expires_at<=clock_timestamp()
    or preview.project_name is distinct from p_confirmation or project.name is distinct from p_confirmation then
    raise exception 'Fresh unused preview and exact current project name required.' using errcode='22023'; end if;
  counts:=private.project_lifecycle_dependencies(p_project_id);
  if project.archived_at is not null or project.status<>'planning'
    or exists(select 1 from jsonb_array_elements(counts) c where (c->>'count')::bigint>0) then
    raise exception 'Only unarchived planning projects without retained records can be deleted. Refresh the preview.' using errcode='40001'; end if;
  if preview.expires_at<=clock_timestamp() then
    raise exception 'Deletion preview expired. Request a fresh preview.' using errcode='22023'; end if;
  -- The project row lock also blocks concurrent FK inserts until this transaction ends.
  -- No child deletion, cascade traversal or shared-record cleanup is performed.
  delete from public.projects where id=p_project_id and organization_id=p_organization_id;
  delete from private.project_deletion_previews where id=p_preview_id;
  result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'request_id',p_request_id,'deleted',true,'replayed',false);
  insert into private.project_lifecycle_commands values(p_organization_id,actor,p_request_id,payload,result,clock_timestamp());
  return result;
end $$;

create or replace function private.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects project
      where project.id = target_project_id
        and (
          public.is_team_organization_member(project.organization_id)
          or (
            project.portal_visible = true
            and project.archived_at is null
            and exists (
              select 1
              from public.project_client_access access
              join public.client_contacts contact
                on contact.id = access.client_contact_id
              where access.project_id = project.id
                and access.status = 'active'
                and contact.auth_user_id = (select auth.uid())
                and contact.status = 'active'
            )
          )
        )
    );
$$;

create or replace function private.is_project_client(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects project
      join public.project_client_access access
        on access.project_id = project.id
       and access.status = 'active'
      join public.client_contacts contact
        on contact.id = access.client_contact_id
       and contact.status = 'active'
      where project.id = target_project_id
        and project.portal_visible = true
        and project.archived_at is null
        and contact.auth_user_id = (select auth.uid())
    );
$$;

revoke all on function private.can_access_project(uuid) from public, anon;
revoke all on function private.is_project_client(uuid) from public, anon;
grant execute on function private.can_access_project(uuid)
  to authenticated, service_role;
grant execute on function private.is_project_client(uuid)
  to authenticated, service_role;


revoke all on function private.project_lifecycle_authority(uuid,uuid,boolean),
  private.lock_project_soft_reference_write(),
  private.project_lifecycle_dependencies(uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_project_archived(uuid,uuid,boolean,uuid),
  public.list_project_lifecycle(uuid,boolean),public.preview_project_deletion(uuid,uuid),
  public.delete_empty_project(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_project_archived(uuid,uuid,boolean,uuid),
  public.list_project_lifecycle(uuid,boolean),public.preview_project_deletion(uuid,uuid),
  public.delete_empty_project(uuid,uuid,uuid,text,uuid) to authenticated;
commit;
