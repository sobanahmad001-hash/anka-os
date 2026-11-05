"""Owned PG17 integration: actual stage-binding SQL and current n2/n6/n1c
authority functions on synthetic minimal tables. No production/business writes,
provider calls, PostgREST or full production RLS acceptance."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse, subprocess, json, socket, hashlib, os
p=argparse.ArgumentParser();p.add_argument('--qa',required=True);p.add_argument('--preimages',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--progress',action='store_true');a=p.parse_args()
repo=Path(__file__).resolve().parents[1];parent=Path(a.preimages);qa=Path(a.qa);data=qa/'data';bin=Path(a.pgbin);port=29988;started=False;checks=[]
assert not data.exists(),'Never reuse an existing data directory'
qa.mkdir(parents=True,exist_ok=True);os.environ['PGCLIENTENCODING']='UTF8'
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0
def control(args):
 with (qa/'control.log').open('a',encoding='utf8') as log:
  r=subprocess.run(list(map(str,args)),stdout=log,stderr=subprocess.STDOUT,creationflags=0x08000000,timeout=40);assert r.returncode==0
def raw(sql):
 r=subprocess.run([str(bin/'psql.exe'),'-X','-qAt','-h','127.0.0.1','-p',str(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=sql+'\n',capture_output=True,text=True,encoding='utf8',creationflags=0x08000000,timeout=30)
 with (qa/'commands.log').open('a',encoding='utf8') as log:log.write(sql+'\n'+r.stdout+r.stderr+'\n')
 return r
def run(sql):
 r=raw(sql);assert r.returncode==0,r.stderr;return r.stdout.strip()
def value(sql):return json.loads(run(sql).splitlines()[-1])
def denied(sql,code):
 r=raw(sql);assert r.returncode and code in r.stderr,(code,r.stdout,r.stderr)
def passed(name):checks.append(name)
u=lambda n:f'cc000000-0000-4000-8000-{n:012d}'
q=lambda x:'null' if x is None else "'"+str(x).replace("'","''")+"'"
j=lambda x:q(json.dumps(x))+'::jsonb'
def actor(sql,who=4,role='authenticated'):return 'set qa.actor='+q(u(who) if who else '')+';set role '+role+';'+sql
def review(bindings,head,who=4):return value(actor('select public.review_project_stage_bindings('+','.join([q(u(1)),q(u(2)),q(u(3)),q(head),j(bindings)])+')',who))
def apply_sql(bindings,head,request,sha,who=4):return actor('select public.apply_project_stage_bindings('+','.join([q(u(1)),q(u(2)),q(u(3)),q(head),q(u(request)),q(sha),j(bindings)])+')',who)
def recover(req,who=4):return value(actor('select public.recover_project_stage_bindings('+','.join(map(q,[u(1),u(2),u(3),u(req)]))+')',who))
try:
 control([bin/'initdb.exe','-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale'])
 control([bin/'pg_ctl.exe','-D',data,'-l',qa/'server.log','-o',f'-p {port} -h 127.0.0.1','-w','start']);started=True
 run("""create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.actor',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table public.organizations(id uuid primary key,status text);
 create table public.organization_memberships(organization_id uuid,user_id uuid,status text,member_kind text,role text);
 create table public.projects(id uuid primary key,organization_id uuid,archived_at timestamptz);
 create table public.project_manager_bindings(organization_id uuid,project_id uuid,user_id uuid,status text);
 create table public.engagements(id uuid primary key,organization_id uuid,project_id uuid,status text);
 create table public.project_pipeline_groups(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,kind text,preset_publication_id uuid);
 create table public.pipeline_execution_publications(id uuid primary key,organization_id uuid,definition_id uuid);
 create table public.pipeline_execution_definitions(id uuid primary key,organization_id uuid,preset_publication_id uuid,steps jsonb,steps_sha256 text,name text,version_number integer);
 create table public.pipeline_template_publications(id uuid primary key,organization_id uuid);
 create table private.project_delivery_plan_versions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,
 version_number integer not null check(version_number>0),parent_version_id uuid references private.project_delivery_plan_versions(id),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=1048576),
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),created_by uuid not null,created_at timestamptz default clock_timestamp(),
 unique(organization_id,project_id,engagement_id,version_number),unique(organization_id,created_by,request_id));
 alter table private.project_delivery_plan_versions enable row level security;
 revoke all on private.project_delivery_plan_versions from public,anon,authenticated,service_role;""")
 additional=json.loads((parent/'additional-function-preimages.json').read_text(encoding='utf8'))
 authority=json.loads((parent/'authority-preimages.json').read_text(encoding='utf8'))
 n1c=json.loads((parent/'n1c-preimage.json').read_text(encoding='utf8'))
 base=json.loads((parent/'function-preimages.json').read_text(encoding='utf8'))
 for f in n1c+[x for x in additional if x['proname']=='n2_scope_require_member']+authority+[x for x in base if x['proname']=='build_service_project_plan']:run(f['definition'])
 run("create trigger delivery_plan_immutable before update or delete on private.project_delivery_plan_versions for each row execute function private.n1b_preserve_receipt()")
 migration=(repo/'supabase/migrations/20261106082802_project_stage_plan_bindings.sql').read_text(encoding='utf8')
 run(migration)
 passed('entire migration installs with actual preimage guard and original helper definitions')
 step={'key':'draft','label':'Content','department_id':'content','service_id':u(12),'depends_on':[],'stage_contract':{'artifact_type':'content','output_type':None}}
 group={'pipeline_group_id':u(6),'kind':'website','definition_publication_id':u(7),'preset_publication_id':u(8),'stages':[dict(step,selected_service=True,planned_quantity=2,source_review_required=True)]}
 snapshot={'organization_id':u(1),'project_id':u(2),'engagement_id':u(3),'groups':[group],'contributions':[{'service_id':u(12),'quantity':2}],'foundation':{'fixture':'retained'},'unchanged_history':{'asset':u(90)}}
 binding={'group_id':u(6),'publication_id':u(7),'step_key':'draft','phase':'website.content'}
 run(f"""insert into organizations values({q(u(1))},'active');
 insert into projects values({q(u(2))},{q(u(1))},null);
 insert into engagements values({q(u(3))},{q(u(1))},{q(u(2))},'active');
 insert into organization_memberships values({q(u(1))},{q(u(4))},'active','team','system_owner'),({q(u(1))},{q(u(5))},'active','team','team_member'),({q(u(1))},{q(u(15))},'active','team','team_member');
 insert into project_manager_bindings values({q(u(1))},{q(u(2))},{q(u(15))},'active');
 insert into project_pipeline_groups values({q(u(6))},{q(u(1))},{q(u(2))},{q(u(3))},'website',{q(u(8))});
 insert into pipeline_execution_publications values({q(u(7))},{q(u(1))},{q(u(9))});
 insert into pipeline_execution_definitions values({q(u(9))},{q(u(1))},{q(u(8))},{j([step])},encode(sha256(convert_to({j([step])}::text,'UTF8')),'hex'),'Content',1);
 insert into private.project_delivery_plan_versions(id,organization_id,project_id,engagement_id,version_number,snapshot,request_id,request_sha256,created_by)
 values({q(u(10))},{q(u(1))},{q(u(2))},{q(u(3))},1,{j(snapshot)},{q(u(11))},{q('a'*64)},{q(u(4))});""")
 if a.progress:
  from project_stage_progress_fixture import verify
  verify(repo,parent,qa,run,raw,value,actor,u,q,j,binding)
  raise SystemExit(0)
 head=u(10);r=review([binding],head);assert r['changed'] and r['bindings']==[binding]
 assert review([binding],head,15)['review_sha256']==r['review_sha256']
 passed('actual owner and explicit current project manager resolve same exact saved published step')
 denied(actor('select public.review_project_stage_bindings('+','.join([q(u(1)),q(u(2)),q(u(3)),q(head),j([binding])])+')',5),'42501')
 denied(actor('select public.review_project_stage_bindings('+','.join([q(u(1)),q(u(2)),q(u(3)),q(head),j([binding])])+')',None),'42501')
 passed('active ordinary member and null actor cannot configure mappings')
 for altered,code in [(dict(binding,group_id=u(99)),'42501'),(dict(binding,publication_id=u(99)),'42501'),(dict(binding,step_key='guess'),'42501'),(dict(binding,phase='marketing.assets'),'42501'),(dict(binding,phase='website.invented'),'42501'),(dict(binding,done=True),'22023')]:
  denied(actor('select public.review_project_stage_bindings('+','.join([q(u(1)),q(u(2)),q(u(3)),q(head),j([altered])])+')'),code)
 denied(actor('select public.review_project_stage_bindings('+','.join([q(u(1)),q(u(2)),q(u(3)),q(head),j([binding,binding])])+')'),'22023')
 passed('foreign group/publication, guessed step, wrong track, unknown phase, forged completion and duplicate step denied')
 row=value(apply_sql([binding],head,20,r['review_sha256']));assert row['version_number']==2 and row['parent_version_id']==head
 assert {k:v for k,v in row['snapshot'].items() if k not in ('stage_bindings','parent_version_id')}==snapshot
 assert value(apply_sql([binding],head,20,r['review_sha256']))==row
 passed('single append preserves every prior field; exact original UUID replays without another plan')
 denied(apply_sql([],head,20,r['review_sha256']),'23505')
 denied(apply_sql([binding],head,21,r['review_sha256']),'40001')
 assert recover(20)['original_result']==row and recover(20,5)['status']=='not_found'
 assert recover(11)['status']=='not_found'
 passed('request collision, stale head and foreign actor cannot change/recover another command')
 run(f"update engagements set status='archived' where id={q(u(3))}")
 assert recover(20)['original_result']==row
 run(f"update engagements set status='active' where id={q(u(3))}")
 passed('original read-only recovery survives later engagement closure without preview or replay')
 denied(f"update private.project_delivery_plan_versions set snapshot='{{}}' where id={q(row['id'])}",'42501')
 denied("set role authenticated;select * from private.project_delivery_plan_versions",'42501')
 for role in ['anon','service_role']:
  denied(actor('select public.review_project_stage_bindings('+','.join([q(u(1)),q(u(2)),q(u(3)),q(row['id']),j([binding])])+')',4,role),'42501')
 passed('immutable plan history and private table/service/anonymous RPC boundaries remain closed')
 head=row['id'];r=review([],head)
 with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda req:raw(apply_sql([],head,req,r['review_sha256'])),[30,31]))
 assert sum(x.returncode==0 for x in results)==1 and any('40001' in x.stderr for x in results)
 passed('two concurrent exact-head edits yield one append and one stale-head denial')
 current=value("select to_jsonb(x) from private.project_delivery_plan_versions x order by version_number desc limit 1")
 assert current['snapshot']['stage_bindings']['bindings']==[]
 # Only the unchanged lower service/foundation providers below are synthetic.
 # Execute the actual modified planner, verifying its binding-retention branch.
 run("""create function public.get_project_setup(uuid,uuid) returns jsonb language sql as $$select '{"state":{"plan":{"contributions":[]}},"scopes":[],"catalog":[],"token":"fixture","can_manage":true}'::jsonb$$;
 create function private.resolve_project_foundation(uuid,uuid,jsonb) returns jsonb language sql as $$select null::jsonb$$;
 create function private.branding_preset_current(uuid,uuid) returns boolean language sql as $$select true$$;""")
 compiled=value(actor('select private.build_service_project_plan('+','.join([q(u(1)),q(u(2)),q(u(3)),"'{}'::jsonb"])+')',4,'postgres'))
 assert compiled['stage_bindings']==current['snapshot']['stage_bindings']
 passed('actual service-plan builder retains exact saved binding metadata across later plan compilation; lower service/foundation fixture disclosed')
 result={'status':'passed','checks':checks,'count':len(checks),'migration_sha256':hashlib.sha256(migration.encode()).hexdigest(),'boundary':'Actual migration/authority/replay/CAS/immutability on synthetic base; unchanged lower service/foundation providers synthetic. No PostgREST/UI/full production RLS/provider acceptance.','port':port}
 (qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8');print(json.dumps(result))
finally:
 if started:control([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
