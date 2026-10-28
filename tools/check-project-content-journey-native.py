"""New isolated PG17 database: actual current scope helpers, exact new migration, synthetic records."""
import argparse,json,subprocess,socket,uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
p=argparse.ArgumentParser();p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);p.add_argument('--helpers',required=True);a=p.parse_args()
qa=Path(a.qa).resolve();qa.mkdir(parents=True,exist_ok=True);data=qa/'data';port=29936;flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
def cmd(exe,args):
 with (qa/'commands.log').open('ab') as f:r=subprocess.run([str(Path(a.pgbin)/exe),*map(str,args)],stdout=f,stderr=subprocess.STDOUT,creationflags=flags,timeout=60)
 if r.returncode:raise RuntimeError('See owned commands.log')
assert not data.exists(),'Preserve existing QA data; choose a new output folder'
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Port occupied'
cmd('initdb.exe',['-D',data,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
cmd('pg_ctl.exe',['-D',data,'-l',qa/'server.log','-o',f'-h 127.0.0.1 -p {port}','-w','start'])
base=[str(Path(a.pgbin)/'psql.exe'),'-X','-w','-h','127.0.0.1','-p',str(port),'-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
db='journey_'+uuid.uuid4().hex[:8]
def run(sql,database=None):return subprocess.run(base+['-d',database or db],input=sql,text=True,encoding='utf8',capture_output=True,creationflags=flags,timeout=30)
def sql(s):
 r=run(s)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
checks=[]
try:
 assert Path(run('show data_directory','postgres').stdout.strip()).resolve()==data
 assert run('create database '+db,'postgres').returncode==0
 sql('''create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;
 create table public.organizations(id uuid primary key,status text);
 create table public.organization_memberships(organization_id uuid,user_id uuid,role text,status text,member_kind text);
 create table public.projects(id uuid primary key,organization_id uuid,archived_at timestamptz);
 create table public.project_manager_bindings(organization_id uuid,project_id uuid,user_id uuid,status text);
 create table public.engagements(id uuid primary key,organization_id uuid,project_id uuid);
 create table public.work_items(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,department_id text,deleted_at timestamptz,status text);
 create table public.department_chat_conversations(id uuid primary key,organization_id uuid,project_id uuid,owner_id uuid,context_kind text,state text,archived_at timestamptz);
 create table public.department_chat_messages(id uuid primary key,conversation_id uuid,organization_id uuid,project_id uuid,author_id uuid,role text);
 create table public.project_context_chat_shares(conversation_id uuid,recipient_id uuid,revoked_at timestamptz);
 ''')
 for h in json.loads(Path(a.helpers).read_text(encoding='utf8')):
  if h['signature'] in ['private.n1b_preserve_receipt()','private.n1c_require_scope(uuid,uuid,uuid)','private.n2_scope_require_member(uuid,uuid,boolean)']:sql(h['definition'])
 sql(Path('supabase/migrations/20261028091649_project_conversation_content_journey.sql').read_text(encoding='utf8'))
 uid=lambda n:f'f0000000-0000-4000-8000-{n:012d}'
 org,actor,other,project,eng,conv,msg,work,privateconv,foreignwork,foreignproject=[uid(i) for i in range(1,12)]
 q=lambda s:"'"+s+"'"
 sql(f"insert into auth.users values({q(actor)}),({q(other)});insert into public.organizations values({q(org)},'active');insert into public.organization_memberships values({q(org)},{q(actor)},'team_member','active','team'),({q(org)},{q(other)},'team_member','active','team');insert into public.projects values({q(project)},{q(org)},null),({q(foreignproject)},{q(org)},null);insert into public.engagements values({q(eng)},{q(org)},{q(project)});insert into public.work_items values({q(work)},{q(org)},{q(project)},{q(eng)},'content',null,'not_started'),({q(foreignwork)},{q(org)},{q(foreignproject)},{q(eng)},'content',null,'not_started');insert into public.department_chat_conversations values({q(conv)},{q(org)},{q(project)},{q(actor)},'project_team','active',null),({q(privateconv)},{q(org)},{q(project)},{q(actor)},'private','active',null);insert into public.department_chat_messages values({q(msg)},{q(conv)},{q(org)},{q(project)},{q(actor)},'user');")
 bind=lambda c=conv,m=msg,w=work:f"select public.bind_project_content_journey({q(org)},{q(project)},{q(c)},{q(m)},{q(w)});"
 read=lambda c=conv:f"select jsonb_array_length(public.read_project_content_journeys({q(org)},{q(project)},{q(c)}));"
 def auth(s,who=actor,role='authenticated'):return f"begin;set local role {role};set local request.jwt.claim.sub={q(who)};{s}commit;"
 def denied(s,code='42501',who=actor,role='authenticated'):
  r=run(auth(s,who,role));assert r.returncode and code in r.stderr,r.stderr;checks.append('denial '+code)
 original=sql(auth(bind()));assert json.loads(original)['source_message_id']==msg;checks.append('exact immutable origin binding')
 assert sql(auth(bind()))==original;checks.append('deterministic replay')
 assert sql(auth(read()))=='1';checks.append('original conversation recovery read')
 denied(bind(),who=other);denied(read(),who=other);denied(bind(c=privateconv));denied(bind(m=uid(99)));denied(bind(w=foreignwork));denied(bind(),role='anon');denied(read(),role='service_role')
 sql(f"insert into public.project_context_chat_shares values({q(conv)},{q(other)},null)");assert sql(auth(read(),other))=='1';checks.append('explicit shared read')
 sql(f"update public.project_context_chat_shares set revoked_at=now()");denied(read(),who=other)
 sql(f"update public.department_chat_messages set role='assistant'");denied(bind());sql(f"update public.department_chat_messages set role='user'")
 sql(f"update public.organization_memberships set status='inactive' where user_id={q(actor)}");denied(read());denied(bind());sql(f"update public.organization_memberships set status='active'")
 denied("select * from private.project_content_journeys");denied("update private.project_content_journeys set source_message_id=source_message_id")
 assert run('update private.project_content_journeys set created_at=now()').returncode;checks.append('immutable history even privileged update')
 sql(f"delete from public.project_context_chat_shares;update public.work_items set status='done' where id={q(work)}")
 assert sql(auth(bind()))==original;assert sql("select status from public.work_items where id="+q(work))=='done';checks.append('completed work unchanged')
 with ThreadPoolExecutor(2) as pool:assert len(set(pool.map(lambda _:sql(auth(bind())),range(2))))==1
 checks.append('concurrent identical link is single record')
 assert sql('select count(*) from private.project_content_journeys')=='1';checks.append('one canonical pointer only')
 (qa/'result.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'database':db,'port':port,'base':'synthetic','authority':'actual current scope helpers','migration':'exact source'},indent=2));print(json.dumps({'passed':len(checks),'database':db}))
finally:cmd('pg_ctl.exe',['-D',data,'-m','fast','-w','stop'])
