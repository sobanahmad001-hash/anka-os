begin;

create table private.page_keyword_strategy_commands (
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  project_id uuid not null references public.projects(id),
  engagement_id uuid not null references public.engagements(id),
  page_id uuid not null references public.project_website_pages(id),
  page_key text not null,
  architecture_version_id uuid not null references public.artifact_versions(id),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  artifact_id uuid not null,
  version_id uuid not null,
  warnings jsonb not null check (jsonb_typeof(warnings) = 'array'),
  primary key (organization_id, actor_id, request_id),
  foreign key (artifact_id, version_id, organization_id)
    references public.artifact_versions(artifact_id, id, organization_id)
);

alter table private.page_keyword_strategy_commands enable row level security;
revoke all on private.page_keyword_strategy_commands from public, anon, authenticated, service_role;
create trigger preserve_page_keyword_strategy_command
  before update or delete on private.page_keyword_strategy_commands
  for each row execute function private.n1b_preserve_receipt();

-- Return only the original version pointer. The Edge reader must fetch the
-- exact artifact version through the authenticated caller's current RLS scope.
create function public.recover_page_keyword_strategy_receipt(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_page_id uuid,
  p_page_key text, p_architecture_version_id uuid, p_request_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  original private.page_keyword_strategy_commands;
begin
  if auth.uid() is null or not exists (
    select 1 from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    join public.projects p on p.organization_id = m.organization_id and p.id = p_project_id
    join public.engagements e on e.project_id = p.id and e.organization_id = p.organization_id
    where m.organization_id = p_organization_id and m.user_id = auth.uid()
      and m.status = 'active' and m.member_kind = 'team' and e.id = p_engagement_id
      and (m.role in ('system_owner','operations_admin','executive') or m.department_id = 'content')
  ) then
    raise exception 'Current Content workspace access required' using errcode = '42501';
  end if;
  select * into original from private.page_keyword_strategy_commands
    where organization_id = p_organization_id and actor_id = auth.uid() and request_id = p_request_id
      and project_id = p_project_id and engagement_id = p_engagement_id
      and page_id = p_page_id and page_key = p_page_key and architecture_version_id = p_architecture_version_id;
  if not found then return null; end if;
  return jsonb_build_object('request_id', original.request_id, 'project_id', original.project_id,
    'engagement_id', original.engagement_id, 'page_id', original.page_id, 'page_key', original.page_key,
    'architecture_version_id', original.architecture_version_id, 'artifact_id', original.artifact_id,
    'version_id', original.version_id, 'warnings', original.warnings);
end;
$$;
revoke all on function public.recover_page_keyword_strategy_receipt(uuid,uuid,uuid,uuid,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.recover_page_keyword_strategy_receipt(uuid,uuid,uuid,uuid,text,uuid,uuid)
  to authenticated;

commit;
