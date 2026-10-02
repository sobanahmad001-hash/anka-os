-- Current resource overview uses existing verified stored-read authority. No new writer/grant.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef('public.list_project_reporting_bindings(uuid,uuid,text,integer,integer)'::regprocedure),chr(13),'')) is distinct from 'ab200e18a759f0759b8468a9d4bd3aec'
 or md5(replace(pg_get_functiondef('private.stored_reporting_context(uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '21034c71f7290e4d6ec6020264a8b1f6'
 then raise exception 'Exact reporting overview prerequisites changed' using errcode='55000';end if;
end $$;
create or replace function public.list_project_reporting_bindings(p_organization_id uuid,p_project_id uuid,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare total bigint;matching bigint;items jsonb:='[]';row record;context jsonb;reason text;revision record;result jsonb;status jsonb;
begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_query is null or length(p_query)>120 or p_query~'[[:cntrl:]]' or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded resource paging required' using errcode='22023';end if;
 select count(*) into total from public.project_reporting_bindings where organization_id=p_organization_id and project_id=p_project_id;
 select count(*) into matching from public.project_reporting_bindings where organization_id=p_organization_id and project_id=p_project_id and (p_query='' or strpos(lower(resource_key||' '||resource_kind),lower(p_query))>0);
 for row in select * from public.project_reporting_bindings where organization_id=p_organization_id and project_id=p_project_id and (p_query='' or strpos(lower(resource_key||' '||resource_kind),lower(p_query))>0) order by created_at desc,id limit p_limit offset p_offset loop
 select * into revision from public.project_reporting_binding_revisions where binding_id=row.id order by revision_number desc limit 1;
 -- Reuse the same current proof and shared authority/resource locks as stored reads.
 status:=private.stored_reporting_context(p_organization_id,p_project_id,row.id);
 context:=status->'current_context';reason:=status->>'reason';
 items:=items||jsonb_build_array(jsonb_build_object('binding',to_jsonb(row),'revision_number',revision.revision_number,'state',revision.state,'context_checksum',revision.context_checksum,'current_context',context,'reporting_ready',(status->>'current_authorized')::boolean,'reason',reason,'external_write_authorized',false,'reporting_status',jsonb_build_object('binding_id',row.id,'revision_number',revision.revision_number,'context_checksum',revision.context_checksum,'current_authorized',status->'current_authorized','provider_resource_verified',status->'provider_resource_verified','verified_source_contract',status->'verified_source_contract','reason',reason,'provider_request_made',false,'refresh',status->'refresh','historical_last_success_at',status->'historical_last_success_at')));
 end loop;
 result:=jsonb_build_object('items',items,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<matching);
 if octet_length(result::text)>131072 then raise exception 'Resource list exceeds whole bounded result' using errcode='22023';end if;
 return result;
end $$;
revoke all on function public.list_project_reporting_bindings(uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_project_reporting_bindings(uuid,uuid,text,integer,integer) to authenticated;
commit;
