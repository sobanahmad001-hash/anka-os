begin;
do $fixture$
declare p uuid;o uuid;a uuid;c uuid; foreign_project uuid; bind jsonb; j jsonb; e date:=(now() at time zone 'America/Los_Angeles')::date-3; page_id uuid;page_url text; report jsonb; request_id uuid:=gen_random_uuid(); before_targets jsonb; original_count integer; revision integer;
begin
 select pr.id,pr.organization_id,m.user_id into strict p,o,a from public.projects pr join public.organization_memberships m on m.organization_id=pr.organization_id and m.role='system_owner' and m.status='active'
 where pr.archived_at is null and exists(select from private.website_inventory_rows(pr.organization_id,pr.id) x where x->>'url' like 'http%') limit 1;
 select id into strict foreign_project from public.projects where organization_id=o and id<>p and archived_at is null limit 1;
 perform set_config('request.jwt.claim.sub',a::text,true);
 select (x->>'id')::uuid,x->>'url' into strict page_id,page_url from private.website_inventory_rows(o,p) x where x->>'url' like 'http%' limit 1;
 insert into public.integration_connections(organization_id,provider,display_name,status,public_config,created_by) values(o,'google_search_console','Fixture','verified','{"site_url":"sc-domain:example.com"}',a) returning id into c;
 insert into public.integration_connection_departments(connection_id,organization_id,department_id,created_by) values(c,o,'development',a);
 insert into public.integration_oauth_credentials(connection_id,organization_id,provider,access_token_ciphertext,access_token_iv,refresh_token_ciphertext,refresh_token_iv,access_token_expires_at,granted_scopes)
 values(c,o,'google_search_console','fixture','fixture','fixture','fixture',now()+interval '1 hour',array['https://www.googleapis.com/auth/webmasters.readonly']);
 bind:=public.gsc_bind(o,p,c,'sc-domain:example.com',0);
 j:=public.gsc_import_progress(o,p,(bind->>'binding')::uuid,e);
 perform public.commit_gsc_batch(o,p,(j->>'id')::uuid,'pages',0,jsonb_build_array(jsonb_build_object('page',page_url,'query','','clicks',12,'impressions',100,'ctr',0.12,'position',3)));
 perform public.commit_gsc_batch(o,p,(j->>'id')::uuid,'pages',0,'[]');
 if public.gsc_page_performance(o,p,page_id,0) is not null then raise exception 'Partial snapshot leaked';end if;
 if public.gsc_import_progress(o,p,(bind->>'binding')::uuid,e)->>'phase'<>'queries' then raise exception 'Resume failed';end if;
 perform public.commit_gsc_batch(o,p,(j->>'id')::uuid,'queries',0,jsonb_build_array(jsonb_build_object('page',page_url,'query','observed','clicks',5,'impressions',70,'ctr',0.0714,'position',2)));
 report:=public.gsc_page_performance(o,p,page_id,0);
 if report->'totals'->>'clicks' is distinct from '12' or report->'queries'->0->>'clicks' is distinct from '5' then raise exception 'Independent totals missing';end if;
 begin perform public.gsc_import_progress(o,foreign_project,(bind->>'binding')::uuid,e);raise exception 'Cross-project scope accepted';exception when no_data_found or insufficient_privilege then null;end;
 perform public.decide_website_keyword(o,p,page_id,'observed','dismissed',gen_random_uuid(),0,0);
 if public.website_keyword_assessment(o,p,page_id)->'decisions'->0->>'state'<>'dismissed' then raise exception 'Dismiss lost';end if;
 perform public.decide_website_keyword(o,p,page_id,'observed','suggested',gen_random_uuid(),1,0);
 if public.website_keyword_assessment(o,p,page_id)->'decisions'->0->>'revision'<>'2' then raise exception 'Decision history lost';end if;
 begin perform public.website_keyword_assessment(o,foreign_project,page_id);raise exception 'Foreign page read accepted';exception when no_data_found or insufficient_privilege then null;end;
 select x->'targets',(x->>'revision')::int into before_targets,revision from private.website_inventory_rows(o,p)x where x->>'id'=page_id::text;
 original_count:=jsonb_array_length(before_targets);
 perform public.decide_website_keyword(o,p,page_id,'observed','selected',request_id,2,revision,'supporting','Service enquiry','en-GB');
 perform public.decide_website_keyword(o,p,page_id,'observed','selected',request_id,2,revision,'supporting','Service enquiry','en-GB');
 select x into report from private.website_inventory_rows(o,p)x where x->>'id'=page_id::text;
 if not report->'targets' @> before_targets or jsonb_array_length(report->'targets')<>original_count+1 then raise exception 'Prior targets lost or retry duplicated';end if;
 update private.gsc_imports set synced_at=now()+interval '1 second' where id=(j->>'id')::uuid;
 if public.website_keyword_assessment(o,p,page_id)->'decisions'->0->>'state'<>'selected' then raise exception 'Selection lost after sync';end if;
end;$fixture$;

rollback;



