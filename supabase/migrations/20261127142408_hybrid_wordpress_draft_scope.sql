-- Separate external-write grant. Existing can_save consent never implies WordPress access.
create table private.hybrid_wordpress_grants (
 user_id uuid not null references auth.users(id), client_id uuid not null,
 organization_id uuid not null references public.organizations(id),
 project_id uuid not null references public.projects(id), card_kind text not null check(card_kind in ('project_task','engagement_work_item')),
 card_id uuid not null, target_id uuid not null references private.website_staging_targets(id),
 revoked_at timestamptz, expires_at timestamptz not null,
 primary key(user_id,client_id,project_id,card_kind,card_id)
);
alter table private.hybrid_wordpress_grants enable row level security;
revoke all on private.hybrid_wordpress_grants from public,anon,authenticated,service_role,hybrid_mcp;
-- Installation does not grant anyone access. A reviewed administrator must populate
-- an exact actor/client/card/target row with a bounded expiry, separately from OAuth.
create function public.hybrid_wordpress_draft_scope(p_org uuid,p_project uuid,p_card_kind text,p_card uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target private.website_staging_targets;
begin
 perform private.require_hybrid_oauth_grant(p_org,p_project,true);
 perform private.work_asset_card(p_org,p_project,p_card_kind,p_card,true);
 select t.* into strict target from private.hybrid_wordpress_grants g
 join private.website_staging_targets t on t.id=g.target_id and t.project_id=g.project_id and t.organization_id=g.organization_id
 join public.integration_connections c on c.id=t.connection_id and c.organization_id=t.organization_id
 join public.engagements e on e.id=t.engagement_id and e.project_id=t.project_id and e.organization_id=t.organization_id
 where g.user_id=auth.uid() and g.client_id::text=auth.jwt()->>'client_id'
 and g.organization_id=p_org and g.project_id=p_project and g.card_kind=p_card_kind and g.card_id=p_card
 and g.revoked_at is null and g.expires_at>now() and c.provider='wordpress' and c.status='verified'
 and c.archived_at is null and c.updated_at=t.connection_revision
 and rtrim(c.base_url,'/')=t.base_url and e.status in ('active','planning')
 for share of g,t,c,e;
 return jsonb_build_object('organization_id',p_org,'project_id',p_project,'card_kind',p_card_kind,'card_id',p_card,
 'target_id',target.id,'base_url',target.base_url,'site_id',target.site_id,'draft_only',true);
exception when no_data_found then raise insufficient_privilege;
end;$$;
revoke all on function public.hybrid_wordpress_draft_scope(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.hybrid_wordpress_draft_scope(uuid,uuid,text,uuid) to hybrid_mcp;
create or replace function public.hybrid_oauth_api_guard() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.jwt()->>'client_id' is not null or auth.role()='hybrid_mcp' then
  if auth.role()<>'hybrid_mcp' or coalesce(current_setting('request.path',true),'') not in
    ('/rpc/hybrid_mcp_context','/rpc/save_hybrid_work_draft','/rpc/hybrid_wordpress_draft_scope')
  then raise insufficient_privilege;end if;
 end if;
end;$$;
notify pgrst,'reload schema';
