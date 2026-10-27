"""Owned loopback PG17 QA only. Synthetic base schema; actual source helpers and W2 migration."""
import argparse,json,re,subprocess,uuid,socket,os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);args=p.parse_args()
repo=Path(args.repo);qa=Path(args.qa).resolve();qa.mkdir(parents=True,exist_ok=True);data=qa/'data';port=29930
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
base=['-X','-w','-h','127.0.0.1','-p',port,'-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];database='website_w4_'+uuid.uuid4().hex[:8]
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

# New W3 checks; prior lines create synthetic canonical W2 sources in this new owned cluster only.
checks=[]
wp=(repo/'supabase/migrations/20260831151956_rp5_native_wordpress_export.sql').read_text(encoding='utf-8')
ddl=wp[wp.index('create table public.wordpress_export_jobs'):wp.index('create index idx_wordpress_export_jobs_design_requested')]
run(ddl+"alter table public.wordpress_export_jobs enable row level security;revoke all on public.wordpress_export_jobs from public,anon,authenticated;")
run((repo/'supabase/migrations/20261027190648_website_native_block_builds.sql').read_text(encoding='utf-8'))
run((repo/'supabase/migrations/20261027194656_website_block_execution_window.sql').read_text(encoding='utf-8'))
builder=uid(61);dev_service=uid(62);dev_catalog=uid(63)
run(f"insert into auth.users values({q(builder)});insert into public.organization_memberships values({q(org)},{q(builder)},'team','active','contributor','development');insert into public.service_catalog values({q(dev_catalog)},{q(org)},'development','setup_development_website_page_build',true);insert into public.engagement_services values({q(dev_service)},{q(org)},{q(engagement)},{q(dev_catalog)},'active');")
design=draft['design_id']
def read_review(d=design,a=builder):return auth(a)+f"select public.get_website_block_review({q(org)},{q(project)},{q(engagement)},{q(d)});"
review=json.loads(check('current team reads exact saved build inputs without writes',read_review()))
assert review['manifest']==manifest and review['stale_sources']==[]
def start(request=uid(70),review_sha=review['review_sha256'],a=builder,d=design):
 return auth(a,'service_role')+f"select public.start_website_block_build({q(org)},{q(project)},{q(engagement)},{q(a)},{q(d)},{q(request)},{q(review_sha)});"
claim=json.loads(check('actual Development actor claims one canonical export job with immutable sources',start()))
job=claim['job']['id'];assert claim['created'] and claim['job']['status']=='processing'
assert json.loads(check('original request replay returns same job without redispatch',start()))['created']==False
check('changed request digest conflicts',start(review_sha='f'*64),True)
check('Design role cannot acquire Development build authority',start(uid(71),a=actor),True)
check('ordinary team member cannot claim build',start(uid(72),a=reader),True)
check('direct authenticated build writer denied',start(uid(73)).replace('set role service_role','set role authenticated'),True)
check('anonymous build denied',start(uid(74)).replace('set role service_role','set role anon'),True)
check('direct private inputs are closed',auth(builder)+'select * from private.website_block_inputs;',True)
check('input receipt immutable',f"update private.website_block_inputs set review_sha256='{'e'*64}' where job_id={q(job)}",True)
hashes={k:'a'*64 for k in ['anka-page.json','functions.php','parts/footer.html','parts/header.html','source-manifest.json','style.css','templates/index.html','theme.json','templates/anka-home.html']}
def finish(job_id=job,a=builder,pkg="'"+'a'*64+"'",source="'"+'b'*64+"'",size='1200',files=hashes):
 return auth(a,'service_role')+f"select public.finish_website_block_build({q(org)},{q(project)},{q(engagement)},{q(a)},{q(job_id)},{pkg},{source},{size},300,{j(files)});"
check('null package checksum denied',finish(pkg='null'),True);check('oversized native package denied',finish(size='1048577'),True)
check('unsafe archive manifest paths denied',finish(files={**hashes,'../evil.php':hashes['style.css']}),True)
before=run(f"select md5(row_to_json(x)::text) from public.website_page_designs x where id={q(design)}").stdout.strip()
complete=json.loads(check('exact claim completes package metadata without changing source design status',finish()))
assert complete['status']=='complete' and complete['seo_verification']['delivery_approved']==False and complete['seo_verification']['wordpress_installed']==False
assert before==run(f"select md5(row_to_json(x)::text) from public.website_page_designs x where id={q(design)}").stdout.strip()

# W4 starts from fresh synthetic canonical sources; no older database is modified.
checks=[]
gateway=(repo/'supabase/migrations/20260825100000_secure_integration_gateway.sql').read_text(encoding='utf-8')
ddl=gateway[gateway.index('create table if not exists public.integration_connections'):gateway.index('create index if not exists idx_integration_connections_org_provider')]
run(ddl+"create table public.integration_connection_departments(organization_id uuid,connection_id uuid,department_id text);create table public.integration_connection_engagements(organization_id uuid,connection_id uuid,engagement_id uuid,department_id text);")
run((repo/'supabase/migrations/20261027201617_website_staging_revision_flow.sql').read_text(encoding='utf-8'))
owner,connection,siteid,foreignsite=[uid(n) for n in [100,101,102,103]]
revision='2026-10-27T20:00:00Z';origin='https://staging.example.test'
run(f"insert into auth.users values({q(owner)});insert into public.organization_memberships values({q(org)},{q(owner)},'team','active','operations_admin','operations');insert into public.integration_connections(id,organization_id,provider,display_name,base_url,public_config,secret_name,status,last_check_status,created_by,updated_at) values({q(connection)},{q(org)},'wordpress','Synthetic isolated staging',{q(origin)},'{{\"username\":\"fixture-stage\"}}','ANKA_WORDPRESS_FIXTURE','verified','passed',{q(owner)},{q(revision)});insert into public.integration_connection_departments values({q(org)},{q(connection)},'development');insert into public.integration_connection_engagements values({q(org)},{q(connection)},{q(engagement)},'development');")
scope=f"{q(org)},{q(project)},{q(engagement)}"
def bind(request=uid(110),a=owner,s=siteid):return auth(a,'service_role')+f"select public.bind_website_staging_target({scope},{q(a)},{q(connection)},{q(s)},{q(origin)},{q(revision)},{q(request)});"
t=json.loads(check('actual organization owner binds one exact immutable staging target',bind()));target=t['id']
assert json.loads(check('target replay recovers same immutable target without a new version',bind()))['id']==target
check('target request changed identity conflicts',bind(s=foreignsite),True)
check('Development authority cannot act as organization target binder',bind(uid(111),a=builder),True)
check('direct authenticated target binding denied',bind(uid(112)).replace('set role service_role','set role authenticated'),True)
check('anonymous target binding denied',bind(uid(113)).replace('set role service_role','set role anon'),True)
workspace=auth(builder)+f"select public.get_website_staging_workspace({scope},0);"
w=json.loads(check('team reads only scoped credential-free staging workspace',workspace));assert len(w['targets'])==1 and len(w['jobs'])==1 and 'secret_name' not in json.dumps(w) and 'username' not in json.dumps(w)
assert json.loads(check('non-admin project reader sees no connection configuration choices',workspace.replace(q(builder),q(reader))))['connections']==[]
for table in ['targets','runs','results','issues']:check('private staging '+table+' denies direct client reads',auth(builder)+f"select * from private.website_staging_{table};",True)
def context(head='null',target_id=target,a=builder):return auth(a,'service_role')+f"select public.get_website_staging_dispatch({scope},{q(a)},null,{q(target_id)},{q(job)},{head});"
ctx=json.loads(check('scoped current Development context pins package target and remote head',context()));assert ctx['job']['artifact_sha256']==complete['artifact_sha256']
def stage_start(request=uid(120),a=builder,head='null',review_sha=ctx['review_sha256'],prior='null',target_id=target):return auth(a,'service_role')+f"select public.start_website_staging_run({scope},{q(a)},{q(target_id)},{q(job)},{head},{q(review_sha)},{prior},{q(request)});"
before=run(f"select md5(row_to_json(j)::text||row_to_json(d)::text) from public.wordpress_export_jobs j join public.website_page_designs d on d.id=j.website_page_design_id where j.id={q(job)}").stdout.strip()
first=json.loads(check('reviewed dry-run claims one immutable canonical-page staging attempt',stage_start()));staging_run=first['run'];assert first['created']
assert json.loads(check('same staging request replays without another command',stage_start()))['created']==False
check('parallel new request blocked until original outcome recovered',stage_start(uid(121)),True)
changed_ctx=json.loads(run(context(q(uid(122)))).stdout)
check('changed inputs under original staging request conflict',stage_start(head=q(uid(122)),review_sha=changed_ctx['review_sha256']),True)
check('Content reader cannot acquire staging execution authority',stage_start(uid(123),a=reader),True)
check('direct authenticated staging dispatch denied',stage_start(uid(124)).replace('set role service_role','set role authenticated'),True)
check('direct authenticated server connection dispatch denied',context().replace('set role service_role','set role authenticated'),True)
evidence={'protocol':'anka-stage-v1','environment':'staging','published':False,'base_url':origin,'site_id':siteid,'request_id':uid(120),'package_sha256':complete['artifact_sha256'],'status':'staged','preview_url':origin+'/?anka_staging_preview='+uid(120),'preview_verified':True,'unresolved_paths':[]}
def result(value=evidence,outcome='staged',run_id=staging_run['id']):return auth(builder,'service_role')+f"select public.record_website_staging_result({scope},{q(builder)},{q(run_id)},{q(outcome)},{j(value)});"
check('different remote site result denied',result({**evidence,'site_id':foreignsite}),True)
check('client publication claim denied in staging receipt',result({**evidence,'published':True}),True)
check('unverified or arbitrary preview URL denied',result({**evidence,'preview_url':'https://client.example.test/'}),True)
check('wrong original package checksum denied',result({**evidence,'package_sha256':'f'*64}),True)
check('unverified preview cannot become staged',result({**evidence,'preview_verified':False}),True)
check('direct authenticated fake result denied',result().replace('set role service_role','set role authenticated'),True)
res=json.loads(check('verified staging receipt is append-only and does not approve delivery',result()));assert res['evidence']['published']==False
check('identical result replay returns original immutable evidence',result())
check('different terminal result cannot replace history',result({**evidence,'unresolved_paths':['/changed']}),True)
def issue(request=uid(130),kind='opened',note='Review the contact heading',issue_id='null',expected='null',a=builder):return auth(a)+f"select public.record_website_staging_issue({scope},{q(staging_run['id'])},{issue_id},{expected},{q(kind)},{q(note)},{q(request)});"
opened=json.loads(check('explicit page revision note links the exact staged run without Work changes',issue()))
assert json.loads(check('issue replay returns original event',issue()))['id']==opened['id']
check('changed note under original UUID conflicts',issue(note='Different body'),True)
check('non-Development reader cannot create revision events',issue(uid(131),a=reader),True)
check('blank note rejected',issue(uid(132),note=' '),True)
check('oversized note rejected',issue(uid(133),note='x'*2001),True)
check('stale issue resolution conflicts',issue(uid(134),'resolved','Reviewed',q(opened['issue_id']),q(uid(999))),True)
resolved=json.loads(check('explicit resolution appends an event retaining the original note',issue(uid(135),'resolved','Reviewed in a later source-bound revision',q(opened['issue_id']),q(opened['id']))));assert resolved['previous_event_id']==opened['id']
check('resolved event cannot be silently reopened or resolved again',issue(uid(136),'resolved','Again',q(opened['issue_id']),q(opened['id'])),True)
for table,column,value in [('targets','base_url',q(origin)),('runs','review_sha256',q(ctx['review_sha256'])),('results','outcome',"'failed'"),('issues','note',"'changed'")]:
 check('immutable '+table+' denies even owner updates',f"update private.website_staging_{table} set {column}={value};",True)
 check('immutable '+table+' denies deletes',f"delete from private.website_staging_{table};",True)
check('cross-project staging workspace denied',workspace.replace(q(project),q(uid(999))),True)
run(f"update public.integration_connections set status='disabled' where id={q(connection)}")
check('revoked connection cannot dispatch',context(),True)
assert not json.loads(run(workspace).stdout)['targets'][0]['current'];checks.append('historical target retained with explicit current-connection warning')
run(f"update public.integration_connections set status='verified' where id={q(connection)};delete from public.integration_connection_engagements where connection_id={q(connection)}")
check('removing explicit project connection mapping blocks dispatch',context(),True)
run(f"insert into public.integration_connection_engagements values({q(org)},{q(connection)},{q(engagement)},'development')")
run(f"update public.integration_connections set updated_at=updated_at+interval '1 second' where id={q(connection)}")
check('changed connection revision invalidates prior binding',context(),True)
run(f"update public.integration_connections set updated_at={q(revision)} where id={q(connection)}")
def process(sql):
 p=subprocess.Popen([str(Path(args.pgbin)/'psql.exe'),*map(str,base),'-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=flags);p.stdin.write('begin;'+sql+'commit;');p.stdin.close();p.stdin=None;return p
check('supplied revision predecessor must match the exact current remote head',stage_start(uid(139),prior=q(staging_run['id'])),True)
assert check('absent local claim is observed read-only without fabricating a run',auth(builder,'service_role')+f"select public.get_website_staging_recovery({scope},{q(builder)},{q(uid(138))});")==''
revision_ctx=json.loads(run(context(q(uid(120)))).stdout)
writers=[process(stage_start(uid(140),head=q(uid(120)),review_sha=revision_ctx['review_sha256'],prior=q(staging_run['id']))) for _ in range(2)]
with ThreadPoolExecutor(max_workers=2) as pool:answers=list(pool.map(lambda p:(*p.communicate(timeout=25),p.returncode),writers))
assert all(x[2]==0 for x in answers),answers
rows=[json.loads(x[0].splitlines()[-1]) for x in answers];assert rows[0]['run']['id']==rows[1]['run']['id'] and sorted(x['created'] for x in rows)==[False,True];checks.append('concurrent same revision request creates one immutable attempt')
pending_run=rows[0]['run']
recover=auth(builder,'service_role')+f"select public.get_website_staging_recovery({scope},{q(builder)},{q(uid(140))});"
run(f"insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum) select {q(uid(150))},organization_id,artifact_id,2,content,content_checksum from public.artifact_versions where id={q(contentv)}")
check('changed source head rejects new staging dispatch',context(),True)
recovered=json.loads(check('original recovery reads retained source after source head changes',recover));assert recovered['run']['id']==pending_run['id'] and recovered['source']['manifest']==manifest
run(f"delete from public.artifact_versions where id={q(uid(150))}")
import time
locker=process(f"set application_name='website_w4_connection_revoke';update public.integration_connections set status='disabled' where id={q(connection)};select pg_sleep(2);")
for _ in range(60):
 if run("select exists(select 1 from pg_stat_activity where application_name='website_w4_connection_revoke' and wait_event='PgSleep')").stdout.strip()=='t':break
 time.sleep(.02)
else:raise AssertionError('Connection revocation lock not observed')
check('observed connection lock race rejects dispatch after committed revocation',context(),True)
out,err=locker.communicate(timeout=10);assert locker.returncode==0,err
run(f"update public.integration_connections set status='verified' where id={q(connection)}")
run(f"update public.organization_memberships set status='revoked' where user_id={q(builder)}")
check('current membership revocation blocks issue and recovery',recover,True)
run(f"update public.organization_memberships set status='active' where user_id={q(builder)}")
assert before==run(f"select md5(row_to_json(j)::text||row_to_json(d)::text) from public.wordpress_export_jobs j join public.website_page_designs d on d.id=j.website_page_design_id where j.id={q(job)}").stdout.strip();checks.append('native design package completion and canonical history remain byte-identical')
functions=json.loads(run("select json_agg(json_build_object('name',n.nspname||'.'||p.proname,'md5',md5(p.prosrc))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like '%website_staging%'").stdout)
result={'database':database,'port':port,'data':str(data),'checks':checks,'count':len(checks),'functions':functions,'boundary':'Owned synthetic PG17 only; no production business writes, secrets or external requests'}
(qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
