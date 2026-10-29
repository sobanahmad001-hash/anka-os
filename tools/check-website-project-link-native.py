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
port = 29944
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
database = 'website_project_link_' + uuid.uuid4().hex[:8]

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

run("alter table public.integration_connections add constraint integration_connections_id_organization_unique unique(id,organization_id);")
run(f"alter table public.integration_connection_engagements add column created_by uuid not null default {q(owner)} references auth.users(id),add column created_at timestamptz not null default now(),add primary key(connection_id,engagement_id,department_id),add foreign key(connection_id,organization_id) references public.integration_connections(id,organization_id),add foreign key(engagement_id,organization_id) references public.engagements(id,organization_id);")
run((repo/'supabase/migrations/20261029111008_website_staging_project_link.sql').read_text(encoding='utf-8'))
new_connection=uid(600)
run(f"insert into public.integration_connections(id,organization_id,provider,display_name,base_url,public_config,secret_name,status,last_check_status,created_by,updated_at) values({q(new_connection)},{q(org)},'wordpress','Synthetic verified existing connector',{q(origin)},{j({'username':'fixture-stage'})},'ANKA_WORDPRESS_FIXTURE','verified','passed',{q(owner)},{q(revision)});insert into public.integration_connection_departments values({q(org)},{q(new_connection)},'development');")
checks=[]
def link(a=owner,request=uid(610),confirmed='true',rev=revision,url=origin):
 return auth(a)+f"select public.link_website_staging_connection({scope},{q(new_connection)},{q(rev)},{q(url)},{confirmed},{q(request)});"
def workspace(a=owner):
 return auth(a)+f"select public.get_website_staging_connection_links({scope});"
def recover(request=uid(610)):
 return auth(owner)+f"select public.get_website_staging_connection_link({scope},{q(request)});"
try:
 choices=json.loads(check('owner sees verified Development choices without secrets or automatic project links',workspace()))
 chosen=next(x for x in choices['connections'] if x['id']==new_connection)
 assert not chosen['project_linked'] and 'secret' not in str(choices) and 'username' not in str(choices)
 for a in [builder,reader,outsider]:check('non-owner '+a+' cannot create project access',link(a),True)
 check('unchecked project link denied',link(confirmed='false'),True)
 check('stale connector revision denied',link(rev='2026-01-01T00:00:00Z'),True)
 check('different exact origin denied',link(url='https://foreign.example.test'),True)
 check('anonymous caller cannot link',link().replace('set role authenticated','set role anon'),True)
 check('database service role cannot impersonate an app owner',link().replace('set role authenticated','set role service_role'),True)
 before=run(f"select row_to_json(c) from public.integration_connections c where id={q(new_connection)}").stdout.strip()
 receipt=json.loads(check('actual signed-in owner links one canonical Development engagement mapping',link()))
 assert receipt['created_by']==owner and receipt['link_existed']==False
 assert run(f"select count(*) from public.integration_connection_engagements where connection_id={q(new_connection)} and engagement_id={q(engagement)} and department_id='development'").stdout.strip()=='1'
 assert run(f"select row_to_json(c) from public.integration_connections c where id={q(new_connection)}").stdout.strip()==before
 checks.append('entire existing connector row remains unchanged including Verified status and last check')
 assert json.loads(check('same original request replays one receipt without another link',link()))['id']==receipt['id']
 check('changed original project-link input conflicts',link(url='https://changed.example.test'),True)
 with ThreadPoolExecutor(max_workers=2) as pool:parallel=list(pool.map(lambda _:json.loads(run(link(request=uid(612))).stdout),range(2)))
 assert parallel[0]['id']==parallel[1]['id'] and parallel[0]['link_existed']
 checks.append('concurrent original UUID appends one receipt and does not duplicate canonical mapping')
 original_count=run('select count(*) from private.website_staging_connection_links').stdout.strip()
 assert json.loads(check('read-only lost-response recovery returns actual original receipt',recover()))['id']==receipt['id']
 assert run('select count(*) from private.website_staging_connection_links').stdout.strip()==original_count
 run(f"delete from public.integration_connection_engagements where connection_id={q(new_connection)} and engagement_id={q(engagement)};")
 assert json.loads(run(recover()).stdout)['id']==receipt['id']
 run(link())
 assert run(f"select count(*) from public.integration_connection_engagements where connection_id={q(new_connection)}").stdout.strip()=='0'
 checks.append('later mapping revocation remains possible and original recovery/replay never regrants access')

 alternate_project=uid(640)
 run(f"insert into public.projects(id,organization_id) values({q(alternate_project)},{q(org)});")
 check('same-organization different project cannot borrow the selected engagement',link(request=uid(641)).replace(q(project),q(alternate_project)),True)
 run(f"create function private.reject_project_link_fixture() returns trigger language plpgsql as $$$$begin if new.request_id={q(uid(650))} then raise exception 'Synthetic receipt insertion failure';end if;return new;end$$$$;create trigger project_link_fixture_failure before insert on private.website_staging_connection_links for each row execute function private.reject_project_link_fixture();".replace('$$$$','$$'))
 check('late receipt failure rolls back canonical mapping atomically',link(request=uid(650)),True)
 assert run(f"select count(*) from public.integration_connection_engagements where connection_id={q(new_connection)}").stdout.strip()=='0'
 run('drop trigger project_link_fixture_failure on private.website_staging_connection_links;drop function private.reject_project_link_fixture();')
 checks.append('no canonical mapping survives failed immutable receipt insertion')

 run(f"update public.organization_memberships set status='inactive' where user_id={q(owner)} and organization_id={q(org)};")
 check('revoked owner cannot grant a fresh project link',link(request=uid(613)),True)
 run(f"update public.organization_memberships set status='active' where user_id={q(owner)} and organization_id={q(org)};")
 run(f"delete from public.integration_connection_departments where connection_id={q(new_connection)};")
 check('missing department access cannot be silently recreated',link(request=uid(614)),True)
 check('private immutable receipt cannot be rewritten',f"update private.website_staging_connection_links set base_url='https://changed.example.test' where id={q(receipt['id'])};",True)
 schema=json.loads(run("select json_agg(json_build_object('signature',p.oid::regprocedure::text,'body',p.prosrc,'md5',md5(p.prosrc),'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'service_role',has_function_privilege('service_role',p.oid,'execute'),'schema',n.nspname) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('website_staging_link_actor','get_website_staging_connection_links','link_website_staging_connection','get_website_staging_connection_link')").stdout)
 assert len(schema)==4
 for fn in schema:assert fn['config']==['search_path=""'] and not fn['anon'] and not fn['service_role'] and fn['authenticated']==(fn['schema']=='public')
 assert run("select relrowsecurity from pg_class where oid='private.website_staging_connection_links'::regclass").stdout.strip()=='t'
 for role in ['anon','authenticated','service_role']:assert run(f"select has_table_privilege('{role}','private.website_staging_connection_links','select,insert,update,delete')").stdout.strip()=='f'
 (qa/'expected-schema.json').write_text(json.dumps(schema,indent=2))
 (qa/'verification.json').write_text(json.dumps({'database':database,'port':port,'checks':checks,'actual_authority_helpers':True,'canonical_mapping':'existing integration_connection_engagements','connector_row_unchanged':True,'production_writes':False},indent=2))
 print(json.dumps({'passed':len(checks),'database':database,'port':port}))
finally:
 command('pg_ctl.exe',['-D',data,'-m','fast','-w','stop'],timeout=30)
