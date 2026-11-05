"""Progress-specific synthetic base; called by the owned PG fixture runner.
Actual installed stage reader/context/approval/current-stage functions execute.
Unchanged architecture/foundation/normalization lower providers are disclosed fixtures."""
import json,hashlib
def verify(repo,parent,qa,run,raw,value,actor,u,q,j,binding):
 checks=[]
 def passed(s):checks.append(s)
 def denied(sql,code):
  r=raw(sql);assert r.returncode and code in r.stderr,(r.stdout,r.stderr)
 run("""alter table engagements add column brand_id uuid;
 create table public.project_pipeline_configurations(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,pipeline_group_id uuid,definition_publication_id uuid,revision integer,selected_steps jsonb,selected_steps_sha256 text,configured_by uuid,request_id uuid);
 create table public.project_pipeline_stage_reviews(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,configuration_id uuid,reviewed_by uuid,request_id uuid,review_sha256 text,decisions jsonb,resolved_artifacts jsonb,foundation_context jsonb);
 create table public.project_website_pages(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,brand_id uuid,architecture_artifact_id uuid,page_key text,initial_path text,initial_architecture_version_id uuid);
 create table public.project_campaign_assets(id uuid primary key,organization_id uuid,project_id uuid,brand_id uuid,source_kind text,source_version_id uuid,source_reference_checksum text);
 create table public.recurring_work_occurrences(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,plan_version_id uuid,engagement_service_id uuid,service_id uuid,period_start date,period_end date,timezone text,status text);
 create table private.project_work_commands(organization_id uuid,project_id uuid,actor_id uuid,request_id uuid,payload jsonb,result jsonb,created_at timestamptz default clock_timestamp());
 create table public.work_items(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,department_id text,status text,row_version bigint,deleted_at timestamptz,recurring_occurrence_id uuid,linked_artifact_id uuid,linked_artifact_version_id uuid);
 create table private.project_asset_relation_revisions(organization_id uuid,project_id uuid,subject_kind text,subject_id uuid,revision bigint,assets jsonb);
 create table public.work_item_dependencies(organization_id uuid,work_item_id uuid,depends_on_work_item_id uuid);
 create table public.service_catalog(id uuid primary key,organization_id uuid,department_id text,is_active boolean);
 create table public.engagement_services(id uuid primary key,organization_id uuid,engagement_id uuid,service_id uuid,status text);
 create table public.project_service_scopes(id uuid primary key,organization_id uuid,project_id uuid,service_id uuid,status text);
 create table public.artifacts(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,brand_id uuid,artifact_type text);
 create table public.artifact_versions(id uuid primary key,organization_id uuid,artifact_id uuid,version_number integer,content jsonb,content_checksum text,ai_use_allowed boolean);
 create table public.artifact_approvals(id uuid primary key,organization_id uuid,artifact_id uuid,artifact_version_id uuid,engagement_id uuid,decision text,approved_at timestamptz);
 create table public.artifact_approval_requests(id uuid primary key,organization_id uuid,artifact_version_id uuid,status text,created_at timestamptz);
 create table private.project_page_keyword_target_revisions(organization_id uuid,project_id uuid,page_id uuid,revision bigint,strategy_version_id uuid,source_checksum text,targets jsonb,created_at timestamptz);
 create table public.project_website_page_seo_links(organization_id uuid,project_id uuid,page_id uuid,link_number bigint,tracked_page_id uuid,architecture_version_id uuid);
 create function private.pipeline_foundation_context(uuid,uuid,uuid,uuid,boolean) returns jsonb language sql as $$select null::jsonb$$;
 create function private.normalize_content_page_path(text) returns text language sql immutable as $$select trim(both '/' from $1)$$;
 create function private.website_approved_source(p_org uuid,p_project uuid,p_version uuid) returns jsonb language plpgsql as $$
 declare e public.engagements;begin
 select * into e from public.engagements where organization_id=p_org and project_id=p_project limit 1;
 if current_setting('qa.source_changed',true)='yes' then raise exception 'Fixture source changed' using errcode='55000';end if;
 return jsonb_build_object('engagement_id',e.id,'brand_id',e.brand_id,'reference',jsonb_build_object('artifact_id',(select artifact_id from public.artifact_versions where id=p_version),'artifact_version_id',p_version,'content_checksum',repeat('a',64)),
 'pages',(select jsonb_agg(jsonb_build_object('page_key',page_key,'path',initial_path)) from public.project_website_pages where organization_id=p_org and project_id=p_project));
 end;$$;""")
 functions=json.loads((parent/'function-preimages.json').read_text(encoding='utf8'))+json.loads((parent/'additional-function-preimages.json').read_text(encoding='utf8'))
 for f in functions:
  if f['proname'] in ['current_pipeline_stage_review','require_pipeline_approved_artifact','project_pipeline_work_context']:run(f['definition'])
 migration=(repo/'supabase/migrations/20261106083617_project_stage_progress_reads.sql').read_text(encoding='utf8')
 run(migration)
 passed('progress migration installs against exact original Work helper; existing writer unchanged')
 config=u(21);request=u(22);review_id=u(23);brand=u(24);arch=u(25);av=u(26);page=u(27);other=u(28)
 selected=[{'key':'draft','quantity':2}];decisions=[{'key':'draft','action':'run','quantity':2}]
 snapshot=value('select snapshot from private.project_delivery_plan_versions where id='+q(u(10)))
 snapshot['stage_bindings']={'version':1,'request_id':u(31),'bindings':[binding]}
 # Append synthetic saved binding through the existing history shape, preserving prior row.
 run(f"""update engagements set brand_id={q(brand)};
 insert into private.project_delivery_plan_versions(id,organization_id,project_id,engagement_id,version_number,parent_version_id,snapshot,request_id,request_sha256,created_by)
 values({q(u(30))},{q(u(1))},{q(u(2))},{q(u(3))},2,{q(u(10))},{j(snapshot)},{q(u(31))},{q('b'*64)},{q(u(4))});
 insert into project_pipeline_configurations values({q(config)},{q(u(1))},{q(u(2))},{q(u(3))},{q(u(6))},{q(u(7))},1,{j(selected)},encode(sha256(convert_to({j(selected)}::text,'UTF8')),'hex'),{q(u(4))},{q(request)});
 insert into project_pipeline_stage_reviews values({q(review_id)},{q(u(1))},{q(u(2))},{q(u(3))},{q(config)},{q(u(4))},{q(request)},{q('c'*64)},{j(decisions)},'[]',null);
 insert into service_catalog values({q(u(12))},{q(u(1))},'content',true);
 insert into engagement_services values({q(u(33))},{q(u(1))},{q(u(3))},{q(u(12))},'active');
 insert into project_service_scopes values({q(u(34))},{q(u(1))},{q(u(2))},{q(u(12))},'active');
 insert into artifacts values({q(arch)},{q(u(1))},{q(u(2))},{q(u(3))},{q(brand)},'website_architecture');
 insert into artifact_versions values({q(av)},{q(u(1))},{q(arch)},1,'{{}}',{q('a'*64)},false);
 insert into project_website_pages values({q(page)},{q(u(1))},{q(u(2))},{q(u(3))},{q(brand)},{q(arch)},'home','home',{q(av)}),({q(other)},{q(u(1))},{q(u(2))},{q(u(3))},{q(brand)},{q(arch)},'about','about',{q(av)});
 insert into project_website_pages select gen_random_uuid(),{q(u(1))},{q(u(2))},{q(u(3))},{q(brand)},{q(arch)},'other-'||n,'other-'||n,{q(av)}::uuid from generate_series(1,68) n;""")
 def listing(offset=0):return value(actor('select public.list_project_stage_partitions('+','.join([q(u(1)),q(u(2)),q(u(3)),q(u(30)),q(u(6)),q('website_page'),str(offset),'25'])+')',5))
 pages=[listing(i) for i in [0,25,50]]
 assert [len(x['items']) for x in pages]==[25,25,20] and all(x['total']==70 for x in pages) and not pages[-1]['has_more']
 assert len({x['partition']['id'] for p in pages for x in p['items']})==70
 passed('bounded canonical page pagination covers all 70 identities without duplicates or claiming global completion')
 def partition(pid=page):return {'kind':'website_page','id':pid,'architecture_version_id':av}
 def read(pid=page,who=5,extra=''):
  return value(actor(extra+'select public.read_project_stage_partition('+','.join([q(u(1)),q(u(2)),q(u(3)),q(u(30)),q(u(6)),j(partition(pid))])+')',who))
 h=value(actor('select public.read_project_stage_plan('+','.join(map(q,[u(1),u(2),u(3)]))+')',5))
 assert h['can_manage'] is False and h['bindings']==[binding]
 first=read();assert first['state']=='current' and len(first['steps'][0]['items'])==2 and all(not i['work_done'] and not i['output_approved'] for i in first['steps'][0]['items'])
 passed('ordinary current team member reads exact saved mapping and uncreated requirements without manager writer authority')
 c=value(actor('select private.project_stage_partition_context('+','.join([q(u(1)),q(u(2)),q(u(3)),q(config),j(partition()),"'{}'::uuid[]"])+')',4,'postgres'))
 artifact=u(40);version=u(41);approval=u(42);content={'pages':[{'page_path':'home','page_key':'home','text':'Fixture'}]}
 slots=[{'key':'draft','instance':i,'work_item_id':u(50+i),'source_sha256':c['stages'][0]['source_sha256']} for i in [1,2]]
 result={'batch_key':c['batch_key'],'revision':1,'bindings':slots,'configuration_id':config,'partition':partition(),'engagement_id':u(3)}
 run(f"""insert into artifacts values({q(artifact)},{q(u(1))},{q(u(2))},{q(u(3))},{q(brand)},'content');
 insert into artifact_versions values({q(version)},{q(u(1))},{q(artifact)},1,{j(content)},encode(sha256(convert_to({j(content)}::text,'UTF8')),'hex'),false);
 insert into artifact_approvals values({q(approval)},{q(u(1))},{q(artifact)},{q(version)},{q(u(3))},'approved',clock_timestamp());
 insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result) values({q(u(1))},{q(u(2))},{q(u(4))},{q(u(60))},'{{"action":"pipeline_work_batch_v1"}}',{j(result)});""")
 for i in [1,2]:
  run(f"""insert into work_items values({q(u(50+i))},{q(u(1))},{q(u(2))},{q(u(3))},'content','done',1,null,null,{q(artifact)},{q(version)});
  insert into private.project_asset_relation_revisions values({q(u(1))},{q(u(2))},'engagement_work_item',{q(u(50+i))},1,{j([{'kind':'website_page','id':page}])});""")
 good=read();assert all(i['work_done'] and i['output_approved'] and i['material_current'] for i in good['steps'][0]['items'])
 assert all(not i['work_done'] for i in read(other)['steps'][0]['items'])
 (qa/'actual-progress-header.json').write_text(json.dumps(h,indent=2)+'\n',encoding='utf8');(qa/'actual-progress-partition.json').write_text(json.dumps(good,indent=2)+'\n',encoding='utf8')
 passed('exact homepage Work/output approval independent of 69 other registered pages; actual RPC DTOs retained')
 # Normal Content Writer v2 has one explicit page identity, not legacy pages[].
 writer={'schema_version':2,'output_type':'website_page_copy','source_architecture_version_id':av,'target_page_key':'home','target_page_path':'home','body':'Fixture page copy'}
 def set_content(payload):
  run(f"update artifact_versions set content={j(payload)},content_checksum=encode(sha256(convert_to({j(payload)}::text,'UTF8')),'hex') where id={q(version)}")
 # Match the normal writer's published output contract; keep strict existing helper unchanged.
 legacy_steps=value('select steps from pipeline_execution_definitions where id='+q(u(9)))
 writer_steps=json.loads(json.dumps(legacy_steps));writer_steps[0]['stage_contract']['output_type']='website_page_copy'
 def set_steps(steps):
  run(f"update pipeline_execution_definitions set steps={j(steps)},steps_sha256=encode(sha256(convert_to({j(steps)}::text,'UTF8')),'hex') where id={q(u(9))}")
 set_steps(writer_steps)
 set_content(writer)
 assert all(i['output_approved'] for i in read()['steps'][0]['items']), 'normal writer v2 exact approved page must count'
 for field,bad in [('source_architecture_version_id',u(99)),('target_page_key','about'),('target_page_path','about'),('schema_version',3),('output_type','blog_article')]:
  set_content(dict(writer,**{field:bad}))
  assert all(not i['output_approved'] for i in read()['steps'][0]['items']), field
 for field in ['source_architecture_version_id','target_page_key','target_page_path']:
  missing=dict(writer);missing.pop(field);set_content(missing)
  assert all(not i['output_approved'] for i in read()['steps'][0]['items']), field
 set_content(dict(writer,target_page_key='about',pages=content['pages']))
 assert all(not i['output_approved'] for i in read()['steps'][0]['items']), 'writer cannot fall back to legacy pages'
 set_steps(legacy_steps)
 set_content(content)
 assert all(i['output_approved'] for i in read()['steps'][0]['items'])
 passed('normal writer v2 exact architecture/key/path approved; mismatched or missing identity denied; no legacy fallback; legacy preserved')
 if (repo/'supabase/migrations/20261106092215_project_stage_chat_context.sql').exists():
  from project_stage_message_fixture import verify as verify_message
  verify_message(repo,parent,qa,run,raw,value,actor,u,q,j,h,good)
 run(f"update artifact_approvals set decision='changes_requested' where id={q(approval)}")
 noapproval=read();assert all(not i['output_approved'] and i['output']['artifact_version_id']==version for i in noapproval['steps'][0]['items'])
 run(f"update artifact_approvals set decision='approved' where id={q(approval)}")
 run(f"insert into artifact_approval_requests values({q(u(61))},{q(u(1))},{q(version)},'pending',clock_timestamp())")
 assert all(not i['output_approved'] for i in read()['steps'][0]['items'])
 run(f"update artifact_approval_requests set status='completed' where id={q(u(61))}")
 passed('requested changes and unresolved governed review retain identity but cannot count approved output')
 wrong={'pages':[{'page_path':'about','page_key':'about'}]}
 run(f"update artifact_versions set content={j(wrong)},content_checksum=encode(sha256(convert_to({j(wrong)}::text,'UTF8')),'hex') where id={q(version)}")
 assert all(not i['output_approved'] for i in read()['steps'][0]['items'])
 run(f"update artifact_versions set content={j(content)},content_checksum=encode(sha256(convert_to({j(content)}::text,'UTF8')),'hex') where id={q(version)}")
 passed('an approved content version for another page does not complete homepage content')
 run(f"update private.project_asset_relation_revisions set assets='[]' where subject_id={q(u(51))}")
 assert read()['steps'][0]['items'][0]['material_current'] is False
 run(f"update private.project_asset_relation_revisions set assets={j([{'kind':'website_page','id':page}])} where subject_id={q(u(51))}")
 passed('removed exact page relation cannot retain current material status')
 unavailable=read(extra="set qa.source_changed='yes';")
 assert unavailable['state']=='source_unavailable_or_changed' and all(i['work_done'] and i['output']['artifact_version_id']==version and not i['material_current'] and not i['output_approved'] for i in unavailable['steps'][0]['items'])
 passed('changed/unavailable source preserves historical Work and exact output identity without claiming current completion')
 run(f"insert into work_item_dependencies values({q(u(1))},{q(u(51))},{q(u(99))})")
 assert read()['steps'][0]['items'][0]['dependency_blocked']
 passed('missing declared prerequisite is blocked; no all-page dependency inferred')
 denied(actor('select public.read_project_stage_partition('+','.join([q(u(1)),q(u(2)),q(u(3)),q(u(30)),q(u(6)),j(partition(u(99)))])+')',5),'42501')
 denied(actor('select public.read_project_stage_partition('+','.join([q(u(1)),q(u(2)),q(u(3)),q(u(10)),q(u(6)),j(partition())])+')',5),'40001')
 run(f"update organization_memberships set status='inactive' where user_id={q(u(5))}")
 denied(actor('select public.read_project_stage_plan('+','.join(map(q,[u(1),u(2),u(3)]))+')',5),'42501')
 passed('foreign partition, superseded plan and revoked member fail at normal authenticated entry')
 result={'status':'passed','count':len(checks),'checks':checks,'migration_sha256':hashlib.sha256(migration.encode()).hexdigest(),'boundary':'Actual reader/current-stage/approval/context code and actual scope helpers. Minimal synthetic tables and unchanged architecture/foundation/path-normalization providers. No PostgREST/signed-in/provider or full production RLS acceptance.'}
 (qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8');print(json.dumps(result))
