begin;

create table private.project_foundation_brief_bindings (
  request_id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  project_id uuid not null references public.projects(id),
  engagement_id uuid not null references public.engagements(id),
  actor_id uuid not null references auth.users(id),
  checkpoint_id uuid not null references public.living_project_document_snapshots(id),
  source_version bigint not null check (source_version > 0),
  brief_sha256 text not null check (brief_sha256 ~ '^[0-9a-f]{64}$'),
  prior_request_id uuid references private.project_foundation_brief_bindings(request_id),
  revision bigint not null check (revision > 0),
  unique (organization_id, project_id, engagement_id, revision)
);
alter table private.project_foundation_brief_bindings enable row level security;
revoke all on private.project_foundation_brief_bindings from public, anon, authenticated, service_role;
create trigger preserve_project_foundation_brief_binding before update or delete
  on private.project_foundation_brief_bindings for each row execute function private.n1b_preserve_receipt();

create function private.foundation_brief_binding_dto(b private.project_foundation_brief_bindings)
returns jsonb language sql immutable strict security invoker set search_path='' as $$
  select jsonb_build_object('request_id',b.request_id,'checkpoint_id',b.checkpoint_id,
    'source_version',b.source_version,'brief_sha256',b.brief_sha256)
$$;
revoke all on function private.foundation_brief_binding_dto(private.project_foundation_brief_bindings)
  from public, anon, authenticated, service_role;

