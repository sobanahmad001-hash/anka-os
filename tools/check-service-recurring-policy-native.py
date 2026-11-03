"""Targeted policy/source follow-up in a NEW database cloned from owned native QA.
The original database stays unchanged. No full passed suite or real-clock wait repeats.
"""
from pathlib import Path
import argparse,json,re,subprocess,uuid,socket,os,hashlib,copy
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--base-qa',required=True);p.add_argument('--qa',required=True);a=p.parse_args()
repo=Path(a.repo).resolve();parent=repo.parent;base=Path(a.base_qa).resolve();qa=Path(a.qa).resolve();data=qa/'data';bin=Path(a.pgbin);port=29974;started=False;checks=[];os.environ['PGCLIENTENCODING']='UTF8'
assert base.parent==parent and qa.parent==parent and base!=qa and (base/'verification.json').exists()
copy_proof=json.loads((qa/'offline-copy-verification.json').read_text(encoding='utf-8'))
assert Path(copy_proof['source']).resolve()==base/'data' and Path(copy_proof['destination']).resolve()==data
assert copy_proof['sourceStopped'] and copy_proof['sourceUnchanged'] and (data/'PG_VERSION').exists()
assert not (base/'data/postmaster.pid').exists() and not (data/'postmaster.pid').exists()
for record in copy_proof['files']:
 assert hashlib.sha256((data/record['path']).read_bytes()).hexdigest()==record['sha256'],'Physical copy must still match verified offline manifest before startup'
original=re.search(r'create database (recurring_[a-f0-9]+)',(base/'commands.log').read_text(encoding='utf-8'))[1]
database='policy_'+uuid.uuid4().hex[:8]
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0
def ctl(args):
 with (qa/'control.log').open('a',encoding='utf-8') as f:r=subprocess.run([str(v) for v in args],stdout=f,stderr=subprocess.STDOUT,creationflags=0x08000000,timeout=40);assert r.returncode==0
