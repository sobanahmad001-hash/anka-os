from pathlib import Path
import argparse,json,subprocess,uuid,socket,copy,hashlib
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);a=p.parse_args()
repo=Path(a.repo).resolve();parent=repo.parent;qa=Path(a.qa).resolve();data=qa/'data';bin=Path(a.pgbin);port=29970;db='recurring_'+uuid.uuid4().hex[:8];flags=0x08000000;checks=[];started=False
assert not data.exists(),'Fresh owned data only';qa.mkdir(parents=True,exist_ok=True)
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned port occupied'
def control(args):
 with (qa/'control.log').open('a',encoding='utf-8') as f:
  r=subprocess.run([str(x) for x in args],stdout=f,stderr=subprocess.STDOUT,creationflags=flags,timeout=40);assert r.returncode==0,'See control.log'
def raw(sql,database=None):
 r=subprocess.run([str(bin/'psql.exe'),'-X','-qAt','-h','127.0.0.1','-p',str(port),'-U','postgres','-d',database or db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=sql,capture_output=True,text=True,encoding='utf-8',creationflags=flags,timeout=30)
 with (qa/'commands.log').open('a',encoding='utf-8') as f:f.write(sql+'\n'+r.stdout+r.stderr+'\n')
 return r
def run(sql,database=None):
 r=raw(sql,database);assert r.returncode==0,r.stderr;return r.stdout.strip()
q=lambda x:"'"+str(x).replace("'","''")+"'"
j=lambda x:q(json.dumps(x))+'::jsonb'
uid=lambda n:f'a1000000-0000-4000-8000-{n:012d}'
def passed(name):checks.append(name)
try:
 control([bin/'initdb.exe','-D',data,'-U','postgres','--encoding=UTF8','--no-locale','--auth=trust'])
 control([bin/'pg_ctl.exe','-D',data,'-l',qa/'server.log','-o',f'-p {port} -h 127.0.0.1','-w','start']);started=True
 assert Path(run('show data_directory','postgres')).resolve()==data
 run('create database '+db,'postgres');run('create schema private;create role anon;create role authenticated;create role service_role;')
 audit=json.loads((parent/'runtime-preimage-20261103.json').read_text())
 for name in ['recurring_month_anchor','recurring_period_end']:
  run(next(f['definition'] for f in audit['functions'] if f['name']==name))
 migration=next((repo/'supabase/migrations').glob('*reviewed_service_recurring_bridge.sql'));source=migration.read_text(encoding='utf-8')
 compiler_start=source.index('create function private.service_recurring_timezone_probe_matches(') if 'create function private.service_recurring_timezone_probe_matches(' in source else source.index('create function private.compile_service_recurring_bridge(')
 compiler_source=source[compiler_start:source.index('create function private.service_recurring_source_context(')]
 run(compiler_source)
 line={'catalogue_version':1,'service_group':'marketing','start_date':'2028-01-01','target_date':'2028-12-01','timezone':'Asia/Karachi','generation_horizon':2,'scope_statement':'Twelve shared social posts monthly','exclusions':'Paid distribution excluded'}
 contributions=[{'scope_id':uid(i),'service_id':uid(i+10),'engagement_service_id':uid(i+20),'department_id':name,'name':name.title(),'quantity':12,'unit':'posts','cadence':'monthly','pipeline':'marketing','deliverable_key':'social_posts','channels':['instagram','facebook'],'service_line':copy.deepcopy(line)} for i,name in enumerate(['content','design','marketing'],1)]
 stages=[{'key':c['department_id'],'service_id':c['service_id'],'department_id':c['department_id'],'action':'run','quantity':12,'depends_on':([] if i==0 else [contributions[i-1]['department_id']])} for i,c in enumerate(contributions)]
 context={'version':1,'selected_scope_id':uid(1),'source_plan_version_id':uid(99),'configuration_source':{'id':uid(90),'revision':1,'review_sha256':'a'*64},'contributions':contributions,'stages':stages}
 proposal={'version':1,'effective_start':'2028-01-01','scheduler':None}
 def compile(c=None,p=None):return json.loads(run(f'select private.compile_service_recurring_bridge({j(c or context)},{j(p or proposal)})'))
 def denied(name,c=None,p=None,code='22023'):
  r=raw(f'select private.compile_service_recurring_bridge({j(c or context)},{j(p or proposal)})');assert r.returncode!=0 and code in r.stderr,(name,r.stderr);passed(name)
 result=compile();assert (result['deliverable_count'],result['work_card_count'],result['dependency_count'])==(12,36,24);passed('12 shared deliverables produce 36 departmental cards and 24 exact unit edges')
 assert len({x['template_key'] for x in result['template_items']})==36 and {x['department_id'] for x in result['template_items']}=={'content','design','marketing'};passed('all36 template identities and canonical departments remain distinct')
 assert all(x['default_assignee_id'] is None for x in result['template_items']) and 'scheduler' not in result['schedule_definition'];passed('no assignment or scheduler consent manufactured')
 assert result['effective_end']=='2028-02-29' and result['timezone']=='Asia/Karachi';passed('two monthly cycles include leap February and preserve project timezone')
 assert not result['target_date_is_recurrence_end'] and result['effective_end']!=line['target_date'];passed('target deadline does not become recurrence end')
 c=copy.deepcopy(context);c['contributions'][1]['channels'].reverse();assert compile(c)['schedule_definition']['service_bridge']['source_checksum']==result['schedule_definition']['service_bridge']['source_checksum'];passed('channel set ordering is normalized without merging channel identities')
 c=copy.deepcopy(context);c['source_plan_version_id']=uid(98);r=compile(c);assert r['schedule_definition']['service_bridge']['source_checksum']==result['schedule_definition']['service_bridge']['source_checksum'] and r['review_sha256']!=result['review_sha256'];passed('unrelated plan head requires fresh creation review without changing material fingerprint')
 c=copy.deepcopy(context);c['contributions'][1]['quantity']=13;denied('unequal connected quantities demand existing source clarification',c)
 c=copy.deepcopy(context);c['contributions'][1]['channels']=['linkedin'];denied('different channels are not silently merged or bridged across missing exact dependency',c)
 c=copy.deepcopy(context)
 for x in c['contributions']:x['deliverable_key']=''
 denied('missing shared deliverable linkage returns actionable ambiguity',c)
 c=copy.deepcopy(context);c['contributions'][1]['service_line']['timezone']='UTC';denied('different contributor timezones require exact source review',c)
 c=copy.deepcopy(context);c['stages'][1]['department_id']='content';denied('canonical department mismatch denied',c)
 c=copy.deepcopy(context);c['stages'][0]['depends_on']=['marketing'];denied('published stage cycle denied',c)
 c=copy.deepcopy(context);c['stages'][0]['depends_on']=['foundation'];denied('unresolved external prerequisite denied',c)
 c['stages'].append({'key':'foundation','action':'reuse','source_reference':{'id':uid(80),'checksum':'b'*64}})
 assert compile(c)['dependency_count']==24;passed('exact approved prerequisite metadata is a material pin never a fake completed card')
 c=copy.deepcopy(context)
 for x in c['contributions']:x['service_line']['start_date']='2028-01-31';x['service_line']['generation_horizon']=1
 r=compile(c,{'version':1,'effective_start':'2028-02-29','scheduler':None});assert r['cycle_end_exclusive']=='2028-03-31' and r['effective_end']=='2028-03-30';passed('leap February cutover preserves original January31 anchor into March31')
 denied('noncanonical month anchor denied',c,{'version':1,'effective_start':'2028-02-28'})
 c=copy.deepcopy(context)
 for x in c['contributions']:x['cadence']='weekly';x['service_line']['generation_horizon']=2
 assert compile(c)['cycle_end_exclusive']=='2028-01-15';passed('weekly horizon is two local-date cycles')
 for zone in ['America/New_York','UTC','Europe/London']:
  c=copy.deepcopy(context)
  for x in c['contributions']:x['service_line']['timezone']=zone
  assert compile(c)['timezone']==zone
 passed('unaffected IANA zones are preserved without blanket lockout or fallback')
 c=copy.deepcopy(context)
 for x in c['contributions']:x['service_line']['timezone']='Mars/Unknown'
 denied('unknown timezone has no fallback',c)
 for zone in ['America/Vancouver','America/Edmonton','Africa/Casablanca']:
  c=copy.deepcopy(context)
  for x in c['contributions']:x['service_line']['timezone']=zone
  sample='2026-10-01 12:00' if zone=='Africa/Casablanca' else '2026-11-02 12:00'
  correct=run('select private.service_recurring_timezone_probe_matches('+q(zone)+','+q(sample)+'::timestamp at time zone '+q(zone)+",'2027-01-15 12:00'::timestamp at time zone "+q(zone)+')')=='t'
  if correct:assert compile(c)['timezone']==zone;passed('verified actual tzdata zone retained '+zone)
  else:denied('observed unfixed tzdata zone denied '+zone,c,code='55000')
 for cadence in ['quarterly','custom','once']:
  c=copy.deepcopy(context)
  for x in c['contributions']:x['cadence']=cadence
  denied('unsupported cadence is not coerced '+cadence,c)
 denied('unreviewed client fields denied',p={**proposal,'quantity':999})
 report={'passed':len(checks),'checks':checks,'migration':str(migration),'migrationSHA256':hashlib.sha256(source.encode()).hexdigest(),'boundary':'Actual PostgreSQL compiler + existing calendar helpers; read-only synthetic canonical packet, NOT server actor/source/writer/generation acceptance.','port':port,'original29690Touched':False}
 (qa/'verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,ensure_ascii=True))
finally:
 if started:control([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
