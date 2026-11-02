"""Fresh owned PG17. Actual review/stage/pinning/actor functions; synthetic base,
published templates/digest wrapper and activation fixtures; actual lower configuration writers. No old
QA database is touched; no provider, business or production acceptance claim.
"""
from pathlib import Path
import sys,json,subprocess,re,time,hashlib
bootstrap_file=Path(__file__).with_name('check-project-foundation-binding-native.py')
bootstrap=bootstrap_file.read_text(encoding='utf-8').split(" assert before_acl==",1)[0]
assert 'port=29962' in bootstrap
bootstrap=bootstrap.replace('port=29962','port=29964',1)
try:
 exec(compile(bootstrap+'finally:\n pass\n',str(bootstrap_file),'exec'),globals())
 repo=repo.resolve()
 checks=[]
 pre=json.loads((repo.parent/'readiness-preimage-20261102.json').read_text(encoding='utf-8'))
 actor_helpers=json.loads((repo.parent/'readiness-actor-helpers.json').read_text(encoding='utf-8'))
 for helper in actor_helpers:run(helper['definition'])
 run("""alter table public.project_pipeline_configurations add column organization_id uuid,add column engagement_id uuid,add column project_id uuid,
 add column definition_publication_id uuid,add column request_id uuid,add column configured_by uuid,add column selected_steps jsonb,
 add column selected_steps_sha256 text,add column max_ai_cost_microusd bigint,add column pipeline_group_id uuid;
 alter table public.pipeline_execution_definitions add column steps_sha256 text;
 update public.pipeline_execution_definitions set steps_sha256=encode(sha256(convert_to(steps::text,'UTF8')),'hex');
 create table public.project_pipeline_stage_reviews(id uuid primary key default gen_random_uuid(),organization_id uuid,engagement_id uuid,project_id uuid,configuration_id uuid unique,
 request_id uuid,reviewed_by uuid,decisions jsonb,resolved_artifacts jsonb,review_sha256 text,reviewed_at timestamptz default now(),unique(organization_id,request_id));
 alter table public.project_pipeline_stage_reviews enable row level security;
 revoke all on public.project_pipeline_stage_reviews from public,anon,authenticated,service_role;
 grant select on public.project_pipeline_stage_reviews to authenticated,service_role;
 create trigger protect_pipeline_stage_review before update or delete on public.project_pipeline_stage_reviews for each row execute function private.reject_pipeline_template_mutation();
 """)
 contract=(repo/'supabase/migrations/20261001010000_pipeline_published_stage_contracts.sql').read_text(encoding='utf-8')
 run(re.search(r'create function private.valid_pipeline_stage_contract[\s\S]*?\$\$;',contract).group())
 # Actual current lower writers; synthetic canonical tables and published fixtures.
 run("""alter table public.project_pipeline_configurations alter column id set default gen_random_uuid(),add column revision integer,add column group_revision integer,add column request_sha256 text;
 create schema if not exists extensions;
 create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
 create table public.engagement_pipeline_origins(engagement_id uuid,organization_id uuid,pipeline_template_version_id uuid);
 create table public.engagement_services(organization_id uuid,engagement_id uuid,service_id uuid,status text);
 create table public.project_department_participation(project_id uuid,organization_id uuid,department_id text,status text);
 """)
 lower=json.loads((repo.parent/'readiness-lower-configuration-preimage.json').read_text(encoding='utf-8'))
 for row in lower:
  run(row['definition']);run(f"revoke all on function {row['signature']} from public,anon,authenticated,service_role")
 for name in ['create_reviewed_project_pipeline_configuration','private.current_pipeline_stage_review','private.n6_pin_current_project_activation']:
  row=next(x for x in pre if x['signature'].startswith(name+'('));run(row['definition']);run(f"revoke all on function {row['signature']} from public,anon,authenticated,service_role")
 run('grant execute on function public.create_reviewed_project_pipeline_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint) to authenticated')
 run((repo/'supabase/migrations/20261102175340_pipeline_foundation_readiness.sql').read_text(encoding='utf-8'))
 passed('exact installed review/stage/resolver prerequisites accepted without weakening guards')
 initial=value(get());legacy_plan=value(apply(initial,uid(6100)));group=legacy_plan['snapshot']['groups'][0]['pipeline_group_id']
 # Minimal valid declared stages retain real dependency and input validation.
 run(f"insert into public.engagement_pipeline_origins values({q(engagement)},{q(org)},{q(uid(910))});insert into public.engagement_services values({q(org)},{q(engagement)},{q(copy)},'active');insert into public.project_department_participation values({q(project)},{q(org)},'content','active')")
 config_def,config_pub=uid(6101),uid(6102)
 stage_contract={'optional':False,'output_label':'Reviewed human output','reuse_allowed':False,'required_inputs':[]}
 declared=[{'key':'brief','kind':'human','service_id':copy,'department_id':'content','label':'Brief','depends_on':[],'stage_contract':{**stage_contract,'required_inputs':[{'key':'audience','label':'Audience','kind':'manual'}]}},
 {'key':'copy','kind':'human','service_id':copy,'department_id':'content','label':'Copy','depends_on':['brief'],'stage_contract':stage_contract}]
 run(f"insert into public.pipeline_execution_definitions values({q(config_def)},{q(org)},{q(preset)},2,'Native configured stages',{j(declared)},encode(sha256(convert_to({j(declared)}::text,'UTF8')),'hex'));insert into public.pipeline_execution_publications values({q(config_pub)},{q(org)},{q(config_def)});")
 decisions=[{'key':'brief','action':'run','quantity':1,'inputs':[{'key':'audience','value':'Explicit human audience'}]},{'key':'copy','action':'run','quantity':1,'inputs':[]}]
 missing=object()
 def configure(request,context=missing,chosen=None):
  args=f"{q(org)},{q(engagement)},{q(config_pub)},{q(group)},{q(request)},{j(decisions if chosen is None else chosen)},0"
  if context is not missing:args+=','+('null::jsonb' if context is None else j(context))
  return 'select public.'+('create_reviewed_project_pipeline_configuration' if context is missing else 'create_foundation_reviewed_project_pipeline_configuration')+'('+args+')'
 def context():return value(f"select public.get_project_pipeline_foundation_context({q(org)},{q(engagement)},{q(group)})")
 legacy_context=context();assert legacy_context['state']=='legacy_unbound' and legacy_context['legacy_configuration_allowed'] is True and legacy_context['foundation_context'] is None and legacy_context['blockers']==[] and legacy_context['ready_for_preparation'] is False
 legacy=value(configure(uid(6110)));assert value(configure(uid(6110)))['idempotent_replay'] is True
 assert value(configure(uid(6110),None))['idempotent_replay'] is True
 denied(configure(uid(6110),{'schema_version':1}),'23505')
 passed('legacy and explicit-null new routes share original request ownership; changed payload cannot replace its receipt')
 def output(n,kind):
  aid,vid,ap=uid(6200+n),uid(6300+n),uid(6400+n)
  run(f"insert into public.artifacts values({q(aid)},{q(org)},{q(project)},{q(engagement)},{q(brand)},{q(kind)},'Native guidance');insert into public.artifact_versions values({q(vid)},{q(org)},{q(aid)},1,repeat('a',64),now(),'{{}}');insert into public.artifact_approvals values({q(ap)},{q(org)},{q(aid)},{q(vid)},{q(engagement)},'approved',{q(actor)},now());")
  return {'mode':'approved_version','artifact_id':aid,'version_id':vid,'approval_id':ap,'checksum':'a'*64}
 written=output(1,'content');visual={'mode':'minimum','guidance':'Private limited typography guidance','reason':'Text-only private draft'}
 intent={'version':1,'engagement_id':engagement,'written':written,'visual':visual}
 def bind(request,guidance=intent):
  snap=setup();row=next((x for x in snap['scopes'] if x['service_id']==design),None)
  p={**plan,'items':[{**item(design,12),'expected_revision':row['revision'] if row else None}],'foundation':guidance}
  review=value(preview(p));return value(combined(review,p,request,snap['token']))
 legacy_stage=f"select private.current_pipeline_stage_review({q(org)},{q(legacy['configuration_id'])})"
 assert value(legacy_stage,role='postgres').get('foundation_context') is None
 bound=bind(uid(6120));denied(legacy_stage,'55000',role='postgres');assert value(configure(uid(6110)))['idempotent_replay'] is True
 passed('legacy DTO permits existing rules without foundation-ready claims; first binding requires new runtime review while original receipt remains readable')
 other_group=uid(6150);other_preset=uid(6151)
 run(f"insert into public.project_pipeline_groups(id,organization_id,engagement_id,project_id,kind,name,preset_publication_id) values({q(other_group)},{q(org)},{q(engagement)},{q(project)},'branding','Native separate branding',{q(other_preset)})")
 brand_context=value(f"select public.get_project_pipeline_foundation_context({q(org)},{q(engagement)},{q(other_group)})");assert brand_context['state']=='not_required_for_this_pipeline' and brand_context['foundation_context'] is None and brand_context['legacy_configuration_allowed'] is False
 denied(configure(uid(6152)).replace(q(group),q(other_group),1),'42501')
 denied(configure(uid(6153)).replace(q(group),q(uid(6154)),1),'42501')
 null_call=configure(uid(6155)).replace(q(group),'null::uuid',1)
 denied(f"update public.engagement_pipeline_origins set pipeline_template_version_id={q(uid(6156))} where engagement_id={q(engagement)};"+null_call,'42501')
 null_config=value(null_call);assert null_config['configuration_id']
 null_context=value(f"select public.get_project_pipeline_foundation_context({q(org)},{q(engagement)},null)");assert null_context['state']=='not_required_for_this_pipeline' and null_context['ready_for_preparation'] is False
 new_website=uid(6157)
 run(f"insert into public.project_pipeline_groups(id,organization_id,engagement_id,project_id,kind,name,preset_publication_id) values({q(new_website)},{q(org)},{q(engagement)},{q(project)},'website','Not in reviewed plan',{q(preset)})")
 denied(configure(uid(6158)).replace(q(group),q(new_website),1),'55000')
 blocked=value(f"select public.get_project_pipeline_foundation_context({q(org)},{q(engagement)},{q(new_website)})");assert blocked['blockers'][0]['code']=='foundation_review_required' and blocked['foundation_context'] is None and not blocked.get('legacy_configuration_allowed',False)
 passed('actual lower writers reject Branding mismatched preset and null-route wrong origin; valid legacy origin remains separate, new bound Website absent from plan blocks')
 current=context();ctx=current['foundation_context'];assert ctx and current['ready_for_preparation'] is False and current['ready_for_traffic'] is False
 assert 'Private limited' not in json.dumps(ctx) and 'Text-only' not in json.dumps(ctx)
 passed('context derives exact immutable plan and source metadata/digests without raw minimum guidance or global readiness claims')
 denied(configure(uid(6121)),'40001');denied(configure(uid(6122),{**ctx,'foundation_checksum':'b'*64}),'40001')
 configured=value(configure(uid(6123),ctx));configuration=configured['configuration_id']
 assert value(configure(uid(6123),ctx))['idempotent_replay'] is True
 denied(configure(uid(6123)),'23505')
 passed('bound configuration requires the explicit exact context; eight-argument save and original replay succeed once')
 for changed in [[{**decisions[0],'inputs':[]},decisions[1]],[{**decisions[0],'action':'omit','reason':'skip'},decisions[1]],[{**decisions[0],'action':'outside_scope'},decisions[1]]]:denied(configure(uid(6124),ctx,changed),'22023')
 passed('foundation availability cannot omit required stages, dependencies or declared manual inputs')
 stage_sql=f"select private.current_pipeline_stage_review({q(org)},{q(configuration)})"
 pinned=value(stage_sql,role='postgres');assert pinned['foundation_context']==ctx
 unrelated=bind(uid(6125));assert unrelated['delivery']['id']!=ctx['plan_version_id'];assert value(stage_sql,role='postgres')==pinned
 passed('unrelated new plan version with the same material foundation keeps original runtime lineage stable')
 denied(configure(uid(6126),ctx),'40001')
 latest_ctx=context()['foundation_context'];assert latest_ctx['plan_version_id']==unrelated['delivery']['id']
 # A real existing pinning trigger consumes the changed stage snapshot. Its
 # invocation table/activation are synthetic; normal service actor guards are actual.
 run("""create table public.project_pipeline_activations(id uuid,organization_id uuid,engagement_id uuid,pipeline_group_id uuid,configuration_id uuid,activation_number integer);
 create table public.qa_readiness_intents(organization_id uuid,engagement_id uuid,pipeline_group_id uuid,project_activation_id uuid,selected_steps_sha256 text,input_manifest jsonb,input_sha256 text);
 create trigger qa_actual_pin before insert on public.qa_readiness_intents for each row execute function private.n6_pin_current_project_activation();
 revoke all on public.qa_readiness_intents from public,anon,authenticated,service_role;
 """)
 run(f"insert into public.project_pipeline_activations values({q(uid(6500))},{q(org)},{q(engagement)},{q(group)},{q(configuration)},1)")
 run(f"""create function public.qa_authorized_service_pin(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a uuid;answer jsonb;begin
 a:=private.n1c_actor(p_actor);perform private.n1c_require_scope({q(org)},{q(project)},a);
 insert into public.qa_readiness_intents(organization_id,engagement_id,pipeline_group_id,input_manifest) values({q(org)},{q(engagement)},{q(group)},'{{}}') returning input_manifest into answer;return answer;end;$$;
 revoke all on function public.qa_authorized_service_pin(uuid) from public,anon,authenticated;grant execute on function public.qa_authorized_service_pin(uuid) to service_role;""")
 pinned_service=value(f"select public.qa_authorized_service_pin({q(actor)})",role='service_role',who='');assert pinned_service['stage_review']['foundation_context']==ctx
 denied(f"select public.qa_authorized_service_pin({q(uid(99))})",'42501',role='service_role',who='')
 passed('auth.uid-null service path uses actual n1c actor/scope checks and actual n6 pinning trigger; nonmember actor denies')
 changed={**intent,'visual':{**visual,'guidance':'Different reviewed material guidance'}};bind(uid(6127),changed)
 denied(stage_sql,'55000',role='postgres');denied(f"select public.qa_authorized_service_pin({q(actor)})",'55000',role='service_role',who='')
 assert value(configure(uid(6123),ctx))['idempotent_replay'] is True
 passed('changed material binding blocks existing runtime and trigger, while original completed configuration receipt remains recoverable')
 fresh=context()['foundation_context'];configured2=value(configure(uid(6128),fresh));configuration2=configured2['configuration_id']
 for column,bad in [('organization_id',uid(6601)),('project_id',uid(6602)),('brand_id',uid(6603))]:
  run(f"update public.artifacts set {column}={q(bad)} where id={q(written['artifact_id'])}");assert context()['blockers'];denied(configure(uid(6129),fresh),'55000')
  original=org if column=='organization_id' else project if column=='project_id' else brand;run(f"update public.artifacts set {column}={q(original)} where id={q(written['artifact_id'])}")
 run(f"update public.brands set status='inactive' where id={q(brand)}");assert context()['blockers'];run(f"update public.brands set status='active' where id={q(brand)}")
 passed('current source organization/project/brand and brand status are revalidated, not inferred from the saved checksum')
 # Observe advisory lock ordering: follower must wait before taking engagement
 # FOR UPDATE, so the leader can obtain that row lock and finish without a cycle.
 request=uid(6130);ctx_now=context()['foundation_context']
 leader=subprocess.Popen(base+['-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=flags)
 leader.stdin.write(f"begin;select pg_advisory_xact_lock(hashtextextended('project-setup:'||{q(org)}||':'||{q(project)},0));\n");leader.stdin.flush()
 for _ in range(60):
  if run("select exists(select 1 from pg_locks where locktype='advisory' and granted)").stdout.strip()=='t':break
  time.sleep(.04)
 else:raise AssertionError('leader advisory lock missing')
 follower=subprocess.Popen(base+['-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=flags)
 follower.stdin.write('begin;set local role authenticated;'+claim()+configure(request,ctx_now)+';commit;');follower.stdin.close();follower.stdin=None
 for _ in range(60):
  if run("select exists(select 1 from pg_locks where locktype='advisory' and not granted)").stdout.strip()=='t':break
  time.sleep(.04)
 else:raise AssertionError('follower advisory wait missing')
 leader.stdin.write(f"set local lock_timeout='2s';select id from public.engagements where id={q(engagement)} for update;commit;\n");leader.stdin.close();leader.stdin=None
 _,err=leader.communicate(timeout=10);assert leader.returncode==0,err
 _,err=follower.communicate(timeout=15);assert follower.returncode==0,err
 passed('observed advisory-first concurrency allows leader engagement lock and follower completion without inverted-lock deadlock')
 rights=run("select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'service',has_function_privilege('service_role',p.oid,'execute'),'config',p.proconfig,'names',p.proargnames,'defaults',p.pronargdefaults)) from pg_proc p where p.proname in ('pipeline_foundation_context','create_foundation_reviewed_configuration','get_project_pipeline_foundation_context','create_reviewed_project_pipeline_configuration','create_foundation_reviewed_project_pipeline_configuration')").stdout.strip()
 for r in json.loads(rights):
  assert r['config']==['search_path=""'];assert not r['anon'] and not r['service'];assert r['authenticated']==(not r['signature'].startswith('private.'))
 passed('exact named RPC signatures are unique with empty search paths; public routes authenticated-only and private core/metadata closed')
 named=json.loads(rights);new=[r for r in named if r['signature'].startswith('create_foundation_reviewed_project_pipeline_configuration(') or r['signature'].startswith('public.create_foundation_reviewed_project_pipeline_configuration(')];assert len(new)==1 and new[0]['names'][-1]=='p_foundation_context' and new[0]['defaults']==0
 result={'count':len(checks),'checks':checks,'port':port,'database':database,'migration_sha256':hashlib.sha256((repo/'supabase/migrations/20261102175340_pipeline_foundation_readiness.sql').read_text(encoding='utf-8').encode()).hexdigest(),'boundary':'Fresh synthetic canonical base, templates, digest wrapper and activation fixture; actual current lower configuration writers. Actual current actor/scope helpers, configuration review/core, stage snapshot and n6 pinning trigger executed. QA service wrapper is synthetic; no full production endpoint, work materialization, provider or client acceptance.'}
 (qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
finally:
 if 'a' in globals() and 'data' in globals():subprocess.run([str(Path(a.pgbin)/'pg_ctl.exe'),'-D',str(data),'-m','fast','-w','stop'],capture_output=True,creationflags=flags,timeout=30)
