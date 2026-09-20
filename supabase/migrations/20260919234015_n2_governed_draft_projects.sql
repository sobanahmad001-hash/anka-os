-- N2: official draft projects use canonical project/engagement IDs and N1 PM bindings.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.n2_project_commands (
  organization_id uuid not null,
  actor_id uuid not null,
  request_id uuid not null,
  command text not null check (command in ('create_draft', 'activate')),
  payload jsonb not null,
  result jsonb not null,
  project_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, actor_id, request_id),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete restrict
);
alter table private.n2_project_commands enable row level security;
revoke all on private.n2_project_commands from public, anon, authenticated, service_role;
create trigger n2_project_commands_immutable before update or delete on private.n2_project_commands
for each row execute function private.n1b_preserve_receipt();

-- The previous P3 internal setup creates active projects for every team member.
-- Its form is replaced by the common draft form; the old RPC cannot bypass N2.
revoke execute on function public.create_internal_project_setup(
  uuid, uuid, text, text, uuid, date, date, text, text, jsonb
), public.get_internal_project_setup_options(uuid),
  private.can_select_internal_project_owner(uuid,uuid,text) from authenticated;
-- Both older engagement composers instantiate services before draft activation.
revoke execute on function public.compose_engagement(
  uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb
), public.compose_engagement_from_pipeline_template(
  uuid,uuid,uuid,text,uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb
) from authenticated;

drop policy if exists "Team can create projects" on public.projects;
drop policy if exists "Team can update projects" on public.projects;
create policy "N2 admins can create planning projects" on public.projects for insert to authenticated
with check (
  status = 'planning'
  and exists (
    select 1 from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = projects.organization_id and m.user_id = (select auth.uid())
      and m.member_kind = 'team' and m.status = 'active'
      and m.role in ('system_owner', 'operations_admin') and o.status = 'active'
  )
);
create policy "N2 admins and bound PMs can update projects" on public.projects for update to authenticated
using (
  exists (
    select 1 from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = projects.organization_id and m.user_id = (select auth.uid())
      and m.member_kind = 'team' and m.status = 'active' and o.status = 'active'
      and (
        m.role in ('system_owner', 'operations_admin')
        or exists (
          select 1 from public.project_manager_bindings b
          where b.organization_id = projects.organization_id and b.project_id = projects.id
            and b.user_id = m.user_id and b.status = 'active'
        )
      )
  )
)
with check (
  exists (
    select 1 from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = projects.organization_id and m.user_id = (select auth.uid())
      and m.member_kind = 'team' and m.status = 'active' and o.status = 'active'
      and (
        m.role in ('system_owner', 'operations_admin')
        or exists (
          select 1 from public.project_manager_bindings b
          where b.organization_id = projects.organization_id and b.project_id = projects.id
            and b.user_id = m.user_id and b.status = 'active'
        )
      )
  )
);

create function private.n2_project_write_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  manager_allowed boolean;
begin
  -- Service-role maintenance remains a trusted, separately audited lane.
  if current_setting('role', true) is distinct from 'authenticated' then return new; end if;
  if actor is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  select m.role into actor_role from public.organization_memberships m
    join public.organizations o on o.id=m.organization_id
    where m.organization_id=new.organization_id and m.user_id=actor
      and m.member_kind='team' and m.status='active' and o.status='active' for share of m,o;
  if not found then raise exception 'Active same-organization team membership required.' using errcode='42501'; end if;
  if tg_op='INSERT' then
    if actor_role not in ('system_owner','operations_admin') then
      raise exception 'Only organization owner/admin may create a project.' using errcode='42501';
    end if;
    if new.status <> 'planning' then
      raise exception 'A new project must begin as a planning draft.' using errcode='42501';
    end if;
  else
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
      raise exception 'Project identity and organization are immutable.' using errcode='42501';
    end if;
    if actor_role not in ('system_owner','operations_admin') then
      perform 1 from public.project_manager_bindings b where b.organization_id=new.organization_id
        and b.project_id=new.id and b.user_id=actor and b.status='active' for share;
      if not found then raise exception 'Exact active project-manager binding required.' using errcode='42501'; end if;
      if new.client_id is distinct from old.client_id or new.engagement_type is distinct from old.engagement_type
        or new.owner_id is distinct from old.owner_id or new.portal_visible is distinct from old.portal_visible then
        raise exception 'Client, work type, owner and portal access require organization admin.' using errcode='42501';
      end if;
    end if;
  end if;
  if new.owner_id is not null then
    perform 1 from public.organization_memberships m where m.organization_id=new.organization_id
      and m.user_id=new.owner_id and m.member_kind='team' and m.status='active' for share;
    if not found then raise exception 'Project owner must be an active same-organization team member.' using errcode='42501'; end if;
  end if;
  if new.engagement_type='internal' then
    if new.client_id is not null then raise exception 'Internal Work cannot claim a client.' using errcode='42501'; end if;
  else
    perform 1 from public.clients c where c.id=new.client_id and c.organization_id=new.organization_id for share;
    if not found then raise exception 'Client work requires a canonical same-organization client.' using errcode='42501'; end if;
  end if;
  if tg_op='UPDATE' and new.status='active' and old.status is distinct from 'active' then
    select exists(
      select 1 from public.project_manager_bindings b
      join public.organization_memberships m on m.organization_id=b.organization_id and m.user_id=b.user_id
      where b.organization_id=new.organization_id and b.project_id=new.id and b.status='active'
        and m.member_kind='team' and m.status='active'
    ) into manager_allowed;
    if not manager_allowed then
      raise exception 'An active assigned project manager is required for activation.' using errcode='42501';
    end if;
    if new.engagement_type <> 'internal' and not exists (
      select 1 from public.engagements e
      join public.agency_clients a on a.id=e.client_id and a.organization_id=e.organization_id
      join public.brands b on b.id=e.brand_id and b.client_id=a.id and b.organization_id=e.organization_id
      where e.project_id=new.id and e.organization_id=new.organization_id
        and a.canonical_client_id=new.client_id and b.status='active' and e.status='planning'
    ) then
      raise exception 'Client activation requires its canonical engagement and active brand.' using errcode='42501';
    end if;
  end if;
  return new;
