-- Disposable F1 fixture only. Requires a completed synthetic F1 client decision.
-- No fixture changes survive rollback. Do not run on a hosted database.
begin;
create temporary table receipt_fixture as
select r.organization_id,r.actor_id,r.request_id,v.id version_id,v.project_id,
  md5((select jsonb_agg(to_jsonb(a) order by a.id)::text from public.approvals a
    where a.deliverable_version_id=v.id)) approval_hash,
  md5(to_jsonb(r)::text) receipt_hash
from public.deliverable_action_requests r
join auth.users u on u.id=r.actor_id
join public.deliverable_versions v on v.id=(r.result->>'deliverable_version_id')::uuid
where r.action='client_decision' and u.email ~ '^anka-qa-[0-9a-f-]+@example\.test$'
  and r.result->>'review_status'='client_approved'
  and r.payload_checksum=encode(extensions.digest(convert_to(jsonb_build_object(
    'version_id',v.id,'expected_state_version',4,'decision','approved',
    'rationale','Synthetic client acceptance')::text,'UTF8'),'sha256'),'hex')
order by r.created_at desc limit 1;
do $$ begin if (select count(*) from receipt_fixture)<>1 then
  raise exception 'Synthetic F1 fixture required'; end if; end $$;
grant select on receipt_fixture to authenticated;
-- Restore only this local synthetic access inside the rollback transaction.
update public.project_client_access a set status='active'
from public.client_contacts c,receipt_fixture f
where a.client_contact_id=c.id and c.auth_user_id=f.actor_id and a.project_id=f.project_id;
select set_config('request.jwt.claim.sub',actor_id::text,true) from receipt_fixture;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$ declare f record; result jsonb; begin
 select * into strict f from receipt_fixture;
 result:=public.decide_governed_deliverable_version(f.organization_id,f.version_id,4,
   'approved','Synthetic client acceptance',f.request_id);
 if result->>'idempotent_replay' is distinct from 'true' then raise exception 'Authorized replay lost original receipt'; end if;
 begin
  perform public.decide_governed_deliverable_version(f.organization_id,f.version_id,4,
    'approved','Changed payload',f.request_id);
  raise exception 'Conflicting receipt payload accepted';
 exception when unique_violation then null; end;
end $$;
reset role;
update public.project_client_access a set status='revoked'
from public.client_contacts c,receipt_fixture f
where a.client_contact_id=c.id and c.auth_user_id=f.actor_id and a.project_id=f.project_id;
set local role authenticated;
do $$ declare f record; begin
 select * into strict f from receipt_fixture;
 begin
  perform public.decide_governed_deliverable_version(f.organization_id,f.version_id,4,
    'approved','Synthetic client acceptance',f.request_id);
  raise exception 'Revoked client recovered an old decision receipt';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare f record; begin
 select * into strict f from receipt_fixture;
 if f.approval_hash is distinct from (select md5(jsonb_agg(to_jsonb(a) order by a.id)::text)
   from public.approvals a where a.deliverable_version_id=f.version_id)
 or f.receipt_hash is distinct from (select md5(to_jsonb(r)::text)
   from public.deliverable_action_requests r where r.organization_id=f.organization_id
   and r.actor_id=f.actor_id and r.request_id=f.request_id and r.action='client_decision')
 then raise exception 'Original audit decision or receipt changed'; end if;
end $$;
rollback;
