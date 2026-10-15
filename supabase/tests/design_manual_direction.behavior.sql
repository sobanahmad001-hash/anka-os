begin;
set local statement_timeout='30s';
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end;$$;
do $$
declare org uuid:='99999999-9999-4999-8999-999999999901'; actor uuid:='99999999-9999-4999-8999-999999999902';
 b uuid:=gen_random_uuid();bv uuid:=gen_random_uuid();op uuid:=gen_random_uuid();es record;r jsonb;again jsonb;before_runs integer; catalog_id uuid:=gen_random_uuid(); rate jsonb; media_quote jsonb; media_request jsonb; accepted jsonb;accept_input jsonb;accept_op uuid:=gen_random_uuid();
begin
 insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active)
 values(catalog_id,org,'design','website_ux_ui','Rollback manual Design QA',true);
 insert into public.engagement_services(id,organization_id,engagement_id,service_id,status,owner_id,activated_by)
 values(gen_random_uuid(),org,'99999999-9999-4999-8999-999999999975',catalog_id,'active',actor,actor);
 select e.id engagement_id,e.brand_id,s.id service_id into es from public.engagement_services s
 join public.service_catalog c on c.id=s.service_id join public.engagements e on e.id=s.engagement_id
 join public.projects p on p.id=e.project_id
 where s.organization_id=org and s.status='active' and c.department_id='design' and c.is_active and c.slug in ('website_ux_ui','brand_visual_identity','social_assets','campaign_creative','design_systems','advertising_assets','video_concepts_storyboards','visual_production')
 and e.status in ('planning','active') and p.archived_at is null limit 1;
 if not found then raise exception 'Synthetic active Design service fixture missing'; end if;
 insert into public.design_creative_briefs(id,organization_id,engagement_id,brand_id,engagement_service_id,visibility,created_by,updated_by)
 values(b,org,es.engagement_id,es.brand_id,es.service_id,'official',actor,actor);
 insert into public.design_creative_brief_versions(id,organization_id,creative_brief_id,version_number,content,content_checksum,validation_snapshot,operation_key,created_by)
 values(bv,org,b,1,'{"title":"Rollback manual draft","instructions":"Synthetic local-only composition","purpose":"Native verification"}',repeat('a',64),'{"valid":true}',gen_random_uuid(),actor);
 update public.design_creative_briefs set current_version_id=bv,frozen_version_id=bv,revision=2 where id=b;
 select count(*) into before_runs from public.design_generation_runs;
 r:=public.create_design_manual_direction(org,actor,b,bv,2,op,es.engagement_id,es.service_id);
 perform pg_temp.ok(r#>>'{version,creative_brief_version_id}'=bv::text,'exact brief source');
 perform pg_temp.ok(r#>>'{version,generation_run_id}' is null,'manual provenance has no AI run');
 perform pg_temp.ok((select count(*)=before_runs from public.design_generation_runs),'no provider run created');
 again:=public.create_design_manual_direction(org,actor,b,bv,2,op,es.engagement_id,es.service_id);
 perform pg_temp.ok(again#>>'{version,id}'=r#>>'{version,id}' and (again->>'idempotent_replay')::boolean,'same request replay');
 again:=public.create_design_manual_direction(org,actor,b,bv,2,gen_random_uuid(),es.engagement_id,es.service_id);
 perform pg_temp.ok(again#>>'{version,id}'=r#>>'{version,id}','same frozen brief reuses draft');
 begin perform public.create_design_manual_direction(org,actor,b,bv,3,op,es.engagement_id,es.service_id);raise exception 'FAIL mismatch accepted';exception when unique_violation then raise notice 'PASS changed replay rejected';end;
 begin perform public.create_design_manual_direction(org,actor,b,bv,1,gen_random_uuid(),es.engagement_id,es.service_id);raise exception 'FAIL stale accepted';exception when serialization_failure then raise notice 'PASS stale revision rejected';end;

 rate:=public.configure_design_media_rate(org,actor,'higgsfield','higgsfield-ai/soul/v2/standard','{"resolution":"720p"}',600000,'https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/standard#synthetic-local-qa',clock_timestamp(),clock_timestamp()+interval '1 hour');
 media_request:=jsonb_build_object('organization_id',org,'context',jsonb_build_object('kind','engagement','id',es.engagement_id,'service_id',es.service_id),'creative_brief_version_id',bv,'connector_connection_id',gen_random_uuid(),'provider','higgsfield','model_id','higgsfield-ai/soul/v2/standard','settings',jsonb_build_object('resolution','720p'),'output_count',4,'input_versions','[]'::jsonb,'prompt_checksum',repeat('a',64));
 media_quote:=public.quote_design_media_request(org,actor,media_request);
 perform pg_temp.ok((media_quote->>'total_max_charge_microusd')::bigint=2400000,'server quote multiplies complete output count above threshold');
 perform pg_temp.ok(media_quote->'request'=media_request,'quote pins all request fields');

 accept_input:=jsonb_build_object('generate',true,'quote_id',media_quote->>'id','request_checksum',media_quote->>'request_checksum','total_max_charge_microusd',(media_quote->>'total_max_charge_microusd')::bigint);
 begin perform public.accept_design_media_quote(org,actor,(media_quote->>'id')::uuid,accept_op,media_request,accept_input);raise exception 'FAIL over-threshold unconfirmed accepted';exception when insufficient_privilege then raise notice 'PASS above threshold blocks without confirmation';end;
 accepted:=public.accept_design_media_quote(org,actor,(media_quote->>'id')::uuid,accept_op,media_request,accept_input||'{"confirm_above_threshold":true}'::jsonb);
 perform pg_temp.ok((accepted->>'confirmed_above_threshold')::boolean,'exact above threshold confirmation recorded');
 accepted:=public.accept_design_media_quote(org,actor,(media_quote->>'id')::uuid,accept_op,media_request,accept_input||'{"confirm_above_threshold":true}'::jsonb);
 perform pg_temp.ok((accepted->>'idempotent_replay')::boolean,'acceptance replay stable');
 begin perform public.accept_design_media_quote(org,actor,(media_quote->>'id')::uuid,gen_random_uuid(),media_request||'{"output_count":1}'::jsonb,accept_input||'{"confirm_above_threshold":true}'::jsonb);raise exception 'FAIL changed request accepted';exception when serialization_failure then raise notice 'PASS changed request cannot reuse acceptance';end;
 rate:=public.configure_design_media_rate(org,actor,'higgsfield','higgsfield-ai/soul/v2/standard','{"resolution":"720p"}',500000,'https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/standard#synthetic-local-qa',clock_timestamp(),clock_timestamp()+interval '1 hour');
 begin perform public.accept_design_media_quote(org,actor,(media_quote->>'id')::uuid,gen_random_uuid(),media_request,accept_input||'{"confirm_above_threshold":true}'::jsonb);raise exception 'FAIL superseded rate accepted';exception when serialization_failure then raise notice 'PASS changed reviewed rate invalidates quote';end;
 media_quote:=public.quote_design_media_request(org,actor,media_request);
 accept_input:=jsonb_build_object('generate',true,'quote_id',media_quote->>'id','request_checksum',media_quote->>'request_checksum','total_max_charge_microusd',(media_quote->>'total_max_charge_microusd')::bigint);
 accepted:=public.accept_design_media_quote(org,actor,(media_quote->>'id')::uuid,gen_random_uuid(),media_request,accept_input);
 perform pg_temp.ok(not (accepted->>'confirmed_above_threshold')::boolean,'exact two-dollar total needs only Generate');
 perform pg_temp.ok(not has_function_privilege('authenticated','public.configure_design_media_rate(uuid,uuid,text,text,jsonb,bigint,text,timestamptz,timestamptz)','execute'),'no direct pricing administration');
 perform pg_temp.ok(jsonb_array_length(public.list_design_media_rates(org,actor))=1,'admin reads latest exact rate only');
 update public.organization_memberships set role='contributor',department_id='design' where organization_id=org and user_id=actor;
 begin perform public.list_design_media_rates(org,actor);raise exception 'FAIL ordinary pricing read allowed';exception when insufficient_privilege then raise notice 'PASS ordinary member cannot read rate administration';end;
 begin perform public.configure_design_media_rate(org,actor,'higgsfield','higgsfield-ai/soul/v2/standard','{}',1,'https://open.higgsfield.ai/models/test',clock_timestamp(),clock_timestamp()+interval '1 hour');raise exception 'FAIL ordinary pricing author accepted';exception when insufficient_privilege then raise notice 'PASS ordinary member cannot configure prices';end;
 update public.organization_memberships set status='revoked' where organization_id=org and user_id=actor;
 begin perform public.create_design_manual_direction(org,actor,b,bv,2,op,es.engagement_id,es.service_id);raise exception 'FAIL revoked replay accepted';exception when insufficient_privilege then raise notice 'PASS revoked authority denies replay';end;
 perform pg_temp.ok(not has_function_privilege('authenticated','public.create_design_manual_direction(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid)','execute'),'no direct actor spoof');
 perform pg_temp.ok(not has_table_privilege('authenticated','public.design_manual_direction_receipts','select'),'receipt data closed');
 perform pg_temp.ok(not has_table_privilege('service_role','public.design_manual_direction_receipts','update,delete'),'receipts immutable to service');
 perform pg_temp.ok((select relrowsecurity from pg_class where oid='public.design_manual_direction_receipts'::regclass),'RLS enabled');
end;$$;
rollback;