create function public.read_project_foundation_brief(p_organization_id uuid,p_project_id uuid,
  p_engagement_id uuid,p_checkpoint_id uuid default null,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare
  project public.projects;
  binding jsonb;
  page jsonb;
  more boolean;
  selected jsonb;
begin
  project := private.n2_scope_require_member(p_organization_id,p_project_id,false);
  perform 1 from public.engagements e where e.organization_id=p_organization_id and e.project_id=p_project_id
    and e.id=p_engagement_id and e.status in ('planning','active') for share;
  if not found then raise exception 'Current project engagement required' using errcode='42501'; end if;
  if p_offset is null or p_offset not between 0 and 1000000 then
    raise exception 'Invalid checkpoint offset' using errcode='22023';
  end if;

  select private.foundation_brief_binding_dto(b) into binding from private.project_foundation_brief_bindings b
    where b.organization_id=p_organization_id and b.project_id=p_project_id and b.engagement_id=p_engagement_id
    order by b.revision desc limit 1;
  with candidates as (
    select s.id,s.source_version from public.living_project_document_snapshots s
    where s.organization_id=p_organization_id and s.project_id=p_project_id and s.projection_kind='internal'
      and jsonb_typeof(s.snapshot #> '{project,description}')='string'
    order by s.source_version desc,s.id limit 26 offset p_offset
  ), numbered as (
    select *,row_number() over(order by source_version desc,id) as ordinal from candidates
  )
  select coalesce(jsonb_agg(jsonb_build_object('checkpoint_id',id,'source_version',source_version)
    order by ordinal) filter(where ordinal<=25),'[]'::jsonb),count(*)>25 into page,more from numbered;

  if p_checkpoint_id is not null then
    select jsonb_build_object('checkpoint_id',s.id,'source_version',s.source_version,
      'brief_text',s.snapshot #>> '{project,description}',
      'brief_sha256',encode(sha256(convert_to(s.snapshot #>> '{project,description}','UTF8')),'hex'),
      'matches_current_brief',(s.snapshot #>> '{project,description}')=project.description)
    into selected from public.living_project_document_snapshots s
    where s.id=p_checkpoint_id and s.organization_id=p_organization_id and s.project_id=p_project_id
      and s.projection_kind='internal' and jsonb_typeof(s.snapshot #> '{project,description}')='string';
    if selected is null then raise exception 'Selected internal checkpoint unavailable' using errcode='42501'; end if;
  end if;
  return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'engagement_id',p_engagement_id,'actor_id',auth.uid(),'current_binding',binding,
    'options',page,'has_more',more,'selected',selected);
end $$;

create function public.bind_project_foundation_brief(p_organization_id uuid,p_project_id uuid,
  p_engagement_id uuid,p_checkpoint_id uuid,p_source_version bigint,p_brief_sha256 text,
  p_expected_binding_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare
  prior private.project_foundation_brief_bindings;
  saved private.project_foundation_brief_bindings;
  reviewed jsonb;
begin
  if p_request_id is null or p_checkpoint_id is null or p_source_version is null or p_source_version<1
    or p_brief_sha256 is null or p_brief_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Exact reviewed checkpoint identity required' using errcode='22023';
  end if;
  perform private.n2_scope_require_member(p_organization_id,p_project_id,true);
  perform 1 from public.engagements e where e.id=p_engagement_id and e.organization_id=p_organization_id
    and e.project_id=p_project_id and e.status in ('planning','active') for update;
  if not found then raise exception 'Current project engagement required' using errcode='42501'; end if;

  select * into saved from private.project_foundation_brief_bindings where request_id=p_request_id;
  if found then
    if row(saved.organization_id,saved.project_id,saved.engagement_id,saved.actor_id,saved.checkpoint_id,
           saved.source_version,saved.brief_sha256,saved.prior_request_id)
       is distinct from row(p_organization_id,p_project_id,p_engagement_id,auth.uid(),p_checkpoint_id,
           p_source_version,p_brief_sha256,p_expected_binding_id) then
      raise exception 'Request identity unavailable' using errcode='23505';
    end if;
    return private.foundation_brief_binding_dto(saved);
  end if;
  select * into prior from private.project_foundation_brief_bindings
    where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id
    order by revision desc limit 1;
  if prior.request_id is distinct from p_expected_binding_id then
    raise exception 'Foundation binding changed; review again' using errcode='40001';
  end if;
  reviewed := public.read_project_foundation_brief(p_organization_id,p_project_id,p_engagement_id,p_checkpoint_id,0)->'selected';
  if (reviewed->>'source_version')::bigint is distinct from p_source_version
    or reviewed->>'brief_sha256' is distinct from p_brief_sha256
    or (reviewed->>'matches_current_brief')::boolean is distinct from true
    or nullif(btrim(reviewed->>'brief_text'),'') is null then
    raise exception 'Checkpoint or current brief differs; review again' using errcode='22023';
  end if;
  insert into private.project_foundation_brief_bindings(request_id,organization_id,project_id,engagement_id,
    actor_id,checkpoint_id,source_version,brief_sha256,prior_request_id,revision)
    values(p_request_id,p_organization_id,p_project_id,p_engagement_id,auth.uid(),p_checkpoint_id,
      p_source_version,p_brief_sha256,p_expected_binding_id,coalesce(prior.revision,0)+1)
    returning * into saved;
  return private.foundation_brief_binding_dto(saved);
end $$;

revoke all on function public.read_project_foundation_brief(uuid,uuid,uuid,uuid,integer),
  public.bind_project_foundation_brief(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_project_foundation_brief(uuid,uuid,uuid,uuid,integer),
  public.bind_project_foundation_brief(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid) to authenticated;

create function public.recover_project_foundation_brief(
  p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare result jsonb;
begin
  perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
  select private.foundation_brief_binding_dto(b) into result
  from private.project_foundation_brief_bindings b
  join public.engagements e on e.id=b.engagement_id and e.organization_id=b.organization_id
    and e.project_id=b.project_id
  where b.request_id=p_request_id and b.actor_id=auth.uid() and b.organization_id=p_organization_id
    and b.project_id=p_project_id and b.engagement_id=p_engagement_id;
  return result;
end $$;
revoke all on function public.recover_project_foundation_brief(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.recover_project_foundation_brief(uuid,uuid,uuid,uuid) to authenticated;
commit;