def raw(sql,db=None):
 r=subprocess.run([str(bin/'psql.exe'),'-X','-qAt','-h','127.0.0.1','-p',str(port),'-U','postgres','-d',db or database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=sql,capture_output=True,text=True,encoding='utf-8',creationflags=0x08000000,timeout=30)
 with (qa/'commands.log').open('a',encoding='utf-8') as f:f.write(sql+'\n'+r.stdout+r.stderr+'\n')
 return r
def run(sql,db=None):
 r=raw(sql,db);assert r.returncode==0,r.stderr;return r.stdout.strip()
q=lambda s:"'"+str(s).replace("'","''")+"'"
j=lambda d:q(json.dumps(d))+'::jsonb'
uid=lambda n:f'a2000000-0000-4000-8000-{n:012d}'
def actor(sql):
 r=run("begin;set local role authenticated;select set_config('request.jwt.claim.sub',"+q(uid(2))+",true);"+sql+';commit;');return json.loads(r.splitlines()[-1])
def passed(name):checks.append(name)
try:
 ctl([bin/'pg_ctl.exe','-D',data,'-l',qa/'server.log','-o',f'-p {port} -h 127.0.0.1','-w','start']);started=True
 assert Path(run('show data_directory','postgres')).resolve()==data.resolve()
 original_proof=run("select jsonb_build_object('work',md5((select jsonb_agg(to_jsonb(w) order by id)::text from public.work_items w)),'compiler',md5(pg_get_functiondef('private.compile_service_recurring_bridge(jsonb,jsonb)'::regprocedure)))",original)
 run('create database '+database+' template '+original,'postgres')
 source=next((repo/'supabase/migrations').glob('*reviewed_service_recurring_bridge.sql')).read_text(encoding='utf-8')
 first=source.index('create function private.service_recurring_timezone_probe_matches(');end=source.index('CREATE OR REPLACE FUNCTION private.insert_recurring_plan_version(')
 layer=source[first:end].replace('create function ','create or replace function ')
 run('begin;'+layer+'\ncommit;')
 passed('exact current new-helper/API layer compiles in a separate cloned QA database without changing the original fixture')
 org,project,eng,scope_id=uid(1),uid(4),uid(5),uid(101)
 args=','.join(q(x) for x in [org,project,eng,scope_id])+',null'
 context=actor('select public.get_service_recurring_plan_context('+args+')')
 observed=json.loads((parent/'runtime-preimage-20261103.json').read_text(encoding='utf-8'))['timezone_evidence']
 for zone,key,winter in [('America/Vancouver','VancouverNovember','2027-01-15 19:00+00'),('America/Edmonton','EdmontonNovember','2027-01-15 18:00+00'),('Africa/Casablanca','CasablancaOctober','2027-01-15 12:00+00')]:
  assert run('select private.service_recurring_timezone_probe_matches('+q(zone)+','+q(observed[key])+'::timestamptz,'+q(winter)+'::timestamptz)')=='f'
 passed('actual policy predicate rejects all three previously observed live incorrect offsets independently of server minor version')
 for zone in ['America/Vancouver','Canada/Pacific','America/Edmonton','Canada/Mountain','Africa/Casablanca','Africa/El_Aaiun','Asia/Karachi','America/New_York','UTC','Europe/London']:
  c=copy.deepcopy(context['context'])
  for item in c['contributions']:item['service_line']['timezone']=zone
  compiled=json.loads(run('select private.compile_service_recurring_bridge('+j(c)+','+j(context['proposal'])+')'))
  assert compiled['timezone']==zone and compiled['work_card_count']==45
 passed('actual fixed native conversions permit six affected-zone names/aliases and four unaffected IANA zones without fallback or blanket blocking')
 c=copy.deepcopy(context['context'])
 for item in c['contributions']:item['service_line']['timezone']='Mars/Unknown'
 denied=raw('select private.compile_service_recurring_bridge('+j(c)+','+j(context['proposal'])+')');assert denied.returncode!=0 and '22023' in denied.stderr
 passed('unknown timezone remains an explicit error')
 assert run("select has_function_privilege('service_role','private.service_recurring_timezone_probe_matches(text,timestamptz,timestamptz)','EXECUTE') or has_function_privilege('authenticated','private.service_recurring_timezone_probe_matches(text,timestamptz,timestamptz)','EXECUTE') or has_function_privilege('anon','private.service_recurring_timezone_probe_matches(text,timestamptz,timestamptz)','EXECUTE')")=='f'
 passed('new runtime timezone policy helper remains closed to all client/service roles')
 before=run('select md5(jsonb_agg(to_jsonb(w) order by id)::text) from public.work_items w')
 plan=context['context']['existing_plan_id'];pending=context['context']['plan_head_id'];approved=context['context']['approved_version_id']
 assert pending!=approved
 assert run('select count(*) from public.recurring_work_plan_template_items where plan_version_id='+q(pending)+' and default_assignee_id='+q(uid(3)))=='1'
 assert all(x['default_assignee_id'] is None for x in context['compiled']['template_items'])
 passed('owner review retains approved assignment state and does not adopt pending unapproved departmental reassignment')
 result=actor('select public.apply_service_recurring_plan('+args+','+j(context['proposal'])+','+q(context['review_sha256'])+','+q(uid(9900))+')')
 assert not result['work_created'] and result['plan_version_number']==4
 assert run('select count(*) from public.recurring_work_plan_template_items where plan_version_id='+q(pending)+' and default_assignee_id='+q(uid(3)))=='1'
 passed('normal authenticated future-version save succeeds while retaining the pending reassignment version unchanged')
 run('begin;set local role service_role;'+"select set_config('request.jwt.claim.sub','',true);select public.approve_recurring_work_plan_version("+q(plan)+','+q(pending)+",'Explicit native approval of existing reassignment',"+q(uid(2))+');commit;')
 current=actor('select public.get_service_recurring_plan_context('+args+')')
 assert sum(x['default_assignee_id']==uid(3) for x in current['compiled']['template_items'])==1
 carried=actor('select public.apply_service_recurring_plan('+args+','+j(current['proposal'])+','+q(current['review_sha256'])+','+q(uid(9901))+')')
 assert carried['plan_version_number']==5 and not carried['assignment_performed']
 assert run('select count(*) from public.recurring_work_plan_template_items where plan_version_id='+q(carried['plan_version_id'])+' and default_assignee_id='+q(uid(3))+" and department_id='design'")=='1'
 assert run('select md5(jsonb_agg(to_jsonb(w) order by id)::text) from public.work_items w')==before
 passed('after actual owner approval, normal future review/save preserves the exact authorized assignee without changing any generated card')
 assert run("select jsonb_build_object('work',md5((select jsonb_agg(to_jsonb(w) order by id)::text from public.work_items w)),'compiler',md5(pg_get_functiondef('private.compile_service_recurring_bridge(jsonb,jsonb)'::regprocedure)))",original)==original_proof
 passed('original QA database, compiler and historical Work remain unchanged by the cloned follow-up')
 for record in copy_proof['files']:
  assert hashlib.sha256((base/'data'/record['path']).read_bytes()).hexdigest()==record['sha256'],'Original stopped QA data must remain unchanged'
 report={'passed':len(checks),'checks':checks,'migrationSHA256':hashlib.sha256(source.encode()).hexdigest(),'originalDatabaseInSeparateCopy':original,'testDatabase':database,'data':str(data),'preservedSourceData':str(base/'data'),'offlineCopyProof':str(qa/'offline-copy-verification.json'),'sourcePhysicalDataUnchanged':True,'port':port,'original29690Touched':False,'boundary':__doc__+' Native writer/authority checks use disclosed synthetic base/saved-plan/config/approved-stage seam; timezone compiler packets are read-only policy inputs. No production upgrade, signed-in/PostgREST/provider acceptance.'}
 (qa/'verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
finally:
 if started:ctl([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
