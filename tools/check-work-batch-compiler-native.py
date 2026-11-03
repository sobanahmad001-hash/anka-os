"""Fresh owned PG17; actual private SQL compiler on synthetic canonical DTOs.
READ ONLY compilation, no Work writer, actor/source acceptance or production claim.
"""
from pathlib import Path
import argparse,subprocess,json,uuid,copy,hashlib
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);p.add_argument('--focused-provenance',action='store_true');p.add_argument('--stage-fingerprint',action='store_true');p.add_argument('--lineage-limit',action='store_true');a=p.parse_args()
repo=Path(a.repo).resolve();qa=Path(a.qa).resolve();data=qa/'data';assert not data.exists(),'Use a fresh owned QA directory'
qa.mkdir(parents=True,exist_ok=True);bin=Path(a.pgbin);port=29966;database='batch_'+uuid.uuid4().hex[:8];flags=0x08000000;checks=[]
def server_command(args):
 with (qa/'server-control.log').open('a',encoding='utf-8') as log:return subprocess.run([str(x) for x in args],stdout=log,stderr=subprocess.STDOUT,creationflags=flags,timeout=30)
def process(args):return subprocess.run([str(x) for x in args],capture_output=True,text=True,encoding='utf-8',creationflags=flags,timeout=30)
def run(sql,ok=True):
 r=process([bin/'psql.exe','-h','127.0.0.1','-p',port,'-U','postgres','-d',database,'-X','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-c',sql])
 with (qa/'commands.log').open('a',encoding='utf-8') as f:f.write(sql+'\n'+r.stdout+r.stderr+'\n')
 if ok and r.returncode:raise RuntimeError(r.stderr)
 return r
def value(sql):return json.loads(next(line for line in reversed(run(sql).stdout.splitlines()) if line.strip().startswith('{')))
def j(x):return "'"+json.dumps(x).replace("'","''")+"'::jsonb"
def compile(context,proposal):return value('begin read only;select private.compile_project_pipeline_work_batch('+j(context)+','+j(proposal)+');commit;')
def denied(context,proposal,code):
 r=run('begin read only;select private.compile_project_pipeline_work_batch('+j(context)+','+j(proposal)+')',False);assert r.returncode and code in r.stderr,r.stderr;checks.append('denied '+code)
def passed(s):checks.append(s)
def uid(n):return 'e0000000-0000-4000-8000-'+str(n).zfill(12)
scope={'organization_id':uid(1),'project_id':uid(2),'engagement_id':uid(3)}
def stage(key,quantity=1,depends=(),action='run'):
 return {'key':key,'label':key.title(),'department_id':'content','service_id':uid(4),'quantity':quantity,'depends_on':list(depends),'action':action}
def context(stages):return {'version':1,'scope':scope,'configuration_id':uid(5),'partition':{'kind':'engagement','id':uid(3)},'source_sha256':'a'*64,'receipt_head':None,'creation_allowed':True,'stages':stages,'work_options':[],'prior_slots':[],'existing_work_edges':[],'asset_options':[]}
def proposal(c):return {'version':1,'slots':[{'key':s['key'],'instance':i,'action':'create_missing'} for s in c['stages'] if s['action']=='run' for i in range(1,s['quantity']+1)],'dependencies':[],'asset_links':[]}
def pair(key,instance,up,upinstance):return {'key':key,'instance':instance,'depends_on_key':up,'depends_on_instance':upinstance}
def work(n=10,status='not_started'):return {'id':uid(n),'row_version':1,**scope,'department_id':'content','eligible':True,'material_current':True,'status':status,'relation_revision':0,'assets':[]}
def reuse(c,p,key='brief',instance=1,n=10):
 w=work(n);c['work_options'].append(w);slot=next(x for x in p['slots'] if x['key']==key and x['instance']==instance);slot.update(action='use_existing',work_item_id=w['id'],row_version=w['row_version']);return w,slot
