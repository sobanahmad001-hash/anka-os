-- N2: proposed scope is project-owned; service activation remains an explicit PM command.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create table public.project_service_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  service_id uuid not null,
  status text not null default 'proposed' check (status in ('proposed','active','on_hold','completed','cancelled')),
  scope_statement text not null default '',
  exclusions text not null default '',
  quantity integer not null default 1 check (quantity>0),
  owner_id uuid references auth.users(id) on delete set null,
  start_date date,
  target_date date,
  engagement_service_id uuid,
  revision bigint not null default 1 check (revision>0),
  source text not null check (source in ('legacy','project_setup','later_addition')),
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (project_id,service_id),
  foreign key (project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  foreign key (service_id,organization_id) references public.service_catalog(id,organization_id) on delete restrict,
  foreign key (engagement_service_id,organization_id) references public.engagement_services(id,organization_id) on delete restrict,
  check (target_date is null or start_date is null or target_date>=start_date)
);
alter table public.project_service_scopes enable row level security;
revoke all on public.project_service_scopes from public,anon,authenticated,service_role;
grant select on public.project_service_scopes to authenticated,service_role;
create policy n2_team_read_project_scope on public.project_service_scopes for select to authenticated
using (public.is_team_organization_member(organization_id));
create index n2_project_service_scopes_org_project on public.project_service_scopes(organization_id,project_id);

-- Preserve existing official selections exactly; no journey or work is rewritten.
insert into public.project_service_scopes(organization_id,project_id,service_id,status,owner_id,target_date,
  engagement_service_id,source,created_by,created_at,updated_at)
select s.organization_id,e.project_id,s.service_id,
  case s.status when 'planned' then 'proposed' else s.status end,
  s.owner_id,s.target_date,s.id,'legacy',s.activated_by,s.activated_at,s.activated_at
from public.engagement_services s join public.engagements e on e.id=s.engagement_id
  and e.organization_id=s.organization_id;

create table private.n2_service_scope_commands (
  organization_id uuid not null,
  actor_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,actor_id,request_id)
);
alter table private.n2_service_scope_commands enable row level security;
revoke all on private.n2_service_scope_commands from public,anon,authenticated,service_role;
create trigger n2_service_scope_commands_immutable before update or delete on private.n2_service_scope_commands
for each row execute function private.n1b_preserve_receipt();

create table private.n2_service_scope_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  project_id uuid not null,
  scope_id uuid not null references public.project_service_scopes(id) on delete restrict,
  actor_id uuid not null,
  action text not null,
  before_status text,
  after_status text not null,
  impact jsonb not null default '{}'::jsonb,
  request_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (organization_id,actor_id,request_id)
);
alter table private.n2_service_scope_events enable row level security;
revoke all on private.n2_service_scope_events from public,anon,authenticated,service_role;
create trigger n2_service_scope_events_immutable before update or delete on private.n2_service_scope_events
for each row execute function private.n1b_preserve_receipt();

-- The old team-wide write policy would bypass impact review and manager authority.
drop policy if exists "Team can manage engagement services" on public.engagement_services;
create policy n2_team_read_engagement_services on public.engagement_services for select to authenticated
using (public.is_team_organization_member(organization_id));
revoke insert,update,delete on public.engagement_services from public,anon,authenticated;

create function private.n2_scope_require_member(p_org uuid,p_project uuid,p_write boolean)
returns public.projects language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); project public.projects%rowtype; actor_role text;
begin
  if actor is null or p_org is null or p_project is null then
    raise exception 'Authenticated project scope required.' using errcode='42501';
  end if;
  select * into project from public.projects where id=p_project and organization_id=p_org
    and archived_at is null for share;
  if not found then raise exception 'Same-organization project required.' using errcode='42501'; end if;
  select m.role into actor_role from public.organization_memberships m join public.organizations o
    on o.id=m.organization_id where m.organization_id=p_org and m.user_id=actor
    and m.member_kind='team' and m.status='active' and o.status='active' for share of m,o;
  if not found then raise exception 'Active same-organization team member required.' using errcode='42501'; end if;
  if p_write and actor_role not in ('system_owner','operations_admin') and not exists (
    select 1 from public.project_manager_bindings b where b.organization_id=p_org
      and b.project_id=p_project and b.user_id=actor and b.status='active'
  ) then
    raise exception 'Exact project-manager or organization admin required.' using errcode='42501';
  end if;
  return project;