end; $$;
revoke all on function private.n2_project_write_guard() from public,anon,authenticated,service_role;
create trigger n2_govern_project_write before insert or update on public.projects
for each row execute function private.n2_project_write_guard();

create function public.create_draft_project(
  p_organization_id uuid, p_request_id uuid, p_name text, p_description text,
  p_engagement_type text, p_client_id uuid, p_brand_id uuid, p_manager_id uuid,
  p_start_date date, p_due_date date, p_scope_statement text, p_exclusions text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  project_id uuid;
  engagement_id uuid;
  agency_id uuid;
  manager_binding_id uuid;
  payload jsonb;
  receipt private.n2_project_commands%rowtype;
  result jsonb;
begin
  actor := private.n1b_require_admin(p_organization_id);
  if p_request_id is null or nullif(trim(coalesce(p_name,'')),'') is null
    or length(trim(p_name)) > 240 or p_engagement_type is null
    or p_engagement_type not in ('internal','project','retainer')
    or (p_start_date is not null and p_due_date is not null and p_due_date < p_start_date) then
    raise exception 'Complete valid draft-project inputs required.' using errcode='22023';
  end if;
  if p_engagement_type='internal' then
    if p_client_id is not null or p_brand_id is not null then
      raise exception 'Internal Work cannot select client or brand.' using errcode='22023';
    end if;
  else
    if p_client_id is null or p_brand_id is null then
      raise exception 'Client and brand are required for a client draft.' using errcode='22023';
    end if;
    select a.id into agency_id from public.agency_clients a
      join public.brands b on b.client_id=a.id and b.organization_id=a.organization_id
      where a.canonical_client_id=p_client_id and a.organization_id=p_organization_id
        and b.id=p_brand_id for share of a,b;
    if not found then raise exception 'Same-organization client and brand required.' using errcode='42501'; end if;
  end if;
  if p_manager_id is not null then
    perform 1 from public.organization_memberships m where m.organization_id=p_organization_id
      and m.user_id=p_manager_id and m.member_kind='team' and m.status='active' for share;
    if not found then raise exception 'Initial PM must be an active same-organization team member.' using errcode='42501'; end if;
  end if;
  payload := jsonb_build_object('name',trim(p_name),'description',trim(coalesce(p_description,'')),
    'engagement_type',p_engagement_type,'client_id',p_client_id,'brand_id',p_brand_id,
    'manager_id',p_manager_id,'start_date',p_start_date,'due_date',p_due_date,
    'scope',trim(coalesce(p_scope_statement,'')),'exclusions',trim(coalesce(p_exclusions,'')));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || actor::text || ':' || p_request_id::text, 0));
  select * into receipt from private.n2_project_commands
    where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.command <> 'create_draft' or receipt.payload is distinct from payload then
      raise exception 'Request ID already used with different inputs.' using errcode='23505';
    end if;
    return receipt.result || jsonb_build_object('replayed',true);
  end if;
  insert into public.projects(organization_id,client_id,name,description,engagement_type,status,
    owner_id,start_date,due_date,scope_statement,exclusions,portal_visible)
  values(p_organization_id,p_client_id,trim(p_name),trim(coalesce(p_description,'')),
    p_engagement_type,'planning',coalesce(p_manager_id,actor),p_start_date,p_due_date,
    trim(coalesce(p_scope_statement,'')),trim(coalesce(p_exclusions,'')),false)
  returning id into project_id;
  if p_engagement_type <> 'internal' then
    insert into public.engagements(organization_id,client_id,brand_id,project_id,legacy_project_id,
      name,engagement_type,objective,status,lead_owner_id,start_date,target_date,created_by)
    values(p_organization_id,agency_id,p_brand_id,project_id,project_id,
      trim(p_name),p_engagement_type,trim(coalesce(p_description,'')),'planning',
      coalesce(p_manager_id,actor),p_start_date,p_due_date,actor)
    returning id into engagement_id;
  end if;
  if p_manager_id is not null then
    insert into public.project_manager_bindings(organization_id,user_id,project_id,source,source_details)
    values(p_organization_id,p_manager_id,project_id,'explicit',
      jsonb_build_object('actor_id',actor,'request_id',p_request_id,'setup','n2_draft'))
    returning id into manager_binding_id;
  end if;
  result := jsonb_build_object('organization_id',p_organization_id,'project_id',project_id,
    'engagement_id',engagement_id,'manager_binding_id',manager_binding_id,
    'status','planning','request_id',p_request_id,'replayed',false);
  insert into private.n2_project_commands(organization_id,actor_id,request_id,command,payload,result,project_id)
    values(p_organization_id,actor,p_request_id,'create_draft',payload,result,project_id);
  return result;
