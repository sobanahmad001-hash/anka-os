-- Disabled reviewed Facebook adapter and exact observed access expiry/denial guard.
-- No policy, credential, resource, schedule or live provider activation.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin if md5(replace(pg_get_functiondef('private.stored_reporting_verified(uuid,uuid,uuid,integer,text)'::regprocedure),chr(13),'')) is distinct from '57748feb252c185c8b39e82b60c79f85' or md5(replace(pg_get_functiondef('private.reporting_refresh_ready(uuid,uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '65691deed8c8f5473c731859e7b7f2ec' or md5(replace(pg_get_functiondef('private.reporting_http_completion(text,uuid,boolean,text)'::regprocedure),chr(13),'')) is distinct from '3425e819e407161074fa2e2a0cbd5d50' then raise exception 'Exact observed-proof prerequisites changed' using errcode='55000';end if;end $$;
-- Enclosing readers hold project FOR SHARE; original outcome writes hold FOR UPDATE.
-- A known denial is therefore visible before a subsequent read, even if final completion is lost.
create function private.reporting_http_verified(p_binding uuid,p_challenge uuid,p_observed timestamptz,p_source text,p_manifest text,p_checksum text) returns boolean language sql volatile security definer set search_path='' as $$
 select private.reporting_http_cost(p_source,p_manifest)=1 or (
 exists(select 1 from private.reporting_http_reservations r
 join private.reporting_verification_attempts a on a.claim_id=r.claim_id and r.claim_kind='verification'
 join private.reporting_http_permits f on f.claim_kind=r.claim_kind and f.claim_id=r.claim_id and f.ordinal=1
 join private.reporting_http_outcomes fo on fo.permit_id=f.permit_id
 join private.reporting_http_permits s on s.claim_kind=r.claim_kind and s.claim_id=r.claim_id and s.ordinal=2
 join private.reporting_http_outcomes so on so.permit_id=s.permit_id
 where r.binding_id=p_binding and a.challenge_id=p_challenge and r.source_contract=p_source and r.manifest_sha256=p_manifest and r.context_checksum=p_checksum
 and fo.outcome='validated' and fo.valid_until>clock_timestamp() and so.outcome='validated')
 and not exists(select 1 from private.reporting_http_reservations r join private.reporting_http_permits p on p.claim_kind=r.claim_kind and p.claim_id=r.claim_id join private.reporting_http_outcomes o using(permit_id)
 where r.binding_id=p_binding and r.context_checksum=p_checksum and o.outcome='denied' and o.recorded_at>=p_observed))
$$;
revoke all on function private.reporting_http_verified(uuid,uuid,timestamptz,text,text,text) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.stored_reporting_verified(p_org uuid, p_project uuid, p_binding uuid, p_revision integer, p_checksum text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p private.reporting_refresh_policies%rowtype;a private.reporting_refresh_adapters%rowtype;q private.reporting_verification_challenges%rowtype;v private.reporting_resource_verifications%rowtype;c jsonb;actor uuid;begin
 -- The enclosing read has already locked project and caller membership FOR SHARE.
 -- Do not upgrade that shared lock via the write-only administrator helper.
 c:=private.reporting_refresh_binding(p_org,p_project,p_binding);
 select * into p from private.reporting_refresh_policies where binding_id=p_binding order by revision_number desc limit 1;
 if p.id is null or p.binding_revision_number<>p_revision or p.context_checksum<>p_checksum then return jsonb_build_object('verified',false,'reason','configuration_and_resource_verification_required');end if;
 select * into a from private.reporting_refresh_adapters where source_contract=p.source_contract and provider=c->>'provider' and resource_kind=c->>'resource_kind' and enabled for share;
 if not found then return jsonb_build_object('verified',false,'reason','installed_adapter_unavailable');end if;
 select ch.* into q from private.reporting_verification_challenges ch join private.reporting_resource_verifications vr on vr.challenge_id=ch.id where ch.binding_id=p_binding and ch.binding_revision_number=p_revision and ch.context_checksum=p_checksum and ch.source_contract=a.source_contract and ch.manifest_sha256=a.manifest_sha256 order by vr.observed_at desc,vr.recorded_at desc,ch.id desc limit 1;
 select * into v from private.reporting_resource_verifications where challenge_id=q.id;
 if v.challenge_id is null or not v.resource_matches or not v.observed_reporting_grant or not private.reporting_http_verified(p_binding,q.id,v.observed_at,a.source_contract,a.manifest_sha256,q.context_checksum) or exists(select 1 from private.reporting_refresh_results rr join private.reporting_refresh_attempts ra on ra.claim_id=rr.claim_id where ra.binding_id=p_binding and rr.outcome in ('permission_denied','disconnected') and rr.created_at>=v.observed_at) then return jsonb_build_object('verified',false,'reason','resource_access_verification_pending');end if;
 for actor in select distinct unnest(array[p.created_by,q.actor_id]) loop
 perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id where o.id=p_org and o.status='active' and m.user_id=actor and m.status='active' and m.member_kind='team' and m.role in ('system_owner','operations_admin','executive') for share of o,m;
 if not found then return jsonb_build_object('verified',false,'reason','verification_authority_unavailable');end if;
 end loop;
 return jsonb_build_object('verified',true,'reason','verified_resource_access');
end $function$;
CREATE OR REPLACE FUNCTION private.reporting_refresh_ready(p_org uuid, p_project uuid, p_binding uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;p private.reporting_refresh_policies%rowtype;a private.reporting_refresh_adapters%rowtype;q private.reporting_verification_challenges%rowtype;v private.reporting_resource_verifications%rowtype;begin
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for update;
 if not found or not private.n6_project_configuration_authorized(p_org,p_project,p_actor) then raise exception 'Current exact project refresh authority required' using errcode='42501';end if;
 c:=private.reporting_refresh_binding(p_org,p_project,p_binding);
 select * into p from private.reporting_refresh_policies where binding_id=p_binding order by revision_number desc limit 1;
 if p.id is null or not p.enabled or p.context_checksum<>c->>'context_checksum' or p.binding_revision_number<>(c->>'binding_revision_number')::integer then raise exception 'Current enabled policy required' using errcode='42501';end if;
 perform private.reporting_refresh_admin(p_org,p_project,p.created_by);
 select * into a from private.reporting_refresh_adapters where source_contract=p.source_contract and provider=c->>'provider' and resource_kind=c->>'resource_kind' and enabled for share;
 if not found then raise exception 'Installed enabled reporting adapter required' using errcode='42501';end if;
 -- Latest completed exact-context receipt wins, including a negative receipt.
 select ch.* into q from private.reporting_verification_challenges ch join private.reporting_resource_verifications vr on vr.challenge_id=ch.id
 where ch.binding_id=p_binding and ch.binding_revision_number=p.binding_revision_number and ch.context_checksum=p.context_checksum and ch.source_contract=a.source_contract and ch.manifest_sha256=a.manifest_sha256 order by vr.observed_at desc,vr.recorded_at desc,ch.id desc limit 1;
 select * into v from private.reporting_resource_verifications where challenge_id=q.id;
 if v.challenge_id is null or not v.resource_matches or not v.observed_reporting_grant or not private.reporting_http_verified(p_binding,q.id,v.observed_at,a.source_contract,a.manifest_sha256,q.context_checksum) or exists(select 1 from private.reporting_refresh_results rr join private.reporting_refresh_attempts ra on ra.claim_id=rr.claim_id where ra.binding_id=p_binding and rr.outcome in ('permission_denied','disconnected') and rr.created_at>=v.observed_at) then raise exception 'Trusted current exact resource/grant verification required' using errcode='42501';end if;
 perform private.reporting_refresh_admin(p_org,p_project,q.actor_id);
 return jsonb_build_object('context',c,'policy',to_jsonb(p),'verification_id',q.id,'manifest_sha256',a.manifest_sha256);
end $function$;
CREATE OR REPLACE FUNCTION private.reporting_http_completion(p_kind text, p_claim uuid, p_positive boolean, p_evidence text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r private.reporting_http_reservations%rowtype;last_outcome text;last_hash text;begin
 select * into r from private.reporting_http_reservations where claim_kind=p_kind and claim_id=p_claim;if not found then return;end if;
 select o.outcome,o.evidence_sha256 into last_outcome,last_hash from private.reporting_http_permits p join private.reporting_http_outcomes o using(permit_id) where p.claim_kind=p_kind and p.claim_id=p_claim order by p.ordinal desc limit 1;
 if p_positive then
 if not exists(select 1 from private.reporting_http_permits p join private.reporting_http_outcomes o using(permit_id) where p.claim_kind=p_kind and p.claim_id=p_claim and p.ordinal=1 and o.outcome='validated' and o.valid_until>clock_timestamp()) then raise exception 'Observed original access proof expired' using errcode='42501';end if;
 if (select count(*) from private.reporting_http_permits p join private.reporting_http_outcomes o using(permit_id) where p.claim_kind=p_kind and p.claim_id=p_claim and o.outcome='validated')<>2 then raise exception 'Both original HTTP proofs required' using errcode='42501';end if;
 elsif last_outcome is distinct from 'denied' then raise exception 'Observed original HTTP denial required' using errcode='42501';end if;
 if p_evidence is not null and last_hash is distinct from p_evidence then raise exception 'Original HTTP evidence changed' using errcode='22023';end if;
end $function$;
insert into private.reporting_refresh_adapters(source_contract,provider,resource_kind,manifest_sha256,metric_definitions,enabled) values('anka.meta.facebook-page.media-view.native-day.bounded.v26.v1','meta','meta_facebook_page','87c6ef2e5dc29d62fcb244de95cc7667d87686035d4b32140403397bc0f10daf','[{"metric_key":"page_media_view","metric_label":"Facebook content plays or displays","unit":"count","aggregation":"unknown"},{"metric_key":"page_total_media_view_unique","metric_label":"Facebook unique media viewers","unit":"count","aggregation":"non_additive"}]',false);
insert into private.reporting_http_costs(source_contract,manifest_sha256,request_budget) values('anka.meta.facebook-page.media-view.native-day.bounded.v26.v1','87c6ef2e5dc29d62fcb244de95cc7667d87686035d4b32140403397bc0f10daf',2);
commit;
