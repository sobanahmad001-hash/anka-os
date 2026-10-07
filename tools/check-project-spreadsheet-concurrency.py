"""Two-session synthetic checks. Disposable copy on the EXISTING QA server only."""
import argparse, concurrent.futures, json, threading, time
from pathlib import Path
import psycopg2
from psycopg2.extras import Json
p=argparse.ArgumentParser()
p.add_argument('--port',type=int,required=True);p.add_argument('--database',required=True)
p.add_argument('--expected-data-directory',required=True);p.add_argument('--user',default='postgres')
p.add_argument('--evidence',type=Path,required=True)
p.add_argument('--calendar-create-only',action='store_true')
a=p.parse_args()
if not a.database.startswith('anka_importer_qa_'):raise SystemExit('Disposable synthetic QA copy required; never run against shared QA or production')
def connect():
 c=psycopg2.connect(host='127.0.0.1',port=a.port,dbname=a.database,user=a.user,connect_timeout=5)
 with c.cursor() as q:
  q.execute("select current_database(),current_setting('data_directory'),current_setting('server_version_num')")
  db,directory,version=q.fetchone()
  if db!=a.database or directory!=a.expected_data_directory or not 170000<=int(version)<180000:raise RuntimeError('Wrong QA identity')
  q.execute("set statement_timeout='15s';set lock_timeout='10s'")
  q.execute("select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',false)")
 c.commit();return c
org='99999999-9999-4999-8999-999999999901';actor='99999999-9999-4999-8999-999999999902'
chat='8f000000-0000-4000-8000-000000000001';project='99999999-9999-4999-8999-999999999974'
repo=Path(__file__).resolve().parents[1]
base=connect()
with base.cursor() as q:
 q.execute("select to_regprocedure('public.confirm_project_chat_import_proposal(uuid,uuid,uuid,uuid,text)')")
 if q.fetchone()[0] is None:raise RuntimeError('First apply the exact two candidate migrations and synthetic behavior fixture to this QA copy; see handoff')
 q.execute("select count(*) from public.department_chat_conversations where id=%s",(chat,))
 if q.fetchone()[0]!=1:raise RuntimeError('Synthetic fixture prerequisite missing')
base.commit()
def proposal(request,suffix):
 with base.cursor() as q:
  q.execute("""select p.import_attachment_id,p.engagement_id,p.artifact_id,p.preview_payload,p.import_source_receipt,v.id,v.content
  from public.department_chat_proposals p join lateral(select id,content from public.artifact_versions where artifact_id=p.artifact_id order by version_number desc limit 1) v on true
  where p.idempotency_key='8f000000-0000-4000-8000-000000000005'""")
  attachment,engagement,root,preview,source,parent,content=q.fetchone()
  content['pages'][0]['title']='Synthetic concurrency '+suffix
  payload={'title':'Synthetic concurrency','expected_parent_version_id':str(parent),'content':content}
  q.execute('select public.save_project_chat_import_proposal(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
    (org,chat,actor,attachment,engagement,'website_architecture',request,root,parent,Json(payload),Json(preview),Json(source)))
  review=q.fetchone()[0]['review_sha256']
 base.commit();return review
def count_versions():
 with base.cursor() as q:q.execute("select count(*) from public.artifact_versions where artifact_id='8f000000-0000-4000-8000-000000000003'");return q.fetchone()[0]
def confirm(c,request,review):
 with c.cursor() as q:q.execute('select public.confirm_project_chat_import_proposal(%s,%s,%s,%s,%s)',(org,chat,actor,request,review));return q.fetchone()[0]
if not a.calendar_create_only:
 request='8f000000-0000-4000-8000-000000000040';review=proposal(request,'double confirm');before=count_versions();base.commit()
 barrier=threading.Barrier(2)
 def race():
  c=connect()
  try:barrier.wait(timeout=5);result=confirm(c,request,review);c.commit();return result
  finally:c.close()
 with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:race(),range(2)))
 assert sorted(r['replayed'] for r in results)==[False,True]
 assert count_versions()==before+1
 base.commit()
# Separate proposals for one stable create identity: first writes, second is stale.
def calendar_proposal(request,key="qa:calendar:concurrency",title="Synthetic calendar concurrent create"):
 with base.cursor() as q:
  q.execute("select sha256_hex from public.department_chat_attachments where id='8f000000-0000-4000-8000-000000000002'")
  source_sha=q.fetchone()[0]
  rows=[{'row_id':'3'*64,'record_kind':'engagement_work_item','record_id':None,'expected_row_version':None,'calendar_key':key,'title':title,'start_date':None,'due_date':None,'action':'create'}]
  source={'origin':'spreadsheet_import','attachment_id':'8f000000-0000-4000-8000-000000000002','batch_sha256':'b'*64,'rows':[{'row_id':'3'*64,'identity':'calendar:'+key,'action':'create','source':{'fileSha256':source_sha,'fileName':'synthetic.csv','sheet':'Visible','row':5}}]}
  q.execute('select public.save_project_chat_import_proposal(%s,%s,%s,%s,%s,%s,%s,null,null,%s,%s,%s)',(org,chat,actor,source['attachment_id'],'99999999-9999-4999-8999-999999999975','content_calendar',request,Json({'rows':rows}),Json({'reviewed':True}),Json(source)))
  review=q.fetchone()[0]['review_sha256']
 base.commit();return review