end; $$;

create function public.activate_draft_project(
  p_organization_id uuid, p_project_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  project public.projects%rowtype;
  payload jsonb := jsonb_build_object('project_id',p_project_id);
  receipt private.n2_project_commands%rowtype;
  result jsonb;
begin
  if actor is null or p_organization_id is null or p_project_id is null or p_request_id is null then
    raise exception 'Complete authenticated activation required.' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || actor::text || ':' || p_request_id::text, 0));
  perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
    where m.organization_id=p_organization_id and m.user_id=actor and m.member_kind='team'
      and m.status='active' and o.status='active' for share of m,o;
  if not found then raise exception 'Active same-organization team member required.' using errcode='42501'; end if;
  -- Recheck exact authority even on a replay after a PM binding was revoked.
  perform 1 from public.organization_memberships m where m.organization_id=p_organization_id
    and m.user_id=actor and m.member_kind='team' and m.status='active'
    and m.role in ('system_owner','operations_admin') for share;
  if not found then
    perform 1 from public.project_manager_bindings b where b.organization_id=p_organization_id
      and b.project_id=p_project_id and b.user_id=actor and b.status='active' for share;
    if not found then raise exception 'Exact project-manager or organization admin required.' using errcode='42501'; end if;
  end if;
  select * into receipt from private.n2_project_commands
    where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.command <> 'activate' or receipt.payload is distinct from payload then
      raise exception 'Request ID already used with different inputs.' using errcode='23505';
    end if;
    return receipt.result || jsonb_build_object('replayed',true);
  end if;
  select * into project from public.projects where id=p_project_id and organization_id=p_organization_id
    and archived_at is null for update;
  if not found then raise exception 'Same-organization project required.' using errcode='42501'; end if;
  perform 1 from public.organization_memberships m where m.organization_id=p_organization_id
    and m.user_id=actor and m.member_kind='team' and m.status='active'
    and m.role in ('system_owner','operations_admin') for share;
  if not found then
    perform 1 from public.project_manager_bindings b where b.organization_id=p_organization_id
      and b.project_id=p_project_id and b.user_id=actor and b.status='active' for share;
    if not found then raise exception 'Exact project-manager or organization admin required.' using errcode='42501'; end if;
  end if;
  if project.status <> 'planning' then
    raise exception 'Only a planning draft can be activated.' using errcode='40001';
  end if;
  update public.projects set status='active' where id=p_project_id and organization_id=p_organization_id;
  if project.engagement_type <> 'internal' then
    update public.engagements set status='active' where project_id=p_project_id and organization_id=p_organization_id
      and status='planning';
  end if;
  result := jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'status','active','request_id',p_request_id,'replayed',false);
  insert into private.n2_project_commands(organization_id,actor_id,request_id,command,payload,result,project_id)
    values(p_organization_id,actor,p_request_id,'activate',payload,result,p_project_id);
  return result;
end; $$;

create function public.get_project_draft_options(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.n1b_require_admin(p_organization_id);
  return jsonb_build_object(
    'organization_id',p_organization_id,
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.user_id,'name',coalesce(nullif(trim(p.full_name),''),m.user_id::text),
      'role',m.role) order by m.user_id)
      from public.organization_memberships m left join public.profiles p on p.id=m.user_id
      where m.organization_id=p_organization_id and m.member_kind='team' and m.status='active'),'[]'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.canonical_client_id,'name',a.name,
      'brands',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name)
        from public.brands b where b.organization_id=p_organization_id and b.client_id=a.id
          and b.status='active'),'[]'::jsonb)) order by a.name)
      from public.agency_clients a where a.organization_id=p_organization_id),'[]'::jsonb));
end; $$;

revoke all on function public.create_draft_project(uuid,uuid,text,text,text,uuid,uuid,uuid,date,date,text,text),
  public.activate_draft_project(uuid,uuid,uuid), public.get_project_draft_options(uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_draft_project(uuid,uuid,text,text,text,uuid,uuid,uuid,date,date,text,text),
  public.activate_draft_project(uuid,uuid,uuid), public.get_project_draft_options(uuid) to authenticated;
commit;
