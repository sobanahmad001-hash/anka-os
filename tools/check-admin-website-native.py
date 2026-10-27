"""Owned isolated native PG17 contract QA. Synthetic base identities; actual pipeline migrations."""
import argparse,json,subprocess,uuid,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pgbin',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();r=Path(a.repo);dbname='website_starter_qa_'+uuid.uuid4().hex[:8]
base=[str(Path(a.pgbin)/'psql.exe'),'-X','-w','-h','127.0.0.1','-p','29822','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql,db=None,ok=True):
 v=subprocess.run(base+['-d',db or dbname],input=sql,text=True,encoding='utf-8',capture_output=True,timeout=30)
 if ok and v.returncode:raise RuntimeError(v.stderr)
 return v
assert run("select current_setting('data_directory');",'postgres').stdout.strip().replace('\\','/').endswith('/anka-admin-website-qa/data')
run('create database '+dbname+';','postgres')
bootstrap="""
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end$$;
create schema auth;create schema private;create schema extensions;create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
create table public.organizations(id uuid primary key,status text);
create table public.organization_memberships(organization_id uuid references public.organizations,user_id uuid references auth.users,member_kind text,status text,role text,department_id text,unique(organization_id,user_id));
create table public.departments(id text,organization_id uuid,primary key(id,organization_id));
create table public.engagements(id uuid,organization_id uuid,primary key(id,organization_id));
create table public.service_catalog(id uuid primary key,organization_id uuid,department_id text,slug text,name text,description text,display_order integer,is_active boolean default true,unit text,recurrence text,unique(id,organization_id));
create table public.service_stage_rules(organization_id uuid,service_id uuid,target_stage_id uuid,fallback_stage_id uuid,satisfied_by_stage_slugs text[],rule_kind text,prerequisite_key text,prerequisite_description text,accepted_asset_kinds text[]);
create table public.blueprint_stage_catalog(id uuid,organization_id uuid,slug text,name text,accountable_department_id text,display_order integer,stage_kind text);
create table public.blueprint_stage_dependencies(organization_id uuid,stage_id uuid,depends_on_stage_id uuid,reason text);
"""
run(bootstrap)
for name in ['20260903201500_pln2_versioned_pipeline_templates.sql','20260920152000_n4_pipeline_preset_department_approvals.sql','20260922080000_n6_execution_definitions.sql','20261001010000_pipeline_published_stage_contracts.sql','20261027123520_admin_website_starter_publication.sql']:
 run((r/'supabase/migrations'/name).read_bytes().decode())
org='8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25';other=str(uuid.uuid4());actors=[str(uuid.uuid4()) for _ in range(9)];request=str(uuid.uuid4())
fixture=f"insert into public.organizations values('{org}','active'),('{other}','active');"
for i,role in enumerate(['system_owner','operations_admin','department_manager','team_member','system_owner','system_owner','system_owner','department_manager','department_manager']):
 fixture+=f"insert into auth.users values('{actors[i]}');insert into public.organization_memberships values('{other if i==4 else org}','{actors[i]}','{'client' if i==6 else 'team'}','{'suspended' if i==5 else 'active'}','{role}','{"design" if i==7 else "development" if i==8 else "content"}');"
for dept in ['content','design','development']:fixture+=f"insert into public.departments values('{dept}','{org}');"
seed=json.loads(run('select private.website_starter_seed();').stdout)
for sid,dept,name in zip(seed['template']['p_service_ids'],['content','design','development'],['New website copy','Unique page UI layout','Website page build']):
 fixture+=f"insert into public.service_catalog(id,organization_id,department_id,slug,name,display_order,unit,recurrence) values('{sid}','{org}','{dept}','test_{dept}','{name}',1,'page','per_batch');"
run(fixture)
def claim(actor):return f"set role authenticated;set request.jwt.claim.sub='{actor}';"
def review(actor=actors[0]):return f"select public.review_website_starter('{org}');"
# Construct explicitly to keep all client commands parameter-independent and readable.
def pub(req=request,token=None,reason='Reviewed Website starter'):
 token="'"+token+"'" if token else f"(public.review_website_starter('{org}')->>'review_sha256')"
 return f"select public.publish_website_starter('{org}','{req}',{token},'{reason}');"
checks=[]
def case(name,sql,code=None,actor=actors[0]):
 result=run('begin;'+claim(actor)+sql+'rollback;',ok=False)
 if code:assert result.returncode and code in result.stderr,(name,result.stderr)
 else:assert result.returncode==0,(name,result.stderr)
 checks.append(name)
case('owner atomic publication',pub())
case('operations admin atomic publication',pub(),actor=actors[1])
for i in range(2,7):case('denied actor '+str(i),review(), '42501',actors[i])
case('anonymous denied',review(),'42501','')
case('other organization denied',f"select public.review_website_starter('{other}');",'42501')
case('wrong review hash denied',pub(token='0'*64),'40001')
case('empty reason denied',pub(reason=''),'22023')
case('changed department denied',"reset role;update public.service_catalog set department_id='design' where department_id='content';"+claim(actors[0])+review(),'40001')
case('inactive service denied',"reset role;update public.service_catalog set is_active=false where department_id='content';"+claim(actors[0])+review(),'55000')
case('changed metadata invalidates review',f"select public.review_website_starter('{org}')->>'review_sha256' as token \\gset\nreset role;update public.service_catalog set name='Changed' where department_id='content';"+claim(actors[0])+f"select public.publish_website_starter('{org}','{request}',:'token','Reviewed Website starter');",'40001')
# Replay the immutable original, and verify no fictional approvals or extra publications.
# Private receipt is deliberately unavailable to the client; recover hash from the public review envelope instead.
success=pub()+f"select public.publish_website_starter('{org}','{request}',public.review_website_starter('{org}')->'receipt'->>'review_sha256','Reviewed Website starter');"
case('exact request replay',success)
case('different request rejected',pub()+pub(req=str(uuid.uuid4()),token='0'*64),'23505')
case('receipt private',f"select * from private.website_starter_publications;",'42501')
case('private helper denied',f"select private.website_starter_seed();",'42501')
# Existing department-gated publisher still rejects an ordinary cross-department draft.
t=seed['template'];ids=','.join("'"+x+"'::uuid" for x in t['p_service_ids'])
case('normal publisher still requires heads',f"select public.create_pipeline_template_version('{org}',null,'manual_test','Manual','',array[{ids}],null,'')->>'pipeline_template_version_id' as vid \\gset\nselect public.publish_pipeline_template_version(:'vid'::uuid);",'42501')

# Prove all existing real department-signoff commands still form a valid publication path.
manual=f"select public.create_pipeline_template_version('{org}',null,'manual_approved','Manual approved','',array[{ids}],null,'')->>'pipeline_template_version_id' as vid \\gset\n"
for i,dept in [(2,'content'),(7,'design'),(8,'development')]:
 manual+="reset role;"+claim(actors[i])+f"select public.approve_pipeline_template_version_department(:'vid'::uuid,'{dept}');"
manual+="reset role;"+claim(actors[0])+"select public.publish_pipeline_template_version(:'vid'::uuid)->>'pipeline_template_publication_id' as presetid \\gset\n"
steps=json.dumps(seed['execution']['p_steps']).replace("'","''")
manual+=f"select public.create_pipeline_execution_definition('{org}',:'presetid'::uuid,'{uuid.uuid4()}','Normal path','{steps}'::jsonb)->>'definition_id' as did \\gset\n"
for i,dept in [(2,'content'),(7,'design'),(8,'development')]:
 manual+="reset role;"+claim(actors[i])+f"select public.approve_pipeline_execution_definition(:'did'::uuid,'{dept}');"
manual+="reset role;"+claim(actors[0])+"select public.publish_pipeline_execution_definition(:'did'::uuid);"
case('existing real department approval publication flow unchanged',manual)
case('revoked publisher cannot replay',pub()+"reset role;"+f"update public.organization_memberships set status='suspended' where user_id='{actors[0]}';"+claim(actors[0])+review(),'42501')
case('inactive organization denied',"reset role;"+f"update public.organizations set status='suspended' where id='{org}';"+claim(actors[0])+review(),'42501')
# The fixed starter is server-defined. Fault injection verifies the reused author validators
# reject a corrupt dependency or stage contract and roll back the earlier preset publication.
for label,mutate in [('invalid dependency',lambda x:x['execution']['p_steps'][0].update(depends_on=['later'])),('invalid required input',lambda x:x['execution']['p_steps'][0]['stage_contract']['required_inputs'][0].update(kind='unknown'))]:
 changed=json.loads(json.dumps(seed));mutate(changed);value=json.dumps(changed).replace("'","''")
 replacement=f"reset role;create or replace function private.website_starter_seed() returns jsonb language sql immutable set search_path='' as $seed$select '{value}'::jsonb$seed$;"+claim(actors[0])
 case(label+' rolls back all publications',replacement+pub(),'22023')

# A fault after the preset insert proves whole-command rollback, including the audit receipt.
run("create function public.qa_fail_definition() returns trigger language plpgsql as $$begin raise exception 'QA stop' using errcode='P0001';end$$;create trigger qa_fail before insert on public.pipeline_execution_definitions for each row execute function public.qa_fail_definition();")
case('execution failure rolls back preset',pub(),'P0001')
assert run('select count(*) from public.pipeline_templates;').stdout.strip()=='0'
run('drop trigger qa_fail on public.pipeline_execution_definitions;drop function public.qa_fail_definition();')
# Native concurrency: identical first request serializes and replays once.
first=subprocess.Popen(base+['-d',dbname],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
first.stdin.write('begin;'+claim(actors[0])+pub()+"select pg_sleep(2);commit;\n");first.stdin.close();first.stdin=None
time.sleep(.3)
second=run(claim(actors[0])+f"select public.publish_website_starter('{org}','{request}',(public.review_website_starter('{org}')->'receipt'->>'review_sha256'),'Reviewed Website starter');",ok=False)
out,err=first.communicate(timeout=15);assert first.returncode==0,err
assert second.returncode==0,second.stderr
counts=json.loads(run("select json_build_object('templates',(select count(*) from public.pipeline_templates),'definitions',(select count(*) from public.pipeline_execution_definitions),'preset_publications',(select count(*) from public.pipeline_template_publications),'execution_publications',(select count(*) from public.pipeline_execution_publications),'fake_preset_approvals',(select count(*) from public.pipeline_template_department_approvals),'fake_execution_approvals',(select count(*) from public.pipeline_execution_definition_approvals),'receipts',(select count(*) from private.website_starter_publications));").stdout)
assert counts==dict(templates=1,definitions=1,preset_publications=1,execution_publications=1,fake_preset_approvals=0,fake_execution_approvals=0,receipts=1),counts
checks.append('concurrent identical request creates one exact pair without department approvals')
Path(a.evidence).write_text(json.dumps({'database':dbname,'checks':checks,'count':len(checks),'counts':counts,'boundary':'Native PG17 with synthetic base schema and actors; actual five pipeline migrations. No production acceptance.'},indent=2))
print(json.dumps({'pass':len(checks),'counts':counts}))
