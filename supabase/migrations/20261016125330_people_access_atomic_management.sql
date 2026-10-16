begin;
create table private.people_management_receipts (
 organization_id uuid not null references public.organizations(id), actor_id uuid not null,
 request_id uuid not null, action text not null check(action in ('team_update','client_invitation')),
 target_id uuid not null, payload jsonb not null, prior_state jsonb, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,actor_id,request_id)
);
alter table private.people_management_receipts enable row level security;
revoke all on private.people_management_receipts from public,anon,authenticated,service_role;

create function private.people_update_team(p_org uuid,p_target uuid,p_expected timestamptz,p_role text,p_department text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; current_row public.organization_memberships; prior private.people_management_receipts; payload jsonb; answer jsonb;
begin
 actor:=private.n1b_require_admin(p_org);
 if p_target is null or p_request is null or p_expected is null or p_role is null or p_department is null
 or p_role not in ('operations_admin','executive','department_manager','project_owner','contributor') then
  raise exception 'Complete supported membership change required' using errcode='22023'; end if;
 if actor=p_target then raise exception 'Self role and department changes require another administrator' using errcode='42501'; end if;
 select * into current_row from public.organization_memberships where organization_id=p_org and user_id=p_target
  and member_kind='team' and status='active' for update;
 if not found or current_row.role='system_owner' then raise exception 'Active non-owner team target required' using errcode='42501'; end if;
 perform 1 from public.departments where organization_id=p_org and id=p_department for share;
 if not found then raise exception 'Same-organization department required' using errcode='42501'; end if;
 payload:=jsonb_build_object('target',p_target,'expected_revision',p_expected,'role',p_role,'department',p_department);
 select * into prior from private.people_management_receipts where organization_id=p_org and actor_id=actor and request_id=p_request;
 if found then
  if prior.action<>'team_update' or prior.payload<>payload then raise exception 'Request identity reused with different input' using errcode='22023'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if current_row.updated_at<>p_expected then raise exception 'Membership changed; reload before saving' using errcode='40001'; end if;
 update public.organization_memberships set role=p_role,department_id=p_department,updated_at=clock_timestamp() where id=current_row.id;
 answer:=jsonb_build_object('organization_id',p_org,'user_id',p_target,'request_id',p_request,'role',p_role,'department_id',p_department,'replayed',false,'global_profile_changed',false);
 insert into private.people_management_receipts(organization_id,actor_id,request_id,action,target_id,payload,prior_state,result)
 values(p_org,actor,p_request,'team_update',p_target,payload,jsonb_build_object('role',current_row.role,'department_id',current_row.department_id,'status',current_row.status,'updated_at',current_row.updated_at),answer);
 return answer;
end; $$;
create function public.update_team_membership(p_organization_id uuid,p_user_id uuid,p_expected_revision timestamptz,p_role text,p_department_id text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.people_update_team(p_organization_id,p_user_id,p_expected_revision,p_role,p_department_id,p_request_id);
$$;

create function private.people_complete_client(p_org uuid,p_client uuid,p_user uuid,p_email text,p_name text,p_role text,p_projects uuid[],p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ids uuid[]; locked_ids uuid[]; prior private.people_management_receipts; payload jsonb; answer jsonb; contact uuid;
begin
 if actor is null or p_org is distinct from '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid then raise exception 'Authenticated Anka inviter required' using errcode='42501'; end if;
 -- Share the existing administration lane and hold current authority through commit.
 perform pg_advisory_xact_lock(hashtextextended('n1b-admin:'||p_org::text,0));
 perform 1 from public.organizations where id=p_org and status='active' for share;
 if not found then raise exception 'Active organization required' using errcode='42501'; end if;
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=actor and status='active' and member_kind='team'
  and role in ('system_owner','operations_admin','executive','project_owner') for share;
 if not found then raise exception 'Current client invitation authority required' using errcode='42501'; end if;
 if p_client is null or p_user is null or p_request is null or p_email is null or length(trim(p_email))=0
  or p_name is null or length(trim(p_name)) not between 1 and 160 or p_role is null
  or p_role not in ('viewer','collaborator','approver','admin') or coalesce(cardinality(p_projects),0) not between 1 and 100
  or array_position(p_projects,null) is not null then raise exception 'Complete supported client invitation required' using errcode='22023'; end if;
 select array_agg(distinct x order by x) into ids from unnest(p_projects) x;
 perform 1 from public.clients where id=p_client and organization_id=p_org and status='active' for share;
 if not found then raise exception 'Active same-organization client required' using errcode='42501'; end if;
 select array_agg(id order by id) into locked_ids from (select id from public.projects where id=any(ids) and organization_id=p_org and client_id=p_client
  and archived_at is null and status not in ('completed','cancelled','archived') order by id for share) locked;
 if locked_ids is distinct from ids then raise exception 'Exact active client projects required' using errcode='42501'; end if;
 perform 1 from auth.users where id=p_user and lower(email)=lower(trim(p_email)) and invited_at is not null and deleted_at is null for share;
 if not found then raise exception 'Matching invited identity required' using errcode='42501'; end if;
 payload:=jsonb_build_object('client',p_client,'user',p_user,'email',lower(trim(p_email)),'name',trim(p_name),'role',p_role,'projects',ids);
 select * into prior from private.people_management_receipts where organization_id=p_org and actor_id=actor and request_id=p_request;
 if found then
  if prior.action<>'client_invitation' or prior.payload<>payload then raise exception 'Request identity reused with different input' using errcode='22023'; end if;
  -- A replay never restores later-revoked grants.
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if exists(select 1 from public.organization_memberships where user_id=p_user)
  or exists(select 1 from public.client_contacts where auth_user_id=p_user) then
  raise exception 'Existing identity relationships require separate review' using errcode='23505'; end if;
 insert into public.client_contacts(organization_id,client_id,auth_user_id,full_name,email,portal_role,status)
 values(p_org,p_client,p_user,trim(p_name),lower(trim(p_email)),p_role,'active') returning id into contact;
 insert into public.project_client_access(organization_id,project_id,client_contact_id,access_role,status)
 select p_org,x,contact,p_role,'active' from unnest(ids) x;
 answer:=jsonb_build_object('organization_id',p_org,'user_id',p_user,'client_id',p_client,'contact_id',contact,'request_id',p_request,'project_ids',ids,'replayed',false);
 insert into private.people_management_receipts(organization_id,actor_id,request_id,action,target_id,payload,result)
 values(p_org,actor,p_request,'client_invitation',p_user,payload,answer);
 return answer;
end; $$;
create function public.complete_client_invitation(p_organization_id uuid,p_client_id uuid,p_user_id uuid,p_email text,p_full_name text,p_portal_role text,p_project_ids uuid[],p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.people_complete_client(p_organization_id,p_client_id,p_user_id,p_email,p_full_name,p_portal_role,p_project_ids,p_request_id);
$$;
revoke all on function private.people_update_team(uuid,uuid,timestamptz,text,text,uuid),public.update_team_membership(uuid,uuid,timestamptz,text,text,uuid),
 private.people_complete_client(uuid,uuid,uuid,text,text,text,uuid[],uuid),public.complete_client_invitation(uuid,uuid,uuid,text,text,text,uuid[],uuid) from public,anon,authenticated,service_role;
grant execute on function private.people_update_team(uuid,uuid,timestamptz,text,text,uuid),public.update_team_membership(uuid,uuid,timestamptz,text,text,uuid),
 private.people_complete_client(uuid,uuid,uuid,text,text,text,uuid[],uuid),public.complete_client_invitation(uuid,uuid,uuid,text,text,text,uuid[],uuid) to authenticated;
commit;
