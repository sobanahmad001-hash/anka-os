"""Owned PG17: actual setup/planners/immutable writer with synthetic base records.
No production writes, template publication, downstream execution or readiness claim.
"""
from pathlib import Path
import sys,json,subprocess,textwrap
fixture=Path(__file__).with_name('check-project-chat-delivery-native.py')
source=fixture.read_text(encoding='utf-8');assert source.count('initial=setup();before=')==1
prefix=source.split('initial=setup();before=',1)[0].replace('port=29932','port=29962',1)
prefix=prefix.replace('a=p.parse_args()',"p.add_argument('--review-corrections-only',action='store_true');a=p.parse_args()",1)
qa_arg=Path(sys.argv[sys.argv.index('--qa')+1]).resolve();assert not(qa_arg/'data').exists(),'Use a new owned QA directory'
try:
 exec(compile(prefix,str(fixture),'exec'),globals())
 # psql rows use LF; Unicode NEL/line separators inside valid JSON are data.
 def value(sql,**kwargs):return json.loads(next(line for line in reversed(call(sql,**kwargs).stdout.split('\n')) if line.strip()))
 v2=Path(__file__).with_name('check-service-line-metadata-native.py').read_text(encoding='utf-8')
 first=v2.index(' run("alter table public.project_service_scopes');last=v2.index(' rights=run(',first)
 exec(compile(textwrap.dedent(v2[first:last]),'v2-fixture-preparation','exec'),globals())
 run((repo/'supabase/migrations/20261102140042_reviewed_service_line_metadata.sql').read_text(encoding='utf-8'))
 brand_fixture=Path(__file__).with_name('check-branding-pipeline-native.py').read_text(encoding='utf-8')
 first=brand_fixture.index(' run("""alter table public.project_pipeline_groups');last=brand_fixture.index(' rights=run(',first)
 exec(compile(textwrap.dedent(brand_fixture[first:last]),'kind-fixture-preparation','exec'),globals())
 run((repo/'supabase/migrations/20261102161752_project_branding_pipeline_kind.sql').read_text(encoding='utf-8'))
 reader_fixture=Path(__file__).with_name('check-brand-foundation-native.py').read_text(encoding='utf-8')
 first=reader_fixture.index(' brand,client=');last=reader_fixture.index(' def context(',first)
 exec(compile('\n'.join(line[1:] if line.startswith((' run(', ' brand,client=')) else line for line in reader_fixture[first:last].splitlines()),'canonical-source-fixture-preparation','exec'),globals())
 acl_sql="select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'acl',p.proacl) order by p.oid) from pg_proc p where p.proname in ('apply_project_setup','preview_combined_setup','build_service_project_plan','build_combined_service_plan','apply_project_delivery_plan','review_project_delivery_setup')"
 before_acl=run(acl_sql).stdout.strip()
 run((repo/'supabase/migrations/20261102172337_project_foundation_plan_binding.sql').read_text(encoding='utf-8'))
 assert before_acl==run(acl_sql).stdout.strip();passed('existing setup and planner ACLs unchanged')
 assert run("select has_function_privilege('anon','private.resolve_project_foundation(uuid,uuid,jsonb)','execute') or has_function_privilege('authenticated','private.resolve_project_foundation(uuid,uuid,jsonb)','execute') or has_function_privilege('service_role','private.resolve_project_foundation(uuid,uuid,jsonb)','execute')").stdout.strip()=='f'
 passed('resolver closed to all client and service roles')
 if a.review_corrections_only:
  ws_codes=[9,10,11,12,13,32,160,5760,*range(8192,8203),8232,8233,8239,8287,12288,65279]
  cases=[]
  def minimum(guidance,reason):
   return {**plan,'foundation':{'version':1,'engagement_id':engagement,'written':{'mode':'minimum','guidance':guidance,'reason':reason},'visual':None}}
  # One authenticated direct-RPC batch checks every ECMAScript trim character
  # in both fields. Each expected denial rolls back its subtransaction.
  batch=f"""do $qa$ declare field text;cp integer;proposal jsonb;denied boolean;begin
   foreach field in array array['guidance','reason'] loop
    foreach cp in array array[{','.join(map(str,ws_codes))}] loop
     proposal:={j(minimum('valid guidance','valid reason'))};
     proposal:=jsonb_set(proposal,array['foundation','written',field],to_jsonb(chr(cp)||chr(cp)));
     denied:=false;
     begin perform public.review_project_delivery_setup({q(org)},{q(project)},{q(setup()['token'])},proposal,{q(engagement)},'{{}}');exception when invalid_parameter_value then denied:=true;end;
     if not denied then raise exception 'Whitespace-only direct RPC admitted field %, codepoint %',field,cp;end if;
    end loop;
   end loop;
  end;$qa$;select jsonb_build_object('whitespace_denials',{len(ws_codes)*2});"""
  assert value(batch)['whitespace_denials']==len(ws_codes)*2
  passed(f'all {len(ws_codes)*2} whitespace-only direct RPC field/codepoint cases deny22023')
  ws=''.join(map(chr,ws_codes))
  value1=value(preview(minimum(ws+'guidance'+ws,ws+'reason'+ws)))['draft']['foundation']['intent']['written']
  assert value1['guidance']=='guidance' and value1['reason']=='reason'
  passed('mixed tabs/newlines/Unicode edge whitespace normalizes exactly like ECMAScript trim')
  astral=chr(0x1f642)
  for guidance,reason in [('x'*4000,'r'*1000),('\u6f22'*4000,'r'*1000),(astral*2000,astral*500),('\u0085','\u200b')]:
   result=value(preview(minimum(guidance,reason)))['draft']['foundation']['intent']['written']
   assert result['guidance']==guidance and result['reason']==reason
  passed('ASCII/BMP/astral exact UTF16 boundaries and non-ECMAScript whitespace match client acceptance')
  for guidance,reason in [('x'*4001,'r'),(' '+('x'*4000),'r'),('g','r'*1001),('g',' '+('r'*1000)),(astral*2001,'r'),('g',astral*501),(' '+astral*2000,'r')]:denied(preview(minimum(guidance,reason)),'22023')
  passed('raw UTF16 limits reject oversized whitespace-padded and astral guidance/reason before normalization')
  assert run('select count(*) from private.project_delivery_plan_versions').stdout.strip()=='0'
  passed('all correction probes use actual read-only review RPC; no canonical plan or service writes')
  import hashlib
  result={'count':len(checks),'checks':checks,'whitespace_rpc_cases':len(ws_codes)*2,'migration_sha256':hashlib.sha256((repo/'supabase/migrations/20261102172337_project_foundation_plan_binding.sql').read_text(encoding='utf-8').encode()).hexdigest(),'boundary':'Synthetic canonical base and templates; actual authenticated review/setup/planner/foundation resolver. Focused correction checks only; previous transaction/race/rollback suite retained.'}
  (qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result));sys.exit(0)
 def output(n,kind):
  aid,vid,approval=uid(2000+n),uid(3000+n),uid(4000+n)
  run(f"insert into public.artifacts values({q(aid)},{q(org)},{q(project)},{q(engagement)},{q(brand)},{q(kind)},'Guideline');insert into public.artifact_versions values({q(vid)},{q(org)},{q(aid)},1,repeat('a',64),now(),'{{}}');insert into public.artifact_approvals values({q(approval)},{q(org)},{q(aid)},{q(vid)},{q(engagement)},'approved',{q(actor)},now());")
  return {'mode':'approved_version','artifact_id':aid,'version_id':vid,'checksum':'a'*64,'approval_id':approval}
 written,visual=output(1,'content'),output(2,'design_system')
 intent={'version':1,'engagement_id':engagement,'written':written,'visual':visual}
 proposal={**plan,'foundation':intent}
 def current_proposal(foundation='inherit'):
  s=setup();row=next((r for r in s['scopes'] if r['service_id']==design),None)
  p={**plan,'items':[{**item(design,12),'expected_revision':row['revision'] if row else None}]}
  if foundation!='inherit':p['foundation']=foundation
  return s,p
 initial=setup();review=value(preview(proposal));f=review['draft']['foundation']
 assert f['pins']['written']['approval_id']==written['approval_id'] and f['pins']['visual']['version_id']==visual['version_id']
 assert f['ready_for_preparation'] is False and f['ready_for_traffic'] is False and f['sources_available'] is True
 assert run('select count(*) from private.project_delivery_plan_versions').stdout.strip()=='0'
 passed('zero-write review resolves exact role/approval/checksum pins without claiming execution readiness')
 saved=value(combined(review,proposal,uid(5001),initial['token']))
 assert saved['delivery']['snapshot']['foundation']==f and setup()['state']['plan']['foundation']==f
 old_id=saved['delivery']['id'];old_digest=run(f"select md5(snapshot::text) from private.project_delivery_plan_versions where id={q(old_id)}").stdout.strip()
 passed('single actual composed transaction binds foundation in existing immutable setup and plan records')
 assert saved==value(combined(review,proposal,uid(5001),initial['token']))==value(recover(uid(5001)))
 assert run('select count(*) from private.project_delivery_plan_versions').stdout.strip()=='1'
 passed('original UUID replay and recovery create no duplicate plan or pipeline group')
 current,p=current_proposal();inherit=value(preview(p));assert inherit['draft']['foundation']==f
 saved2=value(combined(inherit,p,uid(5002),current['token']));assert saved2['delivery']['snapshot']['foundation']==f
 passed('legacy callers preserve an existing binding rather than erasing it')
 # A newer unapproved version never replaces the pinned approved one.
 run(f"insert into public.artifact_versions values({q(uid(3990))},{q(org)},{q(written['artifact_id'])},2,repeat('b',64),now(),'{{}}');")
 current,p=current_proposal();assert value(preview(p))['draft']['foundation']==f
 passed('newer draft does not substitute the approved historical pin')
 minimum={'version':1,'engagement_id':engagement,'written':written,'visual':{'mode':'minimum','guidance':'  Use typography only.  ','reason':'  Limited text preview; imagery pending.  '}}
 current,p=current_proposal(minimum);r=value(preview(p));assert r['draft']['foundation']['intent']['visual']['guidance']=='Use typography only.'
 limited=value(combined(r,p,uid(5003),current['token']));assert limited['delivery']['snapshot']['foundation']['pins']['visual']['mode']=='minimum'
 assert any(c.get('kind')=='foundation' for c in r['draft']['changes'])
 passed('explicit minimum guidance and reason bind without forced Branding scope or fabricated approval')
 assert old_digest==run(f"select md5(snapshot::text) from private.project_delivery_plan_versions where id={q(old_id)}").stdout.strip();passed('prior immutable plan/source/review provenance unchanged')
 for patch in [{'written':{**written,'checksum':'b'*64}},{'written':{**written,'approval_id':uid(4900)}},{'written':visual},{'engagement_id':uid(4999)}]:
  current,p=current_proposal({**intent,**patch});denied(preview(p),'42501')
 passed('wrong checksum, mismatched approval, role and foreign engagement deny before writes')
 for column,bad in [('organization_id',uid(5991)),('project_id',uid(5992)),('brand_id',uid(5993))]:
  run(f"update public.artifacts set {column}={q(bad)} where id={q(written['artifact_id'])}")
  current,p=current_proposal(intent);denied(preview(p),'42501')
  original=org if column=='organization_id' else project if column=='project_id' else brand
  run(f"update public.artifacts set {column}={q(original)} where id={q(written['artifact_id'])}")
 current,p=current_proposal(intent);denied(preview(p),'42501',who=uid(99));denied(preview(p),'42501',who='')
 passed('foreign source organization/project/brand, another actor and absent authentication cannot bind guidance')

 for patch in [None,{'version':2,'engagement_id':engagement},{**intent,'ready_for_preparation':True},{**minimum,'visual':{'mode':'minimum','guidance':'yes','reason':''}}]:
  current,p=current_proposal(patch);denied(preview(p),'22023')
 passed('null reset, invented authority, unsupported version and missing reason deny')
 current,p=current_proposal(intent);r=value(preview(p));run(f"update public.artifact_versions set content_checksum=repeat('c',64) where id={q(written['version_id'])}")
 denied(combined(r,p,uid(5004),current['token']),'42501');assert setup()['token']==current['token']
 passed('source change after review blocks Apply and preserves setup token and all writes')
 stale=value(get());assert stale['draft']['foundation']['binding_stale'] is True and stale['draft']['foundation']['sources_available'] is False
 assert stale['latest']['snapshot']['foundation']['pins']['written']['version_id']==written['version_id']
 denied(apply(stale,uid(5099)),'40001')
 passed('stale guidance yields an explicit blocker while immutable historical plan stays readable; standalone Apply denies')
 assert value(recover(uid(5001)))==saved;passed('original completed receipt recovers read-only even when current guidance is stale; no replay dispatch')

 run(f"update public.artifact_versions set content_checksum=repeat('a',64) where id={q(written['version_id'])}")
 # Exact source lock is observed, not inferred from a source-string assertion.
 other_engagement=uid(5988)
 run(f"insert into public.engagements values({q(other_engagement)},{q(org)},{q(project)},'Other same-project engagement','active',{q(client)},{q(brand)})")
 assert 'foundation' not in value(get(eng=other_engagement))['draft']
 current,p=current_proposal({**intent,'engagement_id':other_engagement});denied(preview(p),'42501')
 passed('same-project engagements neither inherit another binding nor accept a mismatched explicit foundation target')
 current,p=current_proposal(intent);r=value(preview(p));holder=subprocess.Popen(base+['-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=flags)
 holder.stdin.write(f"begin;update public.artifact_versions set content_checksum=repeat('d',64) where id={q(written['version_id'])};select pg_sleep(3);commit;");holder.stdin.close();holder.stdin=None
 import time
 for _ in range(60):
  if run(f"select exists(select 1 from pg_locks where relation='public.artifact_versions'::regclass and mode='RowExclusiveLock' and granted)").stdout.strip()=='t':break
  time.sleep(.04)
 else:raise AssertionError('source lock not observed')
 denied(combined(r,p,uid(5005),current['token']),'42501');holder.communicate(timeout=10);assert holder.returncode==0
 assert setup()['token']==current['token'];passed('observed source-lock race revalidates changed source and rolls back the entire combined action')
 run(f"update public.artifact_versions set content_checksum=repeat('a',64) where id={q(written['version_id'])}")
 current,p=current_proposal(intent);r=value(preview(p))
 run("create function private.qa_foundation_fail() returns trigger language plpgsql as $$begin raise exception 'late QA failure' using errcode='55000';end;$$;create trigger qa_foundation_fail before insert on private.project_delivery_plan_versions for each row execute function private.qa_foundation_fail();")
 denied(combined(r,p,uid(5006),current['token']),'55000');assert setup()['token']==current['token'];assert value(recover(uid(5006)))['status']=='not_applied'
 passed('late immutable plan failure rolls back changed foundation, scope revision and original command receipts')
 run('drop trigger qa_foundation_fail on private.project_delivery_plan_versions')
 current,p=current_proposal({'version':1,'engagement_id':engagement,'written':None,'visual':None});r=value(preview(p));assert len(r['draft']['foundation']['gaps'])==2 and not r['draft']['foundation']['sources_available']
 gap=value(combined(r,p,uid(5007),current['token']));assert len(gap['delivery']['snapshot']['foundation']['gaps'])==2;passed('explicitly reviewed missing roles remain truthful blocked gaps in the saved plan')
 current,p=current_proposal(intent);r=value(preview(p));before_count=int(run('select count(*) from private.project_delivery_plan_versions').stdout.strip())
 with ThreadPoolExecutor(max_workers=2) as pool:parallel=list(pool.map(lambda _:call(combined(r,p,uid(5008),current['token'])),range(2)))
 assert all(x.returncode==0 for x in parallel)
 assert len({json.loads(x.stdout.splitlines()[-1])['delivery']['id'] for x in parallel})==1
 assert int(run('select count(*) from private.project_delivery_plan_versions').stdout.strip())==before_count+1
 passed('concurrent identical original UUID creates exactly one immutable foundation-bound plan version')
 import hashlib
 result={'migration_sha256':hashlib.sha256((repo/'supabase/migrations/20261102172337_project_foundation_plan_binding.sql').read_bytes()).hexdigest(),'count':len(checks),'checks':checks,'port':port,'database':database,'boundary':'Synthetic base/published templates and unchanged lower service lifecycle; actual current authority/setup/planners/composed immutable writer/source resolver executed. No provider/client/template-publication/downstream-readiness acceptance.'}
 (qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
 if 'a' in globals() and 'data' in globals():subprocess.run([str(Path(a.pgbin)/'pg_ctl.exe'),'-D',str(data),'-m','fast','-w','stop'],capture_output=True,creationflags=flags,timeout=30)
