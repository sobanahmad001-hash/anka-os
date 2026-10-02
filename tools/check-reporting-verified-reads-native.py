"""Exact installed local prerequisites; all verified-reader candidate tests rollback."""
import argparse,hashlib,json,re,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=90)
 if r.returncode:raise RuntimeError(r.stderr)
 return r
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');").stdout.strip();assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
tables=['public.project_reporting_observations','public.project_reporting_sync_events','public.project_reporting_bindings','public.project_reporting_binding_revisions','public.project_reporting_binding_commands','public.integration_connections','public.integration_connection_engagements','public.integration_oauth_credentials','public.organization_memberships','private.reporting_refresh_policies','private.reporting_refresh_adapters','private.reporting_verification_challenges','private.reporting_resource_verifications','private.reporting_refresh_jobs','private.reporting_refresh_requests','private.reporting_refresh_attempts','private.reporting_refresh_results','private.reporting_refresh_pages']
catalog="select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'definition',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('stored_reporting_verified','stored_reporting_context','list_project_stored_reporting_observations');"
snapshot="select jsonb_build_object('users',(select count(*) from auth.users),'rows',jsonb_build_array("+','.join("(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from "+x+' t)' for x in tables)+"));"
prior=run(snapshot).stdout;old=run(catalog).stdout
migration=repo/'supabase/migrations/20261002004000_reporting_verified_reads.sql';source=migration.read_text(encoding='utf8');body=re.sub(r'(?im)^begin;\s*','',source,count=1);body=re.sub(r'(?im)^commit;\s*$','',body)
behavior=(repo/'supabase/tests/reporting_verified_reads.behavior.sql').read_text(encoding='utf8');behavior=re.sub(r'(?im)^begin;\s*','',behavior,count=1)
r=run('begin;'+body+behavior);print(r.stderr);count=r.stderr.count('PASS ');assert count>=16,count;assert run(snapshot).stdout==prior and run(catalog).stdout==old,'Reader QA leaked original history, authority or changed installed source'
cat=json.loads(run('begin;'+body+catalog+'rollback;').stdout);assert len(cat)==3;assert run(snapshot).stdout==prior and run(catalog).stdout==old
packet=Path(a.evidence);e=json.loads(packet.read_text(encoding='utf8'));e['storedReporting']['verifiedReads']={'migration':migration.name,'sha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'databaseIdentity':identity,'behaviorPassCount':count,'catalog':cat,'allHistoryAuthorityUsersAndSourceRestored':True,'scope':'Native current resource/original source conditional reads; rollback-only synthetic evidence, no real provider or human acceptance','status':'Locally tested reader integration; not installed/deployed. Transport/UI and final release pending.'};packet.write_text(json.dumps(e,indent=2)+'\n',encoding='utf8',newline='\n');print('Verified stored reader PASS',count,'complete3-function/security catalog; original data/source restored')
