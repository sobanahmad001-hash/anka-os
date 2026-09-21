-- M01 turns saved exact SEO research into a human-confirmed, project-bound N3 Content request.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create table public.marketing_seo_content_requests (
  request_id uuid primary key references public.requests(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  engagement_id uuid not null,
  research_version_id uuid not null,
  research_checksum text not null check(research_checksum ~ '^[a-f0-9]{64}$'),
  receiving_service_id uuid not null,
  receiving_workstream_id uuid not null,
  title text not null check(length(title) between 1 and 240),
  requested_output text not null check(length(requested_output) between 1 and 7800),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  foreign key(engagement_id,organization_id) references public.engagements(id,organization_id) on delete restrict,
  foreign key(research_version_id,organization_id) references public.artifact_versions(id,organization_id) on delete restrict,
  foreign key(receiving_service_id,organization_id) references public.engagement_services(id,organization_id) on delete restrict,
  foreign key(receiving_workstream_id,project_id,organization_id) references public.workstreams(id,project_id,organization_id) on delete restrict
);
create index marketing_seo_content_requests_source_idx on public.marketing_seo_content_requests
  (organization_id,research_version_id,confirmed_at desc);
alter table public.marketing_seo_content_requests enable row level security;
create policy marketing_seo_content_requests_team_read on public.marketing_seo_content_requests
  for select to authenticated using(public.is_team_organization_member(organization_id));
revoke all on public.marketing_seo_content_requests from public,anon,authenticated,service_role;
grant select on public.marketing_seo_content_requests to authenticated;
create trigger marketing_seo_content_requests_immutable before update or delete
  on public.marketing_seo_content_requests for each row execute function private.p7_reject_history_mutation();

create function public.confirm_marketing_seo_content_request(
  p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_request_id uuid,
  p_research_version_id uuid,p_research_checksum text,p_receiving_service_id uuid,
  p_receiving_workstream_id uuid,p_title text,p_requested_output text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  source_record record;
  prior public.marketing_seo_content_requests%rowtype;
  normalized_title text:=trim(coalesce(p_title,''));
  normalized_output text:=trim(coalesce(p_requested_output,''));
  canonical_output text;
begin
  if actor is null or p_request_id is null or p_organization_id is null or p_project_id is null
    or p_engagement_id is null or p_research_version_id is null or p_receiving_service_id is null
    or p_receiving_workstream_id is null or p_research_checksum is null
    or p_research_checksum !~ '^[a-f0-9]{64}$'
    or length(normalized_title) not between 1 and 240
    or length(normalized_output) not between 1 and 7800 then
    raise exception 'Complete exact Marketing Content request required' using errcode='22023';
  end if;
  if not private.p7_assignment_authority(p_organization_id,p_project_id,'marketing',actor) then
    raise exception 'Exact-project Marketing request authority required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('m01-content:'||p_request_id::text,0));
  select * into prior from public.marketing_seo_content_requests where request_id=p_request_id;
  if found then
    if prior.organization_id is distinct from p_organization_id or prior.project_id is distinct from p_project_id
      or prior.engagement_id is distinct from p_engagement_id
      or prior.research_version_id is distinct from p_research_version_id
      or prior.research_checksum is distinct from p_research_checksum
      or prior.receiving_service_id is distinct from p_receiving_service_id
      or prior.receiving_workstream_id is distinct from p_receiving_workstream_id
      or prior.title is distinct from normalized_title or prior.requested_output is distinct from normalized_output
      or prior.confirmed_by is distinct from actor then
      raise exception 'Request ID already used with different Content request inputs' using errcode='23505';
    end if;
    return jsonb_build_object('request_id',prior.request_id,'research_version_id',prior.research_version_id,'replayed',true);
  end if;
  select v.id,v.content_checksum,a.id artifact_id,a.title artifact_title,a.engagement_id,
    e.project_id,e.brand_id
    into source_record
    from public.artifact_versions v
    join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id
    join public.engagements e on e.id=a.engagement_id and e.organization_id=a.organization_id
    where v.id=p_research_version_id and v.organization_id=p_organization_id
      and a.artifact_type='seo_research' and a.engagement_id=p_engagement_id
      and a.brand_id=e.brand_id
      and e.project_id=p_project_id for share of v,a,e;
  if not found or source_record.content_checksum is distinct from p_research_checksum then
    raise exception 'Saved exact SEO research version or checksum changed' using errcode='23514';
  end if;
  perform 1 from public.engagement_services es join public.service_catalog sc
    on sc.id=es.service_id and sc.organization_id=es.organization_id
    where es.organization_id=p_organization_id and es.engagement_id=p_engagement_id
      and es.status='active' and sc.is_active and sc.department_id='marketing' for share of es,sc;
  if not found then raise exception 'Active Marketing service required' using errcode='42501'; end if;
  perform 1 from public.engagement_services es join public.service_catalog sc
    on sc.id=es.service_id and sc.organization_id=es.organization_id
    where es.id=p_receiving_service_id and es.organization_id=p_organization_id
      and es.engagement_id=p_engagement_id and es.status='active'
      and sc.is_active and sc.department_id='content' for share of es,sc;
  if not found then raise exception 'Active same-engagement Content service required' using errcode='42501'; end if;
  perform 1 from public.workstreams w where w.id=p_receiving_workstream_id
    and w.organization_id=p_organization_id and w.project_id=p_project_id
    and w.department_id='content' and w.status='active' for share;
  if not found then raise exception 'Active same-project Content workstream required' using errcode='42501'; end if;
  canonical_output:=normalized_output || E'\n\nExact Marketing SEO research source: '
    || p_research_version_id::text || ' (SHA-256 ' || p_research_checksum || ').';
  perform public.post_project_discussion_message_with_links(
    p_organization_id,p_project_id,p_request_id,
    'Marketing requests Content work: '||normalized_title||' · exact SEO research '
      || p_research_version_id::text||'.',null,'[]'::jsonb);
  perform public.create_project_handoff_request(
    p_organization_id,p_project_id,p_request_id,p_request_id,null,p_receiving_workstream_id,
    normalized_title,canonical_output,
    'Review exact SEO research evidence and update canonical Content work without replacing approved originals.',
    'medium',null);
  insert into public.marketing_seo_content_requests(
    request_id,organization_id,project_id,engagement_id,research_version_id,research_checksum,
    receiving_service_id,receiving_workstream_id,title,requested_output,confirmed_by
  ) values (
    p_request_id,p_organization_id,p_project_id,p_engagement_id,p_research_version_id,p_research_checksum,
    p_receiving_service_id,p_receiving_workstream_id,normalized_title,normalized_output,actor
  );
  return jsonb_build_object('request_id',p_request_id,'research_version_id',p_research_version_id,'replayed',false);
end;
$$;
revoke all on function public.confirm_marketing_seo_content_request(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_marketing_seo_content_request(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text)
  to authenticated;
commit;
