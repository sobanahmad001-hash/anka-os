"""Observed native canonical-plan races; retained immutable local evidence, no users/providers."""
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
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';engagement='99999999-9999-4999-8999-999999999975';campaign='99999999-9999-4999-8999-999999997172';service='99999999-9999-4999-8999-999999997171';claim="select set_config('request.jwt.claim.sub',"+lit(actor)+",false);"
evidence={'title':'Synthetic observed campaign race','objective':'Canonical plan concurrency without provider calls','channels':['Website'],'starts_on':None,'ends_on':None,'audience':'','landing_page_url':None,'planned_budget':0,'currency_code':'USD','approved_message_version_id':None,'measurement_plan_version_id':None,'creative_requirements':[],'change_summary':'Synthetic concurrency evidence','source_plan_version_id':None,'marketing_service_id':service,'owner_id':actor,'strategy_version_ids':[]}
def review(value):
 expected=run('select id from public.marketing_campaign_plan_versions where organization_id='+lit(org)+' and campaign_id='+lit(campaign)+' order by version_number desc limit 1;');uuid.UUID(expected)
 result=json.loads(run(claim+'select public.preview_project_campaign_plan('+','.join(map(lit,[org,project,engagement,campaign,expected]))+','+lit(json.dumps(value))+'::jsonb);').splitlines()[-1]);return expected,result['review_checksum']
def confirm(value,expected,sha,request):return 'select public.confirm_project_campaign_plan('+','.join(map(lit,[org,project,engagement,campaign,expected]))+','+lit(json.dumps(value))+'::jsonb,'+lit(sha)+','+lit(request)+');'
def client(sql):
 name='anka-campaign-plan-'+uuid.uuid4().hex;proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env={**os.environ,'PGAPPNAME':name});proc.stdin.write('begin;'+claim+sql+'\n');proc.stdin.flush();return proc,name
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
state='select json_build_object(\'member\',(select to_jsonb(m) from public.organization_memberships m where organization_id='+lit(org)+' and user_id='+lit(actor)+'),\'archive\',(select archived_at from public.projects where id='+lit(project)+'),\'engagement\',(select status from public.engagements where id='+lit(engagement)+'),\'service\',(select status from public.engagement_services where id='+lit(service)+'),\'users\',(select count(*) from auth.users));'
prior=json.loads(run(state));results=[]
def restore():
 run('update public.organization_memberships set status='+lit(prior['member']['status'])+' where organization_id='+lit(org)+' and user_id='+lit(actor)+';update public.projects set archived_at='+('null' if prior['archive'] is None else lit(prior['archive']))+' where id='+lit(project)+';update public.engagements set status='+lit(prior['engagement'])+' where id='+lit(engagement)+';update public.engagement_services set status='+lit(prior['service'])+' where id='+lit(service)+';')
try:
 checked,sha=review(evidence);request=str(uuid.uuid4());before=int(run('select count(*) from public.marketing_campaign_plan_versions;'));first,name=client(confirm(evidence,checked,sha,request));observe(name,'idle');second,name2=client(confirm(evidence,checked,sha,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code==0 and json.loads(out.splitlines()[-1])['request_id']==request,error;assert int(run('select count(*) from public.marketing_campaign_plan_versions;'))==before+1;results.append({'case':'same UUID same evidence concurrent confirm','observedLock':True,'outcome':'one canonical draft/link and exact original replay'})
 checked,sha=review(evidence);request=str(uuid.uuid4());changed={**evidence,'objective':'Different original campaign objective'};checked2,sha2=review(changed);first,name=client(confirm(evidence,checked,sha,request));observe(name,'idle');second,name2=client(confirm(changed,checked2,sha2,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and 'Original campaign operation identity/payload conflict' in error,error;results.append({'case':'same UUID changed evidence','observedLock':True,'outcome':'changed payload denied'})
 for label,change in [('actor revocation','update public.organization_memberships set status=\'revoked\' where organization_id='+lit(org)+' and user_id='+lit(actor)+';'),('engagement withdrawal','update public.engagements set status=\'on_hold\' where id='+lit(engagement)+';update public.engagement_services set status='+lit(prior['service'])+' where id='+lit(service)+';'),('service withdrawal','update public.engagement_services set status=\'on_hold\' where id='+lit(service)+';'),('project archive','update public.projects set archived_at=clock_timestamp() where id='+lit(project)+';')]:
  for mutation_first in [True,False]:
   checked,sha=review(evidence);native=confirm(evidence,checked,sha,str(uuid.uuid4()));first,name=client(change if mutation_first else native);observe(name,'idle');second,name2=client(native if mutation_first else change);observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second)
   if mutation_first:assert code!=0 and ('authority required' in error or 'Active exact project engagement' in error or 'Exact current Marketing service' in error or 'Current team' in error or 'Active team actor' in error or 'Active Marketing engagement' in error),error
   else:assert code==0,error
   results.append({'case':label+(' before draft' if mutation_first else ' after draft'),'observedLock':True,'outcome':'stale authority/source check denied' if mutation_first else 'canonical draft committed before later change'});restore()
finally:restore()
assert json.loads(run(state))==prior,'Authority/source/project/user values not restored'
p=Path(a.evidence);e=json.loads(p.read_text(encoding='utf-8'));e['campaignPlanning']['planCommands']['concurrency']={'source':'tools/check-project-campaign-plan-commands-races.py','observedRaceCount':len(results),'results':results,'historyAndAuthorityRestored':True,'immutableLocalReceiptsRetained':True,'scope':'Existing synthetic actor and campaign in exact isolated clone; no provider/human acceptance'};p.write_text(json.dumps(e,indent=2)+'\n',encoding='utf-8');print(json.dumps({'racesPassed':len(results),'stateRestored':True,'evidence':str(p)}))
