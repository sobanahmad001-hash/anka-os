-- Run only via the guarded QA runner. It owns BEGIN/ROLLBACK and migrations.
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
create function pg_temp.import_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end;$$;
create function pg_temp.import_error(query text,code text,label text) returns void language plpgsql as $$
begin begin execute query;exception when others then if sqlstate=code then raise notice 'PASS %',label;return;end if;
raise exception 'FAIL % expected % got %',label,code,sqlstate;end;raise exception 'FAIL % did not reject',label;end;$$;

insert into public.department_chat_conversations(id,organization_id,project_id,owner_id,title,context_kind)
values('8f000000-0000-4000-8000-000000000001','99999999-9999-4999-8999-999999999901',
 '99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999902','Synthetic importer QA','project_team');
do $$ declare
 org uuid:='99999999-9999-4999-8999-999999999901';actor uuid:='99999999-9999-4999-8999-999999999902';
 project uuid:='99999999-9999-4999-8999-999999999974';eng uuid:='99999999-9999-4999-8999-999999999975';
 chat uuid:='8f000000-0000-4000-8000-000000000001';attachment uuid:='8f000000-0000-4000-8000-000000000002';
 source_sha text:=repeat('a',64); saved jsonb;result jsonb;again jsonb;cal_rows jsonb;provenance jsonb;preview jsonb:='{"reviewed":true}';target_work public.work_items;
 ai bigint;approvals bigint;count_before bigint;
begin
 select count(*) into ai from public.ai_runs;select count(*) into approvals from public.artifact_approvals;
 perform public.reserve_project_chat_import_attachment(attachment,chat,org,actor,'synthetic.csv','text/csv','internal',now()+interval '2 hours');
 perform public.claim_project_chat_import_attachment(attachment,org,actor);
 perform public.finish_project_chat_import_attachment(attachment,org,actor,'text/csv',10,source_sha,'{"sheets":[{"name":"Visible","rows":5,"hidden":false}]}','Synthetic metadata fixture; no Storage upload');
 -- Approved calendar creation, historical evidence and original-row replay.
 cal_rows:=jsonb_build_array(jsonb_build_object('row_id',repeat('1',64),'record_kind','engagement_work_item','record_id',null,
   'expected_row_version',null,'calendar_key','qa:calendar:create','title','Synthetic imported Marketing entry','start_date',null,'due_date',null,'action','create'));
 provenance:=jsonb_build_object('origin','spreadsheet_import','attachment_id',attachment,'batch_sha256',repeat('b',64),'rows',jsonb_build_array(
   jsonb_build_object('row_id',repeat('1',64),'identity','calendar:qa:calendar:create','action','create',
     'historical_evidence',jsonb_build_object('historical_status','published','original_date','2026-09-30','timezone','Asia/Karachi','channel','synthetic'),
     'source',jsonb_build_object('fileSha256',source_sha,'fileName','synthetic.csv','sheet','Visible','row',5))));
 saved:=public.save_project_chat_import_proposal(org,chat,actor,attachment,eng,'content_calendar','8f000000-0000-4000-8000-000000000050',null,null,jsonb_build_object('rows',cal_rows),preview,provenance);
 perform pg_temp.import_check(not exists(select 1 from public.work_items where title='Synthetic imported Marketing entry' and project_id=project),'Create proposal preview/save has zero canonical side effects');
 result:=public.confirm_project_chat_import_proposal(org,chat,actor,'8f000000-0000-4000-8000-000000000050',saved->>'review_sha256');
 select * into target_work from public.work_items where id=(result->'rows'->0->'result'->>'record_id')::uuid;
 perform pg_temp.import_check(result->'rows'->0->>'outcome'='verified' and target_work.organization_id=org and target_work.project_id=project
   and target_work.engagement_id=eng and target_work.department_id='marketing' and target_work.assignee_id is null and target_work.status='not_started'
   and target_work.start_date is null and target_work.due_date is null,'Historical import creates exactly unassigned Marketing work without invented status or deadline');
 again:=public.confirm_project_chat_import_proposal(org,chat,actor,'8f000000-0000-4000-8000-000000000050',saved->>'review_sha256');
 perform pg_temp.import_check((again->>'replayed')::boolean and (select count(*) from public.work_items where title='Synthetic imported Marketing entry' and project_id=project)=1,'Lost response replay creates no duplicate Work Item');
 saved:=public.save_project_chat_import_proposal(org,chat,actor,attachment,eng,'content_calendar','8f000000-0000-4000-8000-000000000051',null,null,jsonb_build_object('rows',cal_rows),preview,provenance);
 again:=public.confirm_project_chat_import_proposal(org,chat,actor,'8f000000-0000-4000-8000-000000000051',saved->>'review_sha256');
 perform pg_temp.import_check(again->'rows'->0->>'error_code'='40001' and (select count(*) from public.work_items where title='Synthetic imported Marketing entry' and project_id=project)=1,'Separate stale create proposal cannot repeat accepted calendar identity');
 perform pg_temp.import_check((select import_source_receipt->'rows'->0->'historical_evidence'->>'historical_status'='published' from public.department_chat_proposals where idempotency_key='8f000000-0000-4000-8000-000000000050'),'New calendar historical publication stays in private receipt');
 perform pg_temp.import_error(format('select public.save_project_chat_import_proposal(%L,%L,%L,%L,%L,%L,%L,null,null,%L::jsonb,%L::jsonb,%L::jsonb)',org,chat,actor,attachment,eng,'content_calendar','8f000000-0000-4000-8000-000000000052',jsonb_build_object('rows',jsonb_build_array((cal_rows->0)||jsonb_build_object('assignee_id',actor))),preview,provenance),'22023','Create command cannot include assignment/status authority');
 cal_rows:=jsonb_build_array((cal_rows->0)||jsonb_build_object('row_id',repeat('2',64),'calendar_key','qa:calendar:upcoming','title','Synthetic upcoming Marketing entry','start_date','2026-10-15','due_date','2026-10-20'));
 provenance:=jsonb_set(provenance,'{rows}',jsonb_build_array((provenance->'rows'->0)||jsonb_build_object('row_id',repeat('2',64),'identity','calendar:qa:calendar:upcoming')));
 saved:=public.save_project_chat_import_proposal(org,chat,actor,attachment,eng,'content_calendar','8f000000-0000-4000-8000-000000000053',null,null,jsonb_build_object('rows',cal_rows),preview,provenance);
 result:=public.confirm_project_chat_import_proposal(org,chat,actor,'8f000000-0000-4000-8000-000000000053',saved->>'review_sha256');
 select * into target_work from public.work_items where id=(result->'rows'->0->'result'->>'record_id')::uuid;
 perform pg_temp.import_check(target_work.start_date='2026-10-15'::date and target_work.due_date='2026-10-20'::date and target_work.assignee_id is null and target_work.status='not_started','Upcoming import uses only explicitly reviewed canonical dates');
 perform pg_temp.import_check((select count(*) from public.ai_runs)=ai and (select count(*) from public.artifact_approvals)=approvals,'Create preserves provider and approval histories');
end;$$;
