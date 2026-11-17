begin;
do $test$
declare
 p uuid; org uuid; actor uuid; other uuid; cards uuid[]; first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid();
 link uuid; library jsonb; primary_asset jsonb;
begin
 select pr.id,pr.organization_id,m.user_id into strict p,org,actor from public.projects pr
 join public.organization_memberships m on m.organization_id=pr.organization_id and m.role='system_owner' and m.status='active'
 where pr.archived_at is null and (select count(*) from public.work_items w where w.project_id=pr.id and w.deleted_at is null)>=2 limit 1;
 select id into strict other from public.projects where organization_id=org and id<>p and archived_at is null limit 1;
 select array(select id from public.work_items where project_id=p and deleted_at is null limit 2) into cards;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform public.save_work_content(org,p,'engagement_work_item',cards[1],first_id,null,'Draft','One');
 perform public.save_work_content(org,p,'engagement_work_item',cards[1],first_id,null,'Draft','One');
 perform public.save_work_content(org,p,'engagement_work_item',cards[1],second_id,first_id,'Draft','Two');
 if (public.work_content_version(org,p,first_id)->>'body') is distinct from 'One' or
 (public.work_content_version(org,p,second_id)->>'version') is distinct from '2' then raise exception 'Draft history lost'; end if;
 if public.work_content_version(org,other,first_id) is not null then raise exception 'Foreign content exposed'; end if;
 perform public.attach_work_card_asset(org,p,'engagement_work_item',cards[2],'content',first_id);
 perform public.attach_work_card_asset(org,p,'engagement_work_item',cards[2],'content',first_id);
 library:=public.list_work_card_assets(org,p,'engagement_work_item',cards[2]);
 if (select count(*) from jsonb_array_elements(library->'attached') a where a->>'id'=first_id::text)<>1 then raise exception 'Reuse failed'; end if;
 link:=public.attach_work_card_asset(org,p,'engagement_work_item',cards[1],'link',null,'https://example.com/work-card-qa');
 perform public.set_work_primary_asset(org,p,'engagement_work_item',cards[1],'link',link);
 primary_asset:=public.work_primary_asset(org,p,'engagement_work_item',cards[1]);
 if primary_asset->>'id' is distinct from link::text then raise exception 'Primary lost'; end if;
 begin
  perform public.set_work_primary_asset(org,p,'engagement_work_item',cards[2],'content',second_id);
  raise exception 'Unattached primary accepted';
 exception when raise_exception then if sqlerrm<>'Attach this project asset to the card first' then raise;end if;end;
end;$test$;

rollback;
