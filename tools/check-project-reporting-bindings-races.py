"""Observed local AD3 lock races; retained synthetic audit, no users/provider calls."""
import argparse,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(cmd+['-c',sql],text=True,encoding='utf-8',capture_output=True,timeout=15)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');");assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';connection='99999999-9999-4999-8999-999999997230'
claim="select set_config('request.jwt.claim.sub','"+actor+"',false);"
def lit(value):return "'"+str(value).replace("'","''")+"'"
base={'binding_id':None,'expected_revision':0,'engagement_id':'99999999-9999-4999-8999-999999999975','department_id':'marketing','connection_id':connection,'resource_kind':'ga4_property','resource_key':'123456','permitted_operations':['reporting_read'],'state':'enabled'}
def current_input():
 rows=json.loads(run("select coalesce(json_agg(json_build_object('binding_id',b.id,'expected_revision',(select max(revision_number) from public.project_reporting_binding_revisions where binding_id=b.id))),'[]') from public.project_reporting_bindings b where connection_id="+lit(connection)+';'))
 return {**base,**(rows[0] if rows else {})}
def preview(value):return json.loads(run(claim+"select public.preview_project_reporting_binding("+lit(org)+','+lit(project)+','+lit(json.dumps(value))+'::jsonb);').splitlines()[-1])
def confirm(value,review,request):return "select public.confirm_project_reporting_binding("+','.join([lit(org),lit(project),lit(json.dumps(value))+'::jsonb',lit(review),lit(request)])+');'
def client(sql):
 name='anka-ad3-'+uuid.uuid4().hex
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
fixture=(repo/'supabase/tests/project_reporting_bindings.behavior.sql').read_text(encoding='utf-8').split('create function pg_temp')[0]
fixture=fixture.replace('truncate public.project_reporting_binding_revisions,public.project_reporting_binding_commands,public.project_reporting_bindings;','')
fixture=fixture.replace("alter table public.activity_events alter column organization_id set default '99999999-9999-4999-8999-999999999901'::uuid;",'')
for old,new in [('999999997210','999999997230'),('999999997211','999999997231'),('999999997212','999999997232'),('999999997213','999999997233')]:fixture=fixture.replace(old,new)
fixture=fixture.replace('Synthetic reporting ','Synthetic reporting race ').replace('567890123','345678901').replace('678901234','456789012')
assert 'truncate ' not in fixture.lower() and 'alter table' not in fixture.lower(),'Race fixtures must preserve existing schema and candidate audit'
exists=run('select count(*) from public.integration_connections where id='+lit(connection)+';')
if exists=='0':run(fixture+'commit;')
state=f"select json_build_object('member',(select to_jsonb(m) from public.organization_memberships m where organization_id={lit(org)} and user_id={lit(actor)}),'archive',(select archived_at from public.projects where id={lit(project)}),'config',(select public_config from public.integration_connections where id={lit(connection)}),'connectionStatus',(select status from public.integration_connections where id={lit(connection)}),'connectionArchived',(select archived_at from public.integration_connections where id={lit(connection)}),'mapping',(select to_jsonb(m) from public.integration_connection_engagements m where connection_id={lit(connection)} and engagement_id='99999999-9999-4999-8999-999999999975' and department_id='marketing'),'scopes',(select to_jsonb(granted_scopes) from public.integration_oauth_credentials where connection_id={lit(connection)}),'credentialRevision',(select updated_at from public.integration_oauth_credentials where connection_id={lit(connection)}),'users',(select count(*) from auth.users));"
prior=json.loads(run(state));results=[]
mapping_change='update public.integration_connection_engagements set created_at=created_at+interval '+lit('1 second')+' where connection_id='+lit(connection)+';'
grant_change="update public.integration_oauth_credentials set granted_scopes=array[]::text[] where connection_id="+lit(connection)+';'
selection_change="update public.integration_connections set public_config=public_config||'{\"property_id\":\"654321\"}'::jsonb where id="+lit(connection)+';'
def restore():
 run('update public.integration_connection_engagements set created_at='+lit(prior['mapping']['created_at'])+'::timestamptz where connection_id='+lit(connection)+';update public.integration_oauth_credentials set granted_scopes=array['+','.join(lit(x) for x in prior['scopes'])+'],updated_at='+lit(prior['credentialRevision'])+'::timestamptz where connection_id='+lit(connection)+';update public.integration_connections set public_config='+lit(json.dumps(prior['config']))+'::jsonb where id='+lit(connection)+';')
try:
 input=current_input();request=str(uuid.uuid4());review=preview(input)['review_sha256'];first,name=client(confirm(input,review,request));observe(name,'idle');second,name2=client(confirm(input,review,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code==0 and '"replayed": true' in out,error;results.append({'case':'same UUID concurrent binding','observedLock':True,'outcome':'one immutable revision and original receipt replay'})
 input=current_input();request=str(uuid.uuid4());review=preview(input)['review_sha256'];changed={**input,'state':'paused'};changed_review=preview(changed)['review_sha256'];first,name=client(confirm(input,review,request));observe(name,'idle');second,name2=client(confirm(changed,changed_review,request));observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second);assert code!=0 and 'Original request payload changed' in error,error;results.append({'case':'same UUID changed binding state','observedLock':True,'outcome':'changed payload denied'})
 for label,change in [('mapping identity',mapping_change),('observed reporting grant',grant_change),('selected resource',selection_change)]:
  for mutation_first in [True,False]:
   input=current_input();review=preview(input)['review_sha256'];native=confirm(input,review,str(uuid.uuid4()))
   first,name=client(change if mutation_first else native);observe(name,'idle');second,name2=client(native if mutation_first else change);observe(name2,'blocked');assert finish(first)[0]==0;code,out,error=finish(second)
   if mutation_first:assert code!=0 and ('review context changed' in error or 'resource unavailable' in error),error
   else:assert code==0,error
   results.append({'case':label+(' before binding' if mutation_first else ' after binding'),'observedLock':True,'outcome':'stale native binding denied' if mutation_first else 'native committed before later invalidation'})
   restore()
finally:restore()
final=json.loads(run(state))
# The existing credential trigger advances updated_at on every legitimate metadata update.
# Preserve that synthetic audit stamp; compare all mutable grants/mapping/authority/user values exactly.
assert {k:v for k,v in final.items() if k!='credentialRevision'}=={k:v for k,v in prior.items() if k!='credentialRevision'},'Connector/authority/user values changed'

packet=Path(a.evidence);e=json.loads(packet.read_text(encoding='utf-8'));n=e['projectResources']['nativeBindings'];n['concurrency']={'source':'tools/check-project-reporting-bindings-races.py','observedRaceCount':len(results),'results':results,'authorityAndUsersRestored':True,'connectorMappingGrantStateRestored':True,'immutableLocalReceiptsRetained':True,'syntheticCredentialAuditStamp':{'before':prior['credentialRevision'],'after':final['credentialRevision'],'reason':'Existing updated_at trigger records test revocation/regrant; never disabled or falsified'},'scope':'Exact verified local clone; synthetic metadata-only credentials, no provider or human acceptance'};packet.write_text(json.dumps(e,indent=2)+'\n',encoding='utf-8');print(json.dumps({'racesPassed':len(results),'stateRestored':True,'evidence':str(packet)}))
