-- Organization-scoped deactivation; no Auth deletion or session invalidation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table private.n1d_deactivations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,user_id uuid not null,
 actor_id uuid not null,request_id uuid not null,prior_membership jsonb not null,
 reassignment_records jsonb not null,revoked_authorities jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,actor_id,request_id)
);
create index n1d_deactivation_user on private.n1d_deactivations(organization_id,user_id,created_at);
alter table private.n1d_deactivations enable row level security;
revoke all on private.n1d_deactivations from public,anon,authenticated,service_role;
create trigger n1d_deactivation_immutable before update or delete on private.n1d_deactivations
 for each row execute function private.n1b_preserve_receipt();
create function private.n1d_deactivate(p_org uuid,p_user uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; target public.organization_memberships; receipt private.n1b_authority_requests;
 payload jsonb; result jsonb; records jsonb; revoked jsonb; deps integer; labels integer; pms integer; delegations integer; audit_id uuid;
begin
 actor:=private.n1b_require_admin(p_org);
 if p_request is null or p_user is null then raise exception 'Target and request identity required.' using errcode='22023'; end if;
 if p_user=actor then raise exception 'You cannot deactivate your own organization membership.' using errcode='42501'; end if;
 select * into target from public.organization_memberships where organization_id=p_org and user_id=p_user and member_kind='team' for update;
 if not found then raise exception 'Same-organization team membership required.' using errcode='42501'; end if;
 payload:=jsonb_build_object('domain','organization_deactivation','user_id',p_user);
 select * into receipt from private.n1b_authority_requests where organization_id=p_org and actor_id=actor and request_id=p_request;
 if found then
   if receipt.request_payload is distinct from payload then raise exception 'Request ID conflict.' using errcode='23505'; end if;
   return receipt.result||jsonb_build_object('replayed',true);
 end if;
 -- Existing self-removal denial plus serialized current admin authorization
 -- guarantees another active administrator survives this command.
 if target.status='active' and target.role='system_owner' and not exists(
   select 1 from public.organization_memberships where organization_id=p_org and user_id<>p_user
     and member_kind='team' and status='active' and role='system_owner') then
   raise exception 'At least one active System Owner must remain.' using errcode='42501';
 end if;
 if target.status<>'revoked' and target.role in ('system_owner','operations_admin') and not exists(
   select 1 from public.organization_memberships where organization_id=p_org and user_id<>p_user
     and member_kind='team' and status='active' and role in ('system_owner','operations_admin')) then
   raise exception 'At least one active organization administrator must remain.' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(record),'[]'::jsonb) into records from (
   select jsonb_build_object('kind','project_task','id',id,'project_id',project_id,'row_version',row_version,'title',title) record
   from public.tasks where organization_id=p_org and assigned_to=p_user and archived_at is null and status<>'done'
   union all
   select jsonb_build_object('kind','engagement_work_item','id',id,'project_id',project_id,'row_version',row_version,'title',title)
   from public.work_items where organization_id=p_org and assignee_id=p_user and deleted_at is null and status<>'done'
 ) affected;
 update public.organization_memberships set status='revoked' where id=target.id;
 update public.organization_department_memberships set status='revoked',revoked_at=clock_timestamp()
   where organization_id=p_org and user_id=p_user and status='active'; get diagnostics deps=row_count;
 update public.organization_contributor_designations set status='revoked',revoked_at=clock_timestamp()
   where organization_id=p_org and user_id=p_user and status='active'; get diagnostics labels=row_count;
 update public.project_manager_bindings set status='revoked',revoked_at=clock_timestamp()
   where organization_id=p_org and user_id=p_user and status='active'; get diagnostics pms=row_count;
 update private.n1c_recurring_delegations set status='revoked',revoked_at=clock_timestamp(),revoked_by=actor
   where organization_id=p_org and approved_by=p_user and status='active'; get diagnostics delegations=row_count;
 revoked:=jsonb_build_object('departments',deps,'designations',labels,'project_managers',pms,'recurring_delegations',delegations);
 if target.status<>'revoked' or deps+labels+pms+delegations>0 then
   insert into private.n1d_deactivations(organization_id,user_id,actor_id,request_id,prior_membership,reassignment_records,revoked_authorities)
   values(p_org,p_user,actor,p_request,to_jsonb(target),records,revoked) returning id into audit_id;
 end if;
 result:=jsonb_build_object('organization_id',p_org,'user_id',p_user,'request_id',p_request,'status','revoked',
   'already_deactivated',target.status='revoked','audit_id',audit_id,'reassignment_records',records,
   'revoked_authorities',revoked,'replayed',false,'auth_account_preserved',true,'sessions_revoked',false);
 insert into private.n1b_authority_requests(organization_id,actor_id,request_id,request_payload,result) values(p_org,actor,p_request,payload,result);
 return result;
end; $$;
create function public.deactivate_organization_member(p_organization_id uuid,p_user_id uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.n1d_deactivate(p_organization_id,p_user_id,p_request_id);
$$;
create function private.n1d_deactivation_history(p_org uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.n1b_require_admin(p_org);
 return jsonb_build_object('organization_id',p_org,'user_id',p_user,'history',
   coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from private.n1d_deactivations d
     where d.organization_id=p_org and d.user_id=p_user),'[]'::jsonb));
end; $$;
create function public.get_organization_deactivation_history(p_organization_id uuid,p_user_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.n1d_deactivation_history(p_organization_id,p_user_id);
$$;
revoke all on function private.n1d_deactivate(uuid,uuid,uuid),public.deactivate_organization_member(uuid,uuid,uuid),
 private.n1d_deactivation_history(uuid,uuid),public.get_organization_deactivation_history(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.n1d_deactivate(uuid,uuid,uuid),public.deactivate_organization_member(uuid,uuid,uuid),
 private.n1d_deactivation_history(uuid,uuid),public.get_organization_deactivation_history(uuid,uuid) to authenticated;

-- Atomic fixed-Anka application setup after Auth invitation. Never overwrites
-- an existing membership or a shared global profile's authority/department.
create function private.n1d_complete_invitation(p_user uuid,p_email text,p_department text,p_role text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org constant uuid:='8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'; actor uuid;
begin
 actor:=private.n1b_require_admin(org);
 if p_role not in ('operations_admin','executive','department_manager','project_owner','contributor')
   or p_department not in ('content','design','development','marketing') then
   raise exception 'Invalid invitation role or department.' using errcode='22023';
 end if;
 perform 1 from auth.users where id=p_user and lower(email)=lower(p_email) and deleted_at is null for share;
 if not found then raise exception 'Verified invited identity required.' using errcode='42501'; end if;
 perform 1 from public.departments where id=p_department and organization_id=org;
 if not found then raise exception 'Same-organization department required.' using errcode='42501'; end if;
 if exists(select 1 from public.organization_memberships where organization_id=org and user_id=p_user) then
   raise exception 'Existing membership requires separately reviewed reactivation; invitation cannot overwrite history.' using errcode='23505';
 end if;
 insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status)
 values(org,p_user,'team',p_role,p_department,'active');
 return jsonb_build_object('organization_id',org,'user_id',p_user,'status','active');
end; $$;
create function public.complete_team_invitation(p_user_id uuid,p_email text,p_department text,p_role text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.n1d_complete_invitation(p_user_id,p_email,p_department,p_role);
$$;
revoke all on function private.n1d_complete_invitation(uuid,text,text,text),public.complete_team_invitation(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.n1d_complete_invitation(uuid,text,text,text),public.complete_team_invitation(uuid,text,text,text) to authenticated;
commit;
