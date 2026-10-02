"""New candidate only; transactional accounting + affected one-call replay. No retained audit is overwritten."""
import argparse,hashlib,json,re,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo);packet=Path(a.evidence)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=90)
 if r.returncode:raise RuntimeError(r.stderr)
 return r
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');").stdout.strip();assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
assert run("select to_regclass('private.reporting_http_costs') is null;").stdout.strip()=='t','Accounting candidate already installed; adapt transactional replay, do not rerun blindly'
tables=['auth.users','public.organization_memberships','public.integration_connections','public.integration_connection_engagements','public.integration_oauth_credentials','public.project_reporting_bindings','public.project_reporting_binding_revisions','public.project_reporting_binding_commands','public.project_reporting_observations','public.project_reporting_sync_events','private.reporting_refresh_policies','private.reporting_refresh_adapters','private.reporting_verification_challenges','private.reporting_resource_verifications','private.reporting_verification_attempts','private.reporting_refresh_jobs','private.reporting_refresh_requests','private.reporting_refresh_attempts','private.reporting_refresh_results','private.reporting_refresh_pages']
snapshot="select jsonb_build_array("+','.join("(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from "+t+' t)' for t in tables)+");"
catalog="select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'definition',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'reporting_http_%' or p.proname in ('get_project_reporting_http_claim','claim_project_reporting_http_request','record_project_reporting_http_outcome','claim_project_reporting_verification','claim_project_reporting_refresh','complete_project_reporting_verification','commit_project_reporting_refresh_page');"
table_catalog="select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'acl',c.relacl::text,'policies',(select count(*) from pg_policy x where x.polrelid=c.oid),'constraints',(select string_agg(pg_get_constraintdef(x.oid),'|' order by x.conname) from pg_constraint x where x.conrelid=c.oid),'indexes',(select string_agg(pg_get_indexdef(i.indexrelid),'|' order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=c.oid),'triggers',(select string_agg(pg_get_triggerdef(t.oid),'|' order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('reporting_http_costs','reporting_http_reservations','reporting_http_permits','reporting_http_outcomes');"
prior=run(snapshot).stdout;before=run(catalog).stdout
migration=repo/'supabase/migrations/20261002131846_reporting_http_request_accounting.sql';source=migration.read_text(encoding='utf8');body=re.sub(r'(?im)^begin;\s*','',source,count=1);body=re.sub(r'(?im)^commit;\s*$','',body)
counts={}
for mode,file in [('accounting','reporting_http_request_accounting.behavior.sql'),('oneCallCompatibility','reporting_verification_dispatch.behavior.sql')]:
 saved=json.loads(packet.read_text(encoding='utf8'))['storedReporting'].get('httpRequestAccounting',{})
 if mode=='oneCallCompatibility' and saved.get('sha256')==hashlib.sha256(migration.read_bytes()).hexdigest() and saved.get('oneCallCompatibilityPassCount',0)>=34:
  counts[mode]=saved['oneCallCompatibilityPassCount'];print(mode,counts[mode],'unchanged evidence reused');continue
 behavior=(repo/'supabase/tests'/file).read_text(encoding='utf8');behavior=re.sub(r'(?im)^begin;\s*','',behavior,count=1).replace('B6 synthetic local reporting','B6 HTTP original one-call replay')
 try:
  result=run('begin;'+body+behavior)
  (packet.parent/('b6-http-'+mode+'-final.log')).write_text(result.stdout+'\n'+result.stderr,encoding='utf8',newline='\n');counts[mode]=result.stderr.count('PASS ');print(mode,counts[mode])
 finally:
  assert run(snapshot).stdout==prior,'Original history/authority/users changed'
  assert run(catalog).stdout==before,'Original installed functions changed'
assert counts['accounting']>=55 and counts['oneCallCompatibility']>=34,counts
cat=json.loads(run('begin;'+body+catalog+'rollback;').stdout);tabs=json.loads(run('begin;'+body+table_catalog+'rollback;').stdout);assert len(cat)==11 and len(tabs)==4
assert all(t['rls'] and t['policies']==0 and t['acl']=='{postgres=arwdDxtm/postgres}' and t['triggers'] for t in tabs)
assert run(snapshot).stdout==prior and run(catalog).stdout==before
e=json.loads(packet.read_text(encoding='utf8'));e['storedReporting']['httpRequestAccounting'].update({'migration':migration.name,'sha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'databaseIdentity':identity,'nativePassCount':counts['accounting'],'oneCallCompatibilityPassCount':counts['oneCallCompatibility'],'catalog':cat,'tableCatalog':tabs,'originalDataAndFunctionsRestored':True,'status':'Transactional native/source/security candidate checks pass; not installed. Observed races and transport/native integration remain.'});packet.write_text(json.dumps(e,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n');print('PASS exact 11-function/4-closed-table catalog, original data/functions restored')