requests=['8f000000-0000-4000-8000-000000000060','8f000000-0000-4000-8000-000000000061']
reviews=[calendar_proposal(r) for r in requests];barrier=threading.Barrier(2)
def calendar_race(i):
 c=connect()
 try:barrier.wait(timeout=5);result=confirm(c,requests[i],reviews[i]);c.commit();return result
 finally:c.close()
with concurrent.futures.ThreadPoolExecutor(2) as pool:calendar_results=list(pool.map(calendar_race,range(2)))
assert sorted(r['rows'][0]['outcome'] for r in calendar_results)==['error','verified']
assert next(r for r in calendar_results if r['rows'][0]['outcome']=='error')['rows'][0]['error_code']=='40001'
with base.cursor() as q:q.execute("select count(*) from public.work_items where project_id=%s and title='Synthetic calendar concurrent create'",(project,));assert q.fetchone()[0]==1
base.commit()
# Revocation must block the newly introduced canonical create lane as well.
create_request='8f000000-0000-4000-8000-000000000062'
create_review=calendar_proposal(create_request,'qa:calendar:revocation','Synthetic calendar revoked create')
revoker=connect();worker=connect();pid=worker.get_backend_pid()
with revoker.cursor() as q:q.execute("update public.organization_memberships set status='suspended' where organization_id=%s and user_id=%s",(org,actor))
def revoked_create():
 try:confirm(worker,create_request,create_review);worker.commit();return 'unexpected_success'
 except psycopg2.Error as e:worker.rollback();return e.pgcode
try:
 with concurrent.futures.ThreadPoolExecutor(1) as pool:
  future=pool.submit(revoked_create);locked=False
  for _ in range(50):
   with base.cursor() as q:q.execute("select wait_event_type='Lock' from pg_stat_activity where pid=%s",(pid,));locked=bool(q.fetchone()[0])
   base.commit()
   if locked or future.done():break
   time.sleep(.1)
  assert locked,'Create must wait for current membership lock'
  revoker.commit();assert future.result(timeout=15)=='42501'
 with base.cursor() as q:q.execute("select count(*) from public.work_items where project_id=%s and title='Synthetic calendar revoked create'",(project,));assert q.fetchone()[0]==0
finally:
 revoker.rollback()
 with base.cursor() as q:q.execute("update public.organization_memberships set status='active' where organization_id=%s and user_id=%s",(org,actor))
 base.commit();revoker.close();worker.close()
if a.calendar_create_only:
 base.close();a.evidence.parent.mkdir(parents=True,exist_ok=True)
 a.evidence.write_text(json.dumps({'scope':'Synthetic disposable QA only','calendarSeparateProposalsOneWorkItem':True,'losingCreateRequiresFreshReview':True,'createMembershipLockObserved':True,'committedRevocationDeniesCreate':True,'syntheticAuthorityRestored':True},indent=2)+'\n')
 print('PASS calendar create concurrency; no duplicate Work Item; QA copy retained');raise SystemExit(0)
request='8f000000-0000-4000-8000-000000000041';review=proposal(request,'revocation');before=count_versions();base.commit()
revoker=connect();worker=connect();pid=worker.get_backend_pid()
with revoker.cursor() as q:q.execute("update public.organization_memberships set status='suspended' where organization_id=%s and user_id=%s",(org,actor))
def revoked():
 try:confirm(worker,request,review);worker.commit();return 'unexpected_success'
 except psycopg2.Error as e:worker.rollback();return e.pgcode
try:
 with concurrent.futures.ThreadPoolExecutor(1) as pool:
  future=pool.submit(revoked);locked=False
  for _ in range(50):
   with base.cursor() as q:q.execute("select wait_event_type='Lock' from pg_stat_activity where pid=%s",(pid,));locked=bool(q.fetchone()[0])
   base.commit()
   if locked:break
   if future.done():break
   time.sleep(.1)
  assert locked,'Confirm must wait for the current membership lock'
  revoker.commit();assert future.result(timeout=15)=='42501'
 assert count_versions()==before
finally:
 revoker.rollback()
 with base.cursor() as q:q.execute("update public.organization_memberships set status='active' where organization_id=%s and user_id=%s",(org,actor))
 base.commit();revoker.close();worker.close();base.close()
a.evidence.parent.mkdir(parents=True,exist_ok=True)
a.evidence.write_text(json.dumps({'scope':'Synthetic disposable copy on existing local QA server only','database':a.database,
 'doubleConfirmOneVersion':True,'oneFrozenReplay':True,'membershipLockObserved':True,'committedRevocationDeniesWrite':True,'syntheticAuthorityRestored':True},indent=2)+'\n')
print('PASS two-session confirm/replay and locked revocation recheck; QA copy retained for inspection')
