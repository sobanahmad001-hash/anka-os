"""Observed native research-command races; retained immutable local evidence, no users/providers."""
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
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';engagement='99999999-9999-4999-8999-999999999975';service='99999999-9999-4999-8999-999999997171';target='99999999-9999-4999-8999-999999997420';claim="select set_config('request.jwt.claim.sub',"+lit(actor)+",false);"
# Only a named synthetic canonical target in the isolated clone, using the existing synthetic actor.
users_before=int(run('select count(*) from auth.users;'))
if run('select count(*) from public.backlink_targets where id='+lit(target)+';')=='0':
 run('insert into public.backlink_targets(id,organization_id,brand_id,site_name,site_url,created_by) values('+','.join(map(lit,[target,org,'99999999-9999-4999-8999-999999999973','Synthetic retained outreach race target','https://example.invalid/opportunity-race',actor]))+');')
assert run('select count(*) from public.backlink_targets where id='+lit(target)+' and organization_id='+lit(org)+' and brand_id=\'99999999-9999-4999-8999-999999999973\' and created_by='+lit(actor)+';')=='1'
assert int(run('select count(*) from auth.users;'))==users_before
task='99999999-9999-4999-8999-999999997421'
if run('select count(*) from public.tasks where id='+lit(task)+';')=='0':
 run(claim+"begin;do $$declare old_default text;begin select pg_get_expr(adbin,adrelid) into old_default from pg_attrdef where adrelid='public.activity_events'::regclass and adnum=(select attnum from pg_attribute where attrelid='public.activity_events'::regclass and attname='organization_id');alter table public.activity_events alter column organization_id set default '99999999-9999-4999-8999-999999999901'::uuid;insert into public.tasks(id,organization_id,project_id,user_id,created_by,title,department_id,due_date,status) values('99999999-9999-4999-8999-999999997421','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999902','99999999-9999-4999-8999-999999999902','Synthetic retained governed outreach race Task','marketing','2026-10-10','backlog');if old_default is null then alter table public.activity_events alter column organization_id drop default;else execute 'alter table public.activity_events alter column organization_id set default '||old_default;end if;end $$;commit;")
assert run('select count(*) from public.tasks where id='+lit(task)+' and organization_id='+lit(org)+' and project_id='+lit(project)+' and department_id=\'marketing\';')=='1'
base={'command_kind':'record_research','target_id':target,'candidate_kind':'publication','source_url':'https://example.invalid/research/race','observed_on':'2026-09-30','notes':'Synthetic observed research race; no provider/human acceptance'}
def research():return {**base,'candidate_kind':'publication' if len(results)%2==0 else 'directory'}
def review(value):
 result=json.loads(run(claim+'select public.preview_project_marketing_opportunity('+','.join(map(lit,[org,project,engagement,service]))+','+lit(json.dumps(value))+'::jsonb);').splitlines()[-1]);return None,result['review_checksum']
def confirm(value,expected,sha,request):return 'select public.confirm_project_marketing_opportunity('+','.join(map(lit,[org,project,engagement,service]))+','+lit(json.dumps(value))+'::jsonb,'+lit(sha)+','+lit(request)+');'
activity_default=run("select pg_get_expr(adbin,adrelid) from pg_attrdef where adrelid='public.activity_events'::regclass and adnum=(select attnum from pg_attribute where attrelid='public.activity_events'::regclass and attname='organization_id');")
def task_audit_sql(sql):return 'alter table public.activity_events alter column organization_id set default '+lit(org)+'::uuid;'+sql+('alter table public.activity_events alter column organization_id set default '+activity_default+';' if activity_default else 'alter table public.activity_events alter column organization_id drop default;')
def client(sql):
 if 'update public.tasks' in sql:sql=task_audit_sql(sql)

 name='anka-marketing-opportunity-'+uuid.uuid4().hex;proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env={**os.environ,'PGAPPNAME':name});proc.stdin.write('begin;'+claim+sql+'\n');proc.stdin.flush();return proc,name
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
state='select json_build_object(\'member\',(select to_jsonb(m) from public.organization_memberships m where organization_id='+lit(org)+' and user_id='+lit(actor)+'),\'archive\',(select archived_at from public.projects where id='+lit(project)+'),\'engagement\',(select status from public.engagements where id='+lit(engagement)+'),\'service\',(select status from public.engagement_services where id='+lit(service)+'),\'targetNotes\',(select notes from public.backlink_targets where id='+lit(target)+'),\'taskDue\',(select due_date from public.tasks where id='+lit(task)+'),\'users\',(select count(*) from auth.users));'
prior=json.loads(run(state));results=[]
def restore():
 run('begin;'+claim+task_audit_sql('update public.organization_memberships set status='+lit(prior['member']['status'])+' where organization_id='+lit(org)+' and user_id='+lit(actor)+';update public.projects set archived_at='+('null' if prior['archive'] is None else lit(prior['archive']))+' where id='+lit(project)+';update public.engagements set status='+lit(prior['engagement'])+' where id='+lit(engagement)+';update public.engagement_services set status='+lit(prior['service'])+' where id='+lit(service)+';update public.backlink_targets set notes='+('null' if prior['targetNotes'] is None else lit(prior['targetNotes']))+' where id='+lit(target)+' and notes is distinct from '+('null' if prior['targetNotes'] is None else lit(prior['targetNotes']))+';update public.tasks set due_date='+('null' if prior['taskDue'] is None else lit(prior['taskDue']))+' where id='+lit(task)+' and due_date is distinct from '+('null' if prior['taskDue'] is None else lit(prior['taskDue']))+';')+'commit;')
