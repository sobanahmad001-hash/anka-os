create table private.work_content_versions (
 id uuid primary key, project_id uuid not null references public.projects,
 document_id uuid not null, version integer not null, title text not null, body text not null,
 previous_id uuid references private.work_content_versions, author uuid not null,
 created_at timestamptz not null default now(), unique(project_id,document_id,version)
);
create table private.work_card_primary (
 project_id uuid not null references public.projects,card_kind text not null,card_id uuid not null,
 asset_kind text not null,asset_id uuid not null,primary key(project_id,card_kind,card_id)
);
revoke all on private.work_content_versions,private.work_card_primary from public,anon,authenticated,service_role;
alter table private.work_asset_pins drop constraint work_asset_pins_asset_kind_check;
alter table private.work_asset_pins add check(asset_kind in ('file','version','link','page_revision','campaign_asset','content'));
alter function private.work_asset_catalog(uuid,uuid) rename to work_asset_catalog_before_content;
create function private.work_asset_catalog(p_org uuid,p_project uuid)
returns table(kind text,id uuid,label text,url text,bucket text,path text) language sql stable set search_path='' as $$
 select * from private.work_asset_catalog_before_content(p_org,p_project)
 union all select 'content',v.id,v.title||' · draft v'||v.version,null,null,null
 from private.work_content_versions v where v.project_id=p_project
$$;
revoke all on function private.work_asset_catalog(uuid,uuid) from public,anon,authenticated;

create function public.work_content_version(p_org uuid,p_project uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.work_drive_settings(p_org,p_project);
 return (select jsonb_build_object('title',title,'body',body,'version',version,'id',id)
 from private.work_content_versions where id=p_id and project_id=p_project);
end;$$;

create function public.work_primary_asset(p_org uuid,p_project uuid,p_card_kind text,p_card_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.work_asset_card(p_org,p_project,p_card_kind,p_card_id,false);
 return (select jsonb_build_object('kind',asset_kind,'id',asset_id) from private.work_card_primary
 where project_id=p_project and card_kind=p_card_kind and card_id=p_card_id);
end;$$;

create function public.set_work_primary_asset(p_org uuid,p_project uuid,p_card_kind text,p_card_id uuid,p_kind text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.work_asset_card(p_org,p_project,p_card_kind,p_card_id,true);
 perform pg_advisory_xact_lock(hashtextextended(p_card_id::text,112));
 if not exists(select from private.work_asset_refs(p_project) r join private.work_asset_catalog(p_org,p_project) a
 on a.kind=r.asset_kind and a.id=r.asset_id where r.card_kind=p_card_kind and r.card_id=p_card_id and a.kind=p_kind and a.id=p_id)
 then raise exception 'Attach this project asset to the card first'; end if;
 insert into private.work_card_primary values(p_project,p_card_kind,p_card_id,p_kind,p_id)
 on conflict(project_id,card_kind,card_id) do update set asset_kind=excluded.asset_kind,asset_id=excluded.asset_id;
end;$$;

create function public.save_work_content(p_org uuid,p_project uuid,p_card_kind text,p_card_id uuid,p_request uuid,p_previous uuid,p_title text,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare base private.work_content_versions; saved private.work_content_versions;
begin
 perform private.work_asset_card(p_org,p_project,p_card_kind,p_card_id,true);
 if coalesce(length(trim(p_title)),0) not between 1 and 240 or coalesce(length(trim(p_body)),0) not between 1 and 100000 then raise exception 'Title and content required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_card_id::text,112));
 select * into saved from private.work_content_versions where id=p_request;
 if found then
  if saved.project_id=p_project and saved.author=auth.uid() and saved.previous_id is not distinct from p_previous and saved.title=p_title and saved.body=p_body
   and exists(select from private.work_asset_pins where project_id=p_project and card_kind=p_card_kind and card_id=p_card_id and asset_kind='content' and asset_id=p_request)
   then return p_request; end if;
  raise exception 'Save request conflicts with an existing revision';
 end if;
 if p_previous is not null then
  select * into strict base from private.work_content_versions where id=p_previous and project_id=p_project;
  if not exists(select from private.work_asset_pins where project_id=p_project and card_kind=p_card_kind and card_id=p_card_id and asset_kind='content' and asset_id=p_previous)
    then raise exception 'Attach the draft before editing'; end if;
 end if;
 insert into private.work_content_versions(id,project_id,document_id,version,title,body,previous_id,author)
 values(p_request,p_project,coalesce(base.document_id,p_request),coalesce(base.version,0)+1,p_title,p_body,p_previous,auth.uid());
 perform public.attach_work_card_asset(p_org,p_project,p_card_kind,p_card_id,'content',p_request);
 insert into private.work_card_primary values(p_project,p_card_kind,p_card_id,'content',p_request)
 on conflict(project_id,card_kind,card_id) do update set asset_id=excluded.asset_id
 where private.work_card_primary.asset_kind='content' and private.work_card_primary.asset_id=p_previous;
 return p_request;
end;$$;
revoke all on function public.work_content_version(uuid,uuid,uuid),public.work_primary_asset(uuid,uuid,text,uuid),public.set_work_primary_asset(uuid,uuid,text,uuid,text,uuid),public.save_work_content(uuid,uuid,text,uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.work_content_version(uuid,uuid,uuid),public.work_primary_asset(uuid,uuid,text,uuid),public.set_work_primary_asset(uuid,uuid,text,uuid,text,uuid),public.save_work_content(uuid,uuid,text,uuid,uuid,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
