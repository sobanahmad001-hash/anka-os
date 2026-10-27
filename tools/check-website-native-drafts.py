"""Owned loopback PG17 QA only. Synthetic base schema; actual source helpers and W2 migration."""
import argparse,json,re,subprocess,uuid,socket,os
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);args=p.parse_args()
repo=Path(args.repo);qa=Path(args.qa).resolve();qa.mkdir(parents=True,exist_ok=True);data=qa/'data';port=29924
flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
def command(exe,arguments,**kwargs):
 with (qa/'commands.log').open('a',encoding='utf-8') as log:
  result=subprocess.run([str(Path(args.pgbin)/exe),*map(str,arguments)],stdout=log,stderr=subprocess.STDOUT,text=True,creationflags=flags,**kwargs)
 if result.returncode:raise RuntimeError('Native command failed; inspect commands.log')
 return ''
if not (data/'PG_VERSION').exists():
 with socket.socket() as test:assert test.connect_ex(('127.0.0.1',port))!=0,'Owned port already occupied'
 command('initdb.exe',['-D',data,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'],timeout=60)
status=subprocess.run([str(Path(args.pgbin)/'pg_ctl.exe'),'-D',str(data),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
if status.returncode:command('pg_ctl.exe',['-D',data,'-l',qa/'server.log','-o',f'-h 127.0.0.1 -p {port}','-w','start'],timeout=60)
base=['-X','-w','-h','127.0.0.1','-p',port,'-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];database='website_w2_'+uuid.uuid4().hex[:8]
def run(sql,db=None,ok=True):
 result=subprocess.run([str(Path(args.pgbin)/'psql.exe'),*map(str,base),'-d',db or database],input=sql,text=True,encoding='utf-8',capture_output=True,timeout=40,creationflags=flags)
 if ok and result.returncode:raise RuntimeError(result.stderr)
 return result
assert Path(run("select current_setting('data_directory')",'postgres').stdout.strip()).resolve()==data
run('create database '+database,'postgres')
bootstrap="""
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end$$;
create schema private;create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.organizations(id uuid primary key,status text);create table public.organization_memberships(organization_id uuid,user_id uuid,member_kind text,status text,role text,department_id text);
create table public.projects(id uuid,organization_id uuid,archived_at timestamptz,primary key(id,organization_id));
create table public.engagements(id uuid,organization_id uuid,project_id uuid,brand_id uuid,status text,primary key(id,organization_id),unique(id,project_id,organization_id));
create table public.artifacts(id uuid,organization_id uuid,project_id uuid,engagement_id uuid,brand_id uuid,artifact_type text,primary key(id,organization_id));
create table public.artifact_versions(id uuid,organization_id uuid,artifact_id uuid,version_number int,content jsonb,content_checksum text,ai_use_allowed boolean default false,primary key(id,organization_id));
create table public.artifact_approvals(id uuid,organization_id uuid,artifact_id uuid,artifact_version_id uuid,engagement_id uuid,decision text,approved_at timestamptz);
create table public.artifact_approval_requests(id uuid,organization_id uuid,artifact_version_id uuid,status text,created_at timestamptz);
create table public.service_catalog(id uuid,organization_id uuid,department_id text,slug text,is_active boolean);create table public.engagement_services(id uuid,organization_id uuid,engagement_id uuid,service_id uuid,status text);
create table public.project_website_pages(id uuid,organization_id uuid,project_id uuid,engagement_id uuid,brand_id uuid,architecture_artifact_id uuid,page_key text,primary key(id,organization_id));
create table public.design_creative_briefs(id uuid,organization_id uuid,engagement_id uuid,brand_id uuid,engagement_service_id uuid,project_task_id uuid,engagement_work_item_id uuid,visibility text,revision int,current_version_id uuid,frozen_version_id uuid,primary key(id,organization_id));
create table public.design_creative_brief_versions(id uuid,organization_id uuid,creative_brief_id uuid,content jsonb,content_checksum text,validation_snapshot jsonb,primary key(id,organization_id));
create table public.design_workshop_sessions(id uuid default gen_random_uuid(),organization_id uuid,engagement_id uuid,brand_id uuid,engagement_service_id uuid,project_task_id uuid,engagement_work_item_id uuid,output_family text,output_brief jsonb,designer_instructions text,context_manifest jsonb,context_checksum text,created_by uuid,primary key(id,organization_id));
create table public.design_directions(id uuid default gen_random_uuid(),organization_id uuid,session_id uuid,direction_slot int,primary key(id,organization_id));
create table public.design_direction_versions(id uuid default gen_random_uuid(),organization_id uuid,direction_id uuid,version_number int,content jsonb,content_checksum text,distinctness_signature text,created_by uuid,creative_brief_version_id uuid,is_experimental boolean default false,created_at timestamptz default clock_timestamp(),primary key(id,organization_id));
create table public.website_page_designs(id uuid default gen_random_uuid(),organization_id uuid,design_direction_version_id uuid,slug text,html_content text,css_content text,status text,created_by uuid,created_at timestamptz default clock_timestamp(),primary key(id,organization_id));
"""
run(bootstrap)
def function(file,name):
 text=(repo/'supabase/migrations'/file).read_text(encoding='utf-8');match=re.search(r'create (?:or replace )?function '+re.escape(name)+r'\([\s\S]*?\$\$;',text,re.I)
 if not match:raise RuntimeError('Missing actual helper '+name)
 return match[0]
for file,name in [('20260909202126_content_b03a_page_identity.sql','private.normalize_content_page_path'),('20261001011000_pipeline_reviewed_stage_fulfilment.sql','private.require_pipeline_approved_artifact'),('20261001013000_project_website_page_identity.sql','private.website_architecture_pages'),('20261001013000_project_website_page_identity.sql','private.website_approved_source')]:run(function(file,name))
run((repo/'supabase/migrations/20261027163000_website_native_design_drafts.sql').read_text(encoding='utf-8'))
uid=lambda n:'a0000000-0000-4000-8000-'+str(n).zfill(12)
q=lambda value:"'"+value.replace("'","''")+"'"
j=lambda value:q(json.dumps(value))+'::jsonb'
org,project,engagement,brand,actor,reader,outsider=[uid(n) for n in range(1,8)]
arch,content,identity,archv,contentv,identityv,approval,brief,briefv,service,catalog,page=[uid(n) for n in range(10,22)]
architecture={'schema_version':2,'pages':[{'page_key':'home','slug':'home','title':'Home','page_type':'hub'}]};copy={'page_path':'home','page_brief':'Welcome people','draft_copy':'Actual selected page copy','meta_title':'Exact home','meta_description':'Exact description','primary_cta':'Contact'}
seed=f"""insert into auth.users values({q(actor)}),({q(reader)}),({q(outsider)});insert into public.organizations values({q(org)},'active');insert into public.projects values({q(project)},{q(org)},null);insert into public.engagements values({q(engagement)},{q(org)},{q(project)},{q(brand)},'active');
insert into public.organization_memberships values({q(org)},{q(actor)},'team','active','contributor','design'),({q(org)},{q(reader)},'team','active','contributor','content');
insert into public.service_catalog values({q(catalog)},{q(org)},'design','setup_design_unique_page_ui_layout',true);insert into public.engagement_services values({q(service)},{q(org)},{q(engagement)},{q(catalog)},'active');
insert into public.artifacts values({q(arch)},{q(org)},{q(project)},{q(engagement)},{q(brand)},'website_architecture'),({q(content)},{q(org)},{q(project)},{q(engagement)},{q(brand)},'content'),({q(identity)},{q(org)},{q(project)},{q(engagement)},{q(brand)},'design_system');
insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum) values({q(archv)},{q(org)},{q(arch)},1,{j(architecture)},encode(sha256(convert_to(({j(architecture)})::text,'UTF8')),'hex')),({q(contentv)},{q(org)},{q(content)},1,{j({'pages':[copy]})},encode(sha256(convert_to(({j({'pages':[copy]})})::text,'UTF8')),'hex')),({q(identityv)},{q(org)},{q(identity)},1,'{{}}','{'a'*64}');
insert into public.artifact_approvals values({q(approval)},{q(org)},{q(arch)},{q(archv)},{q(engagement)},'approved',now()),({q(uid(30))},{q(org)},{q(identity)},{q(identityv)},{q(engagement)},'approved',now());
insert into public.project_website_pages values({q(page)},{q(org)},{q(project)},{q(engagement)},{q(brand)},{q(arch)},'home');
insert into public.design_creative_briefs(id,organization_id,engagement_id,brand_id,engagement_service_id,visibility,revision,current_version_id,frozen_version_id) values({q(brief)},{q(org)},{q(engagement)},{q(brand)},{q(service)},'official',1,{q(briefv)},{q(briefv)});
insert into public.design_creative_brief_versions values({q(briefv)},{q(org)},{q(brief)},'{{"output_type":"website","title":"Website"}}','{'b'*64}','{{"valid":true}}');"""
run(seed);checks=[]
def check(label,sql,denied=False):
 result=run(sql,ok=not denied)
 if denied:assert result.returncode!=0,(label,result.stdout)
 checks.append(label);return result.stdout.strip()
site={'title':'Synthetic site','language':'en','description':'Synthetic brand','palette':{'background':'#ffffff','surface':'#eeeeee','ink':'#111111','accent':'#224466'},'navigation':[{'label':'Home','path':'/home'}],'footer':'Fixture only'}
site_request=uid(40)
def save_site(actor_id=actor,request=site_request,expected='null',value=site):return f"select public.save_website_native_site({q(org)},{q(project)},{q(engagement)},{q(actor_id)},{q(request)},{expected},{q(identityv)},{j(value)});"
def auth(actor_id=actor,role='authenticated'):return f"set role {role};set request.jwt.claim.sub={q(actor_id)};"
record=json.loads(check('actual Design actor saves immutable settings without department votes',auth(actor,'service_role')+save_site()))
assert record['version_number']==1
check('site request replay returns the same immutable version',auth(actor,'service_role')+save_site());assert json.loads(run(auth(actor,'service_role')+save_site()).stdout)['id']==record['id']
check('changed site body under original request conflicts',auth(actor,'service_role')+save_site(value={**site,'title':'Changed'}),True)
check('anonymous save denied',auth(actor,'anon')+save_site(),True);check('authenticated direct save denied',auth()+save_site(),True)
check('non-Design actor cannot save',auth(reader,'service_role')+save_site(actor_id=reader,request=uid(41)),True)
check('stale expected site version conflicts',auth(actor,'service_role')+save_site(request=uid(42)),True)
check('direct private site access denied',auth()+'select * from private.website_site_versions;',True)
check('site immutable update denied',f"update private.website_site_versions set site='{{}}' where id={q(record['id'])};",True)
def source_sql(actor_id=actor,site_id=record['id']):return auth(actor_id)+f"select public.get_website_native_source({q(org)},{q(project)},{q(engagement)},{q(page)},{q(archv)},{q(contentv)},{q(briefv)},{q(site_id)});"
context=json.loads(check('actual approved source helpers resolve exact registered page/copy/brief/settings',source_sql()))
check('existing active team read authority remains available',source_sql(reader));check('foreign actor read denied',source_sql(outsider),True)
manifest={'schema_version':1,'scope':context['scope'],'sources':{'architecture':{'version_id':archv,'checksum':context['architecture']['content_checksum']},'content':{'version_id':contentv,'checksum':context['content_version']['content_checksum']},'brief':{'version_id':briefv,'checksum':context['brief_version']['content_checksum']},'site_system':{'version_id':record['id'],'checksum':record['request_sha256']}},'site':site,'content':{'title':'Exact home'},'layout':{'template':'home'}}
design_request=uid(50)
def save_design(request=design_request,review=context['review_sha256'],value=manifest,html='<html><h1>Exact home</h1></html>'):
 return auth(actor,'service_role')+f"select public.save_website_native_design({q(org)},{q(project)},{q(engagement)},{q(actor)},{q(request)},null,{q(approval)},{q(review)},{j(value)},{q(html)},'body{{color:#111}}');"
draft=json.loads(check('atomic draft reuses existing page-design identity with canonical native direction',save_design()));assert draft['page_id']==page and draft['version_number']==1
check('design original request replay recovers exact attempt',save_design());assert json.loads(run(save_design()).stdout)['design_id']==draft['design_id']
check('changed original design request conflicts',save_design(html='<h1>Changed</h1>'),True)
check('stale source review cannot create another draft',save_design(request=uid(51)),True)
check('native draft cannot be approved through legacy update',f"update public.website_page_designs set status='approved' where id={q(draft['design_id'])};",True)
check('native binding immutable delete denied',f"delete from private.website_native_bindings where design_id={q(draft['design_id'])};",True)
check('authenticated service RPC cannot spoof actor',auth()+save_design().split(';',2)[2],True)
history=json.loads(check('bounded page history and original receipt recovery are read-only',auth()+f"select public.get_website_native_workspace({q(org)},{q(project)},{q(engagement)},{q(page)},{q(design_request)});"));assert history['designs'][0]['design_id']==draft['design_id']
run(f"update public.organization_memberships set status='inactive' where user_id={q(actor)};")
check('revoked membership blocks original receipt recovery',auth()+f"select public.get_website_native_workspace({q(org)},{q(project)},{q(engagement)},null,{q(design_request)});",True)
check('revoked membership blocks save replay',save_design(),True)
run(f"update public.organization_memberships set status='active' where user_id={q(actor)};")
run(f"update public.projects set archived_at=now() where id={q(project)};")
check('archived project cannot save settings',auth(actor,'service_role')+save_site(request=uid(60),expected=q(record['id'])),True)
run(f"update public.projects set archived_at=null where id={q(project)};")
run(f"update public.engagement_services set status='on_hold' where id={q(service)};")
check('inactive selected service blocks source preparation',source_sql(),True)
run(f"update public.engagement_services set status='active' where id={q(service)};")
run(f"insert into public.artifact_approvals values({q(uid(70))},{q(org)},{q(identity)},{q(identityv)},{q(engagement)},'changes_requested',clock_timestamp());")
check('later identity rejection supersedes historical approval',source_sql(),True)
# New cases use this owned fixture; no previous QA initializer is run.
unbound=json.loads(check('project-only site draft requires no manufactured brand approval',auth(actor,'service_role')+save_site(request=uid(75),expected=q(record['id'])).replace(q(identityv),'null')))
assert json.loads(run(source_sql(site_id=unbound['id'])).stdout)['site_version']['identity_version_id'] is None
checks.append('unbound draft styles remain explicitly unapproved')
run(f"insert into public.artifact_approvals values({q(uid(71))},{q(org)},{q(identity)},{q(identityv)},{q(engagement)},'approved',clock_timestamp());")
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=2) as pool:
 rows=list(pool.map(lambda _:json.loads(run(auth(actor,'service_role')+save_site(request=uid(80),expected=q(unbound['id']))).stdout),range(2)))
assert rows[0]['id']==rows[1]['id'] and rows[0]['version_number']==3
checks.append('concurrent identical site requests settle one original immutable version')
with ThreadPoolExecutor(max_workers=2) as pool:
 results=list(pool.map(lambda n:run(auth(actor,'service_role')+save_site(request=uid(n),expected=q(rows[0]['id'])),ok=False),[81,82]))
assert sum(r.returncode==0 for r in results)==1
assert '40001' in next(r.stderr for r in results if r.returncode)
head=json.loads(next(r.stdout for r in results if r.returncode==0));checks.append('concurrent different site edits reject one stale expected parent')
now_context=json.loads(run(source_sql(site_id=head['id'])).stdout)
now_manifest=json.loads(json.dumps(manifest));now_manifest['site']=head['site'];now_manifest['sources']['site_system']={'version_id':head['id'],'checksum':head['request_sha256']}
with ThreadPoolExecutor(max_workers=2) as pool:
 results=list(pool.map(lambda n:run(save_design(request=uid(n),review=now_context['review_sha256'],value=now_manifest),ok=False),[90,91]))
assert sum(r.returncode==0 for r in results)==1
assert '40001' in next(r.stderr for r in results if r.returncode)
checks.append('concurrent page drafts commit one exact reviewed design head')
before_count=run('select count(*) from private.website_site_versions').stdout.strip()
holder=subprocess.Popen([str(Path(args.pgbin)/'psql.exe'),*map(str,base),'-d',database,'-c',f"begin;update public.organization_memberships set status='inactive' where user_id={q(actor)};select pg_sleep(1.5);commit;"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,creationflags=flags)
import time
time.sleep(.3)
with ThreadPoolExecutor(max_workers=1) as pool:
 waiting=pool.submit(run,"set application_name='w2-native-revocation-race';"+auth(actor,'service_role')+save_site(request=uid(95),expected=q(head['id'])),None,False)
 observed=False
 for _ in range(8):
  if run("select count(*) from pg_stat_activity where application_name='w2-native-revocation-race' and wait_event_type='Lock'").stdout.strip()!='0':observed=True;break
  time.sleep(.05)
 blocked=waiting.result(timeout=10)
holder.communicate(timeout=10)
assert observed and blocked.returncode and '42501' in blocked.stderr
assert run('select count(*) from private.website_site_versions').stdout.strip()==before_count
checks.append('observed membership-row lock race denies a save after committed revocation')
run(f"update public.organization_memberships set status='active' where user_id={q(actor)};")
run(f"update public.service_catalog set slug='setup_design_static_social_visual' where id={q(catalog)};")
check('Website draft does not inherit social-service execution eligibility',source_sql(site_id=head['id']),True)
run(f"update public.service_catalog set slug='setup_design_unique_page_ui_layout' where id={q(catalog)};")
result={'database':database,'port':port,'data':str(data),'checks':checks,'count':len(checks),'boundary':'Native PG17, actual source helper bodies and migration, synthetic base records; no production/provider acceptance'}
(qa/(database+'-verification.json')).write_text(json.dumps(result,indent=2));print(json.dumps(result))
