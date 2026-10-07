"""Rollback-only importer QA. Existing local QA anchors; no users or providers."""
import argparse, hashlib, json, re, subprocess
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--psql',required=True)
parser.add_argument('--port',required=True,type=int)
parser.add_argument('--database',required=True)
parser.add_argument('--expected-data-directory',required=True)
parser.add_argument('--user',default='postgres')
parser.add_argument('--inventory',action='store_true')
parser.add_argument('--calendar-create-only',action='store_true',help='Run only new calendar create assertions; reuse earlier unaffected evidence')
parser.add_argument('--evidence',type=Path)
args=parser.parse_args()
if args.database!='anka_b1_firstsend_20260930' and not args.database.startswith('anka_importer_qa_'):
    raise SystemExit('Use the established synthetic QA database or an anka_importer_qa_ disposable copy only')
repo=Path(__file__).resolve().parents[1]
migrations=[repo/'supabase/migrations/20261006152330_project_chat_spreadsheet_private_sources.sql',repo/'supabase/migrations/20261006154628_project_chat_spreadsheet_proposals.sql',repo/'supabase/migrations/20261006202317_project_chat_import_calendar_create.sql']
behavior=repo/('supabase/tests/project_chat_spreadsheet_import.calendar_create.sql' if args.calendar_create_only else 'supabase/tests/project_chat_spreadsheet_import.behavior.sql')
cmd=[args.psql,'-X','-w','-h','127.0.0.1','-p',str(args.port),'-U',args.user,'-d',args.database,'-qAt','-v','ON_ERROR_STOP=1']
quote=lambda v:"'"+v.replace("'","''")+"'"
guard=f"""do $$begin
 if current_database()<>{quote(args.database)} or current_setting('data_directory')<>{quote(args.expected_data_directory)}
 or current_setting('server_version_num')::integer not between 170000 and 179999 then
 raise exception 'Exact local PostgreSQL17 QA identity required';end if;end;$$;"""
def run(sql):
    result=subprocess.run(cmd,input=guard+sql,text=True,encoding='utf-8',capture_output=True,timeout=180)
    if result.returncode:raise RuntimeError(result.stderr)
    return result
required=[
 'public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)',
 'private.can_edit_content_artifacts(uuid,uuid)',
 'private.n1c_require_scope(uuid,uuid,uuid)',
 'private.n1c_can_assign_department(uuid,uuid,text,uuid)',
 'public.schedule_marketing_calendar_entry(uuid,uuid,uuid,uuid,text,uuid,bigint,date,date,uuid)',
 'public.fail_department_chat_attachment(uuid,uuid,text,text,text)',
 'private.protect_department_chat_model_binding()',
 'private.protect_department_chat_proposal()',
 'private.audit_department_chat_proposal()',
]
inventory_sql="select jsonb_build_object('version',current_setting('server_version'),'database',current_database(),'functions',jsonb_object_agg(signature,to_regprocedure(signature) is not null)) from unnest(array["+','.join(quote(v) for v in required)+"]) signature;"
inventory=json.loads(run(inventory_sql).stdout.strip())
anchors=json.loads(run("""select jsonb_build_object(
 'owner',exists(select 1 from public.organization_memberships where organization_id='99999999-9999-4999-8999-999999999901' and user_id='99999999-9999-4999-8999-999999999902' and status='active' and member_kind='team'),
 'project',exists(select 1 from public.projects where id='99999999-9999-4999-8999-999999999974' and organization_id='99999999-9999-4999-8999-999999999901' and archived_at is null),
 'engagement',exists(select 1 from public.engagements where id='99999999-9999-4999-8999-999999999975' and project_id='99999999-9999-4999-8999-999999999974'),
 'architecture_template',exists(select 1 from public.artifacts where id='99999999-9999-4999-8999-999999997140' and artifact_type='website_architecture' and organization_id='99999999-9999-4999-8999-999999999901' and project_id='99999999-9999-4999-8999-999999999974' and engagement_id='99999999-9999-4999-8999-999999999975'),
 'content_service',exists(select 1 from public.engagement_services s join public.service_catalog c on c.id=s.service_id and c.organization_id=s.organization_id where s.engagement_id='99999999-9999-4999-8999-999999999975' and s.status='active' and c.is_active and c.department_id='content'),
 'marketing_service',exists(select 1 from public.engagement_services s join public.service_catalog c on c.id=s.service_id and c.organization_id=s.organization_id where s.engagement_id='99999999-9999-4999-8999-999999999975' and s.status='active' and c.is_active and c.department_id='marketing'),
 'content_authority',private.can_edit_content_artifacts('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999902'),
 'private_bucket',exists(select 1 from storage.buckets where id='department-chat-attachments' and not public and file_size_limit=5242880),
 'fixture_namespace_clear',not exists(select 1 from public.department_chat_conversations where id='8f000000-0000-4000-8000-000000000001'));
""").stdout.strip())
inventory['synthetic_prerequisites']=anchors
print(json.dumps(inventory,indent=2),flush=True)
if args.inventory:raise SystemExit(0)
if not all(inventory['functions'].values()) or not all(anchors.values()):raise SystemExit('Prerequisite inventory failed; do not synthesize users, authority or production data')