end; $$;
revoke all on function private.n2_scope_require_member(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.get_project_service_scope(p_organization_id uuid,p_project_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare project public.projects%rowtype; task_count bigint; work_count bigint; output_count bigint;
begin
  project:=private.n2_scope_require_member(p_organization_id,p_project_id,false);
  select count(*) into task_count from public.tasks t where t.project_id=p_project_id and t.organization_id=p_organization_id
    and t.archived_at is null;
  select count(*) into work_count from public.work_items w where w.project_id=p_project_id
    and w.organization_id=p_organization_id and w.deleted_at is null;
  select count(*) into output_count from public.deliverables d where d.project_id=p_project_id
    and d.organization_id=p_organization_id and d.archived_at is null;
  return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'project_status',project.status,
    'impact',jsonb_build_object('project_tasks',task_count,'engagement_work_items',work_count,
      'deliverables',output_count,'exact_service_linkage_known',false),
    'catalog',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,
      'department_id',c.department_id,'description',c.description) order by c.display_order,c.name)
      from public.service_catalog c where c.organization_id=p_organization_id and c.is_active),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,
      'name',coalesce(nullif(trim(p.full_name),''),m.user_id::text)) order by m.user_id)
      from public.organization_memberships m left join public.profiles p on p.id=m.user_id
      where m.organization_id=p_organization_id and m.member_kind='team' and m.status='active'),'[]'::jsonb),
    'scopes',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'service_id',s.service_id,
      'status',s.status,'scope_statement',s.scope_statement,'exclusions',s.exclusions,
      'quantity',s.quantity,'owner_id',s.owner_id,'start_date',s.start_date,
      'target_date',s.target_date,'revision',s.revision,'source',s.source,
      'engagement_service_id',s.engagement_service_id,
      'impact_token',pg_catalog.md5(s.id::text||':'||s.revision::text||':'||
        task_count::text||':'||work_count::text||':'||output_count::text)) order by s.created_at,s.id)
      from public.project_service_scopes s where s.project_id=p_project_id
        and s.organization_id=p_organization_id),'[]'::jsonb));
end; $$;

create function public.change_project_service_scope(
  p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_action text,
  p_scope_id uuid default null,p_service_id uuid default null,p_scope_statement text default '',
  p_exclusions text default '',p_quantity integer default 1,p_owner_id uuid default null,
  p_start_date date default null,p_target_date date default null,p_expected_revision bigint default null,
  p_impact_token text default null,p_impact_acknowledged boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); project public.projects%rowtype; scope public.project_service_scopes%rowtype;
  prior_status text; target_engagement_id uuid; service_row_id uuid; task_count bigint; work_count bigint;
  output_count bigint; actual_token text; payload jsonb; receipt private.n2_service_scope_commands%rowtype;
  result jsonb; impact jsonb:='{}'::jsonb;
