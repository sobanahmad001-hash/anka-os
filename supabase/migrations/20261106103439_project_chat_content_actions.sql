-- LOCAL CANDIDATE: explicit Chat Content save and exact approved Design handoff.
-- Existing immutable receipts/journeys/Content/Work/N3 remain canonical.
-- Native stage/concurrency and combined integration acceptance still required.
begin;
set local lock_timeout='500ms';
set local statement_timeout='120s';
do $guard$ begin
 if to_regprocedure('public.apply_project_chat_content_action(uuid,uuid,uuid,uuid,uuid,jsonb)') is not null
  or to_regprocedure('private.lock_project_chat_content_sources(uuid,uuid,uuid[])') is not null
 then raise exception 'New Content action namespace already exists';end if;
 -- Full-definition hashes, distinct from the saved prosrc body_md5 fields.
 if md5(pg_get_functiondef('public.save_p5_work_item(uuid,uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,bigint,text)'::regprocedure)) is distinct from '616f1653e63eccd55908227a64e2febf'
  or md5(pg_get_functiondef('public.confirm_content_n3_handoff(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,uuid,text)'::regprocedure)) is distinct from '2b8cac25868f77595f1c4d9d6fec08be'
  or md5(pg_get_functiondef('private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)'::regprocedure)) is distinct from '9caba1d019b048bb034248815e3974b7'
 then raise exception 'Exact current Content Work/approval/handoff prerequisite changed';end if;
end;$guard$;
-- Row locks participate in normal FK-backed direct version/approval writers.
-- No advisory-only claim and no table-wide locks. Every conflicting acquisition
-- fails immediately so version-first and request-first writers cannot form a
-- new blocking cycle with this acquisition protocol.
create function private.lock_project_chat_content_sources(p_org uuid,p_project uuid,p_artifact_ids uuid[])
returns void language plpgsql set search_path='' as $$
declare root uuid; n integer; initial_requests uuid[]; locked_requests uuid[];
begin
 if auth.uid() is null or p_artifact_ids is null or cardinality(p_artifact_ids) not between 1 and 21
  or array_position(p_artifact_ids,null) is not null
  or (select count(distinct x) from unnest(p_artifact_ids)x)<>cardinality(p_artifact_ids)
 then raise exception 'Bounded exact source roots required' using errcode='22023';end if;
 perform private.n1c_require_scope(p_org,p_project,auth.uid());
 for root in select x from unnest(p_artifact_ids)x order by x loop
  perform 1 from public.artifacts a where a.id=root and a.organization_id=p_org and a.project_id=p_project for update nowait;
  if not found then raise exception 'Current same-project source root required' using errcode='42501';end if;
 end loop;
 select count(*) into n from public.artifact_versions where organization_id=p_org and artifact_id=any(p_artifact_ids);
 if n>2000 then raise exception 'Source history exceeds bounded review' using errcode='54000';end if;
 select coalesce(array_agg(r.id order by r.id),'{}'::uuid[]) into initial_requests
  from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids);
 perform r.id from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids)
  order by r.id for share of r nowait;
 perform v.id from public.artifact_versions v where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids)
  order by v.id for share nowait;
 -- Fresh statement: request creation can have committed between enumeration
 -- and version acquisition. All normal request/approval writers lock versions.
 perform r.id from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids)
  order by r.id for share of r nowait;
 select coalesce(array_agg(r.id order by r.id),'{}'::uuid[]) into locked_requests
  from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids);
 if initial_requests is distinct from locked_requests then
  raise exception 'Governed review changed during source acquisition; review current source explicitly' using errcode='40001';end if;
exception when lock_not_available or deadlock_detected then
 raise exception 'Selected Content source is busy; preserve the original request and review current source explicitly' using errcode='40001';
