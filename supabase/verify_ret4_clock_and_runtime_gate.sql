-- Isolated synthetic-only RET4 diagnostic. Never run against shared/live databases.
-- A failing runtime gate is intentional evidence, not a passing release verifier.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
create temporary table ret4_checks(name text primary key, passed boolean not null, detail text);
grant select, insert on ret4_checks to service_role;

insert into ret4_checks values
('private_helper_exact_owner_acl_definition', (select p.prosecdef
  and p.proowner=(select relowner from pg_class where oid='private.recurring_scheduler_principals'::regclass)
  and p.proconfig=array['search_path=""']
  and (select count(*)=2 and bool_and(a.grantee in (p.proowner,(select oid from pg_roles where rolname='service_role'))
    and a.privilege_type='EXECUTE' and not a.is_grantable) from aclexplode(p.proacl) a)
  and p.prosrc like '%public.organization_memberships%'
  and p.prosrc like '%deleted_at is null%'
  and p.prosrc like '%banned_until%'
  and (length(p.prosrc)-length(replace(p.prosrc,'for share','')))/9=3
  from pg_proc p where p.oid='private.assert_recurring_scheduler(uuid,uuid)'::regprocedure), null),
('utc_due', private.recurring_due_instant('2026-09-04 09:00','UTC') = '2026-09-04 09:00Z'::timestamptz, null),
('ny_gap_first_valid_instant', private.recurring_due_instant('2026-03-08 02:30','America/New_York') = '2026-03-08 07:00Z'::timestamptz, null),
('ny_fold_earlier_instant', private.recurring_due_instant('2026-11-01 01:30','America/New_York') = '2026-11-01 05:30Z'::timestamptz, null),
('lord_howe_half_hour_gap', private.recurring_due_instant('2026-10-04 02:15','Australia/Lord_Howe') = '2026-10-03 15:30Z'::timestamptz, null),
('apia_skipped_date', private.recurring_due_instant('2011-12-30 09:00','Pacific/Apia') = '2011-12-30 10:00Z'::timestamptz, null),
('retry_fifteen_minutes', private.recurring_retry_deadline('2026-09-04 09:02Z','2026-09-04','UTC') = '2026-09-04 09:17Z'::timestamptz, null),
('retry_midnight_cap', private.recurring_retry_deadline('2026-09-04 23:58Z','2026-09-04','UTC') = '2026-09-05 00:00Z'::timestamptz, null),
('retry_local_midnight_cap', private.recurring_retry_deadline('2026-09-04 18:58Z','2026-09-04','Asia/Karachi') = '2026-09-04 19:00Z'::timestamptz, null),
('monthly_clamp_without_drift', private.recurring_month_anchor('2027-01-31',1) = '2027-02-28'::date and private.recurring_month_anchor('2027-01-31',2) = '2027-03-31'::date, null),
('weekly_anchor', private.recurring_period_end('weekly','2027-01-06','2027-01-20') = '2027-01-27'::date, null),
('browser_scheduler_rpc_denied', not has_function_privilege('authenticated','public.admit_recurring_schedule(uuid,date,uuid)','EXECUTE') and not has_function_privilege('anon','public.execute_recurring_schedule(uuid,uuid)','EXECUTE'), null),
('schedule_tables_rls', (select bool_and(relrowsecurity) from pg_class where oid in ('public.recurring_schedule_consents'::regclass,'public.recurring_schedule_admissions'::regclass,'public.recurring_schedule_executions'::regclass)), null);

do $$
begin
  begin
    perform private.recurring_due_instant('2026-01-01','Invalid/Timezone');
    insert into ret4_checks values('invalid_timezone_rejected',false,null);
  exception when sqlstate '22023' then
    insert into ret4_checks values('invalid_timezone_rejected',true,null);
  end;
end;
$$;

-- Synthetic machine binding exists only inside this rollback transaction.
insert into auth.users(id) values('44444444-0000-4000-8000-000000000004');
insert into private.recurring_scheduler_principals(actor_id,organization_id,enabled)
values('44444444-0000-4000-8000-000000000004','44444444-4444-4444-8444-444444444444',true);

set local role service_role;
do $$
declare detail text;
begin
  begin
    perform private.assert_recurring_scheduler('44444444-0000-4000-8000-000000000004','44444444-4444-4444-8444-444444444444');
    insert into ret4_checks values('runtime_machine_authorization_usable',true,null);
  exception when others then
    get stacked diagnostics detail = message_text;
    insert into ret4_checks values('runtime_machine_authorization_usable',false,sqlstate || ': ' || detail);
  end;
  begin
    perform id from auth.users where id='44444444-0000-4000-8000-000000000004';
    insert into ret4_checks values('runtime_direct_auth_user_read_denied',false,'Unexpected direct auth access');
  exception when others then
    get stacked diagnostics detail = message_text;
    insert into ret4_checks values('runtime_direct_auth_user_read_denied',sqlstate = '42501',sqlstate || ': ' || detail);
  end;
end;
$$;
reset role;
table ret4_checks;
select bool_and(passed) as all_passed from ret4_checks \gset
rollback;
-- Confirm fixture rollback before returning a nonzero process exit for the gate.
select not exists(select 1 from auth.users where id='44444444-0000-4000-8000-000000000004') as synthetic_identity_rolled_back;
\if :all_passed
\echo RET4 diagnostic gates passed; full behavioral verification still required.
\else
\echo RET4 diagnostic gate FAILED. Review results; no fixture or permission change retained.
do $$ begin raise exception 'RET4 runtime authorization gate failed; synthetic fixture was rolled back.'; end $$;
\endif
