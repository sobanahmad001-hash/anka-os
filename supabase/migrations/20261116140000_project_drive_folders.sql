begin;
set local lock_timeout='5s';

create table private.work_drive_folders(
 project_id uuid primary key references public.projects,
 folder_id text, label text, revision bigint not null,
 updated_by uuid not null, updated_at timestamptz not null default now()
);
create table private.work_drive_proofs(
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects,
 actor_id uuid not null, action text not null check(action in ('bind','attach')),
 provider_id text not null, label text not null, folder_id text, revision bigint not null,
 expires_at timestamptz not null default now()+interval '2 minutes'
);
revoke all on private.work_drive_folders,private.work_drive_proofs from public,anon,authenticated,service_role;

create function public.work_drive_settings(p_org uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text; binding private.work_drive_folders;
begin
 role_name:=private.n1c_require_scope(p_org,p_project,auth.uid());
 if private.can_access_project(p_project) is not true then raise exception 'Project unavailable' using errcode='42501';end if;
 select * into binding from private.work_drive_folders where project_id=p_project;
 return jsonb_build_object('folder',binding.folder_id,'name',binding.label,'revision',coalesce(binding.revision,0),
 'manage',role_name in ('system_owner','operations_admin') or exists(select from public.projects where id=p_project and owner_id=auth.uid()));
end;$$;

-- Only the verified Edge handler issues a short-lived statement about a Drive object.
create function public.issue_work_drive_proof(p_project uuid,p_actor uuid,p_action text,p_file text,p_name text,p_folder text,p_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if p_file !~ '^[A-Za-z0-9_-]{1,200}$' or p_revision<0 then raise exception 'Invalid Drive selection';end if;
 delete from private.work_drive_proofs where expires_at<now();
 insert into private.work_drive_proofs(project_id,actor_id,action,provider_id,label,folder_id,revision)
 values(p_project,p_actor,p_action,p_file,left(p_name,500),p_folder,p_revision) returning id into result;
 return result;
end;$$;

create function public.save_work_drive_selection(p_org uuid,p_project uuid,p_action text,p_revision bigint,p_proof uuid default null,p_card_kind text default null,p_card_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings jsonb; proof private.work_drive_proofs; pin uuid; saved_url text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_project::text,67));
 settings:=public.work_drive_settings(p_org,p_project);
 if (settings->>'revision')::bigint is distinct from p_revision then raise exception 'Folder changed. Reopen Drive.' using errcode='40001';end if;
 if p_action in ('bind','disconnect') and (settings->>'manage')::boolean is not true then raise exception 'Project management required' using errcode='42501';end if;
 if p_action in ('bind','attach') then
  delete from private.work_drive_proofs where id=p_proof and project_id=p_project and actor_id=auth.uid() and action=p_action
   and revision=p_revision and expires_at>now() returning * into strict proof;
 end if;
 if p_action in ('bind','disconnect') then
  insert into private.work_drive_folders(project_id,folder_id,label,revision,updated_by)
   values(p_project,proof.provider_id,proof.label,p_revision+1,auth.uid())
   on conflict(project_id) do update set folder_id=excluded.folder_id,label=excluded.label,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now();
  return public.work_drive_settings(p_org,p_project);
 elsif p_action='attach' then
  if proof.folder_id is null or proof.folder_id is distinct from settings->>'folder' then raise exception 'File is outside the connected folder';end if;
  -- Reuse an existing pasted Docs or Drive URL for this provider ID when present.
  select u.url into saved_url from private.work_asset_urls u where u.project_id=p_project and
  (substring(u.url from '^https://(?:drive|docs)[.]google[.]com/(?:file|document|spreadsheets|presentation|forms|drawings)/d/([A-Za-z0-9_-]+)')=proof.provider_id
   or u.url='https://drive.google.com/open?id='||proof.provider_id) order by u.id limit 1;
  pin:=public.attach_work_card_asset(p_org,p_project,p_card_kind,p_card_id,'link',null,coalesce(saved_url,'https://drive.google.com/open?id='||proof.provider_id));
  return jsonb_build_object('asset',pin);
 end if;
 raise exception 'Invalid Drive action';
end;$$;

revoke all on function public.issue_work_drive_proof(uuid,uuid,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.issue_work_drive_proof(uuid,uuid,text,text,text,text,bigint) to service_role;
revoke all on function public.work_drive_settings(uuid,uuid), public.save_work_drive_selection(uuid,uuid,text,bigint,uuid,text,uuid) from public,anon,service_role;
grant execute on function public.work_drive_settings(uuid,uuid), public.save_work_drive_selection(uuid,uuid,text,bigint,uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