end;$$;
revoke all on function private.lock_project_chat_content_sources(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;


-- Composed by build-action-migration.py into the CLI-created migration.
create function private.require_project_chat_action_owner(p_org uuid,p_project uuid,p_conversation uuid,p_message uuid,p_write boolean)
returns void language plpgsql set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authenticated action owner required' using errcode='42501';end if;
 perform private.n1c_require_scope(p_org,p_project,auth.uid());
 perform 1 from public.department_chat_conversations c where c.id=p_conversation and c.organization_id=p_org
  and c.project_id=p_project and c.owner_id=auth.uid() and c.context_kind='project_team'
  and c.engagement_id is null and c.department_id is null
  and (not p_write or (c.state='active' and c.archived_at is null)) for share;
 if not found then raise exception 'Original owned Project Chat required' using errcode='42501';end if;
 if p_message is not null then
  perform 1 from public.department_chat_messages m where m.id=p_message and m.organization_id=p_org
   and m.project_id=p_project and m.conversation_id=p_conversation and m.author_id=auth.uid()
   and m.role='user' and m.status='completed' and m.ai_run_id is null for share;
  if not found then raise exception 'Original saved human message required' using errcode='42501';end if;
 end if;
end;$$;
revoke all on function private.require_project_chat_action_owner(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.recover_project_chat_content_action(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.project_work_commands;
begin
 if p_request_id is null or p_source_message_id is null then raise exception 'Original request identity required' using errcode='22023';end if;
 perform private.require_project_chat_action_owner(p_organization_id,p_project_id,p_conversation_id,p_source_message_id,false);
 select * into r from private.project_work_commands where organization_id=p_organization_id and actor_id=auth.uid() and request_id=p_request_id;
 if not found then return jsonb_build_object('status','not_recorded','must_not_submit',true);end if;
 if r.project_id is distinct from p_project_id or r.payload->>'action' is distinct from 'project_chat_content_v1'
  or r.payload->>'conversation_id' is distinct from p_conversation_id::text or r.payload->>'source_message_id' is distinct from p_source_message_id::text
 then raise exception 'Original request belongs to another action' using errcode='23505';end if;
 return jsonb_build_object('status','recorded','receipt',r.result);
end;$$;

create function public.read_project_chat_content_actions(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
 if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset<0 then raise exception 'Bounded receipt page required' using errcode='22023';end if;
 perform private.require_project_chat_action_owner(p_organization_id,p_project_id,p_conversation_id,null,false);
 select coalesce(jsonb_agg(x.result order by x.created_at desc,x.request_id),'[]') into rows from
  (select result,created_at,request_id from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id
   and actor_id=auth.uid() and payload->>'action'='project_chat_content_v1' and payload->>'conversation_id'=p_conversation_id::text
   order by created_at desc,request_id limit p_limit+1 offset p_offset)x;
 return jsonb_build_object('items',case when jsonb_array_length(rows)>p_limit then rows-p_limit else rows end,'limit',p_limit,'offset',p_offset,'has_more',jsonb_array_length(rows)>p_limit);
end;$$;
revoke all on function public.recover_project_chat_content_action(uuid,uuid,uuid,uuid,uuid),public.read_project_chat_content_actions(uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.recover_project_chat_content_action(uuid,uuid,uuid,uuid,uuid),public.read_project_chat_content_actions(uuid,uuid,uuid,integer,integer) to authenticated;

-- Same schema2 Content Writer fields and limits; draft body is never trimmed.
create function private.validate_project_chat_writer(p_content jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text;limit_value integer;q jsonb;v jsonb;website boolean;
begin
 if jsonb_typeof(p_content) is distinct from 'object' or octet_length(p_content::text)>240000
  or p_content->'schema_version' is distinct from '2'::jsonb or p_content->'variant_number' is distinct from '1'::jsonb
  or coalesce(p_content->>'output_type','') not in ('website_page_copy','blog_article','social_copy','campaign_copy','custom_text')
  or exists(select 1 from jsonb_object_keys(p_content) x where x not in ('schema_version','output_type','working_title','source_architecture_version_id','target_page_key','target_page_path','destination','objective','audience','language','tone','body','cta','exclusions','variant_number','quality_requirements','source_citations'))
 then raise exception 'Complete bounded Content Writer v2 required' using errcode='22023';end if;
 foreach k in array array['working_title','objective','audience','language','body'] loop
  limit_value:=case k when 'working_title' then 160 when 'objective' then 8000 when 'audience' then 8000 when 'language' then 120 else 120000 end;
  if jsonb_typeof(p_content->k) is distinct from 'string' or length(btrim(p_content->>k))<(case when k='working_title' then 3 else 1 end)
   or length(p_content->>k)>limit_value then raise exception 'Required writer field exceeds limits: %',k using errcode='22023';end if;
 end loop;
 foreach k in array array['tone','cta','destination','target_page_key','target_page_path','source_architecture_version_id'] loop
  limit_value:=case k when 'tone' then 1000 when 'cta' then 2000 when 'destination' then 1000 when 'target_page_key' then 1208 when 'target_page_path' then 1200 else 80 end;
  if not(p_content?k) or (p_content->k<>'null'::jsonb and (jsonb_typeof(p_content->k)<>'string' or length(p_content->>k)>limit_value)) then raise exception 'Invalid optional writer field: %',k using errcode='22023';end if;
 end loop;
 website:=p_content->>'output_type'='website_page_copy';
 if website then
  if coalesce(p_content->>'source_architecture_version_id','')!~*'^[a-f0-9-]{36}$' or length(btrim(coalesce(p_content->>'target_page_key','')))=0 then raise exception 'Exact architecture and page required' using errcode='22023';end if;
  perform (p_content->>'source_architecture_version_id')::uuid;
 elsif length(btrim(coalesce(p_content->>'destination','')))=0 or p_content->>'source_architecture_version_id' is not null or p_content->>'target_page_key' is not null or p_content->>'target_page_path' is not null then
  raise exception 'Non-page output requires its explicit destination' using errcode='22023';
 end if;
 if jsonb_typeof(p_content->'exclusions') is distinct from 'array' or jsonb_array_length(p_content->'exclusions')>100
  or exists(select 1 from jsonb_array_elements(p_content->'exclusions') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 500)
  or jsonb_typeof(p_content->'source_citations') is distinct from 'array' or jsonb_array_length(p_content->'source_citations')>100
  or exists(select 1 from jsonb_array_elements(p_content->'source_citations') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 3 and 1000
   or (position('://' in (x#>>'{}'))>0 and btrim(x#>>'{}')!~*'^https?://[^/[:space:]]+([/?#][^[:space:]]*)?$'))
 then raise exception 'Bounded explicit exclusions and citations required' using errcode='22023';end if;
 q:=p_content->'quality_requirements';
 if q='null'::jsonb then return p_content;end if;
 if jsonb_typeof(q) is distinct from 'object' or (select count(*) from jsonb_object_keys(q))<>6
  or not(q?&array['required_sections','length_unit','min_length','max_length','required_terms','require_source_citations'])
  or (q->'length_unit'<>'null'::jsonb and (jsonb_typeof(q->'length_unit') is distinct from 'string' or q->>'length_unit' not in ('words','characters'))) or jsonb_typeof(q->'require_source_citations') is distinct from 'boolean'
 then raise exception 'Explicit writer quality configuration required' using errcode='22023';end if;
 foreach k in array array['required_sections','required_terms'] loop
  if jsonb_typeof(q->k) is distinct from 'array' or jsonb_array_length(q->k)>(case when k='required_sections' then 30 else 100 end)
   or exists(select 1 from jsonb_array_elements(q->k) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and (case when k='required_sections' then 120 else 200 end))
  then raise exception 'Bounded quality requirements required' using errcode='22023';end if;
 end loop;
 foreach k in array array['min_length','max_length'] loop
  if q->k<>'null'::jsonb and (jsonb_typeof(q->k)<>'number' or (q->>k)!~'^[1-9][0-9]{0,5}$') then raise exception 'Positive whole-number quality length required' using errcode='22023';end if;
  if (q->>k)::integer>(case when q->>'length_unit'='words' then 30000 else 120000 end) then raise exception 'Bounded quality length required' using errcode='22023';end if;
 end loop;
 if (q->>'min_length')::integer>(q->>'max_length')::integer
  or (q->>'length_unit' is null and (q->>'min_length' is not null or q->>'max_length' is not null))
  or (q->>'length_unit' is not null and q->>'min_length' is null and q->>'max_length' is null)
 then raise exception 'Consistent quality lengths required' using errcode='22023';end if;
 return p_content;
end;$$;
revoke all on function private.validate_project_chat_writer(jsonb) from public,anon,authenticated,service_role;

create function private.require_project_chat_content_contract(p_org uuid,p_project uuid,p_engagement uuid,p_selection jsonb,p_step text,p_content jsonb,p_service uuid)
returns void language plpgsql set search_path='' as $$
declare c public.project_pipeline_configurations;step jsonb;
begin
 select x.* into c from public.project_pipeline_configurations x where x.organization_id=p_org and x.project_id=p_project
  and x.engagement_id=p_engagement and x.pipeline_group_id=(p_selection->>'group_id')::uuid order by x.revision desc limit 1 for share;
 select s into step from public.pipeline_execution_publications pub join public.pipeline_execution_definitions d on d.id=pub.definition_id and d.organization_id=pub.organization_id
  cross join lateral jsonb_array_elements(d.steps)s where pub.id=c.definition_publication_id and pub.organization_id=p_org and s->>'key'=p_step;
 if step is null or step->>'department_id' is distinct from 'content'
  or step->'stage_contract'->>'artifact_type' is distinct from 'content'
  or step->'stage_contract'->>'output_type' is distinct from p_content->>'output_type'
  or private.valid_pipeline_stage_contract(step->'stage_contract') is distinct from true
 then raise exception 'Selected published step requires a different Content output contract' using errcode='42501';end if;
 if not exists(select 1 from public.engagement_services es where es.id=p_service and es.organization_id=p_org and es.engagement_id=p_engagement
  and es.status='active' and es.service_id=(step->>'service_id')::uuid) then raise exception 'Selected Content step requires its exact active service' using errcode='42501';end if;
end;$$;
revoke all on function private.require_project_chat_content_contract(uuid,uuid,uuid,jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;

-- One selected missing slot, preserving the existing batch namespace and guards.
create function private.create_project_chat_content_slot(p_org uuid,p_project uuid,p_engagement uuid,p_selection jsonb,p_work_choice jsonb,p_service uuid,p_content jsonb)
returns public.work_items language plpgsql set search_path='' as $$
declare p_choice jsonb:=p_work_choice->'stage_slot';partition_read jsonb;context jsonb;stage jsonb;candidate jsonb;choices jsonb;prior jsonb;head private.project_work_commands;
 chosen_key text;chosen_instance integer;dep text;upstream jsonb;mapping jsonb;previous jsonb;option jsonb;
 item public.work_items;rid uuid:=gen_random_uuid();relation_id uuid:=gen_random_uuid();review jsonb;assets jsonb;slot jsonb;
 edges jsonb:='[]';bumps jsonb:='[]';bindings jsonb;outcome jsonb;payload jsonb;count_bumps integer:=0;target_id uuid;
begin
 perform private.project_pipeline_work_scope(p_org,p_project,p_engagement);
 perform private.project_stage_chat_metadata(p_org,p_project,p_selection,'{}');
 partition_read:=public.read_project_stage_partition(p_org,p_project,p_engagement,(p_selection->>'plan_id')::uuid,(p_selection->>'group_id')::uuid,p_selection->'partition');
 context:=private.project_pipeline_work_context(p_org,p_project,p_engagement,(partition_read->>'configuration_id')::uuid,p_selection->'partition','{}');
 if context->'creation_allowed' is distinct from 'true'::jsonb then raise exception 'This partition does not allow new Work' using errcode='55000';end if;
 select r.* into head from private.project_work_commands r where r.organization_id=p_org and r.project_id=p_project
  and r.payload->>'action'='pipeline_work_batch_v1' and r.result->>'batch_key'=context->>'batch_key' order by (r.result->>'revision')::bigint desc limit 1;
 prior:=coalesce(head.result->'bindings','[]');
 select coalesce(jsonb_agg(jsonb_build_object('key',s->>'key','instance',i->'instance')),'[]') into choices
  from jsonb_array_elements(partition_read->'steps')s cross join lateral jsonb_array_elements(s->'items')i
  where s->>'phase'=p_selection->>'phase' and s->>'action'='run' and i->>'work_item_id' is null
   and i->'missing_work'='false'::jsonb and exists(select 1 from jsonb_array_elements(context->'stages')cs where cs->>'key'=s->>'key' and cs->>'department_id'='content');
 if p_choice is null or p_choice='null'::jsonb then
  if jsonb_array_length(choices)<>1 then raise exception 'Choose one exact missing Content slot' using errcode='22023';end if;
  candidate:=choices->0;
 else
  if jsonb_typeof(p_choice)<>'object' or (select count(*) from jsonb_object_keys(p_choice))<>3 or not(p_choice?&array['step_key','instance','dependencies'])
   or jsonb_typeof(p_choice->'dependencies')<>'array' or jsonb_array_length(p_choice->'dependencies')>100 then raise exception 'Exact bounded slot choice required' using errcode='22023';end if;
  select x into candidate from jsonb_array_elements(choices)x where x->>'key'=p_choice->>'step_key' and x->'instance'=p_choice->'instance';
 end if;
 if candidate is null then raise exception 'Selected slot is no longer missing' using errcode='40001';end if;
 chosen_key:=candidate->>'key';chosen_instance:=(candidate->>'instance')::integer;
 if exists(select 1 from jsonb_array_elements(prior)x where x->>'key'=chosen_key and (x->>'instance')::integer=chosen_instance) then raise exception 'Original slot history must be retained' using errcode='40001';end if;
 if jsonb_array_length(prior)>=50 then raise exception 'Bounded slot lineage exceeded' using errcode='54000';end if;
 select x into stage from jsonb_array_elements(context->'stages')x where x->>'key'=chosen_key;
 perform private.require_project_chat_content_contract(p_org,p_project,p_engagement,p_selection,chosen_key,p_content,p_service);
 if not exists(select 1 from public.engagement_services es where es.id=p_service and es.organization_id=p_org and es.engagement_id=p_engagement
  and es.status='active' and es.service_id=(stage->>'service_id')::uuid) then raise exception 'Selected Content slot requires its exact service' using errcode='42501';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_choice->'dependencies','[]'))x where jsonb_typeof(x)<>'object'
  or (select count(*) from jsonb_object_keys(x))<>2 or not(x?&array['step_key','instance'])
  or not exists(select 1 from jsonb_array_elements_text(stage->'depends_on')d where d=x->>'step_key'))
 then raise exception 'Only declared predecessor instances may be chosen' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_choice->'dependencies','[]'))x group by x->>'step_key' having count(*)<>1) then raise exception 'One exact predecessor instance per dependency required' using errcode='22023';end if;
 for dep in select value from jsonb_array_elements_text(stage->'depends_on') loop
  select x into upstream from jsonb_array_elements(context->'stages')x where x->>'key'=dep;
  if upstream->>'action'='reuse' then
   if upstream->'source_reference' is null or upstream->'source_reference'='null'::jsonb then raise exception 'Approved prerequisite material unavailable' using errcode='55000';end if;
   if exists(select 1 from jsonb_array_elements(coalesce(p_choice->'dependencies','[]'))x where x->>'step_key'=dep) then raise exception 'Reused material is not a Work dependency' using errcode='22023';end if;
   continue;
  end if;
  if upstream->>'action' is distinct from 'run' then raise exception 'Required prerequisite is not available' using errcode='55000';end if;
  select x into mapping from jsonb_array_elements(coalesce(p_choice->'dependencies','[]'))x where x->>'step_key'=dep;
  if mapping is null then
   if (upstream->>'quantity')::integer<>1 or (stage->>'quantity')::integer<>1 then raise exception 'Choose the exact prerequisite instance' using errcode='22023';end if;
   mapping:=jsonb_build_object('step_key',dep,'instance',1);
  end if;
  select x into previous from jsonb_array_elements(prior)x where x->>'key'=dep and x->'instance'=mapping->'instance';
  if previous is null then raise exception 'Required prerequisite Work is missing; no prerequisite is created by this action' using errcode='55000';end if;
  select x into option from jsonb_array_elements(context->'work_options')x where x->>'id'=previous->>'work_item_id';
  if option->'material_current' is distinct from 'true'::jsonb or previous->>'source_sha256' is distinct from upstream->>'source_sha256' then raise exception 'Prerequisite material changed' using errcode='40001';end if;
  edges:=edges||jsonb_build_array(jsonb_build_object('key',chosen_key,'instance',chosen_instance,'depends_on_key',dep,'depends_on_instance',mapping->'instance','depends_on_work_item_id',previous->'work_item_id','action','add'));
 end loop;
 -- The canonical P5 path checks normal actor/department authority and deferred provenance.
 item:=public.save_p5_work_item(p_org,null,p_engagement,btrim(p_work_choice->>'title'),p_work_choice->>'description','task','medium','not_started',null,'content',null,null,null,null,null,0,null,auth.uid(),null,'pipeline_plan');
 for mapping in select value from jsonb_array_elements(edges) loop
  bumps:=bumps||jsonb_build_array(jsonb_build_object('work_item_id',item.id,'depends_on_work_item_id',mapping->'depends_on_work_item_id','before',item.row_version+count_bumps,'after',item.row_version+count_bumps+1));
  count_bumps:=count_bumps+1;
 end loop;
 slot:=jsonb_build_object('key',chosen_key,'instance',chosen_instance,'action','create_missing','work_item_id',item.id,'department_id','content','service_id',stage->'service_id','title',item.title,'source_sha256',stage->'source_sha256','initial_row_version',item.row_version,'row_version',item.row_version+count_bumps,'created',true);
 bindings:=prior||jsonb_build_array(slot);
 payload:=jsonb_build_object('action','pipeline_work_batch_v1','engagement_id',p_engagement,'configuration_id',partition_read->'configuration_id','partition',p_selection->'partition','composition','project_chat_single_content_slot_v1','selection',p_selection,'slot',candidate,'dependencies',edges,'_writer_xid8',pg_current_xact_id()::text);
 outcome:=jsonb_build_object('action','pipeline_work_batch_v1','request_id',rid,'organization_id',p_org,'project_id',p_project,'engagement_id',p_engagement,'configuration_id',partition_read->'configuration_id','partition',p_selection->'partition','batch_key',context->'batch_key','revision',(context->>'receipt_revision')::bigint+1,'parent_receipt',context->'receipt_head','review_sha256',encode(sha256(convert_to((payload-'_writer_xid8')::text,'UTF8')),'hex'),'source_sha256',context->'source_sha256','bindings',bindings,'reviewed_slots',jsonb_build_array(slot),'retained',prior,'edges',edges,'material_requirements',jsonb_build_array(stage),'relations',case when jsonb_array_length(context->'asset_options')>0 then jsonb_build_array(jsonb_build_object('work_item_id',item.id,'relation_request_id',relation_id,'revision',1)) else '[]'::jsonb end,'version_bumps',bumps,'atomic',true,'ready_for_execution',false,'ready_for_traffic',false);
 insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result) values(p_org,p_project,auth.uid(),rid,payload,outcome);
 for mapping in select value from jsonb_array_elements(bumps) loop
  perform private.asset_relation_subject(p_org,p_project,'engagement_work_item',item.id,true);
  perform public.mutate_p5_work_item_dependency(p_org,'add',item.id,(mapping->>'depends_on_work_item_id')::uuid,(mapping->>'before')::bigint,auth.uid());
 end loop;
 assets:=context->'asset_options';
 if jsonb_array_length(assets)>0 then
  review:=public.review_project_asset_relations(p_org,p_project,'engagement_work_item',item.id,0,item.row_version+count_bumps,assets);
  perform public.save_project_asset_relations(p_org,p_project,'engagement_work_item',item.id,0,item.row_version+count_bumps,assets,review->>'review_sha256',relation_id);
 end if;
 select wi.* into item from public.work_items wi where wi.id=item.id and wi.organization_id=p_org;
 return item;
end;$$;
revoke all on function private.create_project_chat_content_slot(uuid,uuid,uuid,jsonb,jsonb,uuid,jsonb) from public,anon,authenticated,service_role;

-- Closed, transaction-bound capability for only the reviewed Content link.
-- This does not grant assignment, status, scope, or ordinary direct updates.
create function private.project_chat_content_link_authorized(p_old jsonb,p_new jsonb) returns boolean
language plpgsql set search_path='' as $$
begin
 if auth.uid() is null or p_old is null or p_new is null
  or p_old->>'department_id' is distinct from 'content'
  or (p_new-array['linked_artifact_id','linked_artifact_version_id','row_version','updated_at']) is distinct from
     (p_old-array['linked_artifact_id','linked_artifact_version_id','row_version','updated_at'])
  or (p_new->>'row_version')::bigint is distinct from (p_old->>'row_version')::bigint+1
  or (p_new->>'updated_at')::timestamptz is distinct from now()
 then return false;end if;
 return exists(select 1 from private.project_work_commands r
  join public.artifact_versions v on v.id=(r.result->>'artifact_version_id')::uuid and v.organization_id=r.organization_id
  join public.artifacts a on a.id=v.artifact_id and a.organization_id=r.organization_id
  where r.organization_id=(p_old->>'organization_id')::uuid and r.project_id=(p_old->>'project_id')::uuid and r.actor_id=auth.uid()
   and r.payload->>'action'='project_chat_content_link_v1' and r.payload->>'_writer_xid8'=pg_current_xact_id()::text
   and r.payload->'before'=p_old and r.result->'artifact_id'=p_new->'linked_artifact_id'
   and r.result->'artifact_version_id'=p_new->'linked_artifact_version_id'
   and a.id=(p_new->>'linked_artifact_id')::uuid and a.project_id=r.project_id and a.engagement_id=(p_old->>'engagement_id')::uuid
   and a.artifact_type='content' and v.created_by=auth.uid());
end;$$;
revoke all on function private.project_chat_content_link_authorized(jsonb,jsonb) from public,anon,authenticated,service_role;

-- Preserve the existing trigger body and its subsequent normal-actor checks.
do $guard$
declare original text;corrected text;needle text:='(is_task or not private.pipeline_work_version_bump_authorized(to_jsonb(old),next_row))';
begin
 original:=pg_get_functiondef('private.n1c_guard_assignment()'::regprocedure);
 if md5(original) is distinct from 'e72f08ba077ba88801d8515d3c84f6e2'
  or md5(pg_get_functiondef('private.pipeline_work_version_bump_authorized(jsonb,jsonb)'::regprocedure)) is distinct from '5d847bc86520a8e47bd46c91ebb3ef29'
 then raise exception 'Exact current assignment guard prerequisite changed';end if;
 if position(needle in original)=0 or position('project_chat_content_link_authorized' in original)>0 then
  raise exception 'Expected assignment guard body changed';
 end if;
 corrected:=replace(original,needle,'(is_task or not (private.pipeline_work_version_bump_authorized(to_jsonb(old),next_row) or private.project_chat_content_link_authorized(to_jsonb(old),next_row)))');
 execute corrected;
end;$guard$;

create function public.apply_project_chat_content_action(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid,p_action jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<action_apply>>
declare actor uuid:=auth.uid();engagement uuid;selection jsonb;payload jsonb;prior private.project_work_commands;answer jsonb;
 e public.engagements;w public.work_items;receiver public.work_items;a public.artifacts;v public.artifact_versions;parent_version public.artifact_versions;
 content jsonb;roots uuid[];source_ids uuid[];source_id uuid;source_ref jsonb;metadata jsonb;part jsonb;entry jsonb;page jsonb;approval jsonb;
 work_choice jsonb;receiver_choice jsonb;handoff jsonb:='null';assets jsonb;relations jsonb;rel_review jsonb;relation_id uuid;current_revision bigint;
 selected_step text;
 is_save boolean;new_source boolean;old_timeout text:=current_setting('lock_timeout');namespace text:='project_chat_content_v1';
begin
 if actor is null or p_request_id is null or p_source_message_id is null or jsonb_typeof(p_action) is distinct from 'object'
  or octet_length(p_action::text)>250000 or p_action->'version' is distinct from '1'::jsonb
  or coalesce(p_action->>'kind','') not in ('save_content','handoff_design') or not(p_action?'selection')
 then raise exception 'Original owned bounded reviewed Content action required' using errcode='22023';end if;
 is_save:=p_action->>'kind'='save_content';engagement:=(p_action->>'engagement_id')::uuid;selection:=nullif(p_action->'selection','null'::jsonb);
 if engagement is null or (select count(*) from jsonb_object_keys(p_action))<>12 or exists(select 1 from jsonb_object_keys(p_action)k where k<>all(array['version','kind','engagement_id','selection','source_work']||case when is_save then array['active_service_id','artifact_id','expected_parent_version_id','content','change_summary','ai_use_allowed','data_classification'] else array['artifact_version_id','content_checksum','approval_id','receiving_service_id','receiving_workstream_id','receiving_work','recipient_note'] end)) then raise exception 'Exact action fields required' using errcode='22023';end if;
 perform set_config('lock_timeout','500ms',true);
 -- Strongest shared scope first. All supported page/keyword/config/plan writers
 -- participate in these existing project/engagement locks.
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 perform 1 from public.projects where id=p_project_id and organization_id=p_organization_id and archived_at is null for update;
 if not found then raise exception 'Active exact project required' using errcode='42501';end if;
 perform private.require_project_chat_action_owner(p_organization_id,p_project_id,p_conversation_id,p_source_message_id,false);
 payload:=jsonb_build_object('action',namespace,'conversation_id',p_conversation_id,'source_message_id',p_source_message_id,'command',p_action);
 perform pg_advisory_xact_lock(hashtextextended('project-work:'||p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
 select * into prior from private.project_work_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then
  if prior.project_id is distinct from p_project_id or prior.payload is distinct from payload then raise exception 'Original request owns another exact action' using errcode='23505';end if;
  perform set_config('lock_timeout',old_timeout,true);return prior.result;
 end if;
 perform private.require_project_chat_action_owner(p_organization_id,p_project_id,p_conversation_id,p_source_message_id,true);
 select * into e from public.engagements where id=engagement and organization_id=p_organization_id and project_id=p_project_id and status in ('planning','active') for share;
 if not found or e.brand_id is null then raise exception 'Current branded project engagement required' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||engagement::text,0)) then raise exception 'Work graph is busy' using errcode='40001';end if;
 perform 1 from public.organization_memberships where organization_id=p_organization_id and user_id=actor and status='active' and member_kind='team'
  and (role in ('system_owner','operations_admin','executive') or department_id='content') for share;
 if not found then raise exception 'Current Content department authority required' using errcode='42501';end if;
 work_choice:=p_action->'source_work';new_source:=work_choice->'id'='null'::jsonb;
 if jsonb_typeof(work_choice) is distinct from 'object' or not(work_choice?'id') or (new_source and not is_save) then raise exception 'Exact source Content Work required' using errcode='22023';end if;
 if new_source then
  if not(work_choice?&array['id','title','description']) or exists(select 1 from jsonb_object_keys(work_choice)k where k not in ('id','title','description','stage_slot'))
   or jsonb_typeof(work_choice->'title') is distinct from 'string' or length(btrim(work_choice->>'title')) not between 1 and 240
   or jsonb_typeof(work_choice->'description') is distinct from 'string' or length(work_choice->>'description')>20000
   or (selection is null and work_choice?'stage_slot') then raise exception 'Explicit bounded new source Work required' using errcode='22023';end if;
 else
  if (select count(*) from jsonb_object_keys(work_choice))<>2 or not(work_choice?&array['id','row_version']) then raise exception 'Exact source Work row version required' using errcode='22023';end if;
 end if;
 -- Discover complete pinned artifact identities before taking the source fence.
 if is_save then
  content:=private.validate_project_chat_writer(p_action->'content');
  source_ids:=array(select distinct x::uuid from unnest(private.content_n3_source_ids(content))x);
  if jsonb_typeof(p_action->'ai_use_allowed') is distinct from 'boolean' or coalesce(p_action->>'data_classification','') not in ('public','internal','confidential','restricted')
   or jsonb_typeof(p_action->'change_summary') is distinct from 'string' or length(p_action->>'change_summary')>1000
   or ((p_action->>'artifact_id') is null)<>((p_action->>'expected_parent_version_id') is null) then raise exception 'Exact draft policy and parent required' using errcode='22023';end if;
  if private.project_work_context(p_organization_id,p_project_id,engagement,(p_action->>'active_service_id')::uuid,actor)<>'content' then raise exception 'Exact active Content service required' using errcode='42501';end if;
 else
  select x.* into v from public.artifact_versions x where x.id=(p_action->>'artifact_version_id')::uuid and x.organization_id=p_organization_id;
  if v.id is null or v.content_checksum is distinct from p_action->>'content_checksum' then raise exception 'Exact approved Content version unavailable' using errcode='40001';end if;
  content:=v.content;source_ids:=array(select distinct x::uuid from unnest(private.content_n3_source_ids(content))x);
 end if;
 if selection is not null then
  if selection->>'engagement_id' is distinct from engagement::text then raise exception 'Selected engagement differs' using errcode='42501';end if;
  select array(select distinct z from unnest(source_ids||coalesce(array_agg((x->'reference'->>'artifact_version_id')::uuid) filter(where x->'reference'->>'artifact_version_id' is not null),'{}'::uuid[]))z) into source_ids
   from public.project_pipeline_configurations c join public.project_pipeline_stage_reviews r on r.configuration_id=c.id and r.organization_id=c.organization_id
   cross join lateral jsonb_array_elements(r.resolved_artifacts)x
   where c.organization_id=p_organization_id and c.project_id=p_project_id and c.engagement_id=engagement and c.pipeline_group_id=(selection->>'group_id')::uuid
    and c.revision=(select max(c2.revision) from public.project_pipeline_configurations c2 where c2.organization_id=c.organization_id and c2.project_id=c.project_id and c2.engagement_id=c.engagement_id and c2.pipeline_group_id=c.pipeline_group_id);
 end if;
 -- Expand nested source manifests before locking, then revalidate under the
 -- root/version fence. UNION prevents cycles; the action stays bounded.
 with recursive pinned(id) as (
  select unnest(source_ids)
  union
  select child::uuid from pinned p join public.artifact_versions av on av.id=p.id and av.organization_id=p_organization_id
   cross join lateral unnest(private.content_n3_source_ids(av.content)) child
 ) select coalesce(array_agg(id),'{}'::uuid[]) into source_ids from (select id from pinned limit 21) bounded;
 if cardinality(source_ids)>20 then raise exception 'Bounded explicit source set exceeded' using errcode='54000';end if;
 if (select count(*) from public.artifact_versions x join public.artifacts ar on ar.id=x.artifact_id and ar.organization_id=x.organization_id
  where x.id=any(source_ids) and x.organization_id=p_organization_id and ar.project_id=p_project_id and ar.engagement_id=engagement)<>cardinality(source_ids) then raise exception 'Source versions must belong to this exact project engagement' using errcode='42501';end if;
 select array_agg(distinct root) into roots from (
  select x.artifact_id root from public.artifact_versions x where x.id=any(source_ids) and x.organization_id=p_organization_id
  union select case when is_save then (p_action->>'artifact_id')::uuid else v.artifact_id end)q where root is not null;
 if cardinality(roots)>0 then perform private.lock_project_chat_content_sources(p_organization_id,p_project_id,roots);end if;
 foreach source_id in array source_ids loop
  select x.* into parent_version from public.artifact_versions x where x.id=source_id and x.organization_id=p_organization_id;
  select ar.* into a from public.artifacts ar where ar.id=parent_version.artifact_id and ar.organization_id=p_organization_id;
  source_ref:=private.require_pipeline_approved_artifact(p_organization_id,p_project_id,source_id,a.artifact_type,parent_version.content->>'output_type');
  if exists(select 1 from public.artifact_versions newer join public.artifact_approvals ap on ap.artifact_version_id=newer.id and ap.organization_id=newer.organization_id
   where newer.artifact_id=a.id and newer.organization_id=p_organization_id and newer.version_number>parent_version.version_number and ap.decision='approved') then raise exception 'Pinned source has a newer approved version' using errcode='40001';end if;
 end loop;
 if selection is not null then
  metadata:=private.project_stage_chat_metadata(p_organization_id,p_project_id,selection,'{}');
  part:=public.read_project_stage_partition(p_organization_id,p_project_id,engagement,(selection->>'plan_id')::uuid,(selection->>'group_id')::uuid,selection->'partition');
 end if;
 if not new_source then
  select x.* into w from public.work_items x where x.id=(work_choice->>'id')::uuid and x.organization_id=p_organization_id and x.project_id=p_project_id and x.engagement_id=engagement and x.department_id='content' and x.deleted_at is null for update nowait;
  if w.id is null then raise exception 'Source Content Work unavailable' using errcode='42501';end if;
  if w.row_version is distinct from (work_choice->>'row_version')::bigint or (is_save and w.status='done') then raise exception 'Source Work changed or is complete' using errcode='40001';end if;
  if selection is not null and not exists(select 1 from jsonb_array_elements(part->'steps')s cross join lateral jsonb_array_elements(s->'items')i
   where s->>'phase'=selection->>'phase' and i->>'work_item_id'=w.id::text and i->'material_current'='true'::jsonb and i->'needs_update'='false'::jsonb)
  then raise exception 'Source Work is not current in the selected stage' using errcode='40001';end if;
  if is_save and selection is not null then
   select s->>'key' into selected_step from jsonb_array_elements(part->'steps')s cross join lateral jsonb_array_elements(s->'items')i
    where s->>'phase'=selection->>'phase' and i->>'work_item_id'=w.id::text;
   perform private.require_project_chat_content_contract(p_organization_id,p_project_id,engagement,selection,selected_step,content,(p_action->>'active_service_id')::uuid);
  end if;
 end if;
 if content->>'output_type'='website_page_copy' then
  source_ref:=private.website_approved_source(p_organization_id,p_project_id,(content->>'source_architecture_version_id')::uuid);
  select x into page from jsonb_array_elements(source_ref->'pages')x where x->>'page_key'=content->>'target_page_key';
  if page is null or source_ref->>'engagement_id' is distinct from engagement::text then raise exception 'Exact approved page source unavailable' using errcode='42501';end if;
  if selection is not null and (selection->'partition'->>'kind' is distinct from 'website_page' or selection->'partition'->>'architecture_version_id' is distinct from content->>'source_architecture_version_id'
   or part->'page'->>'page_key' is distinct from content->>'target_page_key') then raise exception 'Content destination differs from selected page' using errcode='42501';end if;
  if is_save then content:=content||jsonb_build_object('target_page_path',page->>'path');
  elsif private.normalize_content_page_path(content->>'target_page_path') is distinct from page->>'path' then raise exception 'Saved page path differs from current exact source' using errcode='40001';end if;
 end if;
 if is_save then
  a:=null;parent_version:=null;
  if p_action->>'artifact_id' is not null then
   select ar.* into a from public.artifacts ar where ar.id=(p_action->>'artifact_id')::uuid and ar.organization_id=p_organization_id and ar.project_id=p_project_id and ar.engagement_id=engagement and ar.brand_id=e.brand_id and ar.artifact_type='content';
   if a.id is null then raise exception 'Exact Content artifact unavailable' using errcode='42501';end if;
   select x.* into parent_version from public.artifact_versions x where x.artifact_id=a.id and x.organization_id=p_organization_id order by x.version_number desc limit 1;
   if parent_version.id is distinct from (p_action->>'expected_parent_version_id')::uuid then raise exception 'Content parent version changed' using errcode='40001';end if;
   if array_position(array['public','internal','confidential','restricted'],p_action->>'data_classification')<array_position(array['public','internal','confidential','restricted'],parent_version.data_classification) then raise exception 'Continuation cannot lower classification' using errcode='42501';end if;
  else
   insert into public.artifacts(organization_id,project_id,brand_id,engagement_id,artifact_type,title,created_by)
    values(p_organization_id,p_project_id,e.brand_id,engagement,'content',content->>'working_title',actor) returning * into a;
  end if;
  insert into public.artifact_versions(organization_id,artifact_id,version_number,parent_version_id,content,content_checksum,change_summary,ai_use_allowed,data_classification,created_by)
   values(p_organization_id,a.id,coalesce(parent_version.version_number,0)+1,parent_version.id,content,encode(sha256(convert_to(content::text,'UTF8')),'hex'),p_action->>'change_summary',(p_action->>'ai_use_allowed')::boolean,p_action->>'data_classification',actor) returning * into v;
  if new_source then
   if selection is not null then w:=private.create_project_chat_content_slot(p_organization_id,p_project_id,engagement,selection,work_choice,(p_action->>'active_service_id')::uuid,content);
   else w:=public.save_p5_work_item(p_organization_id,null,engagement,btrim(work_choice->>'title'),work_choice->>'description','request','medium','not_started',null,'content',null,null,null,null,null,0,null,actor,null,'manual');end if;
  end if;
  insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result)
   values(p_organization_id,p_project_id,actor,gen_random_uuid(),
    jsonb_build_object('action','project_chat_content_link_v1','_writer_xid8',pg_current_xact_id()::text,'before',to_jsonb(w),'original_request_id',p_request_id),
    jsonb_build_object('artifact_id',a.id,'artifact_version_id',v.id));
  w:=public.save_p5_work_item(p_organization_id,w.id,engagement,w.title,w.description,w.work_item_type,w.priority,w.status,w.assignee_id,w.department_id,a.id,v.id,w.linked_engagement_stage_instance_id,w.start_date,w.due_date,w.position,w.parent_work_item_id,actor,w.row_version,w.created_via);
  if content->>'output_type'='website_page_copy' then
   select jsonb_agg(jsonb_build_object('kind','website_page','id',p.id)) into assets
    from public.project_website_pages p join public.artifact_versions av on av.artifact_id=p.architecture_artifact_id and av.organization_id=p.organization_id
    where p.organization_id=p_organization_id and p.project_id=p_project_id and p.engagement_id=engagement and p.brand_id=e.brand_id
     and av.id=(action_apply.content->>'source_architecture_version_id')::uuid and p.page_key=action_apply.content->>'target_page_key';
   if coalesce(jsonb_array_length(assets),0)<>1 then raise exception 'Unique canonical page registration required for Content Work' using errcode='40001';end if;
   relations:=public.read_project_asset_relations(p_organization_id,p_project_id,'engagement_work_item',w.id);
   if exists(select 1 from jsonb_array_elements(relations->'assets')x where not assets @> jsonb_build_array(x)) then raise exception 'Source Content Work has conflicting page or asset relations' using errcode='40001';end if;
   if jsonb_array_length(relations->'assets')=0 then
    current_revision:=(relations->>'revision')::bigint;relation_id:=gen_random_uuid();
    rel_review:=public.review_project_asset_relations(p_organization_id,p_project_id,'engagement_work_item',w.id,current_revision,w.row_version,assets);
    perform public.save_project_asset_relations(p_organization_id,p_project_id,'engagement_work_item',w.id,current_revision,w.row_version,assets,rel_review->>'review_sha256',relation_id);
   end if;
  end if;
  insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
   values(p_organization_id,engagement,'artifact_version_created',actor,jsonb_build_object('record_type','artifact','record_id',a.id,'version_id',v.id,'action','version_created','artifact_type','content','source','manual','conversation_id',p_conversation_id,'source_message_id',p_source_message_id));
 else
  select ar.* into a from public.artifacts ar where ar.id=v.artifact_id and ar.organization_id=p_organization_id and ar.project_id=p_project_id and ar.engagement_id=engagement and ar.artifact_type='content';
  if a.id is null or w.linked_artifact_id is distinct from a.id or w.linked_artifact_version_id is distinct from v.id then raise exception 'Source Work must retain the exact approved Content output' using errcode='40001';end if;
  approval:=private.require_pipeline_approved_artifact(p_organization_id,p_project_id,v.id,'content',v.content->>'output_type');
  if approval->>'approval_id' is distinct from p_action->>'approval_id' or exists(select 1 from public.artifact_versions newer join public.artifact_approvals ap on ap.artifact_version_id=newer.id and ap.organization_id=newer.organization_id where newer.organization_id=p_organization_id and newer.artifact_id=a.id and newer.version_number>v.version_number and ap.decision='approved') then raise exception 'Current exact approved Content required' using errcode='40001';end if;
  perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id
   where es.id=(p_action->>'receiving_service_id')::uuid and es.organization_id=p_organization_id and es.engagement_id=engagement and es.status='active' and sc.is_active and sc.department_id='design' for share of es,sc;
  if not found then raise exception 'Current exact Design service required' using errcode='42501';end if;
  perform 1 from public.workstreams where id=(p_action->>'receiving_workstream_id')::uuid and organization_id=p_organization_id and project_id=p_project_id and department_id='design' and status='active' for share;
  if not found then raise exception 'Current exact Design workstream required' using errcode='42501';end if;
  receiver_choice:=p_action->'receiving_work';
  if jsonb_typeof(receiver_choice) is distinct from 'object' or not(receiver_choice?'id') then raise exception 'Exact receiving Work choice required' using errcode='22023';end if;
  if receiver_choice->'id'='null'::jsonb then
   if (select count(*) from jsonb_object_keys(receiver_choice))<>3 or not(receiver_choice?&array['id','title','description']) then raise exception 'Exact new receiving Work fields required' using errcode='22023';end if;
   if jsonb_typeof(receiver_choice->'title') is distinct from 'string' or length(btrim(receiver_choice->>'title')) not between 1 and 240 or jsonb_typeof(receiver_choice->'description') is distinct from 'string' or length(receiver_choice->>'description')>20000 then raise exception 'Explicit receiving Work required' using errcode='22023';end if;
   receiver:=public.save_p5_work_item(p_organization_id,null,engagement,btrim(receiver_choice->>'title'),receiver_choice->>'description','request','medium','not_started',null,'design',null,null,null,null,null,0,null,actor,null,'manual');
  else
   if (select count(*) from jsonb_object_keys(receiver_choice))<>2 or not(receiver_choice?&array['id','row_version']) then raise exception 'Exact receiving Work version required' using errcode='22023';end if;
   select x.* into receiver from public.work_items x where x.id=(receiver_choice->>'id')::uuid and x.organization_id=p_organization_id and x.project_id=p_project_id and x.engagement_id=engagement and x.department_id='design' and x.deleted_at is null for update nowait;
   if receiver.id is null or receiver.id=w.id then raise exception 'Distinct exact receiving Design Work required' using errcode='42501';end if;
   if receiver.row_version is distinct from (receiver_choice->>'row_version')::bigint or receiver.status='done' then raise exception 'Receiving Work changed or is complete' using errcode='40001';end if;
  end if;
  -- Relationship writers take the same project lock, so this snapshot cannot
  -- change between eligibility, association and the canonical N3 write.
  assets:=public.read_project_asset_relations(p_organization_id,p_project_id,'engagement_work_item',w.id)->'assets';
  if content->>'output_type'='website_page_copy' then
   select jsonb_agg(jsonb_build_object('kind','website_page','id',p.id)) into relations
    from public.project_website_pages p join public.artifact_versions av on av.artifact_id=p.architecture_artifact_id and av.organization_id=p.organization_id
    where p.organization_id=p_organization_id and p.project_id=p_project_id and p.engagement_id=engagement and p.brand_id=e.brand_id
     and av.id=(action_apply.content->>'source_architecture_version_id')::uuid and p.page_key=action_apply.content->>'target_page_key';
   if coalesce(jsonb_array_length(relations),0)<>1 then raise exception 'Unique canonical page registration required for handoff' using errcode='40001';end if;
   if exists(select 1 from jsonb_array_elements(assets)x where not relations @> jsonb_build_array(x)) then raise exception 'Source Work has conflicting page or asset relations' using errcode='40001';end if;
   assets:=relations;
  end if;
  relations:=public.read_project_asset_relations(p_organization_id,p_project_id,'engagement_work_item',receiver.id);
  if exists(select 1 from jsonb_array_elements(relations->'assets')x where not assets @> jsonb_build_array(x)) then raise exception 'Receiving Work has conflicting page or asset relations' using errcode='40001';end if;
  if jsonb_array_length(relations->'assets')=0 and jsonb_array_length(assets)>0 then
   current_revision:=(relations->>'revision')::bigint;relation_id:=gen_random_uuid();
   rel_review:=public.review_project_asset_relations(p_organization_id,p_project_id,'engagement_work_item',receiver.id,current_revision,receiver.row_version,assets);
   perform public.save_project_asset_relations(p_organization_id,p_project_id,'engagement_work_item',receiver.id,current_revision,receiver.row_version,assets,rel_review->>'review_sha256',relation_id);
  end if;
  if jsonb_typeof(p_action->'recipient_note') is distinct from 'string' or length(p_action->>'recipient_note')>4000 then raise exception 'Bounded handoff note required' using errcode='22023';end if;
  perform public.confirm_content_n3_handoff(p_organization_id,p_project_id,p_request_id,v.id,v.content_checksum,(p_action->>'approval_id')::uuid,(p_action->>'receiving_service_id')::uuid,(p_action->>'receiving_workstream_id')::uuid,'engagement_work_item',receiver.id,p_action->>'recipient_note');
  handoff:=jsonb_build_object('request_id',p_request_id,'approval_id',p_action->>'approval_id','receiving_service_id',p_action->>'receiving_service_id','receiving_workstream_id',p_action->>'receiving_workstream_id','receiving_work_item_id',receiver.id);
 end if;
 -- Preserve the original journey anchor on subsequent saves in the same Chat.
 if not exists(select 1 from private.project_content_journeys where conversation_id=p_conversation_id and work_item_id=w.id) then
  perform public.bind_project_content_journey(p_organization_id,p_project_id,p_conversation_id,p_source_message_id,w.id);
 elsif not exists(select 1 from private.project_content_journeys where conversation_id=p_conversation_id and work_item_id=w.id and organization_id=p_organization_id and project_id=p_project_id and actor_id=actor) then raise exception 'Original journey ownership differs' using errcode='42501';end if;
 answer:=jsonb_build_object('version',1,'request_id',p_request_id,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',engagement,'conversation_id',p_conversation_id,'source_message_id',p_source_message_id,'actor_id',actor,'kind',p_action->>'kind','status',case when is_save then 'content_saved' else 'handoff_recorded' end,'selection',p_action->'selection','source_work',jsonb_build_object('id',w.id,'row_version',w.row_version),'output',jsonb_build_object('artifact_id',a.id,'artifact_version_id',v.id,'version_number',v.version_number,'content_checksum',v.content_checksum),'handoff',handoff,'review_required',is_save);
 insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result) values(p_organization_id,p_project_id,actor,p_request_id,payload,answer);
 perform set_config('lock_timeout',old_timeout,true);return answer;
exception when lock_not_available or deadlock_detected then raise exception 'Action source or Work is busy; preserve the original request for read-only recovery' using errcode='40001';
end;$$;
revoke all on function public.apply_project_chat_content_action(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_project_chat_content_action(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated;

commit;
