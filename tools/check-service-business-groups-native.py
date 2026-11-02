"""Owned native PG17 metadata migration checks; synthetic catalogue, no remote connection."""
import argparse,json,socket,subprocess,uuid
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);p.add_argument('--port',type=int,default=29952)
a=p.parse_args();repo=Path(__file__).resolve().parent.parent;qa=Path(a.qa).resolve();qa.mkdir(parents=True,exist_ok=True)
data=qa/'data';bin=Path(a.pgbin);flags=getattr(subprocess,'CREATE_NO_WINDOW',0);checks=[]
def command(name,args):
    # pg_ctl's detached server can inherit pipe handles on Windows. Use a retained file.
    with (qa/'commands.log').open('a',encoding='utf-8') as log:
        r=subprocess.run([str(bin/name),*map(str,args)],stdout=log,stderr=subprocess.STDOUT,creationflags=flags,timeout=60)
    if r.returncode:raise RuntimeError('Native command failed; see commands.log')
    return r
with socket.socket() as sock:
    assert sock.connect_ex(('127.0.0.1',a.port))!=0,'Owned QA port already occupied; stop before reusing it'
assert not (data/'PG_VERSION').exists(),'Use a fresh QA directory; never reset prior data'
command('initdb.exe',['-D',data,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
command('pg_ctl.exe',['-D',data,'-l',qa/'server.log','-o',f'-h 127.0.0.1 -p {a.port}','-w','start'])
base=[str(bin/'psql.exe'),'-X','-w','-h','127.0.0.1','-p',str(a.port),'-U','postgres','-qAt','-v','ON_ERROR_STOP=1']
database='business_groups_'+uuid.uuid4().hex[:8]
def sql(text,db=database,ok=True):
    r=subprocess.run(base+['-d',db],input=text,text=True,encoding='utf-8',capture_output=True,creationflags=flags,timeout=30)
    if ok and r.returncode:raise RuntimeError(r.stderr)
    return r
def check(name,condition):
    assert condition,name
    checks.append(name)
def scalar(text):return sql(text).stdout.strip()
source=(repo/'src/data/serviceCatalogue.js').read_text(encoding='utf-8')
leaves=json.loads(source[source.index('['):source.index('\nexport const SERVICE_CADENCES')].strip())
migration=(repo/'supabase/migrations/20261102124538_service_business_group_mapping.sql').read_text(encoding='utf-8')
org='8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
try:
    assert Path(sql('show data_directory','postgres').stdout.strip()).resolve()==data
    sql('create database '+database,'postgres')
    sql('''create schema private;create role anon;create role authenticated;create role service_role;
      create table private.service_setup_leaves(service_id uuid primary key,organization_id uuid,legacy_service_id uuid,definition jsonb);
      alter table private.service_setup_leaves enable row level security;
      revoke all on private.service_setup_leaves from public,anon,authenticated,service_role;
      create table public.service_catalog(id uuid primary key,unit text,recurrence text);
      create table public.project_service_scopes(id uuid primary key,quantity integer,status text);
      insert into public.project_service_scopes values(gen_random_uuid(),12,'active');
      create function public.fixture_receipt() returns integer language sql as $$select 1$$;
      revoke all on function public.fixture_receipt() from public,anon,authenticated,service_role;''')
    inserts=[]
    for row in leaves:
        definition=json.dumps(row).replace("'","''")
        inserts.append(f"insert into private.service_setup_leaves values('{row['id']}','{org}',gen_random_uuid(),'{definition}'::jsonb);insert into public.service_catalog values('{row['id']}','{row['unit']}','{row['recurrence']}');")
    sql('\n'.join(inserts))
    sql("insert into private.service_setup_leaves values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'{\"name\":\"Other organization\"}');")
    metadata_before=scalar("select md5(string_agg(c.relname||coalesce(c.relacl::text,'')||c.relrowsecurity::text,'' order by c.oid)) from pg_class c where c.relnamespace in ('public'::regnamespace,'private'::regnamespace)")
    permissions_before=scalar("select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace")
    canonical_before=scalar("select md5(row_to_json(x)::text) from (select (select jsonb_agg(c order by id) from public.service_catalog c) catalogue,(select jsonb_agg(s order by id) from public.project_service_scopes s) scopes) x")
    original=scalar("select jsonb_agg(l order by service_id)::text from private.service_setup_leaves l")
    # A changed last prerequisite proves the migration cannot partially apply earlier rows.
    sql(f"update private.service_setup_leaves set definition=definition||'{{\"unit\":\"changed\"}}'::jsonb where service_id='{leaves[-1]['id']}';")
    failure=sql(migration,ok=False)
    check('changed prerequisite denies the entire metadata migration',failure.returncode!=0 and 'prerequisite differs' in failure.stderr)
    check('failed admission leaves every mapping absent',scalar("select count(*) from private.service_setup_leaves where definition ? 'business_groups'")=='0')
    sql(f"update private.service_setup_leaves set definition=(select x->'definition' from jsonb_array_elements('{json.dumps([{'id':leaves[-1]['id'],'definition':leaves[-1]}]).replace(chr(39),chr(39)*2)}'::jsonb) x) where service_id='{leaves[-1]['id']}';")
    sql(migration)
    check('all 122 canonical leaves gain versioned mappings',scalar(f"select count(*) from private.service_setup_leaves where organization_id='{org}' and definition->>'business_group_version'='1' and jsonb_array_length(definition->'business_groups')>0")=='122')
    restored=scalar("select jsonb_agg((to_jsonb(l)-'definition')||jsonb_build_object('definition',definition-'business_groups'-'business_group_version') order by service_id)::text from private.service_setup_leaves l")
    check('IDs, legacy links, definitions and other organizations remain unchanged',json.loads(restored)==json.loads(original))
    check('canonical catalogue units, cadence and project commitments remain unchanged',canonical_before==scalar("select md5(row_to_json(x)::text) from (select (select jsonb_agg(c order by id) from public.service_catalog c) catalogue,(select jsonb_agg(s order by id) from public.project_service_scopes s) scopes) x"))
    check('RLS, relation inventory and grants unchanged',metadata_before==scalar("select md5(string_agg(c.relname||coalesce(c.relacl::text,'')||c.relrowsecurity::text,'' order by c.oid)) from pg_class c where c.relnamespace in ('public'::regnamespace,'private'::regnamespace)"))
    check('function bodies and execution rights unchanged',permissions_before==scalar("select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace"))
    before_replay=scalar("select jsonb_agg(l order by service_id)::text from private.service_setup_leaves l")
    check('reapplication denied without rewriting original definitions',sql(migration,ok=False).returncode!=0 and before_replay==scalar("select jsonb_agg(l order by service_id)::text from private.service_setup_leaves l"))
    for role in ['anon','authenticated','service_role']:
        check(role+' retains denied private catalogue access',sql(f'set role {role};select * from private.service_setup_leaves;',ok=False).returncode!=0)
    (qa/'verification.json').write_text(json.dumps({'database':database,'port':a.port,'data':str(data),'checks':checks,'count':len(checks),'evidence':'native PG17; synthetic catalogue/commitments, no production application acceptance'},indent=2),encoding='utf-8')
    print(json.dumps({'passed':len(checks),'verification':str(qa/'verification.json')}))
finally:
    command('pg_ctl.exe',['-D',data,'-m','fast','-w','stop'])
