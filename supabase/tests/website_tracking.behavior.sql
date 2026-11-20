-- Execute after pending tracking migrations inside a BEGIN / ROLLBACK transaction.
-- No provider calls. All fixture schedules, claims and observations are rolled back.
do $test$
declare p uuid;o uuid;actor uuid;page jsonb;claimed jsonb;c uuid;baseline jsonb;stamp timestamptz;n integer;
begin
 select pr.id,pr.organization_id,m.user_id into strict p,o,actor from public.projects pr
 join public.organization_memberships m on m.organization_id=pr.organization_id
 where pr.archived_at is null and m.role='system_owner' and m.status='active' and m.member_kind='team'
 and exists(select from private.website_inventory_rows(pr.organization_id,pr.id) x where x->>'url' like 'https://%') limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform public.configure_website_observations(o,p,true);
 perform set_config('request.jwt.claim.role','service_role',true);
 claimed:=public.claim_website_observations(4);
 select x into strict page from jsonb_array_elements(claimed)x where x->>'project'=p::text limit 1;
 c:=(page->>'claim')::uuid;
 baseline:=jsonb_build_object('state','observed','url',page->>'url','title','Fixture title','content','Fixture content');
 begin
  perform public.commit_website_observation(p,(page->>'page')::uuid,c,baseline||'{"url":"https://foreign.example/"}'::jsonb);
  raise exception 'Foreign URL accepted';
 exception when raise_exception then if sqlerrm<>'Observation URL changed' then raise;end if;end;
 perform public.commit_website_observation(p,(page->>'page')::uuid,c,baseline);
 perform public.commit_website_observation(p,(page->>'page')::uuid,c,baseline);
 select count(*) into n from private.website_observation_history where claim=c;
 if n<>1 then raise exception 'Claim replay duplicated history';end if;
 if exists(select from private.website_observation_history where claim=c and changed) then raise exception 'Baseline counted as a change';end if;
 select last_observed into stamp from private.website_observation_queue where project_id=p and page_id=(page->>'page')::uuid;
 c:=gen_random_uuid();
 update private.website_observation_queue set claim=c,lease_until=now()+interval '1 minute' where project_id=p and page_id=(page->>'page')::uuid;
 perform public.commit_website_observation(p,(page->>'page')::uuid,c,jsonb_build_object('state','read_failed','url',page->>'url'));
 if not exists(select from private.website_observation_queue where project_id=p and page_id=(page->>'page')::uuid and latest_snapshot=baseline and last_observed=stamp and last_state='read_failed') then raise exception 'Failed read replaced content or refreshed observation time';end if;
 begin
  perform public.commit_website_observation(p,(page->>'page')::uuid,null,baseline);
  raise exception 'Null claim accepted';
 exception when raise_exception then if sqlerrm<>'Observation lease changed' then raise;end if;end;
 c:=gen_random_uuid();
 update private.website_observation_queue set claim=c,lease_until=now()+interval '1 minute' where project_id=p and page_id=(page->>'page')::uuid;
 perform public.configure_website_observations(o,p,false);
 begin
  perform public.commit_website_observation(p,(page->>'page')::uuid,c,baseline);
  raise exception 'Paused schedule accepted observation';
 exception when no_data_found then null;end;
end
$test$;
