"""Observed atomic first-Send races in the single owned local clone."""
import argparse,json,os,subprocess,time,uuid
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);a=p.parse_args()
base=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-At','-v','ON_ERROR_STOP=1']
org='99999999-9999-4999-8999-999999999901';actor='99999999-9999-4999-8999-999999999902';project='99999999-9999-4999-8999-999999999974';engagement='99999999-9999-4999-8999-999999999975';service='99999999-9999-4999-8999-999999999977'
def q(sql):
 r=subprocess.run(base,input=sql.encode(),capture_output=True,timeout=10)
 if r.returncode:raise RuntimeError(r.stderr.decode())
 return r.stdout.decode().strip()
def spawn(sql,name):
 env=os.environ.copy();env['PGAPPNAME']=name
 return subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
def wait(name,condition):
 end=time.monotonic()+5
 while time.monotonic()<end:
  if q(f"select count(*) from pg_stat_activity where application_name='{name}' and {condition}")=='1':return
  time.sleep(.05)
 raise RuntimeError('Missing observed wait: '+name)
def race(name,leader_sql,follower_sql,fail=False):
 leader=spawn(leader_sql,'eng-first-'+name+'-leader');leader.stdin.write(('begin;'+leader_sql+'select pg_sleep(2);commit;').encode());leader.stdin.close();leader.stdin=None
 wait('eng-first-'+name+'-leader',"wait_event='PgSleep'")
 follower=spawn(follower_sql,'eng-first-'+name+'-follower');follower.stdin.write(('begin;'+follower_sql+'commit;').encode());follower.stdin.close();follower.stdin=None
 wait('eng-first-'+name+'-follower',"wait_event_type='Lock'")
 lo,le=leader.communicate(timeout=8);fo,fe=follower.communicate(timeout=8)
 assert leader.returncode==0,le.decode();assert follower.returncode==(3 if fail else 0),fe.decode()
 return {'name':name,'observedLockWait':True,'leaderExit':leader.returncode,'followerExit':follower.returncode},fe.decode()
def send(cid,req,body):return f"set local role service_role;select public.start_engagement_chat_turn('{cid}','{org}','{project}','{engagement}','content','{actor}','{req}','{body}');"
results=[]
try:
 for changed in [False,True]:
  cid,req=str(uuid.uuid4()),str(uuid.uuid4());result,error=race('changed-body' if changed else 'same-request',send(cid,req,'First exact prompt'),send(cid,req,'Changed prompt' if changed else 'First exact prompt'),changed)
  assert q(f"select (select count(*) from public.department_chat_conversations where id='{cid}'),(select count(*) from public.department_chat_messages where conversation_id='{cid}')")=='1|1'
  if changed:assert 'identity conflicts' in error
  result.update(conversationCount=1,messageCount=1);results.append(result)
 for name,table,where,column,revoked,active in [('archive','public.projects',f"id='{project}'",'archived_at','now()','null'),('membership','public.organization_memberships',f"organization_id='{org}' and user_id='{actor}'",'status',"'revoked'","'active'"),('service','public.engagement_services',f"id='{service}'",'status',"'on_hold'","'active'")]:
  for first in [True,False]:
   cid,req=str(uuid.uuid4()),str(uuid.uuid4());change=f"update {table} set {column}={revoked} where {where};"
   result,error=race(name+('-first' if first else '-after-send'),change if first else send(cid,req,'Exact authority prompt'),send(cid,req,'Exact authority prompt') if first else change,first)
   assert q(f"select count(*) from public.department_chat_conversations where id='{cid}'")==('0' if first else '1')
   result['conversationCount']=0 if first else 1;results.append(result)
   q(f"update {table} set {column}={active} where {where}")
finally:
 q(f"update public.projects set archived_at=null where id='{project}';update public.organization_memberships set status='active' where organization_id='{org}' and user_id='{actor}';update public.engagement_services set status='active' where id='{service}';")
print(json.dumps({'database':'anka_b1_firstsend_20260930','host':'127.0.0.1','providerFree':True,'results':results},indent=2))
