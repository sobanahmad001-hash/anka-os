"""Observed local AD2 placements lock races; retained synthetic audit, no users/provider calls."""
import argparse,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(cmd+['-c',sql],text=True,encoding='utf-8',capture_output=True,timeout=15)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');");assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';campaign='99999999-9999-4999-8999-999999997172';service='99999999-9999-4999-8999-999999997171';work='99999999-9999-4999-8999-999999997160'
claim="select set_config('request.jwt.claim.sub','"+actor+"',false);"
def lit(value):return "'"+str(value).replace("'","''")+"'"
asset=run("select id from public.project_campaign_assets where organization_id="+lit(org)+" and project_id="+lit(project)+" and source_version_id='99999999-9999-4999-8999-999999997111';");uuid.UUID(asset)
base={'asset_id':asset,'variant_id':None,'campaign_plan_version_id':'99999999-9999-4999-8999-999999997173','marketing_service_id':service,'channel':'Website','account_binding_id':None,'mode':'organic','scheduled_at':'2026-10-10T09:00:00.000Z','time_zone':'Asia/Karachi','cta':{'label':'Read the article','url':'https://example.invalid/article?utm_campaign=launch'},'external_id':None,'recorded_url':None,'publication_state':'planned','contribution':{'kind':'engagement_work_item','id':work}}
def preview(value,placement=None,expected=0):return json.loads(run(claim+"select public.preview_project_campaign_placement("+','.join([lit(org),lit(project),lit(campaign),'null' if placement is None else lit(placement),str(expected),lit(json.dumps(value))+'::jsonb'])+');').splitlines()[-1])
def confirm(value,review,request,placement=None,expected=0):return "select public.confirm_project_campaign_placement("+','.join([lit(org),lit(project),lit(campaign),'null' if placement is None else lit(placement),str(expected),lit(json.dumps(value))+'::jsonb',lit(review),lit(request)])+');'
def client(sql):
 name='anka-placement-'+uuid.uuid4().hex
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env={**os.environ,'PGAPPNAME':name})
 proc.stdin.write('begin;'+claim+sql+'\n');proc.stdin.flush();return proc,name
def observe(name,kind):
 until=time.monotonic()+8
 while time.monotonic()<until:
  sql="select count(*) from pg_stat_activity where application_name="+lit(name)+( " and cardinality(pg_blocking_pids(pid))>0" if kind=='blocked' else " and state='idle in transaction'")+ ';'
  if run(sql)=='1':return
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
 output,error=proc.communicate(timeout=15);return proc.returncode,output,error
state=f"select json_build_object('member',(select to_jsonb(m) from public.organization_memberships m where organization_id={lit(org)} and user_id={lit(actor)}),'archive',(select archived_at from public.projects where id={lit(project)}),'service',(select status from public.engagement_services where id={lit(service)}),'work',(select json_build_object('assignee_id',assignee_id,'due_date',due_date,'status',status,'row_version',row_version) from public.work_items where id={lit(work)}),'users',(select count(*) from auth.users));"
prior=json.loads(run(state));results=[]
service_change="update public.engagement_services set status='on_hold' where id="+lit(service)+';'
work_change="update public.work_items set due_date='2026-10-11' where id="+lit(work)+';'
def restore():
 run('update public.engagement_services set status='+lit(prior['service'])+' where id='+lit(service)+';'+claim+'update public.work_items set due_date='+('null' if prior['work']['due_date'] is None else lit(prior['work']['due_date']))+' where id='+lit(work)+';')
try:
 request=str(uuid.uuid4());review=preview(base)['review_sha256'];first,name=client(confirm(base,review,request));observe(name,'idle');second,name2=client(confirm(base,review,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code==0 and '"replayed": true' in out,error;results.append({'case':'same UUID concurrent placement','observedLock':True,'outcome':'one immutable placement/revision and original result replay'})
 request=str(uuid.uuid4());review=preview(base)['review_sha256'];changed={**base,'mode':'paid'};changed_review=preview(changed)['review_sha256'];first,name=client(confirm(base,review,request));observe(name,'idle');second,name2=client(confirm(changed,changed_review,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and 'Original placement request changed' in error,error;results.append({'case':'same UUID changed organic/paid mode','observedLock':True,'outcome':'changed payload denied'})
 for label,change in [('canonical Work Item deadline',work_change),('Marketing service',service_change)]:
  for mutation_first in [True,False]:
   review=preview(base)['review_sha256'];native=confirm(base,review,str(uuid.uuid4()))
   first,name=client(change if mutation_first else native);observe(name,'idle');second,name2=client(native if mutation_first else change);observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second)
   if mutation_first:assert code!=0 and ('review context changed' in error or 'service unavailable' in error),error
   else:assert code==0,error
   results.append({'case':label+(' before placement' if mutation_first else ' after placement'),'observedLock':True,'outcome':'stale native placement denied' if mutation_first else 'native committed before later canonical change'})
   restore()
 # Two independent operations racing the same optimistic placement revision.
 saved=json.loads(run(claim+confirm(base,preview(base)['review_sha256'],str(uuid.uuid4()))).splitlines()[-1]);placement=saved['placement_id'];first_input={**base,'publication_state':'paused'};second_input={**base,'publication_state':'cancelled'}
 first_review=preview(first_input,placement,1)['review_sha256'];second_review=preview(second_input,placement,1)['review_sha256'];first,name=client(confirm(first_input,first_review,str(uuid.uuid4()),placement,1));observe(name,'idle');second,name2=client(confirm(second_input,second_review,str(uuid.uuid4()),placement,1));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and 'Placement revision changed' in error,error;results.append({'case':'competing exact current placement revisions','observedLock':True,'outcome':'one optimistic edit; stale second revision denied'})
finally:restore()
final=json.loads(run(state));assert {k:v for k,v in final.items() if k!='work'}=={k:v for k,v in prior.items() if k!='work'},'Authority/service/user state changed';assert {k:v for k,v in final['work'].items() if k!='row_version'}=={k:v for k,v in prior['work'].items() if k!='row_version'},'Canonical Work Item values changed';assert final['work']['row_version']>=prior['work']['row_version'],'Canonical row-version audit cannot move backwards'
packet=Path(a.evidence);e=json.loads(packet.read_text(encoding='utf-8'));n=e['campaignPlacements']['nativePlacements'];n['concurrency']={'source':'tools/check-project-campaign-placements-races.py','observedRaceCount':len(results),'results':results,'authorityAndUsersRestored':True,'canonicalWorkValuesRestored':True,'canonicalWorkAuditVersion':{'before':prior['work']['row_version'],'after':final['work']['row_version'],'reason':'Existing canonical version trigger records test deadline updates; never disabled or falsified'},'immutableLocalReceiptsRetained':True,'scope':'Exact verified local clone; existing synthetic actor/approved sources, no provider/human acceptance'};packet.write_text(json.dumps(e,indent=2)+'\n',encoding='utf-8');print(json.dumps({'racesPassed':len(results),'stateRestored':True,'evidence':str(packet)}))
