-- Run only via the guarded QA runner. It owns BEGIN/ROLLBACK and migrations.
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
create function pg_temp.import_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end;$$;
create function pg_temp.import_error(query text,code text,label text) returns void language plpgsql as $$
begin begin execute query;exception when others then if sqlstate=code then raise notice 'PASS %',label;return;end if;
raise exception 'FAIL % expected % got %',label,code,sqlstate;end;raise exception 'FAIL % did not reject',label;end;$$;

-- Established QA anchors only. No auth user, invitation or production fixture.
insert into public.department_chat_conversations(id,organization_id,project_id,owner_id,title,context_kind)
values('8f000000-0000-4000-8000-000000000001','99999999-9999-4999-8999-999999999901',
 '99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999902','Synthetic importer QA','project_team');
insert into public.artifacts select (jsonb_populate_record(null::public.artifacts,to_jsonb(a)||jsonb_build_object(
 'id','8f000000-0000-4000-8000-000000000003','title','Synthetic importer architecture'))).* from public.artifacts a
 where id='99999999-9999-4999-8999-999999997140';
insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum,created_by)
select '8f000000-0000-4000-8000-000000000004','99999999-9999-4999-8999-999999999901','8f000000-0000-4000-8000-000000000003',1,content,
 encode(sha256(convert_to(content::text,'UTF8')),'hex'),'99999999-9999-4999-8999-999999999902'
from (select '{"pages":[{"page_key":"importer:one","slug":"importer-one","title":"Synthetic one","position":1000,"page_type":"service","purpose":"Synthetic QA","parent_page_key":null,"parent_slug":null}]}'::jsonb content) source;
insert into public.tasks(id,organization_id,project_id,user_id,created_by,title,department_id,due_date,status)
values('8f000000-0000-4000-8000-000000000020','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',
 '99999999-9999-4999-8999-999999999902','99999999-9999-4999-8999-999999999902','Synthetic calendar target','marketing','2026-10-10','backlog');

do $$ declare
 org uuid:='99999999-9999-4999-8999-999999999901';actor uuid:='99999999-9999-4999-8999-999999999902';
 project uuid:='99999999-9999-4999-8999-999999999974';eng uuid:='99999999-9999-4999-8999-999999999975';
 chat uuid:='8f000000-0000-4000-8000-000000000001';attachment uuid:='8f000000-0000-4000-8000-000000000002';
 root uuid:='8f000000-0000-4000-8000-000000000003';parent uuid:='8f000000-0000-4000-8000-000000000004';
 request uuid:='8f000000-0000-4000-8000-000000000005';calendar_request uuid:='8f000000-0000-4000-8000-000000000006';
 source_text text:='Synthetic local importer bytes';source_sha text;expiry timestamptz:=now()+interval '2 hours';
 reserved public.department_chat_attachments;claimed public.department_chat_attachments;finalized public.department_chat_attachments;
 saved jsonb;again jsonb;result jsonb;recovered jsonb;payload jsonb;preview jsonb:='{"reviewed":true}';provenance jsonb;cal_rows jsonb;
 approvals bigint;pages bigint;ai bigint;versions bigint;old_task public.tasks;new_task public.tasks;target_work public.work_items;review text;proposal uuid;
