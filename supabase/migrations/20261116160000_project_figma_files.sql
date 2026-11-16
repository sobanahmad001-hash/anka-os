create table private.work_figma_files (
  project_id uuid primary key references public.projects on delete cascade,
  connection_id uuid references public.integration_connections on delete set null,
  file_key text,
  revision bigint not null
);
revoke all on private.work_figma_files from public, anon, authenticated, service_role;

create function private.work_figma_choices(p_org uuid,p_project uuid)
returns table(id uuid, name text, file_key text)
language sql stable security definer set search_path='' as $$
  select c.id,c.display_name,c.public_config->>'file_key'
  from public.integration_connections c
  where c.organization_id=p_org and c.provider='figma' and c.status='verified'
    and c.archived_at is null and c.secret_name ~ '^ANKA_FIGMA_[A-Z0-9_]+$'
    and c.public_config->>'file_key' ~ '^[A-Za-z0-9]{1,160}$'
    and (not exists(select from public.integration_connection_engagements m where m.connection_id=c.id)
      or exists(select from public.integration_connection_engagements m join public.engagements e on e.id=m.engagement_id
        where m.connection_id=c.id and e.organization_id=p_org and e.project_id=p_project and e.status in ('planning','active')))
$$;
revoke all on function private.work_figma_choices(uuid,uuid) from public,anon,authenticated,service_role;

create function public.work_figma_settings(p_org uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb; binding private.work_figma_files; current_file jsonb; choices jsonb;
begin
  scope:=public.work_drive_settings(p_org,p_project);
  select * into binding from private.work_figma_files where project_id=p_project;
  select to_jsonb(c) into current_file from private.work_figma_choices(p_org,p_project) c
    where c.id=binding.connection_id and c.file_key=binding.file_key;
  if (scope->>'manage')::boolean then
    select jsonb_agg(to_jsonb(c) order by c.name,c.id) into choices from private.work_figma_choices(p_org,p_project) c;
  end if;
  return jsonb_build_object('manage',scope->'manage','file',current_file,'choices',coalesce(choices,'[]'),
    'unavailable',binding.file_key is not null and current_file is null,'revision',coalesce(binding.revision,0));
end;$$;

create function public.set_work_figma_file(p_org uuid,p_project uuid,p_revision bigint,p_connection uuid,p_file text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project::text,89));
  settings:=public.work_figma_settings(p_org,p_project);
  if (settings->>'manage')::boolean is not true then raise insufficient_privilege; end if;
  if (settings->>'revision')::bigint is distinct from p_revision then raise serialization_failure; end if;
  if not ((p_connection is null and p_file is null) or exists(select from private.work_figma_choices(p_org,p_project)
    where id=p_connection and file_key=p_file)) then raise exception 'Design file unavailable'; end if;
  insert into private.work_figma_files values(p_project,p_connection,p_file,p_revision+1)
  on conflict(project_id) do update set connection_id=excluded.connection_id,file_key=excluded.file_key,revision=excluded.revision;
  return public.work_figma_settings(p_org,p_project);
end;$$;

create function public.attach_work_figma_frame(p_org uuid,p_project uuid,p_revision bigint,p_file text,p_node text,p_version text,p_card_kind text,p_card_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare settings jsonb; href text; existing text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project::text,89));
  settings:=public.work_figma_settings(p_org,p_project);
  if settings->'file'->>'file_key' is null or settings->'file'->>'file_key' is distinct from p_file
    or (settings->>'revision')::bigint is distinct from p_revision then raise exception 'Project design file changed'; end if;
  if p_node is null or p_node !~ '^[0-9]+:[0-9]+$' or p_version is null or p_version !~ '^[A-Za-z0-9_-]{1,160}$' then raise exception 'Invalid frame reference'; end if;
  href:='https://www.figma.com/design/'||p_file||'?node-id='||replace(p_node,':','-')||'&version-id='||p_version;
  select u.url into existing from private.work_asset_urls u where u.project_id=p_project
    and substring(u.url from '^https://(?:www[.])?figma[.]com/(?:design|file)/([A-Za-z0-9]+)(?:[/?]|$)')=p_file
    and replace(substring(u.url from '[?&]node-id=([0-9:-]+)(?:&|#|$)'),'-',':')=p_node
    and substring(u.url from '[?&]version-id=([A-Za-z0-9_-]+)(?:&|#|$)')=p_version order by u.id limit 1;
  return public.attach_work_card_asset(p_org,p_project,p_card_kind,p_card_id,'link',null,coalesce(existing,href));
end;$$;
revoke all on function public.work_figma_settings(uuid,uuid),public.set_work_figma_file(uuid,uuid,bigint,uuid,text),public.attach_work_figma_frame(uuid,uuid,bigint,text,text,text,text,uuid) from public,anon;
grant execute on function public.work_figma_settings(uuid,uuid),public.set_work_figma_file(uuid,uuid,bigint,uuid,text),public.attach_work_figma_frame(uuid,uuid,bigint,text,text,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
