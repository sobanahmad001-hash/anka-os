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
port = 29940
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
database = 'website_qa_' + uuid.uuid4().hex[:8]

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
check('read-only Content role cannot acquire QA save authority',review_qa(reader),True)
check('anonymous QA writer denied',accept().replace('set role authenticated','set role anon'),True)
check('service role cannot impersonate authenticated QA writer',accept().replace('set role authenticated','set role service_role'),True)
check('unchecked human acceptance denied',accept(confirmed='false'),True)
check('missing manual evidence denied',accept(value={}),True)
check('short evidence denied',accept(value={**evidence_notes,'keyboard':'x'}),True)
check('unexpected evidence key denied',accept(value={**evidence_notes,'extra':'Not accepted'}),True)
check('oversized evidence denied',accept(value={**evidence_notes,'keyboard':'x'*1001}),True)
baseline=run(f"select md5(row_to_json(j)::text||row_to_json(d)::text) from public.wordpress_export_jobs j join public.website_page_designs d on d.id=j.website_page_design_id where j.id={q(job)}").stdout.strip()
accepted=json.loads(check('explicit QA save atomically reuses actual immutable Development artifact writer',accept()))
stored=json.loads(run(f"select content from public.artifact_versions where id={q(accepted['artifact_version_id'])}").stdout)
assert stored['website_qa']['assessment']=='human_reported_pass' and stored['website_qa']['publication_authorized']==False
assert run(f"select count(*) from public.engagement_events where payload->>'version_id'={q(accepted['artifact_version_id'])}").stdout.strip()=='1'
assert json.loads(check('same original request recovers without duplicate artifact version',accept()))['id']==accepted['id']
check('changed original evidence conflicts instead of creating another version',accept(value={**evidence_notes,'keyboard':'Different reviewed keyboard evidence'}),True)
recover=auth(builder)+f"select public.get_website_qa_record({scope},{q(uid(400))});"
assert json.loads(check('read-only original recovery returns exact retained QA receipt',recover))['id']==accepted['id']
assert run(auth(reader)+f"select public.get_website_qa_record({scope},{q(uid(400))});").stdout.strip()==''
checks.append('another actor cannot recover someone else original QA request')
artifact=run(f"select artifact_id from public.artifact_versions where id={q(accepted['artifact_version_id'])}").stdout.strip()
next_review=json.loads(run(review_qa(artifact=q(artifact))).stdout)
check('launch checklist head compare-and-swap rejects stale review',accept(uid(401),artifact=q(artifact),version='null',review=next_review),True)
check('a second first-version request cannot silently create a duplicate QA checklist',accept(uid(402)),True)
assert next_review['snapshot']['artifact_version_id']==accepted['artifact_version_id']

# Manual edits remain canonical and classification is never lowered by the QA save.
run(f"insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum,data_classification) values({q(uid(410))},{q(org)},{q(artifact)},2,'{{\"notes\":\"Preserve this manual launch note\",\"checklist\":[\"Backup reviewed\"]}}','{'d'*64}','restricted')")
check('concurrent manual launch checklist edit invalidates old QA review',accept(uid(411),artifact=q(artifact),version=q(accepted['artifact_version_id']),review=next_review),True)
fresh=json.loads(run(review_qa(artifact=q(artifact))).stdout)
second=json.loads(check('new exact acceptance preserves canonical notes checklist and restricted classification',accept(uid(412),artifact=q(artifact),version=q(uid(410)),review=fresh)))
saved=json.loads(run(f"select row_to_json(v) from public.artifact_versions v where id={q(second['artifact_version_id'])}").stdout)
assert saved['content']['notes']=='Preserve this manual launch note' and saved['content']['checklist']==['Backup reviewed'] and saved['data_classification']=='restricted' and saved['ai_use_allowed']==False

# Current issue writers serialize with the QA review run, then invalidate the reviewed state.
issue_sql=auth(builder)+f"select public.record_website_staging_issue({scope},{q(staging_run['id'])},null,null,'opened','Review keyboard behavior',{q(uid(420))});"
opened=json.loads(run(issue_sql).stdout)
check('unresolved canonical issue prevents new QA acceptance',review_qa(artifact=q(artifact)),True)
assert json.loads(check('new issue never rewrites earlier accepted QA history',recover))['id']==accepted['id']
run(auth(builder)+f"select public.record_website_staging_issue({scope},{q(staging_run['id'])},{q(opened['issue_id'])},{q(opened['id'])},'resolved','Keyboard behavior reviewed',{q(uid(421))});")
closed=json.loads(run(review_qa(artifact=q(artifact))).stdout)
assert len(closed['snapshot']['issue_heads'])==1
check('old no-issue review cannot accept changed issue history',accept(uid(422),artifact=q(artifact),version=q(second['artifact_version_id']),review=fresh),True)
for table in ['private.website_qa_acceptances']:
 check('closed QA pointer table has no direct authenticated reads',auth(builder)+f'select * from {table};',True)
 check('immutable QA pointers reject owner update',f"update {table} set request_sha256='{'e'*64}';",True)
 check('immutable QA pointers reject owner delete',f'delete from {table};',True)