started=False
try:
 r=process([bin/'initdb.exe','-D',data,'-U','postgres','--encoding=UTF8','--no-locale','--auth=trust']);(qa/'initdb.log').write_text(r.stdout+r.stderr,encoding='utf-8');assert r.returncode==0,r.stderr
 r=server_command([bin/'pg_ctl.exe','-D',data,'-l',qa/'server.log','-o',f'-p {port} -h 127.0.0.1','-w','start']);assert r.returncode==0,'See server-control.log';started=True
 r=process([bin/'createdb.exe','-h','127.0.0.1','-p',port,'-U','postgres',database]);assert r.returncode==0,r.stderr
 run('create schema private;create role anon;create role authenticated;create role service_role;alter database '+database+" set statement_timeout='3s'")
 sql=next((repo/'supabase/migrations').glob('*_reviewed_pipeline_work_batches.sql')).read_text(encoding='utf-8');run(sql.split('-- BEGIN WORK BATCH API',1)[0]+'commit;')
 if a.lineage_limit:
  c=context([stage('brief',50)]);c['prior_slots']=[{'key':'retained_old_stage','instance':1,'work_item_id':uid(900),'row_version':1}];denied(c,proposal(c),'54000')
  (qa/'verification.json').write_text(json.dumps({'count':len(checks),'checks':checks,'migration_sha256':hashlib.sha256(sql.encode()).hexdigest(),'boundary':'Focused pure compiler lineage bound before canonical writes; prior compiler/writer tests retained.'},indent=2)+'\n',encoding='utf-8');print(json.dumps({'count':len(checks),'checks':checks}));raise SystemExit(0)
 if a.stage_fingerprint:
  c=context([stage('brief')]);c['stages'][0]['source_sha256']='b'*64;x=proposal(c);r=compile(c,x);assert r['slots'][0]['source_sha256']=='b'*64;passed('trusted per-stage material fingerprint survives normalization independently of whole configuration token')
  c['stages'][0].pop('source_sha256');r2=compile(c,x);assert r2['slots'][0]['source_sha256']=='a'*64 and r2['review_sha256']!=r['review_sha256'];passed('legacy trusted contexts retain previous whole-source fallback and exact hash detects material change')
  (qa/'verification.json').write_text(json.dumps({'count':len(checks),'checks':checks,'migration_sha256':hashlib.sha256(sql.encode()).hexdigest(),'boundary':'Two focused pure compiler cases only; earlier 31 compiler checks retained.'},indent=2)+'\n',encoding='utf-8');print(json.dumps({'count':len(checks),'checks':checks}));raise SystemExit(0)
 if a.focused_provenance:
  c=context([stage('brief')]);x=proposal(c);w,slot=reuse(c,x);slot['previous_work_item_id']=uid(999);denied(c,x,'22023')
  c=context([stage('brief')]);x=proposal(c);c['prior_slots']=[{'key':'brief','instance':1,'work_item_id':uid(10),'row_version':1}]*2;denied(c,x,'22023')
  c=context([stage('brief'),stage('draft',1,['brief','brief'])]);denied(c,proposal(c),'22023')
  result={'count':len(checks),'checks':checks,'port':port,'database':database,'migration_sha256':hashlib.sha256(sql.encode()).hexdigest(),'boundary':'Focused compiler provenance-shape denials in READ ONLY; no actor/source or transactional writer acceptance.'}
  (qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result));raise SystemExit(0)
 c=context([stage('brief')]);p=proposal(c);r=compile(c,p);assert r['can_apply'] and r['counts']['combined']==1 and not r['ready_for_execution'] and not r['ready_for_traffic'];passed('actual SQL compiler executes under READ ONLY; new Work remains planned proposal only')
 c=context([stage('brief'),stage('draft',1,['brief'])]);p=proposal(c);r=compile(c,p);assert r['can_apply'] and len(r['edges'])==1;passed('sole one-to-one dependency is explicit in the hashed reviewed rows')
 c=context([stage('brief',2),stage('draft',2,['brief'])]);p=proposal(c);r=compile(c,p);assert not r['can_apply'] and len(r['edges'])==0 and sum(x['code']=='dependency_mapping_required' for x in r['blockers'])==2
 p['dependencies']=[pair('draft',1,'brief',2),pair('draft',2,'brief',1)];r=compile(c,p);assert r['can_apply'] and len(r['edges'])==2;h=r['review_sha256'];p['dependencies'].reverse();assert compile(c,p)['review_sha256']==h
 p['dependencies']=[pair('draft',1,'brief',1),pair('draft',2,'brief',2)];assert compile(c,p)['review_sha256']!=h;passed('equal quantities never imply zip; exact pair choices and ordering normalize into review hash')
 for uq,dq in [(1,2),(2,1)]:
  c=context([stage('brief',uq),stage('draft',dq,['brief'])]);p=proposal(c);assert not compile(c,p)['can_apply'];p['dependencies']=[pair('draft',i,'brief',1) for i in range(1,dq+1)];assert compile(c,p)['can_apply']
 passed('unequal quantities require explicit bounded instance choices, never broadcast or all-to-all inference')
 c=context([stage('source',1,action='reuse'),stage('draft',1,['source'])]);c['stages'][0]['source_reference']={'artifact_version_id':uid(20),'approval_id':uid(21),'checksum':'c'*64};p=proposal(c);r=compile(c,p);assert r['can_apply'] and len(r['slots'])==1 and len(r['edges'])==0 and len(r['material_requirements'])==1 and r['material_requirements'][0]['source_reference']==c['stages'][0]['source_reference'];passed('approved output is a material pin, never a fabricated completed Work card')
 c['stages'][1]['quantity']=2;p=proposal(c);assert not compile(c,p)['can_apply'];p['dependencies']=[pair('draft',1,'source',None),pair('draft',2,'source',None)];assert len(compile(c,p)['material_requirements'])==2
 c=context([stage('brief'),stage('draft',1,['brief'])]);p=proposal(c);p['dependencies']=[pair('draft',1,'other',1)];denied(c,p,'22023');p['dependencies']=[pair('draft',1,'brief',2)];denied(c,p,'22023');p['dependencies']=[pair('draft',1,'brief',1)]*2;denied(c,p,'22023')
 c=context([stage('brief',1,['draft']),stage('draft',1,['brief'])]);denied(c,proposal(c),'55000')
 c=context([stage('brief',26),stage('draft',25)]);denied(c,proposal(c),'54000');c=context([stage('brief',1000000)]);denied(c,{'version':1,'slots':[]},'22023')
 c=context([stage('s'+str(i),1,['s'+str(j) for j in range(i)]) for i in range(20)]);denied(c,proposal(c),'54000');passed('dense DAG and raw scope-sized quantities terminate within bounded compilation without writes')
 c=context([stage('brief',25),stage('draft',25,['brief'])]);p=proposal(c);p['dependencies']=[pair('draft',i,'brief',j) for i in range(1,26) for j in range(1,5)];c['asset_options']=[{'kind':'website_page','id':uid(100)},{'kind':'website_page','id':uid(101)}];p['asset_links']=[{'key':'draft','instance':i,**a} for i in range(1,26) for a in c['asset_options']];r=compile(c,p);assert r['can_apply'] and r['counts']['combined']==200;p['asset_links'].append({'key':'brief','instance':1,**c['asset_options'][0]});denied(c,p,'54000');passed('fifty slots cannot hide edge/asset fanout: exact combined row budget includes every reviewed pair')
 c=context([stage('brief')]);p=proposal(c);w,s=reuse(c,p);w['assets']=[{'kind':'website_page','id':uid(200+i)} for i in range(50)];c['asset_options']=[{'kind':'website_page','id':uid(300)}];p['asset_links']=[{'key':'brief','instance':1,**c['asset_options'][0]}];denied(c,p,'54000')
 c=context([stage('brief')]);p=proposal(c);p['asset_links']=[{'key':'brief','instance':1,'kind':'website_page','id':uid(500)}];denied(c,p,'42501')
 c=context([stage('brief')]);c['partition']={'kind':'website_page','id':uid(501)};p=proposal(c);assert not compile(c,p)['can_apply'];c['asset_options']=[{'kind':'website_page','id':uid(501)}];p['asset_links']=[{'key':'brief','instance':1,**c['asset_options'][0]}];r=compile(c,p);assert r['can_apply'] and r['counts']['relations']==1;p['asset_links']*=2;assert compile(c,p)['review_sha256']==r['review_sha256'];passed('canonical partition link is explicitly reviewed; foreign links deny and preserved union is bounded')
 c=context([stage('brief')]);p=proposal(c);w,s=reuse(c,p);s['row_version']=2;denied(c,p,'40001');s['row_version']=1;w['project_id']=uid(999);denied(c,p,'42501')
 c=context([stage('brief',2)]);p=proposal(c);w,s=reuse(c,p);p['slots'][1].update(action='use_existing',work_item_id=w['id'],row_version=1);denied(c,p,'22023')
 c=context([stage('brief')]);p=proposal(c);w,s=reuse(c,p);w['status']='done';assert compile(c,p)['can_apply'];w['material_current']=False;assert not compile(c,p)['can_apply'];s['material_reason']='Retain the exact historical Work; new material is separately reviewed';assert compile(c,p)['can_apply'] and not compile(c,p)['ready_for_execution'];passed('completed/history Work is retained by exact ID/version; changed material never silently becomes approved')
 c=context([stage('brief'),stage('draft',1,['brief'])]);p=proposal(c);up,_=reuse(c,p,'brief',1,10);target,_=reuse(c,p,'draft',1,11);target['status']='in_progress';assert not compile(c,p)['can_apply'];c['existing_work_edges']=[{'work_item_id':target['id'],'depends_on_work_item_id':up['id']}];r=compile(c,p);assert r['can_apply'] and r['edges'][0]['action']=='existing';passed('new blockers cannot silently change active/completed Work; existing exact edges stay intact')
 c=context([stage('brief')]);p=proposal(c);c['prior_slots']=[{'key':'brief','instance':1,'work_item_id':uid(600),'row_version':3,'status':'done'}];assert not compile(c,p)['can_apply'];p['slots'][0].update(action='create_replacement',previous_work_item_id=uid(600),previous_row_version=3,material_reason='Explicit new material, preserve prior completed card');r=compile(c,p);assert r['can_apply'] and r['retained'][0]['work_item_id']==uid(600);p['slots'][0]['previous_row_version']=2;denied(c,p,'40001');passed('configuration changes do not recreate cards: exact prior-version replacement is explicit and retains history')
 c=context([stage('brief')]);p=proposal(c);c['prior_slots']=[{'key':'brief','instance':2,'work_item_id':uid(602),'row_version':4,'status':'in_progress'}];r=compile(c,p);assert r['can_apply'] and len(r['retained'])==1;passed('quantity decreases retain outside-batch cards rather than cancelling or deleting them')
 c=context([stage('brief')]);p=proposal(c);c['creation_allowed']=False;assert not compile(c,p)['can_apply'];reuse(c,p);assert compile(c,p)['can_apply'];passed('existing cycle permits reuse only and cannot imply recurrence generation')
 r=value("select jsonb_build_object('anon',has_function_privilege('anon','private.compile_project_pipeline_work_batch(jsonb,jsonb)','execute'),'auth',has_function_privilege('authenticated','private.compile_project_pipeline_work_batch(jsonb,jsonb)','execute'),'service',has_function_privilege('service_role','private.compile_project_pipeline_work_batch(jsonb,jsonb)','execute'))");assert not any(r.values());passed('private pure compiler direct client and service execution stays closed')
 result={'count':len(checks),'checks':checks,'port':port,'database':database,'migration_sha256':hashlib.sha256(sql.encode()).hexdigest(),'boundary':'Actual SQL compiler in READ ONLY transactions with synthetic canonical DTOs. No actor/source reader, Work writer, receipt, asset/DAG write, PostgREST or production acceptance.'};(qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
finally:
 if started:server_command([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
