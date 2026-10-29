"""Owned loopback PG17 QA only. Synthetic base schema; actual source helpers and W2 migration."""
import argparse, json, re, subprocess, uuid, socket, os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--repo', required=True)
p.add_argument('--pgbin', required=True)
p.add_argument('--qa', required=True)
args = p.parse_args()
repo = Path(args.repo)
qa = Path(args.qa).resolve()
qa.mkdir(parents=True, exist_ok=True)
data = qa / 'data'
port = 29942
flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

def command(exe, arguments, **kwargs):
    with (qa / 'commands.log').open('a', encoding='utf-8') as log:
        result = subprocess.run([str(Path(args.pgbin) / exe), *map(str, arguments)], stdout=log, stderr=subprocess.STDOUT, text=True, creationflags=flags, **kwargs)
    if result.returncode:
        raise RuntimeError('Native command failed; inspect commands.log')
    return ''
if not (data / 'PG_VERSION').exists():
    with socket.socket() as test:
        assert test.connect_ex(('127.0.0.1', port)) != 0, 'Owned port already occupied'
    command('initdb.exe', ['-D', data, '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--locale=C'], timeout=60)
status = subprocess.run([str(Path(args.pgbin) / 'pg_ctl.exe'), '-D', str(data), 'status'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
if status.returncode:
    command('pg_ctl.exe', ['-D', data, '-l', qa / 'server.log', '-o', f'-h 127.0.0.1 -p {port}', '-w', 'start'], timeout=60)
base = ['-X', '-w', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
database = 'website_publication_' + uuid.uuid4().hex[:8]

def run(sql, db=None, ok=True):
    result = subprocess.run([str(Path(args.pgbin) / 'psql.exe'), *map(str, base), '-d', db or database], input=sql, text=True, encoding='utf-8', capture_output=True, timeout=40, creationflags=flags)
    if ok and result.returncode:
        raise RuntimeError(result.stderr)
    return result
assert Path(run("select current_setting('data_directory')", 'postgres').stdout.strip()).resolve() == data
run('create database ' + database, 'postgres')
bootstrap = "\ndo $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end$$;\ncreate schema private;create schema auth;create table auth.users(id uuid primary key);\ncreate function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;\ngrant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;\ncreate table public.organizations(id uuid primary key,status text);create table public.organization_memberships(organization_id uuid,user_id uuid,member_kind text,status text,role text,department_id text);\ncreate table public.projects(id uuid,organization_id uuid,archived_at timestamptz,primary key(id,organization_id));\ncreate table public.engagements(id uuid,organization_id uuid,project_id uuid,brand_id uuid,status text,primary key(id,organization_id),unique(id,project_id,organization_id));\ncreate table public.artifacts(id uuid,organization_id uuid,project_id uuid,engagement_id uuid,brand_id uuid,artifact_type text,primary key(id,organization_id));\ncreate table public.artifact_versions(id uuid,organization_id uuid,artifact_id uuid,version_number int,content jsonb,content_checksum text,ai_use_allowed boolean default false,primary key(id,organization_id));\ncreate table public.artifact_approvals(id uuid,organization_id uuid,artifact_id uuid,artifact_version_id uuid,engagement_id uuid,decision text,approved_at timestamptz);\ncreate table public.artifact_approval_requests(id uuid,organization_id uuid,artifact_version_id uuid,status text,created_at timestamptz);\ncreate table public.service_catalog(id uuid,organization_id uuid,department_id text,slug text,is_active boolean);create table public.engagement_services(id uuid,organization_id uuid,engagement_id uuid,service_id uuid,status text);\ncreate table public.project_website_pages(id uuid,organization_id uuid,project_id uuid,engagement_id uuid,brand_id uuid,architecture_artifact_id uuid,page_key text,primary key(id,organization_id));\ncreate table public.design_creative_briefs(id uuid,organization_id uuid,engagement_id uuid,brand_id uuid,engagement_service_id uuid,project_task_id uuid,engagement_work_item_id uuid,visibility text,revision int,current_version_id uuid,frozen_version_id uuid,primary key(id,organization_id));\ncreate table public.design_creative_brief_versions(id uuid,organization_id uuid,creative_brief_id uuid,content jsonb,content_checksum text,validation_snapshot jsonb,primary key(id,organization_id));\ncreate table public.design_workshop_sessions(id uuid default gen_random_uuid(),organization_id uuid,engagement_id uuid,brand_id uuid,engagement_service_id uuid,project_task_id uuid,engagement_work_item_id uuid,output_family text,output_brief jsonb,designer_instructions text,context_manifest jsonb,context_checksum text,created_by uuid,primary key(id,organization_id));\ncreate table public.design_directions(id uuid default gen_random_uuid(),organization_id uuid,session_id uuid,direction_slot int,primary key(id,organization_id));\ncreate table public.design_direction_versions(id uuid default gen_random_uuid(),organization_id uuid,direction_id uuid,version_number int,content jsonb,content_checksum text,distinctness_signature text,created_by uuid,creative_brief_version_id uuid,is_experimental boolean default false,created_at timestamptz default clock_timestamp(),primary key(id,organization_id));\ncreate table public.website_page_designs(id uuid default gen_random_uuid(),organization_id uuid,design_direction_version_id uuid,slug text,html_content text,css_content text,status text,created_by uuid,created_at timestamptz default clock_timestamp(),primary key(id,organization_id));\n"
run(bootstrap)

def function(file, name):
    text = (repo / 'supabase/migrations' / file).read_text(encoding='utf-8')
    match = re.search('create (?:or replace )?function ' + re.escape(name) + '\\([\\s\\S]*?\\$\\$;', text, re.I)
    if not match:
        raise RuntimeError('Missing actual helper ' + name)
    return match[0]
for file, name in [('20260909202126_content_b03a_page_identity.sql', 'private.normalize_content_page_path'), ('20261001011000_pipeline_reviewed_stage_fulfilment.sql', 'private.require_pipeline_approved_artifact'), ('20261001013000_project_website_page_identity.sql', 'private.website_architecture_pages'), ('20261001013000_project_website_page_identity.sql', 'private.website_approved_source')]:
    run(function(file, name))
run((repo / 'supabase/migrations/20261027163000_website_native_design_drafts.sql').read_text(encoding='utf-8'))
uid = lambda n: 'a0000000-0000-4000-8000-' + str(n).zfill(12)
q = lambda value: "'" + value.replace("'", "''") + "'"
j = lambda value: q(json.dumps(value)) + '::jsonb'
org, project, engagement, brand, actor, reader, outsider = [uid(n) for n in range(1, 8)]
arch, content, identity, archv, contentv, identityv, approval, brief, briefv, service, catalog, page = [uid(n) for n in range(10, 22)]
architecture = {'schema_version': 2, 'pages': [{'page_key': 'home', 'slug': 'home', 'title': 'Home', 'page_type': 'hub'}]}
copy = {'page_path': 'home', 'page_brief': 'Welcome people', 'draft_copy': 'Actual selected page copy', 'meta_title': 'Exact home', 'meta_description': 'Exact description', 'primary_cta': 'Contact'}
seed = f"""insert into auth.users values({q(actor)}),({q(reader)}),({q(outsider)});insert into public.organizations values({q(org)},'active');insert into public.projects values({q(project)},{q(org)},null);insert into public.engagements values({q(engagement)},{q(org)},{q(project)},{q(brand)},'active');\ninsert into public.organization_memberships values({q(org)},{q(actor)},'team','active','contributor','design'),({q(org)},{q(reader)},'team','active','contributor','content');\ninsert into public.service_catalog values({q(catalog)},{q(org)},'design','setup_design_unique_page_ui_layout',true);insert into public.engagement_services values({q(service)},{q(org)},{q(engagement)},{q(catalog)},'active');\ninsert into public.artifacts values({q(arch)},{q(org)},{q(project)},{q(engagement)},{q(brand)},'website_architecture'),({q(content)},{q(org)},{q(project)},{q(engagement)},{q(brand)},'content'),({q(identity)},{q(org)},{q(project)},{q(engagement)},{q(brand)},'design_system');\ninsert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum) values({q(archv)},{q(org)},{q(arch)},1,{j(architecture)},encode(sha256(convert_to(({j(architecture)})::text,'UTF8')),'hex')),({q(contentv)},{q(org)},{q(content)},1,{j({'pages': [copy]})},encode(sha256(convert_to(({j({'pages': [copy]})})::text,'UTF8')),'hex')),({q(identityv)},{q(org)},{q(identity)},1,'{{}}','{'a' * 64}');\ninsert into public.artifact_approvals values({q(approval)},{q(org)},{q(arch)},{q(archv)},{q(engagement)},'approved',now()),({q(uid(30))},{q(org)},{q(identity)},{q(identityv)},{q(engagement)},'approved',now());\ninsert into public.project_website_pages values({q(page)},{q(org)},{q(project)},{q(engagement)},{q(brand)},{q(arch)},'home');\ninsert into public.design_creative_briefs(id,organization_id,engagement_id,brand_id,engagement_service_id,visibility,revision,current_version_id,frozen_version_id) values({q(brief)},{q(org)},{q(engagement)},{q(brand)},{q(service)},'official',1,{q(briefv)},{q(briefv)});\ninsert into public.design_creative_brief_versions values({q(briefv)},{q(org)},{q(brief)},'{{"output_type":"website","title":"Website"}}','{'b' * 64}','{{"valid":true}}');"""
run(seed)
checks = []

def check(label, sql, denied=False):
    result = run(sql, ok=not denied)
    if denied:
        assert result.returncode != 0, (label, result.stdout)
    checks.append(label)
    return result.stdout.strip()
site = {'title': 'Synthetic site', 'language': 'en', 'description': 'Synthetic brand', 'palette': {'background': '#ffffff', 'surface': '#eeeeee', 'ink': '#111111', 'accent': '#224466'}, 'navigation': [{'label': 'Home', 'path': '/home'}], 'footer': 'Fixture only'}
site_request = uid(40)

def save_site(actor_id=actor, request=site_request, expected='null', value=site):
    return f'select public.save_website_native_site({q(org)},{q(project)},{q(engagement)},{q(actor_id)},{q(request)},{expected},{q(identityv)},{j(value)});'

def auth(actor_id=actor, role='authenticated'):
    return f'set role {role};set request.jwt.claim.sub={q(actor_id)};'
record = json.loads(check('actual Design actor saves immutable settings without department votes', auth(actor, 'service_role') + save_site()))
assert record['version_number'] == 1
assert json.loads(run(auth(actor, 'service_role') + save_site()).stdout)['id'] == record['id']

def source_sql(actor_id=actor, site_id=record['id']):
    return auth(actor_id) + f'select public.get_website_native_source({q(org)},{q(project)},{q(engagement)},{q(page)},{q(archv)},{q(contentv)},{q(briefv)},{q(site_id)});'
context = json.loads(check('actual approved source helpers resolve exact registered page/copy/brief/settings', source_sql()))
manifest = {'schema_version': 1, 'scope': context['scope'], 'sources': {'architecture': {'version_id': archv, 'checksum': context['architecture']['content_checksum']}, 'content': {'version_id': contentv, 'checksum': context['content_version']['content_checksum']}, 'brief': {'version_id': briefv, 'checksum': context['brief_version']['content_checksum']}, 'site_system': {'version_id': record['id'], 'checksum': record['request_sha256']}}, 'site': site, 'content': {'title': 'Exact home'}, 'layout': {'template': 'home'}}
design_request = uid(50)

def save_design(request=design_request, review=context['review_sha256'], value=manifest, html='<html><h1>Exact home</h1></html>'):
    return auth(actor, 'service_role') + f"select public.save_website_native_design({q(org)},{q(project)},{q(engagement)},{q(actor)},{q(request)},null,{q(approval)},{q(review)},{j(value)},{q(html)},'body{{color:#111}}');"
draft = json.loads(check('atomic draft reuses existing page-design identity with canonical native direction', save_design()))
assert draft['page_id'] == page and draft['version_number'] == 1
checks = []
wp = (repo / 'supabase/migrations/20260831151956_rp5_native_wordpress_export.sql').read_text(encoding='utf-8')
ddl = wp[wp.index('create table public.wordpress_export_jobs'):wp.index('create index idx_wordpress_export_jobs_design_requested')]
run(ddl + 'alter table public.wordpress_export_jobs enable row level security;revoke all on public.wordpress_export_jobs from public,anon,authenticated;')
run((repo / 'supabase/migrations/20261027190648_website_native_block_builds.sql').read_text(encoding='utf-8'))
run((repo / 'supabase/migrations/20261027194656_website_block_execution_window.sql').read_text(encoding='utf-8'))
builder = uid(61)
dev_service = uid(62)
dev_catalog = uid(63)
run(f"insert into auth.users values({q(builder)});insert into public.organization_memberships values({q(org)},{q(builder)},'team','active','contributor','development');insert into public.service_catalog values({q(dev_catalog)},{q(org)},'development','setup_development_website_page_build',true);insert into public.engagement_services values({q(dev_service)},{q(org)},{q(engagement)},{q(dev_catalog)},'active');")
design = draft['design_id']

def read_review(d=design, a=builder):
    return auth(a) + f'select public.get_website_block_review({q(org)},{q(project)},{q(engagement)},{q(d)});'
review = json.loads(check('current team reads exact saved build inputs without writes', read_review()))
assert review['manifest'] == manifest and review['stale_sources'] == []

def start(request=uid(70), review_sha=review['review_sha256'], a=builder, d=design):
    return auth(a, 'service_role') + f'select public.start_website_block_build({q(org)},{q(project)},{q(engagement)},{q(a)},{q(d)},{q(request)},{q(review_sha)});'
claim = json.loads(check('actual Development actor claims one canonical export job with immutable sources', start()))
job = claim['job']['id']
assert claim['created'] and claim['job']['status'] == 'processing'
hashes = {k: 'a' * 64 for k in ['anka-page.json', 'functions.php', 'parts/footer.html', 'parts/header.html', 'source-manifest.json', 'style.css', 'templates/index.html', 'theme.json', 'templates/anka-home.html']}

def finish(job_id=job, a=builder, pkg="'" + 'a' * 64 + "'", source="'" + 'b' * 64 + "'", size='1200', files=hashes):
    return auth(a, 'service_role') + f'select public.finish_website_block_build({q(org)},{q(project)},{q(engagement)},{q(a)},{q(job_id)},{pkg},{source},{size},300,{j(files)});'
before = run(f'select md5(row_to_json(x)::text) from public.website_page_designs x where id={q(design)}').stdout.strip()
complete = json.loads(check('exact claim completes package metadata without changing source design status', finish()))
assert complete['status'] == 'complete' and complete['seo_verification']['delivery_approved'] == False and (complete['seo_verification']['wordpress_installed'] == False)
assert before == run(f'select md5(row_to_json(x)::text) from public.website_page_designs x where id={q(design)}').stdout.strip()
checks = []
gateway = (repo / 'supabase/migrations/20260825100000_secure_integration_gateway.sql').read_text(encoding='utf-8')
ddl = gateway[gateway.index('create table if not exists public.integration_connections'):gateway.index('create index if not exists idx_integration_connections_org_provider')]
run(ddl + 'create table public.integration_connection_departments(organization_id uuid,connection_id uuid,department_id text);create table public.integration_connection_engagements(organization_id uuid,connection_id uuid,engagement_id uuid,department_id text);')
run((repo / 'supabase/migrations/20261027201617_website_staging_revision_flow.sql').read_text(encoding='utf-8'))
owner, connection, siteid, foreignsite = [uid(n) for n in [100, 101, 102, 103]]
revision = '2026-10-27T20:00:00Z'
origin = 'https://staging.example.test'
run(f"""insert into auth.users values({q(owner)});insert into public.organization_memberships values({q(org)},{q(owner)},'team','active','operations_admin','operations');insert into public.integration_connections(id,organization_id,provider,display_name,base_url,public_config,secret_name,status,last_check_status,created_by,updated_at) values({q(connection)},{q(org)},'wordpress','Synthetic isolated staging',{q(origin)},'{{"username":"fixture-stage"}}','ANKA_WORDPRESS_FIXTURE','verified','passed',{q(owner)},{q(revision)});insert into public.integration_connection_departments values({q(org)},{q(connection)},'development');insert into public.integration_connection_engagements values({q(org)},{q(connection)},{q(engagement)},'development');""")
scope = f'{q(org)},{q(project)},{q(engagement)}'

def bind(request=uid(110), a=owner, s=siteid):
    return auth(a, 'service_role') + f'select public.bind_website_staging_target({scope},{q(a)},{q(connection)},{q(s)},{q(origin)},{q(revision)},{q(request)});'
t = json.loads(check('actual organization owner binds one exact immutable staging target', bind()))
target = t['id']
workspace = auth(builder) + f'select public.get_website_staging_workspace({scope},0);'
w = json.loads(check('team reads only scoped credential-free staging workspace', workspace))
assert len(w['targets']) == 1 and len(w['jobs']) == 1 and ('secret_name' not in json.dumps(w)) and ('username' not in json.dumps(w))

def context(head='null', target_id=target, a=builder):
    return auth(a, 'service_role') + f'select public.get_website_staging_dispatch({scope},{q(a)},null,{q(target_id)},{q(job)},{head});'
ctx = json.loads(check('scoped current Development context pins package target and remote head', context()))
assert ctx['job']['artifact_sha256'] == complete['artifact_sha256']

def stage_start(request=uid(120), a=builder, head='null', review_sha=ctx['review_sha256'], prior='null', target_id=target):
    return auth(a, 'service_role') + f'select public.start_website_staging_run({scope},{q(a)},{q(target_id)},{q(job)},{head},{q(review_sha)},{prior},{q(request)});'
before = run(f'select md5(row_to_json(j)::text||row_to_json(d)::text) from public.wordpress_export_jobs j join public.website_page_designs d on d.id=j.website_page_design_id where j.id={q(job)}').stdout.strip()
first = json.loads(check('reviewed dry-run claims one immutable canonical-page staging attempt', stage_start()))
staging_run = first['run']
assert first['created']
changed_ctx = json.loads(run(context(q(uid(122)))).stdout)
evidence = {'protocol': 'anka-stage-v1', 'environment': 'staging', 'published': False, 'base_url': origin, 'site_id': siteid, 'request_id': uid(120), 'package_sha256': complete['artifact_sha256'], 'status': 'staged', 'preview_url': origin + '/?anka_staging_preview=' + uid(120), 'preview_verified': True, 'unresolved_paths': []}

def result(value=evidence, outcome='staged', run_id=staging_run['id']):
    return auth(builder, 'service_role') + f'select public.record_website_staging_result({scope},{q(builder)},{q(run_id)},{q(outcome)},{j(value)});'
res = json.loads(check('verified staging receipt is append-only and does not approve delivery', result()))
assert res['evidence']['published'] == False
checks=[]
run("""
create schema extensions;create extension pgcrypto with schema extensions;
alter table public.artifacts alter column id set default gen_random_uuid();
alter table public.artifacts add column title text,add column engagement_stage_instance_id uuid,add column created_by uuid;
alter table public.artifact_versions alter column id set default gen_random_uuid();
alter table public.artifact_versions add column parent_version_id uuid,add column change_summary text,add column data_classification text default 'internal',add column created_by uuid,add column created_at timestamptz default clock_timestamp();
create table public.engagement_stage_instances(id uuid,organization_id uuid,engagement_id uuid,accountable_department_id text);
create table public.engagement_events(id uuid default gen_random_uuid(),organization_id uuid,engagement_id uuid,event_type text,actor_id uuid,payload jsonb);
""")
run(function('20260828153231_development_studio_minimal.sql','public.save_development_artifact_version'))
run((repo/'supabase/migrations/20261029090218_website_qa_acceptance.sql').read_text(encoding='utf-8'))
checks=[]

def review_qa(a=builder,artifact='null'):
 return auth(a)+f"select public.get_website_qa_review({scope},{q(staging_run['id'])},{artifact});"

qa_review=json.loads(check('actual current source and target guards produce a secret-free exact QA snapshot',review_qa()))
assert 'secret_name' not in json.dumps(qa_review) and 'username' not in json.dumps(qa_review)
assert qa_review['snapshot']['package_sha256']==complete['artifact_sha256']
evidence_notes={key:'Manually checked this exact page preview.' for key in ['responsive','keyboard','structure','motion','links_metadata','security','performance']}
def accept(request=uid(400),a=builder,artifact='null',version='null',review=qa_review,value=evidence_notes,confirmed='true'):
 return auth(a)+f"select public.save_website_qa_acceptance({scope},{q(staging_run['id'])},{artifact},{version},{q(review['review_sha256'])},{j(value)},{confirmed},{q(request)});"

accepted=json.loads(run(accept()).stdout)
artifact_version=accepted['artifact_version_id']
artifact=json.loads(run(f"select row_to_json(v) from public.artifact_versions v where id={q(artifact_version)}").stdout)['artifact_id']
release_approval=uid(450)
run(f"insert into public.artifact_approvals values({q(release_approval)},{q(org)},{q(artifact)},{q(artifact_version)},{q(engagement)},'approved',clock_timestamp());")
run("""create table public.project_website_page_revisions(id uuid primary key default gen_random_uuid(),organization_id uuid,project_id uuid,page_id uuid,revision_number bigint,architecture_artifact_id uuid,architecture_version_id uuid,architecture_approval_id uuid,architecture_checksum text,planned_path text,planned_url text,recorded_live_url text,redirect_url text,publication_state text,template text,work_item_id uuid,implementation_notes text,qa_evidence text,created_by uuid,created_at timestamptz default clock_timestamp(),unique(page_id,revision_number));""")
run((repo/'supabase/migrations/20261029100939_website_publication_controls.sql').read_text(encoding='utf-8'))
checks=[]
production_origin='https://production.example.test'
production_site=uid(460)
production_connection=uid(461)
run(f"insert into public.integration_connections(id,organization_id,provider,display_name,base_url,public_config,secret_name,status,last_check_status,created_by,updated_at) values({q(production_connection)},{q(org)},'wordpress','Synthetic production',{q(production_origin)},{j({'username':'fixture-publisher'})},'ANKA_WORDPRESS_PUBLICATION_FIXTURE','verified','passed',{q(owner)},{q(revision)});insert into public.integration_connection_departments values({q(org)},{q(production_connection)},'development');insert into public.integration_connection_engagements values({q(org)},{q(production_connection)},{q(engagement)},'development');")
identity={'protocol':'anka-publication-v1','receiver_version':'1.0.0','environment':'production','wordpress_version':'7.1.3','php_version':'8.3.33','compiler':'anka-native-block-v1','base_url':production_origin,'site_id':production_site,'publication_enabled':True}
def bind_production(a=owner,value=identity,confirmed='true',request=uid(470)):
 return auth(a,'service_role')+f"select public.bind_website_publication_target({scope},{q(a)},{q(production_connection)},{q(revision)},{j(value)},{confirmed},{q(request)});"
def sources(a=owner,selected=None):
 return auth(a,'service_role')+f"select public.get_website_publication_sources({scope},{q(a)},{j(selected if selected is not None else [{'qa_receipt_id':accepted['id'],'approval_id':release_approval}])});"
try:
 check('Development contributor cannot bind a live production target',bind_production(a=builder),True)
 check('unchecked production confirmation denied',bind_production(confirmed='false'),True)
 for key,value in [('environment','staging'),('publication_enabled',False),('php_version',None),('site_id',None),('base_url','https://foreign.example.test')]:
  check('invalid production identity '+key+' denied',bind_production(value={**identity,key:value}),True)
 check('credential-shaped identity field rejected',bind_production(value={**identity,'password':'synthetic'}),True)
 bound=json.loads(check('owner binds independently inspected exact production identity',bind_production()))
 assert bound['site_id']==production_site
 assert json.loads(check('original binding request replays one immutable target',bind_production()))['id']==bound['id']
 check('changed original binding payload conflicts',bind_production(value={**identity,'site_id':uid(471)}),True)
 check('direct authenticated binding cannot spoof actor',bind_production().replace('set role service_role','set role authenticated'),True)
 actual=json.loads(check('server resolves exact saved QA and separate current deliverable approval',sources()))
 assert actual['pages'][0]['qa']['artifact_version_id']==artifact_version
 assert actual['pages'][0]['release_approval']['id']==release_approval
 assert 'secret_name' not in json.dumps(actual)
 check('caller current or approval flags cannot substitute stored records',sources(selected=[{'qa_receipt_id':accepted['id'],'approval_id':release_approval,'current':True}]),True)
 check('duplicate registered page selection denied',sources(selected=[{'qa_receipt_id':accepted['id'],'approval_id':release_approval}]*2),True)
 check('Development actor cannot grant live release authority',sources(a=builder),True)
 run(f"insert into public.artifact_approvals values({q(uid(480))},{q(org)},{q(artifact)},{q(artifact_version)},{q(engagement)},'changes_requested',clock_timestamp());")
 check('newer requested changes revoke prior delivery approval',sources(),True)
 run(f"delete from public.artifact_approvals where id={q(uid(480))};")


 selected=[{'qa_receipt_id':accepted['id'],'approval_id':release_approval}]
 snapshot={'scope':{'organization_id':org,'project_id':project,'engagement_id':engagement},'target':{'target_id':bound['id']}}
 def record_review(request=uid(500)):
  return auth(owner,'service_role')+f"select public.record_website_publication_review({scope},{q(owner)},{q(bound['id'])},{j(selected)},{j(snapshot)},{q('e'*64)},{q(request)});"
 reviewed=json.loads(check('server records current source review without authorizing a command',record_review()))
 def claim(request=uid(501),confirmed='true'):
  return auth(owner,'service_role')+f"select public.start_website_publication_command({scope},{q(owner)},{q(reviewed['id'])},{q(reviewed['review_sha256'])},{confirmed},{q(request)});"
 check('unchecked live confirmation cannot create a publication command',claim(confirmed='false'),True)
 with ThreadPoolExecutor(max_workers=2) as pool:
  claims=list(pool.map(lambda _:json.loads(run(claim()).stdout),range(2)))
 assert sum(row['created'] for row in claims)==1 and claims[0]['command']['id']==claims[1]['command']['id']
 checks.append('two concurrent copies of original command claim append exactly one authorization')
 check('uncertain original command blocks a replacement request',claim(request=uid(502)),True)
 recovery=auth(owner,'service_role')+f"select public.get_website_publication_command({scope},{q(owner)},{q(uid(501))});"
 recovered=json.loads(check('original command recovery is read-only and keeps exact request identity',recovery))
 assert recovered['command']['request_id']==uid(501) and recovered['result'] is None
 count_before=run('select count(*) from private.website_publication_commands').stdout.strip()
 run(recovery)
 assert run('select count(*) from private.website_publication_commands').stdout.strip()==count_before
 check('direct authenticated client cannot call server-only command claim',claim().replace('set role service_role','set role authenticated'),True)
 for table in ['website_publication_reviews','website_publication_commands','website_publication_results']:
  closed=json.loads(run(f"select json_build_object('rls',(select relrowsecurity from pg_class where oid='private.{table}'::regclass),'policies',(select count(*) from pg_policies where schemaname='private' and tablename='{table}'),'anon',has_table_privilege('anon','private.{table}','select'),'auth',has_table_privilege('authenticated','private.{table}','select'),'service',has_table_privilege('service_role','private.{table}','select'))").stdout)
  assert closed['rls'] and closed['policies']==0 and not any(closed[x] for x in ['anon','auth','service'])
 checks.append('review command and result stores use closed RLS with no direct client or service access')


 publication_command=claims[0]['command']
 failed_receipt={'request_id':publication_command['request_id'],'command_id':publication_command['id'],'kind':'publication','status':'failed','review_sha256':reviewed['review_sha256']}
 def settle(receipt=failed_receipt):
  return auth(owner,'service_role')+f"select public.record_website_publication_result({scope},{q(owner)},{q(publication_command['id'])},{j(receipt)});"
 check('unknown or raw upstream result fields cannot be persisted',settle({**failed_receipt,'message':'synthetic private upstream detail'}),True)
 result_row=json.loads(check('verified fixed outcome appends one immutable original result',settle()))
 assert json.loads(check('same original outcome replay creates no second result',settle()))['command_id']==publication_command['id']
 check('opposite terminal outcome cannot rewrite retained history',settle({**failed_receipt,'status':'succeeded','head':publication_command['request_id'],'backup_snapshot_sha256':'f'*64}),True)
 check('completed review cannot authorize another command UUID',claim(request=uid(503)),True)


 workspace_result=json.loads(check('current owner workspace returns bounded source choices and safe original history',auth(owner,'service_role')+f"select public.get_website_publication_workspace({scope},{q(owner)});"))
 assert all(key in workspace_result for key in ['targets','choices','connections','history']) and 'secret_name' not in json.dumps(workspace_result)
 check('non-owner cannot read the production controls workspace',auth(builder,'service_role')+f"select public.get_website_publication_workspace({scope},{q(builder)});",True)
 # Actual settlement and rollback writers over synthetic canonical records.
 live_page=actual['pages'][0]['page_id']
 run(f"insert into public.project_website_page_revisions(id,organization_id,project_id,page_id,revision_number,architecture_artifact_id,architecture_version_id,architecture_approval_id,architecture_checksum,planned_path,publication_state,implementation_notes,qa_evidence,created_by) values({q(uid(600))},{q(org)},{q(project)},{q(live_page)},1,{q(arch)},{q(archv)},{q(approval)},{q('a'*64)},'home','ready','Preserve original notes','Retained evidence',{q(owner)});")
 publish_snapshot={**snapshot,'pages':[{'page_id':live_page}]}
 live_review=json.loads(run(auth(owner,'service_role')+f"select public.record_website_publication_review({scope},{q(owner)},{q(bound['id'])},{j(selected)},{j(publish_snapshot)},{q('e'*64)},{q(uid(601))});").stdout)
 def new_claim(r,request,rollback=False,confirmed=True):
  name='start_website_rollback_command' if rollback else 'start_website_publication_command'
  return auth(owner,'service_role')+f"select public.{name}({scope},{q(owner)},{q(r['id'])},{q(r['review_sha256'])},{str(confirmed).lower()},{q(request)});"
 live_command=json.loads(run(new_claim(live_review,uid(602))).stdout)['command']
 live_receipt={'request_id':live_command['request_id'],'command_id':live_command['id'],'kind':'publication','status':'succeeded','review_sha256':live_review['review_sha256'],'head':live_command['request_id'],'backup_snapshot_sha256':'f'*64}
 live_inventory={'site_id':bound['site_id'],'origin':bound['base_url'],'environment':'production','head':live_command['request_id'],'inventory_sha256':'b'*64,'theme_sha256':'c'*64,'complete':True,'posts':[{'post_id':1001,'revision':1002,'path':'/home','sha256':'d'*64,'managed_page_id':live_page,'post_type':'page','post_status':'publish'}]}
 live_state={'inventory':live_inventory,'observed_inventory_sha256':'b'*64}
 def settle_new(command,receipt,state):
  return auth(owner,'service_role')+f"select public.record_website_publication_result({scope},{q(owner)},{q(command['id'])},{j(receipt)},{j(state)});"
 check('successful result without verified terminal inventory is denied',settle_new(live_command,live_receipt,{}),True)
 projected=json.loads(check('verified publication appends the canonical published page revision with exact live URL',settle_new(live_command,live_receipt,live_state)))
 assert projected['projection_status']=='applied' and projected['registry_after'][0]['recorded_live_url']==bound['base_url']+'/home'
 assert projected['registry_after'][0]['implementation_notes']=='Preserve original notes'
 check('verified publication projection cannot be directly invoked by authenticated clients',settle_new(live_command,live_receipt,live_state).replace('set role service_role','set role authenticated'),True)
 rollback_snapshot={'scope':snapshot['scope'],'target':snapshot['target'],'retained':{'published_head':live_command['request_id'],'publication_id':live_command['id'],'backup_snapshot_sha256':'f'*64}}
 rollback_review=json.loads(check('rollback review retains original successful publication without requiring new source approval',auth(owner,'service_role')+f"select public.record_website_rollback_review({scope},{q(owner)},{q(live_command['request_id'])},{j(rollback_snapshot)},{q('a'*64)},{q(uid(603))});"))
 check('unchecked rollback confirmation cannot admit a command',new_claim(rollback_review,uid(604),True,False),True)
 with ThreadPoolExecutor(max_workers=2) as pool:
  rollback_claims=list(pool.map(lambda _:json.loads(run(new_claim(rollback_review,uid(604),True)).stdout),range(2)))
 assert sum(row['created'] for row in rollback_claims)==1
 checks.append('concurrent original rollback admits exactly once in the shared immutable journal')
 rollback_command=rollback_claims[0]['command']
 rollback_receipt={**live_receipt,'request_id':rollback_command['request_id'],'command_id':rollback_command['id'],'kind':'rollback','review_sha256':rollback_review['review_sha256'],'head':rollback_command['request_id']}
 rollback_state={'inventory':{**live_inventory,'head':rollback_command['request_id'],'inventory_sha256':'a'*64},'observed_inventory_sha256':'a'*64}
 rolled=json.loads(check('verified rollback appends original canonical page state and retains publication history',settle_new(rollback_command,rollback_receipt,rollback_state)))
 assert rolled['projection_status']=='applied' and rolled['registry_after'][0]['publication_state']=='ready' and rolled['registry_after'][0]['recorded_live_url'] is None
 assert run(f"select count(*) from public.project_website_page_revisions where page_id={q(live_page)}").stdout.strip()=='3'
 conflict_review=json.loads(run(auth(owner,'service_role')+f"select public.record_website_publication_review({scope},{q(owner)},{q(bound['id'])},{j(selected)},{j(publish_snapshot)},{q('e'*64)},{q(uid(605))});").stdout)
 conflict_command=json.loads(run(new_claim(conflict_review,uid(606))).stdout)['command']
 run(f"insert into public.project_website_page_revisions select {q(uid(607))},organization_id,project_id,page_id,revision_number+1,architecture_artifact_id,architecture_version_id,architecture_approval_id,architecture_checksum,planned_path,planned_url,recorded_live_url,redirect_url,publication_state,template,work_item_id,'Later manual operations',qa_evidence,created_by,clock_timestamp() from public.project_website_page_revisions where id={q(rolled['registry_after'][0]['id'])};")
 conflict_receipt={**live_receipt,'request_id':conflict_command['request_id'],'command_id':conflict_command['id'],'head':conflict_command['request_id']}
 conflict_state={'inventory':{**live_inventory,'head':conflict_command['request_id']},'observed_inventory_sha256':'b'*64}
 conflict=json.loads(check('later manual canonical page operations are preserved and projection conflict is explicit',settle_new(conflict_command,conflict_receipt,conflict_state)))
 assert conflict['projection_status']=='conflict' and not conflict['registry_after']
 assert run(f"select implementation_notes from public.project_website_page_revisions where page_id={q(live_page)} order by revision_number desc limit 1").stdout.strip()=='Later manual operations'

 old_review=reviewed
 stale_id=uid(520)
 run(f"insert into private.website_publication_reviews(id,target_id,source_selection,snapshot,review_sha256,context_sha256,request_id,request_sha256,created_by,created_at) select {q(stale_id)},target_id,source_selection,snapshot,review_sha256,context_sha256,{q(uid(521))},request_sha256,created_by,clock_timestamp()-interval '11 minutes' from private.website_publication_reviews where id={q(reviewed['id'])};")
 reviewed={**reviewed,'id':stale_id}
 check('expired reviewed snapshot cannot mint a new command window',claim(request=uid(522)),True)
 reviewed=old_review
 schema=json.loads(run("select json_agg(json_build_object('signature',p.oid::regprocedure::text,'body',p.prosrc,'md5',md5(p.prosrc),'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'service_role',has_function_privilege('service_role',p.oid,'execute'),'schema',n.nspname) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like '%website_publication%' or p.proname like '%website_rollback%'").stdout)
 assert len(schema)==14
 for fn in schema:
  assert fn['config']==['search_path=""'] and not fn['anon'] and not fn['authenticated']
  assert fn['service_role']==(fn['schema']=='public')
 (qa/'expected-schema.json').write_text(json.dumps(schema,indent=2))
 checks.append('all fourteen function bodies use empty search paths and only server APIs grant service execution')

 parallel_request=uid(485)
 with ThreadPoolExecutor(max_workers=2) as pool:
  rows=list(pool.map(lambda _:json.loads(run(bind_production(request=parallel_request)).stdout),range(2)))
 assert rows[0]['id']==rows[1]['id']
 bound=rows[0]
 checks.append('concurrent original binding request creates one exact immutable version')
 check('retained target cannot be rewritten directly',f"update private.website_publication_targets set base_url='https://changed.example.test' where id={q(bound['id'])};",True)
 run(f"update public.organization_memberships set status='inactive' where organization_id={q(org)} and user_id={q(owner)};")
 check('revoked operator cannot reuse previous release access',sources(),True)
 run(f"update public.organization_memberships set status='active' where organization_id={q(org)} and user_id={q(owner)};")
 current_review=json.loads(run(review_qa(artifact=q(artifact))).stdout)
 newer=json.loads(run(accept(request=uid(486),artifact=q(artifact),version=q(artifact_version),review=current_review)).stdout)
 check('newer QA acceptance invalidates prior selected receipt',sources(),True)
 check('new QA version does not inherit previous delivery approval',sources(selected=[{'qa_receipt_id':newer['id'],'approval_id':release_approval}]),True)

 run(f"update public.integration_connections set updated_at=clock_timestamp() where id={q(production_connection)};")
 read_target=auth(owner,'service_role')+f"select public.get_website_publication_target({scope},{q(owner)},{q(bound['id'])},null);"
 check('changed connection revision invalidates retained production binding',read_target,True)
 privileges=json.loads(run("select json_build_object('rls',(select relrowsecurity from pg_class where oid='private.website_publication_targets'::regclass),'rows',(select count(*) from private.website_publication_targets),'policies',(select count(*) from pg_policies where schemaname='private' and tablename='website_publication_targets'),'anon',has_table_privilege('anon','private.website_publication_targets','select'),'auth',has_table_privilege('authenticated','private.website_publication_targets','select'),'service',has_table_privilege('service_role','private.website_publication_targets','select'))").stdout)
 assert privileges['rls'] and privileges['policies']==0 and not any(privileges[x] for x in ['anon','auth','service'])
 (qa/'verification.json').write_text(json.dumps({'database':database,'port':port,'checks':checks,'privileges':privileges,'actual_helpers':True,'base':'Synthetic fixtures only; current actual authority/source/QA/artifact writer functions','production_writes':False},indent=2))
 print(json.dumps({'passed':len(checks),'database':database,'port':port}))
finally:
 command('pg_ctl.exe',['-D',data,'-m','fast','-w','stop'],timeout=30)