run(f"update public.organization_memberships set department_id='content' where user_id={q(builder)}")
check('current department revocation blocks new acceptance',accept(uid(430),artifact=q(artifact),version=q(second['artifact_version_id']),review=closed),True)
assert json.loads(check('still-authorized project reader recovers original receipt without a save',recover))['id']==accepted['id']
run(f"update public.organization_memberships set status='revoked' where user_id={q(builder)}")
check('removed membership denies original recovery',recover,True)
run(f"update public.organization_memberships set status='active',department_id='development' where user_id={q(builder)}")
run(f"update public.integration_connections set status='disabled' where id={q(connection)}")
check('revoked connection prevents new acceptance review',review_qa(artifact=q(artifact)),True)
assert json.loads(check('revoked connection cannot destroy original QA receipt recovery',recover))['id']==accepted['id']
assert baseline==run(f"select md5(row_to_json(j)::text||row_to_json(d)::text) from public.wordpress_export_jobs j join public.website_page_designs d on d.id=j.website_page_design_id where j.id={q(job)}").stdout.strip()
checks.append('existing design package completion and source history unchanged')
run(f"update public.integration_connections set status='verified' where id={q(connection)}")
import time
def process(sql):
 worker=subprocess.Popen([str(Path(args.pgbin)/'psql.exe'),*map(str,base),'-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=flags)
 worker.stdin.write('begin;'+sql+'commit;');worker.stdin.close();worker.stdin=None
 return worker
current=json.loads(run(review_qa(artifact=q(artifact))).stdout)
before_count=run(f"select count(*) from public.artifact_versions where artifact_id={q(artifact)}").stdout.strip()
parallel=accept(uid(450),artifact=q(artifact),version=q(second['artifact_version_id']),review=current)
workers=[process(parallel),process(parallel)]
answers=[]
for worker in workers:
 out,err=worker.communicate(timeout=15);assert worker.returncode==0,err
 answers.append(json.loads(out.strip().splitlines()[-1]))
assert answers[0]['id']==answers[1]['id']
assert int(run(f"select count(*) from public.artifact_versions where artifact_id={q(artifact)}").stdout.strip())==int(before_count)+1
checks.append('actual concurrent identical requests append exactly one artifact version and receipt')
locker=process("set application_name='website_qa_issue_race';"+auth(builder)+f"select public.record_website_staging_issue({scope},{q(staging_run['id'])},null,null,'opened','Concurrent review note',{q(uid(451))});select pg_sleep(1.5);")
for _ in range(80):
 if run("select exists(select 1 from pg_stat_activity where application_name='website_qa_issue_race' and wait_event='PgSleep')").stdout.strip()=='t':break
 time.sleep(.02)
else:raise AssertionError('Issue lock race not observed')
check('observed in-flight issue transaction serializes QA review and rejects newly open issue',review_qa(artifact=q(artifact)),True)
out,err=locker.communicate(timeout=10);assert locker.returncode==0,err
new_issue=json.loads(out.strip().splitlines()[0])
run(auth(builder)+f"select public.record_website_staging_issue({scope},{q(staging_run['id'])},{q(new_issue['issue_id'])},{q(new_issue['id'])},'resolved','Concurrent note reviewed',{q(uid(452))});")
current=json.loads(run(review_qa(artifact=q(artifact))).stdout)
before_atomic=run("select (select count(*) from public.artifact_versions)::text||':'||(select count(*) from public.engagement_events)::text").stdout.strip()
run("create function private.qa_fixture_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic receipt write failure';end$$;create trigger qa_fixture_failure before insert on private.website_qa_acceptances for each row execute function private.qa_fixture_failure();")
check('late receipt failure rolls back actual artifact version and engagement event together',accept(uid(453),artifact=q(artifact),version=q(answers[0]['artifact_version_id']),review=current),True)
assert before_atomic==run("select (select count(*) from public.artifact_versions)::text||':'||(select count(*) from public.engagement_events)::text").stdout.strip()
verification={'database':database,'port':port,'data':str(data),'checks':checks,'count':len(checks),'actual_dependencies':['current Website authority/source/connection helpers','save_development_artifact_version','record_website_staging_issue'],'boundary':'Owned synthetic PG17 only; no production records, secrets, external requests or paid calls'}
(qa/'verification.json').write_text(json.dumps(verification,indent=2)+'\n',encoding='utf-8')
print(json.dumps(verification))