state_sql="""select jsonb_build_object(
 'versions',(select count(*) from public.artifact_versions),'approvals',(select count(*) from public.artifact_approvals),
 'pages',(select count(*) from public.project_website_pages),'ai_runs',(select count(*) from public.ai_runs),
 'conversations',(select count(*) from public.department_chat_conversations),'attachments',(select count(*) from public.department_chat_attachments),
 'events',(select count(*) from public.engagement_events),'audit',(select count(*) from public.department_chat_audit_events),
 'work_items',(select count(*) from public.work_items),'proposals',(select count(*) from public.department_chat_proposals),'tasks',(select count(*) from public.tasks),
 'bucket',(select md5(to_jsonb(b)::text) from storage.buckets b where id='department-chat-attachments'),
 'audit_source',md5(pg_get_functiondef('private.audit_department_chat_proposal()'::regprocedure)),
 'model_guard_source',md5(pg_get_functiondef('private.protect_department_chat_model_binding()'::regprocedure)),
 'membership',(select md5(to_jsonb(m)::text) from public.organization_memberships m where organization_id='99999999-9999-4999-8999-999999999901' and user_id='99999999-9999-4999-8999-999999999902'),
 'project_archive',(select archived_at from public.projects where id='99999999-9999-4999-8999-999999999974'));
"""
before=json.loads(run(state_sql).stdout.strip())
def body(path):
    value=path.read_text(encoding='utf-8')
    value=re.sub(r'(?im)^begin;\s*','',value,count=1)
    value=re.sub(r'(?im)^commit;\s*$','',value,count=1)
    return value
result=run('begin;set local lock_timeout=\'5s\';set local statement_timeout=\'120s\';'+''.join(body(p) for p in migrations)+behavior.read_text(encoding='utf-8')+'rollback;')
passes=result.stderr.count('PASS ')
if passes<(8 if args.calendar_create_only else 35):raise RuntimeError(f'Expected at least 30 focused assertions, got {passes}: '+result.stderr)
after=json.loads(run(state_sql).stdout.strip())
if after!=before:raise RuntimeError('Rollback did not restore QA history/authority/catalog')
print(f'PASS {passes} native assertions; full rollback restored histories, authority, bucket and provider guard',flush=True)
evidence={'scope':'Synthetic local PostgreSQL17 only; not production/Storage/browser/provider acceptance','inventory':inventory,'assertions':passes,'rollback_restored':True,
 'files':{str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in migrations+[behavior]},
 'candidate':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()}
if args.evidence:args.evidence.parent.mkdir(parents=True,exist_ok=True);args.evidence.write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
