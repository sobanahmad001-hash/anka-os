-- Execute with pending migrations inside BEGIN / ROLLBACK. No provider calls.
do $test$
declare b private.gsc_property_bindings;actor uuid;e uuid;saved jsonb;resumed jsonb;before_ctx jsonb;after_ctx jsonb;
begin
 select * into strict b from private.gsc_property_bindings limit 1;
 select user_id into strict actor from public.organization_memberships where organization_id=b.organization_id and role='system_owner' and status='active' limit 1;
 select id into strict e from public.engagements where project_id=b.project_id and status in('planning','active') and brand_id is not null limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 insert into public.integration_connection_engagements(connection_id,organization_id,engagement_id,department_id,created_by)
 values(b.connection_id,b.organization_id,e,'marketing',actor) on conflict do nothing;
 saved:=public.configure_website_tracking(b.organization_id,b.project_id,e,'marketing',true);
 before_ctx:=private.reporting_refresh_binding(b.organization_id,b.project_id,(saved->>'binding')::uuid);
 update public.integration_oauth_credentials set access_token_expires_at=now()+interval '1 hour' where connection_id=b.connection_id;
 after_ctx:=private.reporting_refresh_binding(b.organization_id,b.project_id,(saved->>'binding')::uuid);
 if before_ctx->>'context_checksum' is distinct from after_ctx->>'context_checksum' then raise exception 'Access refresh invalidated tracking authority';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 if not public.website_tracking_token_scope(b.organization_id,b.project_id,(saved->>'binding')::uuid,after_ctx->>'context_checksum') then raise exception 'Exact scope denied';end if;
 perform public.configure_website_tracking(b.organization_id,b.project_id,null,null,false);
 begin
  perform public.website_tracking_token_scope(b.organization_id,b.project_id,(saved->>'binding')::uuid,after_ctx->>'context_checksum');
  raise exception 'Paused scope authorized';
 exception when no_data_found then null;end;
 perform public.website_tracking_status(b.organization_id,b.project_id,null);
 resumed:=public.configure_website_tracking(b.organization_id,b.project_id,e,'marketing',true);
 if resumed->>'policy' is distinct from saved->>'policy' or resumed->>'binding' is distinct from saved->>'binding' then raise exception 'Pause/resume discarded unchanged history policy';end if;
 update public.integration_oauth_credentials set granted_scopes=array_append(granted_scopes,'fixture_scope') where connection_id=b.connection_id;
 begin
  perform public.website_tracking_token_scope(b.organization_id,b.project_id,(saved->>'binding')::uuid,after_ctx->>'context_checksum');
  raise exception 'Changed grant accepted old scope';
 exception when insufficient_privilege then null;end;
 resumed:=public.configure_website_tracking(b.organization_id,b.project_id,e,'marketing',true);
 if resumed->>'policy'=saved->>'policy' then raise exception 'Changed grant reused old policy';end if;
end
$test$;
