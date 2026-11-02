"""Fresh owned PG17: actual scope/setup helpers and new source reader.

Canonical base tables/records are synthetic. No production or provider access;
no claim that this read-only context materializes a default pipeline.
"""
from pathlib import Path
import sys,json,subprocess

fixture=Path(__file__).with_name('check-project-chat-delivery-native.py')
source=fixture.read_text(encoding='utf-8')
assert source.count('initial=setup();before=')==1
prefix=source.split('initial=setup();before=',1)[0].replace('port=29932','port=29958',1)
qa_arg=Path(sys.argv[sys.argv.index('--qa')+1]).resolve()
assert not (qa_arg/'data').exists(),'Use a new owned QA directory'
try:
 exec(compile(prefix,str(fixture),'exec'),globals())
 brand,client=uid(850),uid(851)
 run("""alter table public.engagements add column client_id uuid,add column brand_id uuid;
 create table public.agency_clients(id uuid,organization_id uuid,status text);
 create table public.brands(id uuid,organization_id uuid,client_id uuid,status text);
 create table public.artifacts(id uuid,organization_id uuid,project_id uuid,engagement_id uuid,brand_id uuid,artifact_type text,title text);
 create table public.artifact_versions(id uuid,organization_id uuid,artifact_id uuid,version_number integer,content_checksum text,created_at timestamptz,content jsonb);
 create table public.artifact_approvals(id uuid,organization_id uuid,artifact_id uuid,artifact_version_id uuid,engagement_id uuid,decision text,approved_by uuid,approved_at timestamptz);""")
 run(f"insert into public.agency_clients values({q(client)},{q(org)},'active');insert into public.brands values({q(brand)},{q(org)},{q(client)},'active');update public.engagements set client_id={q(client)},brand_id={q(brand)};")
 run("alter table public.artifact_approvals add constraint artifact_approvals_artifact_version_id_key unique(artifact_version_id),add constraint artifact_approvals_decision_check check(decision='approved');")
 run("""CREATE OR REPLACE FUNCTION private.reject_immutable_artifact_history_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception '% records are immutable; create a new version or decision row.', tg_table_name
    using errcode = '55000';
end;
$function$
""")
 run("create trigger trg_artifact_approvals_immutable before delete or update on public.artifact_approvals for each row execute function private.reject_immutable_artifact_history_change();")
 run((repo/'supabase/migrations/20261102160309_project_default_brand_foundation_context.sql').read_text(encoding='utf-8'))
 def context(limit=25,offset=0,eng=engagement,proj=project,organization=org):return f"select public.get_project_default_plan_context({q(organization)},{q(proj)},{q(eng)},{limit},{offset})"
 def output(n,kind='content',approved=True,proj=project,eng=engagement,brand_value=brand):
  aid,vid=uid(1000+n),uid(2000+n)
  run(f"insert into public.artifacts values({q(aid)},{q(org)},{q(proj)},{q(eng)},{q(brand_value)},{q(kind)},{q('Guideline '+str(n))});insert into public.artifact_versions values({q(vid)},{q(org)},{q(aid)},1,{q(str(n%10)*64)},'2026-11-01','{{\"private_body\":\"Never projected\"}}');")
  if approved:run(f"insert into public.artifact_approvals values({q(uid(3000+n))},{q(org)},{q(aid)},{q(vid)},{q(eng)},'approved',{q(actor)},'2026-11-02');")
  return aid,vid
 first=value(context());assert first['approved_sources']==[] and first['source_total']==0
 passed('actual authenticated scope/setup context executes without creating plan/work/approval records')
 aid,vid=output(1);visual=output(2,'design_system');output(3,approved=False);output(4,proj=uid(987));output(5,brand_value=uid(986));output(6,'marketing_report')
 # Approval belongs to another artifact: it must not make this draft eligible.
 draft_a,draft_v=output(7,approved=False)
 run(f"insert into public.artifact_approvals values({q(uid(3900))},{q(org)},{q(aid)},{q(draft_v)},{q(engagement)},'approved',{q(actor)},now());")
 # Newer unapproved version is not substituted for the original approved version.
 run(f"insert into public.artifact_versions values({q(uid(2980))},{q(org)},{q(aid)},2,repeat('a',64),now(),'{{}}');")
 packet=value(context());assert packet['source_total']==2 and {x['version_id'] for x in packet['approved_sources']}=={vid,visual[1]}
 assert all('content' not in row and 'private_body' not in json.dumps(row) for row in packet['approved_sources'])
 assert packet['ready_for_preparation'] is False and packet['ready_for_traffic'] is False and packet['creates_work'] is False
 assert packet['approved_sources'][0]['eligible_roles'] in [['written'],['visual']]
 passed('only exact approved same-project same-brand versions qualify; no draft/latest/private-body or mismatched approval promotion')
 denied(f"insert into public.artifact_approvals values({q(uid(3991))},{q(org)},{q(aid)},{q(vid)},{q(engagement)},'approved',{q(actor)},now())",'23505',role='postgres')
 denied(f"update public.artifact_approvals set decision='rejected' where artifact_version_id={q(vid)}",'55000',role='postgres')
 denied(f"delete from public.artifact_approvals where artifact_version_id={q(vid)}",'55000',role='postgres')
 assert value(context())['source_page_token']==packet['source_page_token']
 passed('canonical one-approval uniqueness and actual immutable-history trigger prevent duplicate pages or invented later revocation decisions')
 page=value(context(1));page2=value(context(1,1));assert page['has_more'] is True and page2['has_more'] is False and page['source_total']==page2['source_total']==2
 assert page['approved_sources'][0]['version_id']!=page2['approved_sources'][0]['version_id']
 assert value(context(1))['source_page_token']==page['source_page_token']
 assert page['source_page_token']!=page2['source_page_token']
 passed('stable paged exact-source tokens and truthful total/has_more, with no invented complete loaded history')
 before=packet['source_page_token'];run(f"update public.artifact_versions set content_checksum=repeat('b',64) where id={q(vid)}")
 assert value(context())['source_page_token']!=before
 passed('changed selected canonical checksum invalidates the source-page token')
 for sql in [context(0),context(101),context(25,-1)]:denied(sql,'22023')
 for sql in [context(eng=uid(980)),context(proj=uid(981)),context(organization=uid(982))]:denied(sql)
 denied(context(),who=uid(99));denied(context(),who='')
 passed('current authenticated organization/project membership and exact engagement remain mandatory')
 for role in ['anon','service_role']:denied(context(),role=role)
 rights=run("select has_function_privilege('authenticated','public.get_project_default_plan_context(uuid,uuid,uuid,integer,integer)','execute') and not has_table_privilege('authenticated','public.artifact_versions','select')").stdout.strip();assert rights=='t'
 passed('one scoped authenticated reader, no direct table grant or anonymous/service execution')
 run(f"update public.organization_memberships set status='inactive' where user_id={q(actor)}");denied(context());run(f"update public.organization_memberships set status='active' where user_id={q(actor)}")
 run(f"update public.brands set status='inactive' where id={q(brand)}");denied(context());run(f"update public.brands set status='active' where id={q(brand)}")
 run(f"update public.agency_clients set status='inactive' where id={q(client)}");denied(context());run(f"update public.agency_clients set status='active' where id={q(client)}")
 passed('revoked membership and inactive canonical client/brand deny a fresh read')
 assert run('select count(*) from private.project_delivery_plan_versions').stdout.strip()=='0'
 assert run('select count(*) from public.project_pipeline_groups').stdout.strip()=='0'
 assert run('select count(*) from public.work_items').stdout.strip()=='1'
 passed('reader never materializes or approves work, pipelines, schedules or delivery')
 receipt={'count':len(checks),'checks':checks,'database':database,'port':port,'data':str(data),'boundary':'Fresh synthetic base; actual installed scope/setup helpers and exact new read-only source RPC. No plan materialization, signed-in app or production acceptance.'}
 (qa/'verification.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
finally:
 if 'data' in globals() and (data/'PG_VERSION').exists():
  status=subprocess.run([str(Path(a.pgbin)/'pg_ctl.exe'),'-D',str(data),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
  if status.returncode==0:command('pg_ctl.exe',['-D',data,'-m','fast','-w','stop'])
