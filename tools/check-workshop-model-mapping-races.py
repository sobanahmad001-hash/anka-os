"""Candidate-specific QA races; refuses reuse of a retained fixture. No production use."""
import argparse,json,subprocess,time,uuid,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--psql',required=True);p.add_argument('--output',required=True);a=p.parse_args();repo=Path(a.repo)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql):
 x=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=60)
 if x.returncode:raise RuntimeError(x.stderr)
 return x.stdout.strip()
def lit(x):return "'"+str(x).replace("'","''")+"'"
org='99999999-9999-4999-8999-999999999901';actor='99999999-9999-4999-8999-999999999902';project='99999999-9999-4999-8999-999999999974';eng='99999999-9999-4999-8999-999999999975';connection='99999999-9999-4999-8999-999999996910'
assert run("select current_database()||'|'||current_setting('data_directory');")=='anka_b1_firstsend_20260930|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
assert run('select count(*) from public.integration_connections where id='+lit(connection))=='0','Fixture already exists; do not rerun blindly'
tables=['organization_memberships','projects','engagements','engagement_services','service_catalog','integration_connections','integration_connection_departments','integration_connection_engagements','department_chat_model_configurations','engagement_events']
original={t:set(json.loads(run("select coalesce(jsonb_agg(md5(to_jsonb(t)::text)),'[]') from public."+t+' t'))) for t in tables}
migration=repo/'supabase/migrations/20261006123826_workshop_model_mappings.sql';source=migration.read_text(encoding='utf8');run(source)
fixture=(repo/'supabase/tests/workshop_model_mappings.behavior.sql').read_text(encoding='utf8').split('create function pg_temp.snapshot()')[0];run(fixture+'commit;')
base=','.join(map(lit,[org,project,eng,actor]));read='select public.get_workshop_model_mappings('+base+');'
selection=json.dumps([{'connection_id':connection,'department_id':d} for d in ['content','design','marketing']],separators=(',',':'))
def save(request,token):return 'select public.save_workshop_model_mappings('+base+','+lit(request)+','+lit(token)+','+lit(selection)+'::jsonb);'
def process(sql,name):
 q=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8');q.stdin.write("set application_name="+lit(name)+";"+sql);q.stdin.close();return q
def finish(q):
 q.wait(timeout=15);out=q.stdout.read();err=q.stderr.read()
 if q.returncode:raise RuntimeError(err)
 return out.strip()
results=[]
def compete(label,second,commit=False):
 request=str(uuid.uuid4());token=json.loads(run(read))['token'];sql=save(request,token)
 name='workshop_mapping_'+label
 first=process('begin;set local role service_role;'+sql+'select pg_sleep(3);commit;',name+'_holder')
 deadline=time.time()+8
 while time.time()<deadline:
  if run("select count(*) from pg_stat_activity where application_name="+lit(name+'_holder')+" and wait_event='PgSleep';")=='1':break
  time.sleep(.1)
 else:raise AssertionError('Holder did not reach sleep')
 second_sql=sql if second is None else second
 other=process('begin;'+second_sql+('commit;' if commit else 'rollback;'),name+'_waiter')
 observed=False
 for _ in range(20):
  if run("select coalesce(bool_or(cardinality(pg_blocking_pids(pid))>0),false) from pg_stat_activity where application_name="+lit(name+'_waiter'))=='t':observed=True;break
  time.sleep(.05)
 assert observed,label+' did not block'
 first_result=finish(first);other_result=finish(other)
 if second is None:
  assert first_result.splitlines()[0]==other_result.splitlines()[0]
  assert run('select count(*) from private.workshop_model_mapping_receipts where request_id='+lit(request))=='1'
 results.append({'case':label,'observedBlocked':True,'passed':True})
compete('duplicate',None,True)
compete('membership',"update public.organization_memberships set status='revoked' where organization_id="+lit(org)+' and user_id='+lit(actor)+';')
compete('project',"update public.projects set archived_at=now() where id="+lit(project)+';')
compete('service',"update public.engagement_services set status='planned' where engagement_id="+lit(eng)+';')
compete('connector',"update public.integration_connections set status='configured' where id="+lit(connection)+';')
compete('approval',"update public.department_chat_model_configurations set revoked_at=now(),revoked_by="+lit(actor)+' where connector_connection_id='+lit(connection)+';')
# Committed connector revocation before save must reject the previously reviewed token.
token=json.loads(run(read))['token'];run("update public.integration_connections set status='configured' where id="+lit(connection))
x=subprocess.run(cmd,input=save(str(uuid.uuid4()),token),text=True,encoding='utf8',capture_output=True);assert x.returncode and '40001' in x.stderr
run("update public.integration_connections set status='verified' where id="+lit(connection));results.append({'case':'prior-revocation','passed':True})
for t,hashes in original.items():
 now=set(json.loads(run("select coalesce(jsonb_agg(md5(to_jsonb(t)::text)),'[]') from public."+t+' t')));assert hashes<=now,t+' original rows changed'
catalog=json.loads(run("select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('workshop_mapping_context','get_workshop_model_mappings','save_workshop_model_mappings','recover_workshop_model_mappings');"))
assert len(catalog)==4 and all(not x['definer'] for x in catalog)
Path(a.output).write_text(json.dumps({'migration':migration.name,'sha256':hashlib.sha256(source.encode()).hexdigest(),'races':results,'catalog':catalog,'originalRowsPreserved':True,'retainedFixture':connection},indent=2)+'\n',encoding='utf8');print('PASS',len(results),'native concurrency/revocation cases; original rows preserved; retained isolated fixture',connection)
