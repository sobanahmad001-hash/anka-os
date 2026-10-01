"""Observed native manual-check races; retained immutable local evidence, no users/providers."""
import argparse,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args()
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(cmd+['-c',sql],text=True,encoding='utf-8',capture_output=True,timeout=15)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');");assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
def lit(value):return "'"+str(value).replace("'","''")+"'"
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';version='99999999-9999-4999-8999-999999997141';claim="select set_config('request.jwt.claim.sub',"+lit(actor)+",false);"
page=json.loads(run('select json_build_object(\'id\',id,\'engagement\',engagement_id) from public.project_website_pages where organization_id='+lit(org)+' and project_id='+lit(project)+" and page_key='page:1';"));uuid.UUID(page['id'])
evidence={'indexed':None,'schema_valid':False,'mobile_score':0,'desktop_score':None,'notes':'Observed local manual-check race evidence; not real SEO acceptance','evidence_url':None,'findings':[]}
def review(value):
 checked=run('select clock_timestamp();');params=','.join(map(lit,[org,project,page['id'],version,checked]))+','+lit(json.dumps(value))+'::jsonb'
 result=json.loads(run(claim+'select public.preview_project_website_version_check('+params+');').splitlines()[-1]);return checked,result['review_sha256']
def confirm(value,checked,sha,request):return 'select public.confirm_project_website_version_check('+','.join(map(lit,[org,project,page['id'],version,checked]))+','+lit(json.dumps(value))+'::jsonb,'+lit(sha)+','+lit(request)+');'
def client(sql):
 name='anka-version-check-'+uuid.uuid4().hex;proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env={**os.environ,'PGAPPNAME':name});proc.stdin.write('begin;'+claim+sql+'\n');proc.stdin.flush();return proc,name
def observe(name,kind):
 until=time.monotonic()+8
 while time.monotonic()<until:
  if run('select count(*) from pg_stat_activity where application_name='+lit(name)+(' and cardinality(pg_blocking_pids(pid))>0' if kind=='blocked' else " and state='idle in transaction'")+';')=='1':return
  time.sleep(.04)
 raise AssertionError('Did not observe '+kind+' '+name)
def finish(proc,commit=True):
 if proc.stdin is not None:
  try:
   if proc.poll() is None:proc.stdin.write(('commit;' if commit else 'rollback;')+'\n'+chr(92)+'q\n');proc.stdin.flush()
  except (BrokenPipeError,OSError):pass
  try:proc.stdin.close()
  except (BrokenPipeError,OSError):pass
  proc.stdin=None
 out,error=proc.communicate(timeout=15);return proc.returncode,out,error
state='select json_build_object(\'member\',(select to_jsonb(m) from public.organization_memberships m where organization_id='+lit(org)+' and user_id='+lit(actor)+'),\'archive\',(select archived_at from public.projects where id='+lit(project)+'),\'engagement\',(select status from public.engagements where id='+lit(page['engagement'])+'),\'users\',(select count(*) from auth.users));'
prior=json.loads(run(state));results=[]
def restore():
 run('update public.organization_memberships set status='+lit(prior['member']['status'])+' where organization_id='+lit(org)+' and user_id='+lit(actor)+';update public.projects set archived_at='+('null' if prior['archive'] is None else lit(prior['archive']))+' where id='+lit(project)+';update public.engagements set status='+lit(prior['engagement'])+' where id='+lit(page['engagement'])+';')
try:
 checked,sha=review(evidence);request=str(uuid.uuid4());before=int(run('select count(*) from public.project_website_version_checks;'));first,name=client(confirm(evidence,checked,sha,request));observe(name,'idle');second,name2=client(confirm(evidence,checked,sha,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code==0 and '"idempotent_replay": true' in out,error;assert int(run('select count(*) from public.project_website_version_checks;'))==before+1;results.append({'case':'same UUID same evidence concurrent confirm','observedLock':True,'outcome':'one immutable check and exact original replay'})
 checked,sha=review(evidence);request=str(uuid.uuid4());changed={**evidence,'notes':'Different original evidence'};checked2,sha2=review(changed);first,name=client(confirm(evidence,checked,sha,request));observe(name,'idle');second,name2=client(confirm(changed,checked2,sha2,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and 'Original check operation actor or payload differs' in error,error;results.append({'case':'same UUID changed evidence','observedLock':True,'outcome':'changed payload denied'})
 for label,change in [('actor revocation','update public.organization_memberships set status=\'revoked\' where organization_id='+lit(org)+' and user_id='+lit(actor)+';'),('source withdrawal','update public.engagements set status=\'on_hold\' where id='+lit(page['engagement'])+';'),('project archive','update public.projects set archived_at=clock_timestamp() where id='+lit(project)+';')]:
  for mutation_first in [True,False]:
   checked,sha=review(evidence);native=confirm(evidence,checked,sha,str(uuid.uuid4()));first,name=client(change if mutation_first else native);observe(name,'idle');second,name2=client(native if mutation_first else change);observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second)
   if mutation_first:assert code!=0 and ('authority required' in error or 'approved architecture required' in error or 'Current team' in error),error
   else:assert code==0,error
   results.append({'case':label+(' before check' if mutation_first else ' after check'),'observedLock':True,'outcome':'stale authority/source check denied' if mutation_first else 'exact check committed before later change'});restore()
finally:restore()
assert json.loads(run(state))==prior,'Authority/source/project/user values not restored'
p=Path(a.evidence);e=json.loads(p.read_text(encoding='utf-8'));e['pageIdentity']['versionChecks']['concurrency']={'source':'tools/check-project-website-version-checks-races.py','observedRaceCount':len(results),'results':results,'historyAndAuthorityRestored':True,'immutableLocalReceiptsRetained':True,'scope':'Existing synthetic actor and approved page in exact isolated clone; no provider/human acceptance'};p.write_text(json.dumps(e,indent=2)+'\n',encoding='utf-8');print(json.dumps({'racesPassed':len(results),'stateRestored':True,'evidence':str(p)}))
