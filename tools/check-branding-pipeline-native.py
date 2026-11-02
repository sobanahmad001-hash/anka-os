"""Actual setup/plan/Branding group writers on fresh owned PG17.
Base tables, published templates and unchanged lower service lifecycle are synthetic;
this does not claim authenticated template publication or downstream work execution.
"""
from pathlib import Path
import sys,json,subprocess,textwrap
fixture=Path(__file__).with_name('check-project-chat-delivery-native.py')
source=fixture.read_text(encoding='utf-8');assert source.count('initial=setup();before=')==1
prefix=source.split('initial=setup();before=',1)[0].replace('port=29932','port=29960',1)
qa_arg=Path(sys.argv[sys.argv.index('--qa')+1]).resolve();assert not(qa_arg/'data').exists(),'Use a new owned QA directory'
try:
 exec(compile(prefix,str(fixture),'exec'),globals())
 # Reuse only the existing v2 fixture preparation, not its retained tests.
 v2=Path(__file__).with_name('check-service-line-metadata-native.py').read_text(encoding='utf-8')
 first=v2.index(' run("alter table public.project_service_scopes');last=v2.index(' rights=run(',first)
 exec(compile(textwrap.dedent(v2[first:last]),'v2-fixture-preparation','exec'),globals())
 run((repo/'supabase/migrations/20261102140042_reviewed_service_line_metadata.sql').read_text(encoding='utf-8'))
 run("""alter table public.project_pipeline_groups add constraint project_pipeline_groups_kind_check check(kind in ('website','marketing'));
 alter table public.pipeline_template_publications add column pipeline_template_version_id uuid;
 create table public.pipeline_template_version_services(organization_id uuid,pipeline_template_version_id uuid,service_id uuid);""")
 run(f"update public.pipeline_template_publications set pipeline_template_version_id={q(uid(910))};insert into public.pipeline_template_version_services values({q(org)},{q(uid(910))},{q(copy)}),({q(org)},{q(uid(910))},{q(design)});update private.service_setup_leaves set definition=definition||jsonb_build_object('business_group_version',1,'business_groups',jsonb_build_array('branding','website','marketing'));update private.service_setup_leaves set definition=definition||jsonb_build_object('business_groups',jsonb_build_array('marketing')) where service_id={q(caption)};")
 rights=run("select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'acl',p.proacl) order by p.oid) from pg_proc p where p.proname in ('apply_project_setup','preview_combined_setup','build_service_project_plan','build_combined_service_plan','create_project_pipeline_group')").stdout.strip()
 run((repo/'supabase/migrations/20261102161752_project_branding_pipeline_kind.sql').read_text(encoding='utf-8'))
 assert rights==run("select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'acl',p.proacl) order by p.oid) from pg_proc p where p.proname in ('apply_project_setup','preview_combined_setup','build_service_project_plan','build_combined_service_plan','create_project_pipeline_group')").stdout.strip()
 passed('all existing setup/planner/group execution ACLs retained')
 initial=value(get());old=value(apply(initial,uid(920)));old_group=old['snapshot']['groups'][0]['pipeline_group_id']
 old_digest=run(f"select md5(snapshot::text) from private.project_delivery_plan_versions where id={q(old['id'])}").stdout.strip()
 passed('original Website plan saves through the unchanged public API before a Branding contribution')
 pubs=[]
 for n in [1,2]:
  ps,ver,de,pub=uid(930+n),uid(940+n),uid(950+n),uid(960+n);pubs.append(pub)
  st=[stage('positioning',copy),stage('visual_identity',design,['positioning']),stage('visual_review',design,['visual_identity'])]
  run(f"insert into public.pipeline_template_publications values({q(ps)},{q(org)},{q(ver)});insert into public.pipeline_template_version_services values({q(org)},{q(ver)},{q(design)}),({q(org)},{q(ver)},{q(copy)});insert into public.pipeline_execution_definitions values({q(de)},{q(org)},{q(ps)},1,'Branding reviewed manual',{j(st)});insert into public.pipeline_execution_publications values({q(pub)},{q(org)},{q(de)});")
 # This mixed preset would win the old ranking (one short matching step), but
 # its Marketing-only member must exclude it from both Branding planner paths.
 mixed_preset,mixed_version,mixed_definition,mixed_publication=[uid(n) for n in [1101,1102,1103,1104]]
 run(f"insert into public.pipeline_template_publications values({q(mixed_preset)},{q(org)},{q(mixed_version)});insert into public.pipeline_template_version_services values({q(org)},{q(mixed_version)},{q(design)}),({q(org)},{q(mixed_version)},{q(caption)});insert into public.pipeline_execution_definitions values({q(mixed_definition)},{q(org)},{q(mixed_preset)},1,'Mixed short preset',{j([stage('short_visual',design)])});insert into public.pipeline_execution_publications values({q(mixed_publication)},{q(org)},{q(mixed_definition)});")
 metadata={'catalogue_version':1,'service_group':'branding','start_date':'2026-11-02','target_date':None,'timezone':'Asia/Karachi','generation_horizon':None,'scope_statement':'Visual identity guidance','exclusions':'No publication or paid calls'}
 proposal={'items':[{**item(design,1,'branding'),'service_line':metadata}],'pipelines':['branding','website'],'questions':[],'explanation':'Reviewed independent Branding contribution','legacy_acknowledgements':[],'service_line_version':2}
 current=setup();unresolved=value(preview(proposal));entry=next(i for i in unresolved['draft']['unmapped'] if i['service_id']==design)
 assert entry['definition_choice_key']=='definition:'+design and {p['publication_id'] for p in entry['definition_options']}=={publication,*pubs}
 assert mixed_publication not in {p['publication_id'] for p in entry['definition_options']}
 denied(preview(proposal,choices={'definition:'+design:mixed_publication}),'42501')
 passed('Branding review excludes a better-ranked mixed-eligibility preset before selection or Apply')
 passed('ambiguous published definitions are returned for explicit exact choice rather than guessed by title')
 choices={'definition:'+design:pubs[0]};review=value(preview(proposal,choices=choices));assert {g['kind'] for g in review['draft']['groups']}=={'branding','website'}
 brand_group=next(g for g in review['draft']['groups'] if g['kind']=='branding');assert brand_group['work_partition']=='brand_foundation' and len(brand_group['stages'])==3
 saved=value(combined(review,proposal,uid(970),current['token'],choices));assert saved['atomic'] is True
 assert {g['kind'] for g in saved['delivery']['snapshot']['groups']}=={'branding','website'}
 assert next(g for g in saved['delivery']['snapshot']['groups'] if g['kind']=='website')['pipeline_group_id']==old_group
 assert old_digest==run(f"select md5(snapshot::text) from private.project_delivery_plan_versions where id={q(old['id'])}").stdout.strip()
 passed('actual single reviewed transaction creates canonical Branding group and immutable plan while retaining original Website binding/history')
 assert saved==value(combined(review,proposal,uid(970),current['token'],choices))==value(recover(uid(970)))
 assert run('select count(*) from public.project_pipeline_groups').stdout.strip()=='2'
 passed('original UUID replay/recovery cannot create duplicate Branding groups or plan versions')
 fresh=value(get());assert not fresh['draft']['unmapped'];assert next(i for i in fresh['draft']['contributions'] if i['service_id']==design)['publication_id']==pubs[0]
 passed('later reads retain the exact reviewed published definition without requiring another arbitrary choice or substituting latest')
 denied(combined(review,{**proposal,'explanation':'changed'},uid(970),current['token'],choices),'23505')
 current_revision=next(s['revision'] for s in setup()['scopes'] if s['service_id']==design)
 current_proposal={**proposal,'items':[{**proposal['items'][0],'expected_revision':current_revision}]}
 # New publication has fewer extra services and fewer steps: ranking improves,
 # but an explicit still-eligible historical pin must survive in both planners.
 better_preset,better_version,better_definition,better_publication=[uid(n) for n in [1111,1112,1113,1114]]
 run(f"insert into public.pipeline_template_publications values({q(better_preset)},{q(org)},{q(better_version)});insert into public.pipeline_template_version_services values({q(org)},{q(better_version)},{q(design)});insert into public.pipeline_execution_definitions values({q(better_definition)},{q(org)},{q(better_preset)},1,'New shorter alternative',{j([stage('visual_only',design)])});insert into public.pipeline_execution_publications values({q(better_publication)},{q(org)},{q(better_definition)});")
 for draft in [value(get())['draft'],value(preview(current_proposal))['draft'],value(preview(current_proposal,choices=choices))['draft']]:
  contribution=next(i for i in draft['contributions'] if i['service_id']==design)
  assert contribution['publication_id']==pubs[0]
  assert next(g for g in draft['groups'] if g['kind']=='branding')['pipeline_group_id']==next(g for g in saved['delivery']['snapshot']['groups'] if g['kind']=='branding')['pipeline_group_id']
 assert old_digest==run(f"select md5(snapshot::text) from private.project_delivery_plan_versions where id={q(old['id'])}").stdout.strip()
 passed('both planners and explicit choices retain a valid pinned publication after a better-ranked publication appears; historical groups remain unchanged')
 # Reused groups must pass the same all-preset-services check as new groups.
 # The selected Design service remains active; only an unselected prerequisite
 # becomes inactive, so this cannot pass merely via the selected-service guard.
 healthy=value(get())
 run(f"update public.service_catalog set is_active=false where id={q(copy)}")
 for draft in [value(get())['draft'],value(preview(current_proposal))['draft']]:
  issue=next(i for i in draft['unmapped'] if i['service_id']==design)
  assert issue['previous_publication_id']==pubs[0] and issue.get('publication_id') is None
  assert {p['publication_id'] for p in issue['definition_options']}=={better_publication}
  assert not any(g['kind']=='branding' for g in draft['groups'])
 denied(preview(current_proposal,choices=choices),'42501')
 denied(apply(healthy,uid(1115)),'40001')
 assert next(i for i in value(preview(current_proposal,choices={'definition:'+design:better_publication}))['draft']['contributions'] if i['service_id']==design)['publication_id']==better_publication
 run(f"update public.service_catalog set is_active=true where id={q(copy)}")
 assert next(i for i in value(get())['draft']['contributions'] if i['service_id']==design)['publication_id']==pubs[0]
 passed('inactive prerequisite invalidates reused Branding group in both review paths, offers exact eligible replacement without substitution, and preserves the original pin/history')
 denied(preview(current_proposal,choices={'definition:'+design:uid(9999)}),'42501')
 denied(preview(current_proposal,choices={'definition:'+uid(9999):pubs[0]}),'22023')
 denied(f"select public.create_project_pipeline_group({q(org)},{q(engagement)},{q(uid(9998))},'branding','Unpublished',{q(uid(980))})")
 invalid={**proposal,'service_line_version':2,'items':[{**proposal['items'][0],'service_line':{**metadata,'service_group':'website'}}]};denied(preview(invalid),'22023')
 v1={k:v for k,v in proposal.items() if k!='service_line_version'};v1['items']=[{k:v for k,v in proposal['items'][0].items() if k!='service_line'}];denied(preview(v1),'22023')
 passed('foreign/unpublished definitions, unknown choice keys and implicit/v1 Branding scope are denied')
 # A published preset with a non-Branding leaf must never be relabelled Branding.
 bad=uid(981);run(f"insert into public.pipeline_template_publications values({q(bad)},{q(org)},{q(uid(982))});insert into public.pipeline_template_version_services values({q(org)},{q(uid(982))},{q(caption)});")
 denied(f"select public.create_project_pipeline_group({q(org)},{q(engagement)},{q(bad)},'branding','Wrong business scope',{q(uid(983))})",'22023')
 denied(f"select public.create_project_pipeline_group({q(org)},{q(engagement)},{q(uid(931))},'branding','Foreign actor',{q(uid(984))})",who=uid(99))
 passed('actual group writer preserves current actor and explicit current Branding eligibility of every published-preset service')
 run(f"update public.service_catalog set is_active=false where id={q(design)}")
 denied(f"select public.create_project_pipeline_group({q(org)},{q(engagement)},{q(uid(931))},'branding','Inactive source',{q(uid(985))})",'22023')
 run(f"update public.service_catalog set is_active=true where id={q(design)}")
 passed('inactive canonical services cannot acquire a newly labelled Branding group')
 # Fail after attempted service/group writes and prove the whole original transaction rolls back.
 change={**current_proposal,'items':[{**current_proposal['items'][0],'quantity':2}]};new_choices={'definition:'+design:pubs[1]}
 late=value(preview(change,choices=new_choices));token=setup()['token']
 def footprint():return run("select md5(jsonb_build_array((select jsonb_agg(to_jsonb(s) order by id) from public.project_service_scopes s),(select jsonb_agg(to_jsonb(g) order by id) from public.project_pipeline_groups g),(select jsonb_agg(to_jsonb(v) order by id) from private.project_delivery_plan_versions v),(select jsonb_agg(to_jsonb(c) order by request_id) from private.project_delivery_setup_commands c))::text)").stdout.strip()
 before=footprint();run("create function private.qa_brand_late_failure() returns trigger language plpgsql as $$begin raise exception 'Late plan failure' using errcode='55000';end;$$;create trigger qa_brand_late_failure before insert on private.project_delivery_plan_versions for each row execute function private.qa_brand_late_failure();")
 denied(combined(late,change,uid(986),token,new_choices),'55000');assert footprint()==before
 run("drop trigger qa_brand_late_failure on private.project_delivery_plan_versions")
 passed('late immutable-plan failure rolls back attempted scope edits, new Branding group and both receipts without losing old history')
 run(f"update public.organization_memberships set status='inactive' where user_id={q(actor)}");denied(recover(uid(970)));run(f"update public.organization_memberships set status='active' where user_id={q(actor)}")
 assert run('select count(*) from public.work_items').stdout.strip()=='1'
 assert run('select count(*) from public.recurring_work_plans').stdout.strip()=='0'
 assert run('select count(*) from public.recurring_work_occurrences').stdout.strip()=='0'
 passed('revocation still denies recovery; no work/assignment/provider/recurrence is silently executed by plan creation')
 assert run("select bool_and(not has_function_privilege(r,'private.branding_preset_current(uuid,uuid)','execute')) from unnest(array['anon','authenticated','service_role']) r").stdout.strip()=='t'
 passed('shared source-lock/eligibility helper is private and closed to all client roles')
 receipt={'count':len(checks),'checks':checks,'database':database,'port':port,'data':str(data),'boundary':'Fresh synthetic base and published-template fixtures; actual current setup/planner/group/combined transaction and authority helpers. Unchanged lower service lifecycle synthetic. No template publication or downstream work execution acceptance.'}
 (qa/'verification.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
finally:
 if 'data' in globals() and (data/'PG_VERSION').exists():
  status=subprocess.run([str(Path(a.pgbin)/'pg_ctl.exe'),'-D',str(data),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
  if status.returncode==0:command('pg_ctl.exe',['-D',data,'-m','fast','-w','stop'])
