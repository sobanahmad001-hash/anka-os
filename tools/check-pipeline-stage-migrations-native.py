"""Approved owned-local-clone QA only. Immutable synthetic audit is retained; no users/providers."""
import argparse,hashlib,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);args=p.parse_args();repo=Path(args.repo)
org='99999999-9999-4999-8999-999999999901';actor='99999999-9999-4999-8999-999999999902';eng='99999999-9999-4999-8999-999999999975';project='99999999-9999-4999-8999-999999999974';preset='99999999-9999-4999-8999-999999997012';definition='99999999-9999-4999-8999-999999997014';mktpreset='99999999-9999-4999-8999-999999997022';mktdefinition='99999999-9999-4999-8999-999999997024'
cmd=[args.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
claim=f"do $$begin perform set_config('request.jwt.claim.sub','{actor}',false);perform set_config('request.jwt.claims','{{\"sub\":\"{actor}\",\"role\":\"authenticated\"}}',false);end;$$;"
def run(sql,check=True):
 r=subprocess.run(cmd,input=claim+sql,text=True,capture_output=True,timeout=40)
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r
identity=json.loads(run("select json_build_object('database',current_database(),'host',inet_server_addr(),'port',inet_server_port(),'data',current_setting('data_directory'),'user',current_user);").stdout)
assert identity=={'database':'anka_b1_firstsend_20260930','host':'127.0.0.1','port':55462,'data':'G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data','user':'postgres'},identity
q=lambda x:"'"+str(x).replace("'","''")+"'"
def launch(name,sql,keep=False):
 r=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ,PGAPPNAME=name));r.stdin.write(claim+"begin;set local lock_timeout='12s';set local statement_timeout='25s';"+sql+'\n');r.stdin.flush()
 if not keep:r.stdin.write('commit;\n');r.stdin.close();r.stdin=None
 return r
def wait_state(name,condition):
 deadline=time.monotonic()+8
 while time.monotonic()<deadline:
  if run(f"select exists(select 1 from pg_stat_activity where application_name={q(name)} and {condition});").stdout.strip()=='t':return
  time.sleep(.05)
 raise RuntimeError('Expected backend state missing: '+name+' '+condition)
def finish(r):
 if r.stdin:r.stdin.write('commit;\n');r.stdin.close();r.stdin=None
 out,err=r.communicate(timeout=30);return r.returncode,out,err



import re
receipt=json.loads(Path(args.evidence).with_name('b2-installed-schema-receipt.json').read_text(encoding='utf-8'))
files=[repo/'supabase/migrations/20261001010000_pipeline_published_stage_contracts.sql',repo/'supabase/migrations/20261001011000_pipeline_reviewed_stage_fulfilment.sql']
pattern=re.compile(r'(?ims)^create(?: or replace)? function\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\([^)]*\).*?\bas\s+(\$[a-z_]*\$).*?\2;')
functions={m.group(1):m.group(0) for path in files for m in pattern.finditer(path.read_text())}
assert len(functions)==15,(len(functions),list(functions))
old={row['schema']+'.'+row['name']:row['definition'] for row in receipt['independentPipelinePrerequisites']['functions']}
old.update({row['schema']+'.'+row['name']:row['definition'] for row in receipt['stageArtifactPrerequisites']['lockingPrerequisites']['functions']})
old['public.create_pipeline_execution_definition']=receipt['stageArtifactPrerequisites']['functions'][0]['definition']
old.update({m.group(1):m.group(0) for m in pattern.finditer((repo/'supabase/migrations/20261001004000_project_independent_pipeline_groups.sql').read_text())})
names=','.join(q(name) for name in sorted(functions))
snapshot=f"select json_build_object('functions',(select jsonb_object_agg(n.nspname||'.'||p.proname,md5(p.prosrc)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname in ({names})),'reviews',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text,'[]')) from public.project_pipeline_stage_reviews r),'columns',(select md5(jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable) order by ordinal_position)::text) from information_schema.columns where table_schema='public' and table_name='ai_execution_configured_steps'));"
before=json.loads(run(snapshot).stdout)
new=['public.create_reviewed_project_pipeline_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint)','public.list_project_pipeline_stage_artifacts(uuid,uuid,text,integer,integer)','private.current_pipeline_stage_review(uuid,uuid)','private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)','private.valid_pipeline_stage_contract(jsonb)']
reset=''.join('drop function '+name+';' for name in new)+'drop table public.project_pipeline_stage_reviews;alter table public.ai_execution_configured_steps drop column reused_artifact_version_id,drop column reuse_approval_id;'
restores=''
for name in functions:
 if name in old:restores+=old[name].strip().rstrip(';')+';'
 elif not any(name+'(' in declaration for declaration in new):raise RuntimeError('Missing exact old source: '+name)
def without_transaction(s):
 s=re.sub(r'(?im)^begin;\s*','',s,count=1)
 s=re.sub(r'(?im)^commit;\s*$','',s)
 assert not re.search(r'(?im)^commit;',s)
 return s
migrations=''.join(without_transaction(path.read_text()) for path in files)
result=run('begin;set local lock_timeout=\'5s\';'+reset+restores+migrations+snapshot+'rollback;')
after=json.loads(result.stdout.strip().splitlines()[-1])
assert after['functions']==before['functions'],{'before':before['functions'],'after':after['functions']}
assert after['columns']==before['columns'],'Column contract changed across source replay'
assert json.loads(run(snapshot).stdout)==before,'Rollback did not restore exact installed source/history'
evidence=json.loads(Path(args.evidence).read_text(encoding='utf-8'));evidence['stageFulfilment']['native']['atomicMigrationReplay']={'databaseIdentity':identity,'sourceFiles':[{'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in files],'functionCount':len(functions),'exactInstalledBodiesMatched':True,'columnContractMatched':True,'allHistoryRestoredByRollback':True,'scope':'Owned local clone; candidate objects reverted only inside one atomic transaction, exact prerequisites restored from saved source, both complete migrations reapplied then rolled back'}
Path(args.evidence).write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print('Atomic stage migration source replay PASS',len(functions),flush=True)
