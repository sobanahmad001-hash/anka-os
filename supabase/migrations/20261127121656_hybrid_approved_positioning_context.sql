-- Explicit exact-version selection. This does not grant AI consent or approve content.
create table private.hybrid_positioning_sources (
 organization_id uuid not null references public.organizations(id),
 project_id uuid primary key references public.projects(id),
 artifact_id uuid not null references public.artifacts(id),
 artifact_version_id uuid not null references public.artifact_versions(id),
 approval_id uuid not null references public.artifact_approvals(id),
 content_checksum text not null check(content_checksum ~ '^[0-9a-f]{64}$')
);
alter table private.hybrid_positioning_sources enable row level security;
revoke all on private.hybrid_positioning_sources from public,anon,authenticated,service_role,hybrid_mcp;

create function private.hybrid_approved_positioning(p_org uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_hybrid_oauth_grant(p_org,p_project,false);
 select jsonb_build_object('kind','approved_shared_positioning_reference',
  'artifact_id',a.id,'artifact_version_id',v.id,'version_number',v.version_number,
  'approval_id',ap.id,'approved_at',ap.approved_at,'content_checksum',v.content_checksum,
  'ai_use_allowed',true,'body_included',true,'body',v.content->>'body',
  'source_citations',coalesce((select jsonb_agg(c.value) from jsonb_array_elements(
    case when jsonb_typeof(v.content->'source_citations')='array' then v.content->'source_citations' else '[]'::jsonb end
   ) c where jsonb_typeof(c.value)='string' and length(c.value#>>'{}')<=2048 and (c.value#>>'{}') ~ '^https?://'),'[]'::jsonb),
  'evidence_created_at',v.created_at,'source_text_is_data',true,'defines_engagement_scope',false)
 into result
 from private.hybrid_positioning_sources s
 join public.artifacts a on a.id=s.artifact_id and a.organization_id=s.organization_id and a.project_id=s.project_id
 join public.artifact_versions v on v.id=s.artifact_version_id and v.artifact_id=a.id and v.organization_id=a.organization_id
 join public.artifact_approvals ap on ap.id=s.approval_id and ap.artifact_id=a.id and ap.artifact_version_id=v.id and ap.organization_id=a.organization_id and ap.engagement_id=a.engagement_id
 join public.engagements e on e.id=a.engagement_id and e.organization_id=a.organization_id and e.project_id=s.project_id
 where s.organization_id=p_org and s.project_id=p_project and a.artifact_type='content'
 and v.content_checksum=s.content_checksum and v.ai_use_allowed is true and ap.decision='approved'
 and v.data_classification in ('public','internal','confidential') and e.status in ('planning','active')
 and (select count(*) from public.engagements where organization_id=p_org and project_id=p_project)=1
 and jsonb_typeof(v.content->'body')='string' and length(btrim(v.content->>'body')) between 1 and 12000
 and case when jsonb_typeof(v.content->'source_citations')='array' then jsonb_array_length(v.content->'source_citations')<=20 else true end;
 return result;
end;$$;
revoke all on function private.hybrid_approved_positioning(uuid,uuid) from public,anon,authenticated,service_role,hybrid_mcp;

-- Owner-selected published positioning; only v2 has explicit AI consent.
-- No effect in environments without this exact shared artifact/version/approval.
insert into private.hybrid_positioning_sources
select a.organization_id,a.project_id,a.id,v.id,ap.id,v.content_checksum
from public.artifacts a join public.artifact_versions v on v.artifact_id=a.id and v.organization_id=a.organization_id
join public.artifact_approvals ap on ap.artifact_version_id=v.id and ap.artifact_id=a.id and ap.organization_id=a.organization_id
where a.id='936ece60-bde7-4e30-accc-21b042092219' and a.project_id='658d604f-3c5b-404d-8b0e-25c8096bdf10'
and a.organization_id='8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25' and v.id='ed5c18ab-53e5-4f84-baa3-108bce1aeb94'
and ap.id='088e521d-1981-4093-9e91-a84fce189032' and ap.decision='approved' and v.ai_use_allowed
and v.content_checksum='aa2a88539cd92f7ceb8d5a3acc9555cf680ee8f6f04e2a5f0f59af7c0f79875d';

create or replace function public.hybrid_mcp_context(p_org uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.projects; refs jsonb; gaps jsonb:='[]'; engagement jsonb; engagement_count integer; positioning jsonb;
begin
 perform private.require_hybrid_oauth_grant(p_org,p_project,false);
 select * into strict p from public.projects where id=p_project and organization_id=p_org;
 select count(*) into engagement_count from public.engagements where project_id=p_project and organization_id=p_org;
 if engagement_count=1 then select jsonb_build_object('id',id,'status',status) into engagement from public.engagements where project_id=p_project and organization_id=p_org and status in ('planning','active');end if;
 if engagement is null then gaps:=gaps||jsonb_build_array(jsonb_build_object('code',case when engagement_count>1 then 'engagement_ambiguous' when engagement_count=0 then 'engagement_missing' else 'engagement_inactive' end));end if;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into refs from (
  select a.id as artifact_id,a.artifact_type,v.id as artifact_version_id,v.version_number,v.content_checksum,
   ap.id as approval_id,ap.approved_at,v.created_at as evidence_created_at,false as body_included
  from public.artifacts a join public.artifact_versions v on v.artifact_id=a.id and v.organization_id=a.organization_id
  join public.artifact_approvals ap on ap.artifact_id=a.id and ap.artifact_version_id=v.id and ap.organization_id=a.organization_id and ap.engagement_id=a.engagement_id
  join public.engagements e on e.id=a.engagement_id and e.project_id=p_project and e.organization_id=p_org
  where engagement is not null and a.organization_id=p_org and a.project_id=p_project and ap.decision='approved' and v.ai_use_allowed
  and v.data_classification in ('public','internal','confidential') and e.status in ('planning','active')
  order by ap.approved_at desc,ap.id limit 201
 ) x;
 if jsonb_array_length(refs)>200 then raise exception 'Context exceeds bounds';end if;
 if jsonb_array_length(refs)=0 then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','approved_shared_sources_missing'));end if;
 if nullif(btrim(p.description),'') is null then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','business_description_missing'));end if;
 if nullif(btrim(p.scope_statement),'') is null then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','scope_missing'));end if;
 positioning:=private.hybrid_approved_positioning(p_org,p_project);
 if positioning is null then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','approved_positioning_unavailable'));end if;
 return jsonb_build_object('schema_version',1,'operation','project.get_context','organization_id',p_org,'project_id',p_project,'actor_id',auth.uid(),
  'observed_at',now(),'project',jsonb_build_object('id',p.id,'name',p.name,'status',p.status,'business_description',p.description,'scope_statement',p.scope_statement,'input_state','recorded_not_approval'),
  'engagement',engagement,'positioning',positioning,'approved_versions',refs,'gaps',gaps,'private_chat_included',false,'external_write_authorized',false);
end;$$;
revoke all on function public.hybrid_mcp_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.hybrid_mcp_context(uuid,uuid) to hybrid_mcp;
