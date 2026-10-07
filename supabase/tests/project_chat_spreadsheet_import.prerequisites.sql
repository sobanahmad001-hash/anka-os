-- Narrow metadata only. No customer rows, credentials, object paths or writes.
select requested.signature, p.oid is not null as present,
 case when p.oid is not null then encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') end as definition_sha256,
 p.prosecdef as security_definer,p.proconfig as settings,
 case when p.oid is not null then has_function_privilege('service_role',p.oid,'EXECUTE') end as service_execute,
 case when p.oid is not null then has_function_privilege('authenticated',p.oid,'EXECUTE') end as authenticated_execute,
 case when p.oid is not null then has_function_privilege('anon',p.oid,'EXECUTE') end as anon_execute
from (values
 ('public.schedule_marketing_calendar_entry(uuid,uuid,uuid,uuid,text,uuid,bigint,date,date,uuid)'),
 ('private.n1c_require_scope(uuid,uuid,uuid)'),
 ('private.n1c_can_assign_department(uuid,uuid,text,uuid)'),
 ('public.fail_department_chat_attachment(uuid,uuid,text,text,text)'),
 ('private.audit_department_chat_proposal()')
) requested(signature) left join pg_proc p on p.oid=to_regprocedure(requested.signature);

select requested.table_name,requested.column_name,c.udt_name,c.is_nullable
from (values
 ('projects','planning_timezone'),
 ('tasks','id'),('tasks','organization_id'),('tasks','project_id'),('tasks','department_id'),
 ('tasks','title'),('tasks','row_version'),('tasks','due_date'),('tasks','status'),('tasks','user_id'),('tasks','assigned_to'),('tasks','archived_at'),
 ('work_items','id'),('work_items','organization_id'),('work_items','project_id'),('work_items','engagement_id'),('work_items','department_id'),
 ('work_items','title'),('work_items','row_version'),('work_items','start_date'),('work_items','due_date'),('work_items','status'),
 ('work_items','created_by'),('work_items','assignee_id'),('work_items','deleted_at')
) requested(table_name,column_name)
left join information_schema.columns c on c.table_schema='public' and c.table_name=requested.table_name and c.column_name=requested.column_name
order by requested.table_name,requested.column_name;