begin
 source_sha:=encode(sha256(convert_to(source_text,'UTF8')),'hex');
 select count(*) into approvals from public.artifact_approvals;select count(*) into pages from public.project_website_pages;
 select count(*) into ai from public.ai_runs;select count(*) into versions from public.artifact_versions;
 reserved:=public.reserve_project_chat_import_attachment(attachment,chat,org,actor,'synthetic.csv','text/csv','internal',expiry);
 perform pg_temp.import_check(reserved.project_id=project and reserved.engagement_id is null and reserved.department_id is null
   and not reserved.ai_use_allowed and not reserved.share_with_recipients,'Source binds server-side project without Workshop/model identity');
 again:=to_jsonb(public.reserve_project_chat_import_attachment(attachment,chat,org,actor,'synthetic.csv','text/csv','internal',expiry));
 perform pg_temp.import_check(again->>'id'=attachment::text,'Reservation exact replay reuses original identity');
 perform pg_temp.import_error(format('select public.reserve_project_chat_import_attachment(%L,%L,%L,%L,%L,%L,%L,%L)',attachment,chat,org,actor,'changed.csv','text/csv','internal',expiry),'23505','Reservation changed payload rejected');
 claimed:=public.claim_project_chat_import_attachment(attachment,org,actor);
 perform pg_temp.import_check(claimed.status='processing','Source claim is single-flight');
 perform pg_temp.import_error(format('select public.claim_project_chat_import_attachment(%L,%L,%L)',attachment,org,actor),'55000','Competing source claim cannot finalize again');
 finalized:=public.finish_project_chat_import_attachment(attachment,org,actor,'text/csv',octet_length(source_text),source_sha,'{"sheets":[{"name":"Visible","rows":2,"hidden":false}]}','Synthetic native metadata fixture; no Storage upload');
 perform pg_temp.import_check(finalized.status='reference_only' and finalized.extracted_text is null,'Final source is private reference; no auto-ingestion');
 perform pg_temp.import_check((public.finish_project_chat_import_attachment(attachment,org,actor,'text/csv',octet_length(source_text),source_sha,'{"sheets":[{"name":"Visible","rows":2,"hidden":false}]}','Synthetic native metadata fixture; no Storage upload')).id=attachment,'Finalization exact replay returns original source');
 perform pg_temp.import_error(format('update public.department_chat_attachments set share_with_recipients=true where id=%L',attachment),'23514','Source cannot be implicitly shared after finalization');
 provenance:=jsonb_build_object('origin','spreadsheet_import','attachment_id',attachment,'batch_sha256',repeat('b',64),'rows',jsonb_build_array(jsonb_build_object(
   'row_id',repeat('c',64),'source',jsonb_build_object('fileSha256',source_sha,'fileName','synthetic.csv','sheet','Visible','row',2),
   'identity','importer:one','action','update','historical_evidence',jsonb_build_object('historical_status','published','original_date','2026-09-30'))));
 payload:=jsonb_build_object('title','Reviewed synthetic import','expected_parent_version_id',parent,'content',
   '{"pages":[{"page_key":"importer:one","slug":"importer-one","title":"Reviewed synthetic one","position":1000,"page_type":"service","purpose":"Synthetic QA","parent_page_key":null,"parent_slug":null}]}'::jsonb);
 saved:=public.save_project_chat_import_proposal(org,chat,actor,attachment,eng,'website_architecture',request,root,parent,payload,preview,provenance);
 proposal:=(saved->>'proposal_id')::uuid;review:=saved->>'review_sha256';
 perform pg_temp.import_check((select proposal_origin='spreadsheet_import' and ai_run_id is null and connector_connection_id is null and model_id is null and department_id is null from public.department_chat_proposals where id=proposal),'Provider-free proposal invents no AI run/connector/model IDs');
 perform pg_temp.import_check((select count(*) from public.ai_runs)=ai and (select count(*) from public.artifact_versions)=versions,'Saving private preview creates zero provider runs/canonical versions');
 again:=public.save_project_chat_import_proposal(org,chat,actor,attachment,eng,'website_architecture',request,root,parent,payload,preview,provenance);
 perform pg_temp.import_check(again->>'proposal_id'=proposal::text,'Private proposal exact retry is idempotent');
 perform pg_temp.import_error(format('select public.save_project_chat_import_proposal(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L::jsonb,%L::jsonb)',org,chat,actor,attachment,eng,'website_architecture',request,root,parent,payload||'{"title":"Different"}',preview,provenance),'23505','Original request cannot be reused with different mapped input');
 perform pg_temp.import_error(format('select public.confirm_project_chat_import_proposal(%L,%L,%L,%L,%L)',org,chat,actor,request,repeat('d',64)),'40001','Changed review cannot confirm');
 result:=public.confirm_project_chat_import_proposal(org,chat,actor,request,review);
 perform pg_temp.import_check((select count(*) from public.artifact_versions)=versions+1 and (result->'rows'->0->'result'->>'unapproved')::boolean,'Confirm appends one unapproved canonical version');
 perform pg_temp.import_check((select count(*) from public.artifact_approvals)=approvals and (select count(*) from public.project_website_pages)=pages,'Import does not fabricate approval or register/publish pages');
 perform pg_temp.import_check((select content::text not like '%published%' from public.artifact_versions where id=(result->'rows'->0->'result'->>'artifact_version_id')::uuid),'Historical publication label stays out of canonical content');
 perform pg_temp.import_check((select import_source_receipt->'rows'->0->'historical_evidence'->>'historical_status'='published' from public.department_chat_proposals where id=proposal),'Historical label survives only as private source evidence');
 again:=public.confirm_project_chat_import_proposal(org,chat,actor,request,review);
 perform pg_temp.import_check((again->>'replayed')::boolean and (select count(*) from public.artifact_versions)=versions+1,'Lost confirmation response replays receipt without duplicate version');
 recovered:=public.get_project_chat_import_proposal(org,chat,actor,request);
 perform pg_temp.import_check(recovered->>'status'='accepted' and recovered->'result'=result,'UUID-only recovery returns exact immutable row results');
 perform pg_temp.import_error(format('update public.department_chat_proposals set import_source_receipt=%L::jsonb where id=%L','{}',proposal),'23514','Decided source provenance cannot be rewritten');
 perform pg_temp.import_error(format('select public.get_project_chat_import_proposal(%L,%L,%L,%L)',org,chat,'8f000000-0000-4000-8000-000000000099',request),'42501','Other actor cannot read private source/results');
 again:=public.save_project_chat_import_proposal(org,chat,actor,attachment,eng,'website_architecture','8f000000-0000-4000-8000-000000000007',root,parent,payload,preview,provenance);
 perform pg_temp.import_error(format('select public.confirm_project_chat_import_proposal(%L,%L,%L,%L,%L)',org,chat,actor,'8f000000-0000-4000-8000-000000000007',again->>'review_sha256'),'40001','Optimistic parent check never overwrites newer canonical work');
 -- Keyword draft uses an exact same-project architecture and no invented measurement.
 insert into public.artifacts select (jsonb_populate_record(null::public.artifacts,to_jsonb(a)||jsonb_build_object(
   'id','8f000000-0000-4000-8000-000000000030','artifact_type','keyword_strategy','title','Synthetic keyword plan'))).* from public.artifacts a where id=root;
 payload:=jsonb_build_object('title','Synthetic keyword import','expected_parent_version_id',null,'content',jsonb_build_object(
   'schema_version',2,'source_architecture_version_id',parent,'keywords',jsonb_build_array(jsonb_build_object(
    'term','Synthetic service','locale','en-US','intent','informational','target_kind','page','target_page_key','importer:one',
    'target_page_slug','importer-one','search_volume',null,'difficulty',null,'evidence_source','','notes','Synthetic QA')),'content_requests','[]'::jsonb));
 insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum,created_by)
 values('8f000000-0000-4000-8000-000000000031',org,'8f000000-0000-4000-8000-000000000030',1,
   payload->'content',encode(sha256(convert_to((payload->'content')::text,'UTF8')),'hex'),actor);
 payload:=jsonb_set(payload,'{expected_parent_version_id}','"8f000000-0000-4000-8000-000000000031"'::jsonb);
 payload:=jsonb_set(payload,'{content,keywords,0,notes}','"Reviewed synthetic QA"'::jsonb);
 -- Explicit original root and parent; never create a duplicate keyword record.
 saved:=public.save_project_chat_import_proposal(org,chat,actor,attachment,eng,'keyword_strategy','8f000000-0000-4000-8000-000000000032',
   '8f000000-0000-4000-8000-000000000030','8f000000-0000-4000-8000-000000000031',payload,preview,provenance);
 result:=public.confirm_project_chat_import_proposal(org,chat,actor,'8f000000-0000-4000-8000-000000000032',saved->>'review_sha256');
 perform pg_temp.import_check((select content->'keywords'->0->'search_volume'='null'::jsonb and content->>'source_architecture_version_id'=parent::text
   from public.artifact_versions where id=(result->'rows'->0->'result'->>'artifact_version_id')::uuid),'Keyword draft retains unknown measurement and exact architecture');
 payload:=jsonb_set(payload,'{content,keywords,0,target_page_key}','"foreign-page"'::jsonb);
 payload:=jsonb_set(payload,'{expected_parent_version_id}',to_jsonb(result->'rows'->0->'result'->>'artifact_version_id'));
 saved:=public.save_project_chat_import_proposal(org,chat,actor,attachment,eng,'keyword_strategy','8f000000-0000-4000-8000-000000000033',
   '8f000000-0000-4000-8000-000000000030',(result->'rows'->0->'result'->>'artifact_version_id')::uuid,payload,preview,provenance);
 perform pg_temp.import_error(format('select public.confirm_project_chat_import_proposal(%L,%L,%L,%L,%L)',org,chat,actor,
   '8f000000-0000-4000-8000-000000000033',saved->>'review_sha256'),'42501','Keyword target outside exact architecture cannot commit');
 select * into old_task from public.tasks where id='8f000000-0000-4000-8000-000000000020';
 cal_rows:=jsonb_build_array(jsonb_build_object('row_id',repeat('e',64),'record_kind','project_task','record_id',old_task.id,
   'expected_row_version',old_task.row_version,'start_date',null,'due_date','2026-10-15','action','update'),
   jsonb_build_object('row_id',repeat('f',64),'record_kind','project_task','record_id','8f000000-0000-4000-8000-000000000099',
   'expected_row_version',1,'start_date',null,'due_date','2026-10-16','action','update'));
 provenance:=jsonb_build_object('origin','spreadsheet_import','attachment_id',attachment,'batch_sha256',repeat('b',64),'rows',jsonb_build_array(
   jsonb_build_object('row_id',repeat('e',64),'action','update','source',jsonb_build_object('fileSha256',source_sha,'fileName','synthetic.csv','sheet','Visible','row',3)),
   jsonb_build_object('row_id',repeat('f',64),'action','update','source',jsonb_build_object('fileSha256',source_sha,'fileName','synthetic.csv','sheet','Visible','row',4))));
 saved:=public.save_project_chat_import_proposal(org,chat,actor,attachment,eng,'content_calendar',calendar_request,null,null,jsonb_build_object('rows',cal_rows),preview,provenance);
 result:=public.confirm_project_chat_import_proposal(org,chat,actor,calendar_request,saved->>'review_sha256');
 select * into new_task from public.tasks where id=old_task.id;
 perform pg_temp.import_check(result->'rows'->0->>'outcome'='verified' and result->'rows'->1->>'outcome'='error','Calendar batch stores successful and failed rows independently');
 perform pg_temp.import_check(new_task.due_date='2026-10-15'::date and new_task.row_version>old_task.row_version
   and new_task.status=old_task.status and new_task.assigned_to is not distinct from old_task.assigned_to,'Existing scheduler changes only reviewed dates, never status/assignment');
 again:=public.confirm_project_chat_import_proposal(org,chat,actor,calendar_request,saved->>'review_sha256');
 perform pg_temp.import_check((again->>'replayed')::boolean and (select row_version from public.tasks where id=old_task.id)=new_task.row_version,'Partial batch replay repeats neither successful nor failed row execution');
 perform pg_temp.import_check((select count(*) from public.ai_runs)=ai and (select count(*) from public.artifact_approvals)=approvals,'Both import adapters preserve provider and approval histories');
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
 update public.organization_memberships set status='suspended' where organization_id=org and user_id=actor;
 perform pg_temp.import_error(format('select public.get_project_chat_import_proposal(%L,%L,%L,%L)',org,chat,actor,request),'42501','Current revocation denies recovery bytes');
 update public.organization_memberships set status='active' where organization_id=org and user_id=actor;
 update public.projects set archived_at=now() where id=project;
 perform pg_temp.import_error(format('select public.confirm_project_chat_import_proposal(%L,%L,%L,%L,%L)',org,chat,actor,request,review),'42501','Archived project denies even confirmation replay');
end;$$;
select pg_temp.import_check(not has_table_privilege('authenticated','public.department_chat_attachments','SELECT')
  and not has_function_privilege('authenticated','public.confirm_project_chat_import_proposal(uuid,uuid,uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.save_project_chat_import_proposal(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')
  and has_function_privilege('service_role','public.confirm_project_chat_import_proposal(uuid,uuid,uuid,uuid,text)','EXECUTE'),'Private source and mutations retain service-only grants');
