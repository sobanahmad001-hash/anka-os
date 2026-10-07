-- Read-only catalog inventory. Safe even when Storage/scheduler tables are absent.
select signature,to_regprocedure(signature) is not null as present
from unnest(array[
 'public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)',
 'private.n1c_actor(uuid)','private.n1c_set_actor(uuid)',
 'private.n1c_require_scope(uuid,uuid,uuid)','private.n1c_can_assign_department(uuid,uuid,text,uuid)',
 'private.p5_raise_stale_write(text,uuid,bigint,bigint)','private.p7_reject_history_mutation()',
 'public.schedule_marketing_calendar_entry(uuid,uuid,uuid,uuid,text,uuid,bigint,date,date,uuid)'
]) signature;
select name,to_regclass(name) is not null as present from unnest(array[
 'auth.users','public.projects','public.engagements','public.organizations','public.organization_memberships',
 'public.engagement_services','public.service_catalog','public.tasks','public.work_items',
 'public.task_dependencies','public.work_item_dependencies','private.m03_schedule_requests','storage.buckets','storage.objects'
]) name;
select a.attname as bucket_column,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull
from pg_attribute a where a.attrelid=to_regclass('storage.buckets') and a.attnum>0 and not a.attisdropped order by a.attnum;
select requested.name,c.conname,pg_get_constraintdef(c.oid) as definition
from unnest(array['public.tasks','public.work_items','public.task_dependencies','public.work_item_dependencies']) requested(name)
join pg_constraint c on c.conrelid=to_regclass(requested.name)
where c.contype in ('f','u','p') order by requested.name,c.conname;
