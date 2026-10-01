"""Observed native canonical-plan races; retained immutable local evidence, no users/providers."""
import argparse,json,os,re,subprocess,time,uuid
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
deliverable='99999999-9999-4999-8999-999999997520';workstream='99999999-9999-4999-8999-999999997521';plan='99999999-9999-4999-8999-999999997173'
evidence={'title':'Synthetic observed delivery plan','brief':'Exact campaign deliverable concurrency without providers','format':'Article','content_pillar':'Product education','topic':'Observed native concurrency','due_date':'2026-10-15','contributor_ids':[actor],'change_summary':'Synthetic local concurrency evidence','source_version_id':None,'client_approval_required':False}
def review(value):
 expected=run('select current_version_id from public.deliverables where id='+lit(deliverable)+';') or None
 result=json.loads(run(claim+'select public.preview_project_campaign_deliverable_plan('+','.join(map(lit,[org,project,engagement,service,campaign,plan,deliverable]))+','+('null' if expected is None else lit(expected))+','+lit(json.dumps(value))+'::jsonb);').splitlines()[-1]);return expected,result['review_checksum']
def confirm(value,expected,sha,request):return 'select public.confirm_project_campaign_deliverable_plan('+','.join(map(lit,[org,project,engagement,service,campaign,plan,deliverable]))+','+('null' if expected is None else lit(expected))+','+lit(json.dumps(value))+'::jsonb,'+lit(sha)+','+lit(request)+');'
def client(sql):
 name='anka-campaign-deliverable-'+uuid.uuid4().hex;proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env={**os.environ,'PGAPPNAME':name});proc.stdin.write('begin;'+claim+sql+'\n');proc.stdin.flush();return proc,name
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
default_query="select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.activity_events'::regclass and a.attname='organization_id';"
original_default=run(default_query);assert re.fullmatch("'[a-f0-9-]{36}'::uuid",original_default),original_default
# Exclusive isolated QA checkout. Fix only the clone's missing legacy fixture organization
# while observing real project/deliverable/advisory locks; restore the exact default in finally.
run('begin;'+claim+'insert into public.workstreams(id,organization_id,project_id,department_id,name,status) values('+','.join(map(lit,[workstream,org,project,'marketing','Synthetic retained campaign delivery races','active']))+') on conflict(id) do nothing;insert into public.deliverables(id,organization_id,project_id,workstream_id,title,description,deliverable_type,status,visibility,owner_id,created_by,due_date) values('+','.join(map(lit,[deliverable,org,project,workstream,'Synthetic retained campaign delivery races','Isolated native concurrency fixture','article','in_production','internal_only',actor,actor,'2026-10-10']))+') on conflict(id) do nothing;commit;')
state=f"select json_build_object('member',(select jsonb_build_object('status',status,'role',role,'department_id',department_id) from public.organization_memberships where organization_id={lit(org)} and user_id={lit(actor)}),'archive',(select archived_at from public.projects where id={lit(project)}),'engagement',(select status from public.engagements where id={lit(engagement)}),'service',(select status from public.engagement_services where id={lit(service)}),'deadline',(select due_date from public.deliverables where id={lit(deliverable)}),'workstream',(select status from public.workstreams where id={lit(workstream)}),'users',(select count(*) from auth.users));"
prior=json.loads(run(state));results=[];clients=[]
original_client=client
def client(sql):
 proc,name=original_client(sql);clients.append(proc);return proc,name

def restore():
 run('begin;'+claim+'update public.organization_memberships set status='+lit(prior['member']['status'])+',role='+lit(prior['member']['role'])+',department_id='+('null' if prior['member']['department_id'] is None else lit(prior['member']['department_id']))+' where organization_id='+lit(org)+' and user_id='+lit(actor)+';update public.projects set archived_at='+('null' if prior['archive'] is None else lit(prior['archive']))+' where id='+lit(project)+';update public.engagements set status='+lit(prior['engagement'])+' where id='+lit(engagement)+';update public.engagement_services set status='+lit(prior['service'])+' where id='+lit(service)+';update public.deliverables set due_date='+lit(prior['deadline'])+' where id='+lit(deliverable)+';update public.workstreams set status='+lit(prior['workstream'])+' where id='+lit(workstream)+';commit;')
