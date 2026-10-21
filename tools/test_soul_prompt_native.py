# Run only against an isolated local PostgreSQL instance with PG* credentials in the environment.
# Usage: python3 tools/test_soul_prompt_native.py NEW_SCRATCH_DB TEMPLATE_DB OUTPUT_DIR
# Creates a fresh scratch clone; synthetic fixtures roll back. Never targets production.
import pathlib,json,uuid,hashlib,os,subprocess,sys,re
assert os.environ.get('PGHOST') in ('127.0.0.1','localhost')
assert os.environ.get('PGPORT')=='29690'
name,template,output=sys.argv[1:]
assert re.fullmatch(r'anka_soul_prompt_qa_[a-z0-9_]+',name)
assert re.fullmatch(r'anka_[a-z0-9_]+',template)
base=pathlib.Path(output);base.mkdir(parents=True,exist_ok=True)
repo=pathlib.Path(__file__).resolve().parents[1]
env=dict(os.environ,PGDATABASE='postgres')
cmd=[os.environ.get('PSQL','psql'),'-X','-w','-qAt','-v','ON_ERROR_STOP=1']
def sql(s):
 p=subprocess.run(cmd,input=s,capture_output=True,text=True,env=env)
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout
assert sql("select count(*) from pg_database where datname='"+name+"'").strip()=='0','Scratch exists: inspect instead of blind rerun'
sql('create database '+name+' template '+template);env['PGDATABASE']=name
meta="select json_build_object('owner',proowner,'security',prosecdef,'config',proconfig,'acl',proacl)::text from pg_proc where oid='public.prepare_design_media_request(uuid,uuid,jsonb)'::regprocedure"
before=sql(meta)
old=sql("select pg_get_functiondef('public.prepare_design_media_request(uuid,uuid,jsonb)'::regprocedure)")
migration=(repo/'supabase/migrations/20261021132000_design_soul_visual_prompt.sql').read_text()
sql(migration);assert sql(meta)==before
new=sql("select pg_get_functiondef('public.prepare_design_media_request(uuid,uuid,jsonb)'::regprocedure)")
old_fragment=migration.split('$old$')[1];new_fragment=migration.split('$new$')[1]
assert new==old.replace(old_fragment,new_fragment),'Unexpected nonprompt changes'
o,a,c,b,v,conn=[str(uuid.uuid4()) for _ in range(6)]
content={'title':'Synthetic coffee','purpose':'Internal browser verification','audience':'Owner QA only','instructions':'A white ceramic coffee cup, soft sunlight, realistic photography, no text or logos. For motion and video: slow camera push, steam rising.','exclusions_constraints':'No text, logos, people, audio or multiple shots.'}
req={'organization_id':o,'context':{'kind':'private','id':c},'creative_brief_version_id':v,'connector_connection_id':conn,'provider':'higgsfield','model_id':'higgsfield-ai/soul/v2/standard','settings':{'resolution':'720p','aspect_ratio':'16:9','enhance_prompt':False},'output_count':1,'input_versions':[],'prompt_checksum':'0'*64}
def lit(value):return "'"+json.dumps(value).replace("'","''")+"'::jsonb"
setup=f"""begin;
insert into auth.users(id,email) values('{a}','{a}@example.invalid');
insert into public.organizations(id,name,slug,status) values('{o}','Synthetic prompt QA','prompt-{o}','active');
insert into public.organization_memberships(organization_id,user_id,role,department_id,status,member_kind) values('{o}','{a}','operations_admin','design','active','team');
select public.create_design_private_upload_conversation('{o}','{a}','{c}');
insert into public.design_creative_briefs(id,organization_id,visibility,created_by,updated_by) values('{b}','{o}','private','{a}','{a}');
insert into public.design_creative_brief_versions(id,organization_id,creative_brief_id,version_number,content,content_checksum,validation_snapshot,operation_key,created_by) values('{v}','{o}','{b}',1,{lit(content)},repeat('a',64),'{{"valid":true}}',gen_random_uuid(),'{a}');
update public.design_creative_briefs set current_version_id='{v}',frozen_version_id='{v}',revision=2 where id='{b}';
insert into public.integration_connections(id,organization_id,provider,display_name,secret_name,status,created_by) values('{conn}','{o}','higgsfield','Synthetic no credential','ANKA_HIGGSFIELD_LOCAL_QA_NO_CREDENTIAL','verified','{a}');
"""
# Exercise the actual authorized request preparer and checksum in PostgreSQL.
call=f"public.prepare_design_media_request('{o}','{a}',{lit(req)})"
result=sql(setup+f"select 'RESULT:'||{call}::text;rollback;")
answer=json.loads(next(x[7:] for x in result.splitlines() if x.startswith('RESULT:')))
prompt=answer['prompt']
assert content['instructions'] in prompt and content['exclusions_constraints'] in prompt
assert 'not a screenshot' in prompt and 'Context only, not visible text' in prompt
assert 'Required visible text' not in prompt
assert answer['request']['prompt_checksum']==hashlib.sha256(prompt.encode()).hexdigest()
assert answer['request']['settings']==req['settings']
assert sql(f"select count(*) from public.organizations where id='{o}'").strip()=='0'
(base/'soul-native-prompt.json').write_text(json.dumps(answer,indent=2))
# Test adversarial strings/required copy and unchanged non-Soul branch using actual replacement expression.
expression=new_fragment.replace("v.content",'content')
cases=[('required_text',dict(content,required_text='SALE 20%')),('unicode',dict(content,instructions="Café owner's cup — no labels",required_text='سلام')),('empty',dict(content,required_text='   ')),('metadata',dict(content,purpose='Dashboard status report',audience='A slide presentation'))]
checks=[]
for label,data in cases:
 q="begin;create function pg_temp.render(content jsonb,p_request jsonb) returns text language plpgsql as $test$declare prompt text;begin "+expression+" return prompt;end;$test$;select pg_temp.render("+lit(data)+","+lit(req)+");rollback;"
 value=sql(q).strip();assert data['instructions'] in value
 if label in ('required_text','unicode'):assert 'Required visible text (subject to the exclusions): '+data['required_text'] in value
 if label=='empty':assert 'Required visible text' not in value
 checks.append(label)
video=dict(req,model_id='kling-video/v3.0/std/text-to-video')
q="begin;create function pg_temp.render(content jsonb,p_request jsonb) returns text language plpgsql as $test$declare prompt text;begin "+expression+" return prompt;end;$test$;select pg_temp.render("+lit(content)+","+lit(video)+");rollback;"
assert sql(q).strip()=='\n\n'.join([f'Purpose: {content["purpose"]}',f'Audience: {content["audience"]}',f'Instructions: {content["instructions"]}',f'Constraints: {content["exclusions_constraints"]}'])
e={'scratch':name,'actualPreparePass':True,'promptChecksumVerified':True,'settingsUnchanged':True,'fixtureRollbackVerified':True,'functionMetadataUnchanged':True,'nonPromptBodyUnchanged':True,'cases':checks+['non_soul_byte_unchanged'],'paidCalls':0,'productionChanges':False}
(base/'soul-prompt-verification.json').write_text(json.dumps(e,indent=2))
print(json.dumps(e))
