"""Scoped local read-only AD1 editor verification; no users, providers or production calls."""
import argparse,hashlib,json,re,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
claim="do $$begin perform set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',false);end;$$;"
def run(sql):
 r=subprocess.run(cmd,input=claim+sql,text=True,encoding='utf-8',capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr)
 return r
identity=run("select current_database()||'|'||current_setting('data_directory');").stdout.strip();assert identity=='anka_b1_firstsend_20260930|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data',identity
signature='public.get_project_website_page_editor(uuid,uuid,uuid,uuid,text,integer,integer,integer)'
state=f"select json_build_object('source',md5(pg_get_functiondef('{signature}'::regprocedure)),'acl',(select proacl::text from pg_proc where oid='{signature}'::regprocedure),'history',json_build_array((select count(*) from public.artifact_versions),(select count(*) from public.artifact_approvals),(select json_agg(w order by id) from public.work_items w where id='99999999-9999-4999-8999-999999997160'),(select json_agg(m order by id) from public.organization_memberships m where organization_id='99999999-9999-4999-8999-999999999901'),(select archived_at from public.projects where id='99999999-9999-4999-8999-999999999974'),(select count(*) from public.project_website_page_commands)));"
prior=json.loads(run(state).stdout);migration=repo/'supabase/migrations/20261001014000_website_page_editor_context.sql';source=migration.read_text(encoding='utf-8');body=re.sub(r'(?im)^begin;\s*','',source,count=1);body=re.sub(r'(?im)^commit;\s*$','',body)
replay=json.loads(run('begin;drop function '+signature+';'+body+state+'rollback;').stdout.strip().splitlines()[-1]);assert replay==prior;assert json.loads(run(state).stdout)==prior;print('AD1 exact editor migration source/grants replay PASS',flush=True)
behavior=run((repo/'supabase/tests/website_page_editor.behavior.sql').read_text(encoding='utf-8'));count=behavior.stderr.count('PASS ');assert count==20,count;assert json.loads(run(state).stdout)==prior,'Editor QA leaked canonical work/history or authority';print('AD1 editor rollback behavior PASS',count,flush=True)
packet=Path(a.evidence);e=json.loads(packet.read_text(encoding='utf-8'));e['pageIdentity']['editorContext']={'migration':migration.name,'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'databaseIdentity':identity,'completeMigrationReplay':True,'behaviorPassCount':count,'historyAndAuthorityRestored':True,'currentAuthorityRacesReused':'6255be9 nine observed races on unchanged exact website_write_authorized/website_approved_source lock boundaries; editor invokes the same gates before canonical bytes','scope':'Read-only exact selected approved page and bounded existing work/SEO candidates; synthetic approval/size fixtures not human acceptance'};packet.write_text(json.dumps(e,indent=2)+'\n',encoding='utf-8')