try:
 run('begin;alter table public.activity_events alter column organization_id set default '+lit(org)+'::uuid;commit;')
 checked,sha=review(evidence);request=str(uuid.uuid4());before=int(run('select count(*) from public.deliverable_versions;'));first,name=client(confirm(evidence,checked,sha,request));observe(name,'idle');second,name2=client(confirm(evidence,checked,sha,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code==0 and json.loads(out.splitlines()[-1])['request_id']==request,error;assert int(run('select count(*) from public.deliverable_versions;'))==before+1;results.append({'case':'same UUID same evidence','observedLock':True,'outcome':'one canonical version/private plan and original receipt'})
 checked,sha=review(evidence);request=str(uuid.uuid4());changed={**evidence,'topic':'Changed original topic'};checked2,sha2=review(changed);first,name=client(confirm(evidence,checked,sha,request));observe(name,'idle');second,name2=client(confirm(changed,checked2,sha2,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and 'identity/payload conflict' in error,error;results.append({'case':'same UUID changed payload','observedLock':True,'outcome':'altered original payload denied'})
 for label,change,errors in [
 ('actor revocation','update public.organization_memberships set status='+lit('revoked')+' where organization_id='+lit(org)+' and user_id='+lit(actor)+';',('authority required','Current team','Active team actor')),
 ('engagement withdrawal','update public.engagements set status='+lit('on_hold')+' where id='+lit(engagement)+';update public.engagement_services set status='+lit(prior['service'])+' where id='+lit(service)+';',('Active exact project engagement',)),
 ('service withdrawal','update public.engagement_services set status='+lit('on_hold')+' where id='+lit(service)+';',('Existing active exact Marketing service',)),
 ('project archive','update public.projects set archived_at=clock_timestamp() where id='+lit(project)+';',('authority required',)),
 ('canonical root deadline','update public.deliverables set due_date='+lit('2026-10-11')+' where id='+lit(deliverable)+';',('references changed',)),
 ('workstream withdrawal','update public.workstreams set status='+lit('on_hold')+' where id='+lit(workstream)+';',('active deliverable workstream',)),
 ('contributor membership snapshot','update public.organization_memberships set role='+lit('executive')+' where organization_id='+lit(org)+' and user_id='+lit(actor)+';',('references changed',))]:
  for mutation_first in [True,False]:
   checked,sha=review(evidence);native=confirm(evidence,checked,sha,str(uuid.uuid4()));first,name=client(change if mutation_first else native);observe(name,'idle');second,name2=client(native if mutation_first else change);observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second)
   if mutation_first:assert code!=0 and any(value in error for value in errors),error
   else:assert code==0,error
   results.append({'case':label+(' before confirmation' if mutation_first else ' after confirmation'),'observedLock':True,'outcome':'stale scope/reference denied' if mutation_first else 'new canonical version precedes later change'});restore()
 # Collision ordering with the unchanged canonical/Legacy writer uses its actual UUID lock.
 for legacy_first in [True,False]:
  checked,sha=review(evidence);request=str(uuid.uuid4());native=confirm(evidence,checked,sha,request);legacy='select public.create_governed_deliverable_version('+','.join(map(lit,[org,deliverable,'Synthetic Legacy collision','Observed original P7 collision']))+",null,'{}'::jsonb,false,"+lit(request)+');';first,name=client(legacy if legacy_first else native);observe(name,'idle');second,name2=client(native if legacy_first else legacy);observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and ('UUID already belongs' in error or 'Idempotency key' in error),error;results.append({'case':'canonical Legacy UUID collision '+('before' if legacy_first else 'after')+' new command','observedLock':True,'outcome':'one original canonical action; collision denied without deadlock'})
 # Canonical Legacy head changes under the actual deliverable lock invalidate a new review.
 checked,sha=review(evidence);legacy='select public.create_governed_deliverable_version('+','.join(map(lit,[org,deliverable,'Synthetic intervening Legacy head','Observed head change']))+",null,'{}'::jsonb,false,"+lit(str(uuid.uuid4()))+');';first,name=client(legacy);observe(name,'idle');second,name2=client(confirm(evidence,checked,sha,str(uuid.uuid4())));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and 'current version changed' in error,error;results.append({'case':'Legacy canonical head before new confirmation','observedLock':True,'outcome':'stale canonical head denied'})
finally:
 for proc in clients:
  if proc.poll() is None:finish(proc,False)
 try:restore()
 finally:run('begin;alter table public.activity_events alter column organization_id set default '+original_default+';commit;')
assert json.loads(run(state))==prior,'Current authority/business values/users not restored'
assert run(default_query)==original_default,'Exact legacy activity default not restored'
p=Path(a.evidence);e=json.loads(p.read_text(encoding='utf-8'));e['campaignPlanning']['deliverablePlans']['concurrency']={'source':'tools/check-project-campaign-deliverable-plans-races.py','observedRaceCount':len(results),'results':results,'historyAndAuthorityRestored':True,'immutableLocalReceiptsRetained':True,'activityDefaultRestoredExactly':True,'scope':'Named synthetic deliverable/workstream with existing actor in exact isolated clone. The missing clone-only legacy activity organization default was temporarily scoped to the existing synthetic tenant for the suite, restored exactly in finally; real native row/advisory locks observed with no DDL locks held. Canonical versions/activity audits and private planning receipts retained; root current heads/update timestamps advance legitimately. No production schema workaround, provider or distinct-human acceptance.'};p.write_text(json.dumps(e,indent=2)+'\n',encoding='utf-8');print(json.dumps({'racesPassed':len(results),'stateRestored':True,'activityDefaultRestored':True,'evidence':str(p)}))
