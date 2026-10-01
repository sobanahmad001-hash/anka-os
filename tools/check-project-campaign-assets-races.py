"""Observed local AD2 lock races; retained synthetic audit, no users/provider calls."""
import argparse,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(cmd+['-c',sql],text=True,encoding='utf-8',capture_output=True,timeout=15)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');");assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';service='99999999-9999-4999-8999-999999997171'
claim="select set_config('request.jwt.claim.sub','"+actor+"',false);"
def lit(value):return "'"+str(value).replace("'","''")+"'"
input={'command_kind':'register_asset','campaign_id':'99999999-9999-4999-8999-999999997172','plan_version_id':'99999999-9999-4999-8999-999999997173','marketing_service_id':service,'source_kind':'artifact_version','source_version_id':'99999999-9999-4999-8999-999999997111','asset_id':None,'label':None}
def preview(value):return json.loads(run(claim+"select public.preview_project_campaign_asset("+lit(org)+','+lit(project)+','+lit(json.dumps(value))+'::jsonb);').splitlines()[-1])
def confirm(value,review,request):return "select public.confirm_project_campaign_asset("+','.join([lit(org),lit(project),lit(json.dumps(value))+'::jsonb',lit(review),lit(request)])+');'
def client(sql):
 name='anka-ad2-'+uuid.uuid4().hex
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
fixture=(repo/'supabase/tests/project_campaign_assets.behavior.sql').read_text(encoding='utf-8').split('create function pg_temp')[0]
fixture=fixture.replace('truncate public.project_campaign_asset_variants,public.project_campaign_asset_links,public.project_campaign_asset_commands,public.project_campaign_assets;','')
assert 'truncate ' not in fixture.lower(),'Race fixtures must preserve retained candidate audit'
run(fixture+'commit;')
state=f"select json_build_object('member',(select to_jsonb(m) from public.organization_memberships m where organization_id={lit(org)} and user_id={lit(actor)}),'archive',(select archived_at from public.projects where id={lit(project)}),'service',(select status from public.engagement_services where id={lit(service)}),'users',(select count(*) from auth.users));"
prior=json.loads(run(state));results=[]
member_change="update public.organization_memberships set status='suspended' where organization_id="+lit(org)+' and user_id='+lit(actor)+';'
archive_change='update public.projects set archived_at=now() where id='+lit(project)+';'
service_change="update public.engagement_services set status='on_hold' where id="+lit(service)+';'
def restore():
 run('update public.organization_memberships set status='+lit(prior['member']['status'])+' where organization_id='+lit(org)+' and user_id='+lit(actor)+';update public.projects set archived_at='+('null' if prior['archive'] is None else lit(prior['archive'])+'::timestamptz')+' where id='+lit(project)+';update public.engagement_services set status='+lit(prior['service'])+' where id='+lit(service)+';')
try:
 request=str(uuid.uuid4());review=preview(input)['review_sha256'];first,first_name=client(confirm(input,review,request));observe(first_name,'idle');second,second_name=client(confirm(input,review,request));observe(second_name,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code==0,error;assert '"replayed": true' in out;results.append({'case':'same UUID concurrent registration','observedLock':True,'outcome':'one command, original result replay'})
 request=str(uuid.uuid4());review=preview(input)['review_sha256'];changed={**input,'source_version_id':'99999999-9999-4999-8999-999999997180'};changed_review=preview(changed)['review_sha256'];first,name=client(confirm(input,review,request));observe(name,'idle');second,name2=client(confirm(changed,changed_review,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and 'Original request used with different' in error,error;results.append({'case':'same UUID changed canonical source','observedLock':True,'outcome':'changed payload denied'})
 for label,change in [('membership',member_change),('archive',archive_change),('Marketing service',service_change)]:
  for mutation_first in [True,False]:
   request=str(uuid.uuid4());review=preview(input)['review_sha256'];native=confirm(input,review,request)
   first,name=client(change if mutation_first else native);observe(name,'idle');second,name2=client(native if mutation_first else change);observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second)
   if mutation_first:assert code!=0 and ('required' in error.lower() or 'unavailable' in error.lower()),error
   else:assert code==0,error
   results.append({'case':label+(' before registration' if mutation_first else ' after registration'),'observedLock':True,'outcome':'native denied after committed revocation' if mutation_first else 'native committed before later revocation'})
   restore()
finally:restore()
assert json.loads(run(state))==prior,'Authority/user state changed'
packet=Path(a.evidence);e=json.loads(packet.read_text(encoding='utf-8'));n=e['campaignPlacements']['nativeAssets'];n['concurrency']={'source':'tools/check-project-campaign-assets-races.py','observedRaceCount':len(results),'results':results,'authorityAndUsersRestored':True,'immutableLocalReceiptsRetained':True,'scope':'Exact verified local clone; existing synthetic actor/source approvals, no real human/provider acceptance'};n['remaining']='Bounded registry reads, native placements/resource linkage, governed deliverable positive fixture, actual UI and installed production release remain pending.';packet.write_text(json.dumps(e,indent=2)+'\n',encoding='utf-8');print(json.dumps({'racesPassed':len(results),'authorityRestored':True,'evidence':str(packet)}))
