"""Focused v2 setup QA on fresh owned PG17. No remote database/provider access.

Reuse the existing fixture bootstrap and actual authority/setup functions, not its
passed test suite. The unchanged lower lifecycle writer remains explicitly synthetic.
"""
from pathlib import Path
import sys,json,subprocess

fixture=Path(__file__).with_name('check-project-chat-delivery-native.py')
source=fixture.read_text(encoding='utf-8')
assert source.count('initial=setup();before=')==1
prefix=source.split('initial=setup();before=',1)[0].replace('port=29932','port=29956',1)
qa_arg=Path(sys.argv[sys.argv.index('--qa')+1]).resolve()
assert not (qa_arg/'data').exists(),'Use a new owned QA directory; preserve all prior fixture data'
try:
 exec(compile(prefix,str(fixture),'exec'),globals())
 run("alter table public.project_service_scopes add column start_date date,add column target_date date,add column scope_statement text default '',add column exclusions text default '',add column owner_id uuid;create unique index scope_fixture_identity on public.project_service_scopes(id);create table private.n2_service_scope_commands(organization_id uuid,actor_id uuid,request_id uuid);")
 # The actual existing proposal-details writer executes; only its unchanged lower
 # lifecycle call is synthetic. This verifies the new date/scope forwarding boundary.
 run("""create function public.change_project_service_scope(p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_action text,p_service_id uuid,p_scope_statement text,p_exclusions text,p_quantity integer,p_owner_id uuid,p_start_date date,p_target_date date) returns jsonb language plpgsql security definer set search_path='' as $$declare sid uuid:=gen_random_uuid();begin
 insert into public.project_service_scopes(id,organization_id,project_id,service_id,quantity,status,revision,start_date,target_date,scope_statement,exclusions,owner_id) values(sid,p_organization_id,p_project_id,p_service_id,p_quantity,'proposed',1,p_start_date,p_target_date,p_scope_statement,p_exclusions,p_owner_id);
 return jsonb_build_object('scope_id',sid,'revision',1);end;$$;
 revoke all on function public.change_project_service_scope(uuid,uuid,uuid,text,uuid,text,text,integer,uuid,date,date) from public,anon,authenticated,service_role;
 create table public.recurring_work_plans(id uuid);create table public.recurring_work_occurrences(id uuid);"""
 )
 details=(repo/'supabase/migrations/20260930170000_workspace_service_proposal_details.sql').read_text(encoding='utf-8')
 run(details[details.index('create table private.workspace_service_proposal_details'):details.index('CREATE OR REPLACE FUNCTION public.get_project_service_scope')])
 run(details[details.index('create function public.propose_workspace_service_scope'):details.rindex('commit;')].replace('create function','create or replace function',1))
 run("update private.service_setup_leaves set definition=definition||jsonb_build_object('business_group_version',1,'business_groups',jsonb_build_array('website','marketing'))")
 rights=run("select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'acl',p.proacl) order by p.oid) from pg_proc p where p.proname in ('apply_project_setup','preview_combined_setup')").stdout.strip()
 run((repo/'supabase/migrations/20261102140042_reviewed_service_line_metadata.sql').read_text(encoding='utf-8'))
 assert rights==run("select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'acl',p.proacl) order by p.oid) from pg_proc p where p.proname in ('apply_project_setup','preview_combined_setup')").stdout.strip()
 passed('existing public/current private setup function execution ACLs retained')
 initial=setup();review=value(preview(plan));saved_v1=value(combined(review,plan,uid(700),initial['token']))
 assert saved_v1['atomic'] is True
 assert not any('service_line' in row for row in setup()['state']['plan']['contributions'])
 passed('unchanged v1 proposal still saves one atomic service and plan without invented metadata')
 metadata={'catalogue_version':1,'service_group':'marketing','start_date':'2026-11-01','target_date':'2027-01-31','timezone':'America/New_York','generation_horizon':2,'scope_statement':'\u00a0 Twelve monthly posts \u2003','exclusions':'  Paid distribution excluded  '}
 def v2(qty=12,line=None,revision=None):
  row={**item(caption,qty,'marketing'),'cadence':'monthly','service_line':dict(metadata if line is None else line),'expected_revision':revision}
  return {'items':[row],'pipelines':['website','marketing'],'questions':[],'explanation':'Explicit reviewed service dates and scope','legacy_acknowledgements':[],'service_line_version':2}
 current=setup();proposal=v2();r2=value(preview(proposal));saved_v2=value(combined(r2,proposal,uid(701),current['token']))
 scope=next(row for row in setup()['scopes'] if row['service_id']==caption)
 assert scope['start_date']=='2026-11-01' and scope['target_date']=='2027-01-31' and scope['scope_statement']=='Twelve monthly posts' and scope['exclusions']=='Paid distribution excluded'
 assert scope['status']=='proposed' and scope['owner_id'] is None and scope['quantity']==12
 stored=next(row for row in setup()['state']['plan']['contributions'] if row['service_id']==caption)['service_line']
 assert stored['timezone']=='America/New_York' and stored['generation_horizon']==2
 passed('v2 dates/scope pass through actual existing proposal writer to canonical columns, retaining separate intent provenance')
 replay=value(combined(r2,proposal,uid(701),current['token']))
 assert replay==saved_v2 and value(recover(uid(701)))==saved_v2
 passed('same original v2 request replays and recovers without duplicate service/plan writes')
 changed=v2(line={**metadata,'timezone':'Asia/Karachi'})
 denied(combined(r2,changed,uid(701),current['token']),'23505')
 fresh=setup();scope=next(row for row in fresh['scopes'] if row['service_id']==caption)
 update=v2(14,{**metadata,'start_date':'2026-12-01','target_date':None,'scope_statement':'Fourteen monthly posts','generation_horizon':1},scope['revision'])
 reviewed=value(preview(update));saved_update=value(combined(reviewed,update,uid(702),fresh['token']))
 assert saved_update['atomic'] is True
 updated=next(row for row in setup()['scopes'] if row['service_id']==caption)
 assert updated['start_date']=='2026-12-01' and updated['target_date'] is None and updated['quantity']==14
 assert value(recover(uid(701)))==saved_v2
 passed('proposed service v2 update uses current revision and preserves older original receipts')
 fresh=setup();before=fresh['token'];scope=next(row for row in fresh['scopes'] if row['service_id']==caption)
 legacy={'items':[{**item(caption,15,'marketing'),'cadence':'monthly','expected_revision':scope['revision']}],'pipelines':['website','marketing'],'questions':[],'explanation':'Old client cannot erase v2 scope','legacy_acknowledgements':[]}
 denied(preview(legacy),'22023');assert setup()['token']==before
 passed('v1 editing an existing v2 line is denied rather than dropping reviewed dates/intent')
 bad_lines=[{**metadata,**change} for change in [{'start_date':'2026-02-29'},{'start_date':'2026-04-31'},{'start_date':'0000-01-01'},{'target_date':'2026-10-31'},{'timezone':'Mars/Olympus'},{'timezone':'+05:00'},{'catalogue_version':2},{'service_group':'branding'},{'generation_horizon':0},{'generation_horizon':13},{'generation_horizon':1.5},{'generation_horizon':'1'},{'scope_statement':'\u00a0\u2003'},{'scheduler':{'enabled':True}}]]
 for line in bad_lines:denied(preview(v2(line=line,revision=scope['revision'])),'22023')
 denied(preview({**v2(revision=scope['revision']),'service_line_version':'2'}),'22023')
 denied(preview({**v2(revision=scope['revision']),'pipelines':['branding']}),'22023')
 assert setup()['token']==before
 passed('invalid dates/timezones/groups/horizon/hidden scheduling and invented physical kinds cause no writes')
 # Explicit once/custom semantics must not acquire automatic recurrence intent.
 once={**v2(revision=scope['revision']),'items':[{**v2(revision=scope['revision'])['items'][0],'cadence':'once'}]}
 denied(preview(once),'22023')
 once['items'][0]['service_line']['generation_horizon']=None
 assert value(preview(once))['draft']
 passed('once intent remains reviewable without a recurring-cycle horizon')
 assert value(preview(v2(line={**metadata,'timezone':'CET'},revision=scope['revision'])))['draft']
 passed('actual IANA aliases remain valid without accepting guessed numeric offsets')
 for role in ['anon','service_role']:denied(preview(update),role=role)
 denied(preview(update),who=uid(99))
 foreign=preview(update).replace(q(project),q(uid(999)))
 denied(foreign)
 passed('current actor/project/role boundaries remain required before v2 writes')
 # A failure in the second domain rolls back the new canonical date fields as well.
 fresh=setup();scope=next(row for row in fresh['scopes'] if row['service_id']==caption);candidate=v2(16,{**metadata,'start_date':'2027-01-01'},scope['revision']);reviewed=value(preview(candidate))
 run("create function private.qa_fail_line_plan() returns trigger language plpgsql as $$begin raise exception 'Synthetic late plan failure' using errcode='55000';end;$$;create trigger qa_fail_line_plan before insert on private.project_delivery_plan_versions for each row execute function private.qa_fail_line_plan();")
 denied(combined(reviewed,candidate,uid(703),fresh['token']),'55000');assert setup()['token']==fresh['token']
 run('drop trigger qa_fail_line_plan on private.project_delivery_plan_versions')
 passed('late plan failure atomically rolls back scope dates/text/quantity, metadata and receipts')
 with ThreadPoolExecutor(max_workers=2) as pool:
  outcomes=list(pool.map(lambda _:call(combined(reviewed,candidate,uid(704),fresh['token'])),range(2)))
 assert all(row.returncode==0 for row in outcomes),[row.stderr for row in outcomes]
 assert len({json.loads(row.stdout.splitlines()[-1])['delivery']['id'] for row in outcomes})==1
 assert len([row for row in setup()['scopes'] if row['service_id']==caption])==1
 passed('concurrent identical v2 request saves one original receipt/version and one canonical service')
 fresh=setup();scope=next(row for row in fresh['scopes'] if row['service_id']==caption)
 denied(preview(v2(18,revision=scope['revision']-1)),'40001')
 candidate=v2(18,revision=scope['revision']);reviewed=value(preview(candidate))
 run('update public.organization_memberships set status=\'revoked\' where user_id='+q(actor))
 denied(combined(reviewed,candidate,uid(706),fresh['token']))
 run('update public.organization_memberships set status=\'active\' where user_id='+q(actor))
 assert setup()['token']==fresh['token'] and value(recover(uid(701)))==saved_v2
 passed('stale row revision and post-review membership revocation preserve original dates and history')
 fresh=setup();scope=next(row for row in fresh['scopes'] if row['service_id']==caption);candidate=v2(18,revision=scope['revision']);reviewed=value(preview(candidate))
 run("update private.service_setup_leaves set definition=definition||'{\"business_group_version\":2}'::jsonb where service_id="+q(caption))
 denied(combined(reviewed,candidate,uid(705),fresh['token']),'40001')
 run("update private.service_setup_leaves set definition=definition||'{\"business_group_version\":1}'::jsonb where service_id="+q(caption))
 passed('changed catalogue metadata invalidates the exact reviewed source token')
 fresh=setup();scope=next(row for row in fresh['scopes'] if row['service_id']==caption);candidate=v2(18,revision=scope['revision']);reviewed=value(preview(candidate))
 run("update public.service_catalog set unit='changed unit' where id="+q(caption))
 denied(combined(reviewed,candidate,uid(707),fresh['token']),'40001')
 run("update public.service_catalog set unit='page' where id="+q(caption))
 assert setup()['token']==fresh['token']
 passed('canonical unit drift cannot silently substitute the unit after v2 review')
 assert run('select count(*) from public.recurring_work_plans').stdout.strip()=='0'
 assert run('select count(*) from public.recurring_work_occurrences').stdout.strip()=='0'
 for role in ['anon','authenticated','service_role']:
  assert run("select has_function_privilege("+q(role)+",'private.review_setup_line_metadata(jsonb,jsonb,jsonb,text)','EXECUTE')").stdout.strip()=='f'
 passed('no recurring generation or new direct helper execution is enabled')
 result={'count':len(checks),'checks':checks,'database':database,'port':port,'data':str(data),'boundary':'Fresh synthetic base; actual existing auth/setup/combined plan/proposal-details writers plus exact new migration; unchanged lower lifecycle writer synthetic. No provider or production business writes; timezone/date validation is not recurring scheduling acceptance.'}
 (qa/'verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
 print(json.dumps({'passed':len(checks),'verification':str(qa/'verification.json')}))
finally:
 if 'command' in globals() and 'data' in globals() and (data/'PG_VERSION').exists():
  status=subprocess.run([str(Path(a.pgbin)/'pg_ctl.exe'),'-D',str(data),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags,timeout=10)
  if status.returncode==0:command('pg_ctl.exe',['-D',data,'-m','fast','-w','stop'])