begin
  project:=private.n2_scope_require_member(p_organization_id,p_project_id,true);
  if p_request_id is null or p_action is null
    or p_action not in ('add','activate','pause','resume','complete','cancel') then
    raise exception 'Valid service-scope command required.' using errcode='22023';
  end if;
  payload:=jsonb_build_object('project_id',p_project_id,'action',p_action,'scope_id',p_scope_id,
    'service_id',p_service_id,'scope_statement',trim(coalesce(p_scope_statement,'')),
    'exclusions',trim(coalesce(p_exclusions,'')),'quantity',p_quantity,'owner_id',p_owner_id,
    'start_date',p_start_date,'target_date',p_target_date,'expected_revision',p_expected_revision,
    'impact_token',p_impact_token,'impact_acknowledged',p_impact_acknowledged);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
  select * into receipt from private.n2_service_scope_commands
    where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.payload is distinct from payload then
      raise exception 'Request ID already used with different inputs.' using errcode='23505';
    end if;
    return receipt.result||jsonb_build_object('replayed',true);
  end if;
  if p_action='add' then
    if p_scope_id is not null or p_service_id is null or p_quantity is null or p_quantity<=0
      or (p_start_date is not null and p_target_date is not null and p_target_date<p_start_date) then
      raise exception 'Valid proposed service details required.' using errcode='22023';
    end if;
    perform 1 from public.service_catalog c where c.id=p_service_id
      and c.organization_id=p_organization_id and c.is_active for share;
    if not found then raise exception 'Active same-organization catalogue service required.' using errcode='42501'; end if;
    if p_owner_id is not null then
      perform 1 from public.organization_memberships m where m.organization_id=p_organization_id
        and m.user_id=p_owner_id and m.member_kind='team' and m.status='active' for share;
      if not found then raise exception 'Service owner must be an active same-organization member.' using errcode='42501'; end if;
    end if;
    insert into public.project_service_scopes(organization_id,project_id,service_id,scope_statement,
      exclusions,quantity,owner_id,start_date,target_date,source,created_by)
    values(p_organization_id,p_project_id,p_service_id,trim(coalesce(p_scope_statement,'')),
      trim(coalesce(p_exclusions,'')),p_quantity,p_owner_id,p_start_date,p_target_date,
      case when project.status='planning' then 'project_setup' else 'later_addition' end,actor)
    returning * into scope;
  else
    select * into scope from public.project_service_scopes where id=p_scope_id
      and organization_id=p_organization_id and project_id=p_project_id for update;
    if not found then raise exception 'Same-project service scope required.' using errcode='42501'; end if;
    if p_expected_revision is distinct from scope.revision then
      raise exception 'Service scope changed; review the current version.' using errcode='40001';
    end if;
    prior_status:=scope.status;
    if (p_action='activate' and scope.status<>'proposed')
      or (p_action='resume' and scope.status not in ('on_hold','cancelled'))
      or (p_action in ('pause','complete','cancel') and scope.status<>'active') then
      raise exception 'Service-scope transition is unavailable.' using errcode='40001';
    end if;
    if p_action in ('activate','resume') and project.status<>'active' then
      raise exception 'Activate the project before activating a service.' using errcode='40001';
    end if;
    if p_action in ('pause','complete','cancel') then
      select count(*) into task_count from public.tasks t where t.project_id=p_project_id
        and t.organization_id=p_organization_id and t.archived_at is null;
      select count(*) into work_count from public.work_items w where w.project_id=p_project_id
        and w.organization_id=p_organization_id and w.deleted_at is null;
      select count(*) into output_count from public.deliverables d where d.project_id=p_project_id
        and d.organization_id=p_organization_id and d.archived_at is null;
      actual_token:=pg_catalog.md5(scope.id::text||':'||scope.revision::text||':'||
        task_count::text||':'||work_count::text||':'||output_count::text);
      if not coalesce(p_impact_acknowledged,false) or p_impact_token is distinct from actual_token then
        raise exception 'Review current project-wide work impact before changing service scope.' using errcode='40001';
      end if;
      impact:=jsonb_build_object('project_tasks',task_count,'engagement_work_items',work_count,
        'deliverables',output_count,'exact_service_linkage_known',false);
    end if;
    if p_action in ('activate','resume') then
      if project.engagement_type<>'internal' then
        select e.id into target_engagement_id from public.engagements e where e.project_id=p_project_id
          and e.organization_id=p_organization_id and e.status='active' for share;
        if not found then raise exception 'Active canonical engagement required.' using errcode='42501'; end if;
        if scope.engagement_service_id is null then
          insert into public.engagement_services(organization_id,engagement_id,service_id,owner_id,
            target_date,status,activated_by)
          values(p_organization_id,target_engagement_id,scope.service_id,scope.owner_id,
            scope.target_date,'active',actor) returning id into service_row_id;
          scope.engagement_service_id:=service_row_id;
        else
          update public.engagement_services set status='active' where id=scope.engagement_service_id
            and organization_id=p_organization_id and engagement_id=target_engagement_id;
        end if;
      end if;
      scope.status:='active';
    else
      scope.status:=case p_action when 'pause' then 'on_hold' when 'complete' then 'completed' else 'cancelled' end;
      if scope.engagement_service_id is not null then
        update public.engagement_services set status=scope.status where id=scope.engagement_service_id
          and organization_id=p_organization_id;
      end if;
    end if;
    update public.project_service_scopes set status=scope.status,
      engagement_service_id=scope.engagement_service_id,revision=revision+1,
      updated_at=clock_timestamp() where id=scope.id returning * into scope;
  end if;
  insert into private.n2_service_scope_events(organization_id,project_id,scope_id,actor_id,
    action,before_status,after_status,impact,request_id)
  values(p_organization_id,p_project_id,scope.id,actor,p_action,prior_status,scope.status,impact,p_request_id);
  result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'scope_id',scope.id,'status',scope.status,'revision',scope.revision,'request_id',p_request_id,
    'replayed',false);
  insert into private.n2_service_scope_commands(organization_id,actor_id,request_id,payload,result)
    values(p_organization_id,actor,p_request_id,payload,result);
  return result;
end; $$;

revoke all on function public.get_project_service_scope(uuid,uuid),
  public.change_project_service_scope(uuid,uuid,uuid,text,uuid,uuid,text,text,integer,uuid,date,date,bigint,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_project_service_scope(uuid,uuid),
  public.change_project_service_scope(uuid,uuid,uuid,text,uuid,uuid,text,text,integer,uuid,date,date,bigint,text,boolean)
  to authenticated;
commit;
