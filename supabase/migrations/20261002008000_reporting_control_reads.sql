-- Scoped control metadata and original actor recovery only. Existing writers unchanged.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
create function public.get_project_reporting_controls(p_organization_id uuid,p_project_id uuid,p_binding_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;r public.project_reporting_binding_revisions%rowtype;adapters jsonb;admin boolean;begin
 c:=private.stored_reporting_context(p_organization_id,p_project_id,p_binding_id);
 select * into r from public.project_reporting_binding_revisions where binding_id=p_binding_id order by revision_number desc limit 1;
 select exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=auth.uid() and status='active' and member_kind='team' and role in ('system_owner','operations_admin','executive')) into admin;
 select coalesce(jsonb_agg(jsonb_build_object('source_contract',source_contract,'manifest_sha256',manifest_sha256,'enabled',enabled) order by source_contract),'[]') into adapters from private.reporting_refresh_adapters where provider=c#>>'{binding,provider}' and resource_kind=c#>>'{binding,resource_kind}';
 if jsonb_array_length(adapters)>25 then raise exception 'Bounded installed adapter selection required' using errcode='22023';end if;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'binding_id',p_binding_id,'binding_revision_number',r.revision_number,'context_checksum',r.context_checksum,'can_configure',admin,'status',c,'configuration',public.get_project_reporting_refresh_configuration(p_organization_id,p_project_id,p_binding_id),'adapters',adapters,'dispatch_authorized',false,'provider_request_made',false);
end $$;
create function public.get_project_reporting_control_operation(p_organization_id uuid,p_project_id uuid,p_action text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.reporting_refresh_policies%rowtype;result jsonb;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_request_id is null or p_action is null or p_action not in ('configure','verify','refresh') then raise exception 'Exact original reporting action and UUID required' using errcode='22023';end if;
 if p_action='configure' then
 select * into p from private.reporting_refresh_policies where organization_id=p_organization_id and project_id=p_project_id and request_id=p_request_id and created_by=auth.uid();
 if found then result:=jsonb_build_object('policy_id',p.id,'binding_id',p.binding_id,'revision_number',p.revision_number,'enabled',p.enabled,'state','completed','dispatch_authorized',false);end if;
 elsif p_action='verify' then result:=public.get_project_reporting_verification_operation(p_organization_id,p_project_id,p_request_id);
 else result:=public.get_project_reporting_refresh_operation(p_organization_id,p_project_id,p_request_id);end if;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'action',p_action,'request_id',p_request_id,'result',result,'dispatch_authorized',false,'provider_request_made',false);
end $$;
revoke all on function public.get_project_reporting_controls(uuid,uuid,uuid),public.get_project_reporting_control_operation(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_project_reporting_controls(uuid,uuid,uuid),public.get_project_reporting_control_operation(uuid,uuid,text,uuid) to authenticated;
commit;
