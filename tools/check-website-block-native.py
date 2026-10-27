"""Owned loopback PG17 QA only. Synthetic base schema; actual source helpers and W2 migration."""
import argparse,json,re,subprocess,uuid,socket,os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);args=p.parse_args()
repo=Path(args.repo);qa=Path(args.qa).resolve();qa.mkdir(parents=True,exist_ok=True);data=qa/'data';port=29928
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
base=['-X','-w','-h','127.0.0.1','-p',port,'-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];database='website_w3_'+uuid.uuid4().hex[:8]
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
check('completed job cannot be completed again',finish(),True)
download=auth(builder)+f"select public.get_website_block_artifact({q(org)},{q(project)},{q(engagement)},{q(job)});"
assert json.loads(check('historical package retains exact source versions with no approval claim',download))['source_versions']==manifest['sources']
check('foreign project artifact denied',download.replace(q(project),q(uid(999))),True)
run(f"update public.organization_memberships set status='revoked' where user_id={q(builder)}")
check('revoked member cannot read package',download,True);check('revoked member cannot claim or replay',start(),True)
run(f"update public.organization_memberships set status='active' where user_id={q(builder)};update public.engagement_services set status='paused' where id={q(dev_service)}")
check('inactive Development implementation service blocks new builds',start(uid(76)),True)
run(f"update public.engagement_services set status='active' where id={q(dev_service)}")
# Expired worker fixtures are inserted with an old immutable creation time; no trigger bypass.
expired_job,expired_request=uid(90),uid(91)
run(f"insert into public.wordpress_export_jobs(id,organization_id,website_page_design_id,provider,provider_job_id,status,requested_by) values({q(expired_job)},{q(org)},{q(design)},'native','anka-native-block-v1','processing',{q(builder)});insert into private.website_block_inputs(job_id,organization_id,project_id,engagement_id,design_id,page_id,request_id,request_sha256,review_sha256,source,created_by,created_at) select {q(expired_job)},organization_id,project_id,engagement_id,design_id,page_id,{q(expired_request)},request_sha256,review_sha256,source,created_by,clock_timestamp()-interval '11 minutes' from private.website_block_inputs where job_id={q(job)};")
def recover(request=expired_request,a=builder):return auth(a)+f"select public.get_website_block_workspace({q(org)},{q(project)},{q(engagement)},null,{q(request)},0);"
snapshot=lambda:run(f"select md5(row_to_json(j)::text||row_to_json(i)::text) from public.wordpress_export_jobs j join private.website_block_inputs i on i.job_id=j.id where j.id={q(expired_job)}").stdout.strip()
original=snapshot();recovered=json.loads(check('expired original request recovers a terminal projection without writes',recover()))['jobs'][0]
assert recovered['status']=='failed' and recovered['original_status']=='processing' and recovered['execution_window_expired'] is True and snapshot()==original
check('expired worker cannot complete after read-only recovery',finish(expired_job),True);assert snapshot()==original
assert json.loads(check('completed historical request remains complete with original identity',recover(uid(70))))['jobs'][0]['status']=='complete'
assert json.loads(check('request recovery is scoped to the original actor',recover(a=reader)))['jobs']==[]
check('expired recovery still denies anonymous callers',recover().replace('set role authenticated','set role anon'),True)
run(f"update public.organization_memberships set status='revoked' where user_id={q(builder)}")
check('expired recovery still denies revoked members',recover(),True)
run(f"update public.organization_memberships set status='active' where user_id={q(builder)}")

# Concurrent original claims drain both pipes concurrently to avoid host stdout deadlock.
def process(sql):
 p=subprocess.Popen([str(Path(args.pgbin)/'psql.exe'),*map(str,base),'-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=flags)
 p.stdin.write('begin;'+sql+'commit;');p.stdin.close();p.stdin=None;return p
writers=[process(start(uid(77))) for _ in range(2)]
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda p:(*p.communicate(timeout=25),p.returncode),writers))
assert all(r[2]==0 for r in results),results
answers=[json.loads(r[0].splitlines()[-1]) for r in results];assert answers[0]['job']['id']==answers[1]['job']['id'] and sorted(x['created'] for x in answers)==[False,True]
checks.append('concurrent identical claims create exactly one immutable source and canonical job')
processing=answers[0]['job']['id']

fresh=json.loads(check('nonexpired processing recovery retains processing status',recover(uid(77))))['jobs'][0];assert fresh['status']=='processing' and fresh['execution_window_expired'] is False
locker=process(f"set application_name='website_w3_window_lock';update public.wordpress_export_jobs set status='failed',failure_reason='Synthetic worker terminal receipt' where id={q(expired_job)};select pg_sleep(2);")
import time
for _ in range(60):
 if run("select exists(select 1 from pg_stat_activity where application_name='website_w3_window_lock' and wait_event='PgSleep')").stdout.strip()=='t':break
 time.sleep(.02)
else:raise AssertionError('Original job lock was not observed')
started=time.monotonic();after=json.loads(check('recovery waits for original job writer and observes its committed terminal receipt',recover()))['jobs'][0]
out,err=locker.communicate(timeout=10);assert locker.returncode==0,err
assert time.monotonic()-started>0.5 and after['status']=='failed' and after['original_status']=='failed' and after['execution_window_expired'] is False and after['failure_reason']=='Synthetic worker terminal receipt'

run(f"insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum) select {q(uid(80))},organization_id,artifact_id,2,content,content_checksum from public.artifact_versions where id={q(contentv)}")
stale=json.loads(run(download).stdout);assert 'Content' in stale['stale_sources'];checks.append('historical package reports changed source head without rebinding or deletion')
check('source head change rejects processing completion',finish(processing),True)
check('source head change rejects new reviewed claim',start(uid(81)),True)
run(auth(builder,'service_role')+f"select public.fail_website_block_build({q(org)},{q(builder)},{q(processing)});")
assert run(f"select status from public.wordpress_export_jobs where id={q(processing)}").stdout.strip()=='failed';checks.append('failed request retains immutable source and original canonical job')
run(f"delete from public.artifact_versions where id={q(uid(80))}")
# A failed immutable-input insert must roll back the canonical export job atomically.
count=run("select count(*) from public.wordpress_export_jobs").stdout.strip()
run("create function private.w3_rollback_qa() returns trigger language plpgsql as $$begin raise exception 'Owned bridge rollback';end$$;create trigger w3_rollback_qa before insert on private.website_block_inputs for each row execute function private.w3_rollback_qa();")
check('source receipt failure atomically rolls back canonical job claim',start(uid(85)),True)
assert run("select count(*) from public.wordpress_export_jobs").stdout.strip()==count
run("drop trigger w3_rollback_qa on private.website_block_inputs")
# Observe committed revocation while a fresh completion waits on the actual membership lock.
new=json.loads(run(start(uid(82))).stdout);newjob=new['job']['id']
revoker=process(f"set application_name='website_w3_revoke';update public.organization_memberships set status='revoked' where user_id={q(builder)};select pg_sleep(2);")
import time
observed=False
for _ in range(60):
 if run("select exists(select 1 from pg_stat_activity where application_name='website_w3_revoke' and wait_event='PgSleep')").stdout.strip()=='t':observed=True;break
 time.sleep(.02)
assert observed;check('observed membership lock race rejects completion after committed revocation',finish(newjob),True)
out,err=revoker.communicate(timeout=10);assert revoker.returncode==0,err
run(f"update public.organization_memberships set status='active' where user_id={q(builder)};update public.projects set archived_at=now() where id={q(project)}")
check('archived project blocks build dispatch',start(uid(83)),True)
assert before==run(f"select md5(row_to_json(x)::text) from public.website_page_designs x where id={q(design)}").stdout.strip();checks.append('canonical native design, direction and existing completed package preserved')
result={'database':database,'port':port,'data':str(data),'checks':checks,'count':len(checks),'boundary':'Owned synthetic native PG17 current source helpers and W3 migration; no production business records/provider calls'}
(qa/'verification.json').write_bytes((json.dumps(result,indent=2)+'\n').encode());print(json.dumps(result))