try:
 evidence=research();checked,sha=review(evidence);request=str(uuid.uuid4());before=int(run('select count(*) from public.project_marketing_opportunity_observations;'));first,name=client(confirm(evidence,checked,sha,request));observe(name,'idle');second,name2=client(confirm(evidence,checked,sha,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code==0 and json.loads(out.splitlines()[-1])['request_id']==request,error;assert int(run('select count(*) from public.project_marketing_opportunity_observations;'))==before+1;results.append({'case':'same UUID same evidence concurrent confirm','observedLock':True,'outcome':'one immutable research observation and original replay'})
 evidence=research();checked,sha=review(evidence);request=str(uuid.uuid4());changed={**evidence,'notes':'Different original research notes'};checked2,sha2=review(changed);first,name=client(confirm(evidence,checked,sha,request));observe(name,'idle');second,name2=client(confirm(changed,checked2,sha2,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and 'Original opportunity operation identity/payload conflict' in error,error;results.append({'case':'same UUID changed evidence','observedLock':True,'outcome':'changed payload denied'})
 for label,change in [('actor revocation',"update public.organization_memberships set status='revoked' where organization_id="+lit(org)+' and user_id='+lit(actor)+';'),('engagement withdrawal',"update public.engagements set status='on_hold' where id="+lit(engagement)+';'),('service withdrawal',"update public.engagement_services set status='on_hold' where id="+lit(service)+';'),('project archive','update public.projects set archived_at=clock_timestamp() where id='+lit(project)+';')]:
  for mutation_first in [True,False]:
   evidence=research();checked,sha=review(evidence);native=confirm(evidence,checked,sha,str(uuid.uuid4()));first,name=client(change if mutation_first else native);observe(name,'idle');second,name2=client(native if mutation_first else change);observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second)
   if mutation_first:assert code!=0 and ('authority required' in error or 'Active exact project engagement' in error or 'Existing active exact Marketing service' in error or 'Current team' in error or 'Active team actor' in error or 'Active Marketing engagement' in error),error
   else:assert code==0,error
   results.append({'case':label+(' before research' if mutation_first else ' after research'),'observedLock':True,'outcome':'stale authority/source check denied' if mutation_first else 'research committed before later authority/service change'});restore()
 # Use a newly reviewed exact observation whenever a legitimate current-target QA update advanced its timestamp.
 def link_value():
  evidence={**base,'observed_on':run('select current_date;'),'notes':'Synthetic current canonical metadata for observed Task-link race; no real outreach/provider acceptance'};expected,sha=review(evidence);request=str(uuid.uuid4());receipt=json.loads(run(claim+confirm(evidence,expected,sha,request)).splitlines()[-1]);return {'command_kind':'link_task','candidate_id':receipt['candidate']['id'],'observation_id':receipt['observation']['id'],'task_id':task}
 value=link_value();expected,sha=review(value);request=str(uuid.uuid4());before=int(run('select count(*) from public.project_marketing_opportunity_task_links;'));existed=int(run('select count(*) from public.project_marketing_opportunity_task_links where candidate_id='+lit(value['candidate_id'])+' and task_id='+lit(task)+';'));first,name=client(confirm(value,expected,sha,request));observe(name,'idle');second,name2=client(confirm(value,expected,sha,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code==0,error;assert int(run('select count(*) from public.project_marketing_opportunity_task_links;'))==before+(0 if existed else 1);results.append({'case':'same UUID same existing canonical Task link','observedLock':True,'outcome':'one immutable link and original replay'})
 for label,change in [('canonical Task due date/revision','update public.tasks set due_date=\'2026-10-11\' where id='+lit(task)+';'),('canonical target metadata','update public.backlink_targets set notes=\'Observed synthetic current target metadata change\' where id='+lit(target)+';')]:
  for mutation_first in [True,False]:
   value=link_value();expected,sha=review(value);native=confirm(value,expected,sha,str(uuid.uuid4()));first,name=client(change if mutation_first else native);observe(name,'idle');second,name2=client(native if mutation_first else change);observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second)
   if mutation_first:assert code!=0 and ('reference changed' in error or 'target changed' in error),error
   else:assert code==0,error
   results.append({'case':label+(' before Task link' if mutation_first else ' after Task link'),'observedLock':True,'outcome':'stale source/work confirmation denied' if mutation_first else 'original commitment precedes legitimate later metadata update'});restore()
finally:restore()
assert json.loads(run(state))==prior,'Authority/source/project/user values not restored'
p=Path(a.evidence);e=json.loads(p.read_text(encoding='utf-8'));e['marketingOpportunities']['concurrency']={'source':'tools/check-project-marketing-opportunities-races.py','observedRaceCount':len(results),'results':results,'historyAndAuthorityRestored':True,'immutableLocalReceiptsRetained':True,'scope':'Existing synthetic actor, named synthetic manual target and governed Project Task in exact isolated clone; business fields/current authority/service restored and user count unchanged. Legitimate Task row versions and target touch timestamps advance; old private/immutable evidence remains, never rewritten. No provider/human acceptance'};p.write_text(json.dumps(e,indent=2)+'\n',encoding='utf-8');print(json.dumps({'racesPassed':len(results),'stateRestored':True,'evidence':str(p)}))
