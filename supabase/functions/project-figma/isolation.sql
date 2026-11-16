-- Run in a disposable QA database with two projects and two writable Work cards.
begin;
do $test$
declare
  a uuid; b uuid; org uuid; actor uuid; cards uuid[]; connection uuid; asset uuid; again uuid; rev bigint;
begin
  select p.id,p.organization_id,m.user_id into strict a,org,actor from public.projects p
    join public.organization_memberships m on m.organization_id=p.organization_id and m.role='system_owner' and m.status='active'
    where p.archived_at is null and (select count(*) from public.work_items w where w.project_id=p.id and w.deleted_at is null)>=2
    and exists(select from public.projects other where other.organization_id=p.organization_id and other.id<>p.id and other.archived_at is null)
    limit 1;
  select id into strict b from public.projects where organization_id=org and id<>a and archived_at is null limit 1;
  select array(select id from public.work_items where project_id=a and deleted_at is null limit 2) into cards;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.integration_connections(organization_id,provider,display_name,public_config,secret_name,status,created_by)
    values(org,'figma','Picker fixture','{"file_key":"FixtureA"}','ANKA_FIGMA_TEST','verified',actor) returning id into connection;
  rev:=(public.work_figma_settings(org,a)->>'revision')::bigint;
  perform public.set_work_figma_file(org,a,rev,connection,'FixtureA');
  rev:=rev+1;
  if public.work_figma_settings(org,b)->'file'->>'file_key'='FixtureA' then raise exception 'Binding leaked'; end if;
  begin
    perform public.attach_work_figma_frame(org,b,rev,'FixtureA','2:4','123','engagement_work_item',cards[1]);
    raise exception 'Foreign frame accepted';
  exception when raise_exception then if sqlerrm <> 'Project design file changed' then raise; end if;
  end;
  asset:=public.attach_work_figma_frame(org,a,rev,'FixtureA','2:4','123','engagement_work_item',cards[1]);
  again:=public.attach_work_figma_frame(org,a,rev,'FixtureA','2:4','123','engagement_work_item',cards[2]);
  if asset is distinct from again or (select count(*) from private.work_asset_pins where project_id=a and asset_id=asset)<>2
    then raise exception 'Frame reuse failed'; end if;
  if public.attach_work_figma_frame(org,a,rev,'FixtureA','2:4','124','engagement_work_item',cards[2])=asset
    then raise exception 'Version pin lost'; end if;
end
$test$;
rollback;
