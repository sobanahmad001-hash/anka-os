-- C06: exact approved Content version carried by canonical N3 internal handoff.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.content_n3_handoff_links (
  request_id uuid primary key references public.requests(id) on delete restrict,
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete restrict,
  artifact_id uuid not null,
  artifact_version_id uuid not null,
  content_checksum text not null check (content_checksum ~ '^[a-f0-9]{64}$'),
  approval_id uuid not null,
  receiving_service_id uuid not null,
  receiving_workstream_id uuid not null references public.workstreams(id) on delete restrict,
  work_kind text check (work_kind in ('project_task','engagement_work_item')),
  work_id uuid,
  recipient_note text not null default '' check (length(recipient_note) <= 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint content_n3_work_pair check ((work_kind is null) = (work_id is null)),
  foreign key (artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete restrict,
  foreign key (artifact_id, artifact_version_id, organization_id)
    references public.artifact_versions(artifact_id, id, organization_id) on delete restrict,
  foreign key (approval_id, organization_id)
    references public.artifact_approvals(id, organization_id) on delete restrict,
  foreign key (receiving_service_id, organization_id)
    references public.engagement_services(id, organization_id) on delete restrict
);
create index content_n3_handoff_version_idx on public.content_n3_handoff_links
  (organization_id, artifact_version_id, created_at desc);
alter table public.content_n3_handoff_links enable row level security;
create policy content_n3_handoff_team_read on public.content_n3_handoff_links
  for select to authenticated using (public.is_team_organization_member(organization_id));
revoke all on public.content_n3_handoff_links from public, anon, authenticated, service_role;
grant select on public.content_n3_handoff_links to authenticated;
grant select, insert on public.content_n3_handoff_links to service_role;

create function private.content_n3_source_ids(p_content jsonb, p_in_source boolean default false)
returns text[] language plpgsql immutable set search_path = '' as $$
declare result text[] := array[]::text[]; entry record; child jsonb;
begin
  if jsonb_typeof(p_content) = 'array' then
    for child in select value from jsonb_array_elements(p_content) loop
      result := result || private.content_n3_source_ids(child, p_in_source);
    end loop;
  elsif jsonb_typeof(p_content) = 'object' then
    for entry in select key,value from jsonb_each(p_content) loop
      if (p_in_source or entry.key ~* '(source|manifest)')
        and entry.key ~* '(^|_)version_id$' and jsonb_typeof(entry.value)='string'
        and trim(entry.value #>> '{}') <> '' then
        result := result || (entry.value #>> '{}');
      else
        result := result || private.content_n3_source_ids(entry.value,
          p_in_source or entry.key ~* '(source|manifest)');
      end if;
    end loop;
  end if;
  return result;
end; $$;
revoke all on function private.content_n3_source_ids(jsonb,boolean) from public,anon,authenticated,service_role;

create function public.confirm_content_n3_handoff(
  p_organization_id uuid, p_project_id uuid, p_request_id uuid,
  p_artifact_version_id uuid, p_content_checksum text, p_approval_id uuid,
  p_receiving_service_id uuid, p_receiving_workstream_id uuid,
  p_work_kind text, p_work_id uuid, p_recipient_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  prior public.content_n3_handoff_links%rowtype;
  source_record record;
  service_record record;
  normalized_note text := trim(coalesce(p_recipient_note, ''));
  message text;
  requested_output text;
  links jsonb := '[]'::jsonb;
  source_id_text text;
  source_id uuid;
begin
  perform private.n3_require_project_member(p_organization_id, p_project_id);
  if p_request_id is null or p_artifact_version_id is null or p_approval_id is null
    or p_receiving_service_id is null or p_receiving_workstream_id is null
    or p_content_checksum is null or p_content_checksum !~ '^[a-f0-9]{64}$'
    or length(normalized_note) > 4000
    or (p_work_kind is null) <> (p_work_id is null)
    or (p_work_kind is not null and p_work_kind not in ('project_task','engagement_work_item')) then
    raise exception 'Complete bounded exact Content handoff required.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('content-n3:' || p_request_id::text, 0));
  select * into prior from public.content_n3_handoff_links where request_id=p_request_id;
  if found then
    if prior.organization_id is distinct from p_organization_id
      or prior.project_id is distinct from p_project_id
      or prior.artifact_version_id is distinct from p_artifact_version_id
      or prior.content_checksum is distinct from p_content_checksum
      or prior.approval_id is distinct from p_approval_id
      or prior.receiving_service_id is distinct from p_receiving_service_id
      or prior.receiving_workstream_id is distinct from p_receiving_workstream_id
      or prior.work_kind is distinct from p_work_kind or prior.work_id is distinct from p_work_id
      or prior.recipient_note is distinct from normalized_note or prior.created_by is distinct from actor then
      raise exception 'Handoff request ID already used with different inputs.' using errcode = '23505';
    end if;
    return jsonb_build_object('request_id', prior.request_id, 'artifact_version_id', prior.artifact_version_id,
      'receiving_service_id', prior.receiving_service_id, 'receiving_workstream_id', prior.receiving_workstream_id,
      'replayed', true);
  end if;

  select a.id artifact_id, a.title, a.artifact_type, a.engagement_id, e.project_id,
    v.content_checksum, v.content, ap.id approval_id
  into source_record
  from public.artifact_versions v
  join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id
  join public.engagements e on e.id=a.engagement_id and e.organization_id=a.organization_id
  join public.artifact_approvals ap on ap.artifact_version_id=v.id
    and ap.artifact_id=a.id and ap.engagement_id=e.id and ap.organization_id=v.organization_id
  where v.id=p_artifact_version_id and v.organization_id=p_organization_id
    and e.project_id=p_project_id and ap.id=p_approval_id
    and a.artifact_type in ('discovery','vision','audience','brand_statement','website_architecture',
      'keyword_strategy','content','campaign_messaging','scripts')
  for share of v,a,e,ap;
  if not found or source_record.content_checksum is distinct from p_content_checksum then
    raise exception 'Approved exact Content version is unavailable; refresh before handoff.' using errcode = '23514';
  end if;
  foreach source_id_text in array private.content_n3_source_ids(source_record.content) loop
    begin source_id := source_id_text::uuid;
    exception when invalid_text_representation then
      raise exception 'Recorded source version ID is invalid.' using errcode='22023'; end;
    perform 1 from public.artifact_versions sv where sv.id=source_id
      and sv.organization_id=p_organization_id for share;
    if not found then raise exception 'Recorded source version is unavailable in this organization.' using errcode='42501'; end if;
  end loop;
  perform 1 from public.engagement_services es
    join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id
    where es.organization_id=p_organization_id and es.engagement_id=source_record.engagement_id
      and es.status='active' and sc.department_id='content' and sc.is_active for share of es,sc;
  if not found then raise exception 'Active Content service required.' using errcode = '42501'; end if;
  select sc.department_id, sc.name, es.engagement_id into service_record
    from public.engagement_services es
    join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id
    where es.id=p_receiving_service_id and es.organization_id=p_organization_id
      and es.engagement_id=source_record.engagement_id and es.status='active'
      and sc.is_active and sc.department_id in ('design','marketing') for share of es,sc;
  if not found then raise exception 'Active same-engagement recipient service required.' using errcode = '42501'; end if;
  perform 1 from public.workstreams w where w.id=p_receiving_workstream_id
    and w.organization_id=p_organization_id and w.project_id=p_project_id
    and w.department_id=service_record.department_id and w.status='active' for share;
  if not found then raise exception 'Active matching recipient project workstream required.' using errcode = '42501'; end if;
  if p_work_kind='project_task' then
    perform 1 from public.tasks t where t.id=p_work_id and t.organization_id=p_organization_id
      and t.project_id=p_project_id and t.department_id=service_record.department_id
      and t.archived_at is null for share;
    if not found then raise exception 'Existing same-department project task unavailable.' using errcode='42501'; end if;
    links := jsonb_build_array(jsonb_build_object('kind','project_task','id',p_work_id));
  elsif p_work_kind='engagement_work_item' then
    perform 1 from public.work_items wi where wi.id=p_work_id and wi.organization_id=p_organization_id
      and wi.engagement_id=source_record.engagement_id and wi.project_id=p_project_id
      and wi.department_id=service_record.department_id and wi.deleted_at is null for share;
    if not found then raise exception 'Existing same-department engagement work item unavailable.' using errcode='42501'; end if;
  end if;

  message := 'Content handoff: ' || left(source_record.title, 240) || ' · exact version '
    || p_artifact_version_id::text || ' · approved ' || p_approval_id::text
    || ' · recipient ' || service_record.name || ' (' || p_receiving_service_id::text || ').';
  requested_output := 'Review exact approved Content version ' || p_artifact_version_id::text
    || ' (SHA-256 ' || p_content_checksum || '). Existing work: '
    || coalesce(p_work_kind || ' ' || p_work_id::text, 'none') || '.';
  if normalized_note <> '' then requested_output := requested_output || E'\nRecipient note: ' || normalized_note; end if;
  perform public.post_project_discussion_message_with_links(
    p_organization_id,p_project_id,p_request_id,message,null,links);
  perform public.create_project_handoff_request(
    p_organization_id,p_project_id,p_request_id,p_request_id,null,p_receiving_workstream_id,
    left('Content: ' || source_record.title,240),requested_output,
    'Review the linked exact approved version and source context; preserve existing work.',
    'medium',null);
  insert into public.content_n3_handoff_links(request_id,organization_id,project_id,artifact_id,artifact_version_id,
    content_checksum,approval_id,receiving_service_id,receiving_workstream_id,work_kind,work_id,
    recipient_note,created_by)
  values(p_request_id,p_organization_id,p_project_id,source_record.artifact_id,p_artifact_version_id,p_content_checksum,
    p_approval_id,p_receiving_service_id,p_receiving_workstream_id,p_work_kind,p_work_id,
    normalized_note,actor);
  return jsonb_build_object('request_id',p_request_id,'artifact_version_id',p_artifact_version_id,
    'receiving_service_id',p_receiving_service_id,'receiving_workstream_id',p_receiving_workstream_id,
    'replayed',false);
end; $$;
revoke all on function public.confirm_content_n3_handoff(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_content_n3_handoff(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,uuid,text)
  to authenticated;
commit;
