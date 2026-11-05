"""Actual staged-message SQL on the existing isolated native stage fixture.
Minimal Chat tables/lifecycle lower boundaries are synthetic; no provider call.
"""
import json, hashlib
from concurrent.futures import ThreadPoolExecutor

def verify(repo,parent,qa,run,raw,value,actor,u,q,j,header,unit):
 checks=[]
 def passed(s):checks.append(s)
 def denied(sql,code):
  r=raw(sql);assert r.returncode and code in r.stderr,(code,r.stdout,r.stderr)
 run("""alter table public.organization_memberships add column department_id text;
 create table public.organization_department_memberships(organization_id uuid,user_id uuid,department_id text,status text);
 create table public.department_chat_conversations(id uuid primary key,organization_id uuid,context_kind text,project_id uuid,engagement_id uuid,department_id text,owner_id uuid,title text,state text default 'active',next_sequence bigint default 1,last_activity_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now());
 create table public.project_context_chat_shares(conversation_id uuid,organization_id uuid,project_id uuid,recipient_id uuid,revoked_at timestamptz);
 create table public.department_chat_messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,organization_id uuid,project_id uuid,engagement_id uuid,department_id text,owner_id uuid,author_id uuid,role text,body text,status text,error_code text,provider_dispatched_at timestamptz,ai_run_id uuid,proposal_id uuid,client_request_id uuid,sequence bigint,created_at timestamptz default now(),finished_at timestamptz,in_reply_to_message_id uuid,unique(conversation_id,client_request_id));
 grant select,insert,update on public.department_chat_conversations,public.department_chat_messages to service_role;
 grant select,update on public.organization_memberships,public.organizations,public.projects,public.organization_department_memberships,public.project_context_chat_shares to service_role;
 """)
 rows=json.loads((parent/'message-transport-preimages.json').read_text(encoding='utf-8'))
 for row in rows:
  if row['kind']=='function':run(row['definition'])
 run("revoke all on function public.append_context_chat_human_message(uuid,uuid,uuid,uuid,text),public.start_context_chat_human_message(uuid,uuid,uuid,text,uuid,text,uuid,text) from public,anon,authenticated;grant execute on function public.append_context_chat_human_message(uuid,uuid,uuid,uuid,text),public.start_context_chat_human_message(uuid,uuid,uuid,text,uuid,text,uuid,text) to service_role")
 migration=(repo/'supabase/migrations/20261106092215_project_stage_chat_context.sql').read_text(encoding='utf-8')
 run(migration)
 passed('actual legacy preimages and new staged-message migration install; private cores remain closed')
 selection={k:header[k] for k in ['organization_id','project_id','engagement_id','plan_id']}
 selection.update(version=1,group_id=unit['group_id'],phase='website.content',partition=unit['partition'],context_sha256=unit['context_sha256'])
 output=unit['steps'][0]['items'][0]['output']['artifact_version_id']
 def send(request=102,conversation=101,selected=None,ids=None,start=True,who=4,extra=''):
  return actor(extra+'select public.send_project_stage_chat_message('+','.join([q(u(1)),q(u(2)),q(u(conversation)),q(u(request)),q('  Native stage message  '),'true' if start else 'false',j(selection if selected is None else selected),"array["+','.join(q(x)+'::uuid' for x in ([output] if ids is None else ids))+"]::uuid[]"])+')',who)
 saved=value(send());message=saved['message'];metadata=message['project_stage_context']
 assert metadata['selection']==selection and metadata['outputs'][0]['approval_id']==u(42) and metadata['outputs'][0]['ai_use_allowed'] is False
 assert metadata['body_included'] is False and metadata['attachments_included'] is False and message['body']=='Native stage message'
 assert value(send())==saved
 assert value("select count(*) from public.department_chat_messages")==1
 passed('normal authenticated owner start pins server-derived exact stage metadata and original request replays once')
 changed=dict(selection,context_sha256='f'*64)
 denied(send(selected=changed),'23505');denied(send(ids=[u(99)]),'23505')
 denied(send(request=104,conversation=103,selected=changed),'40001')
 assert value('select count(*) from public.department_chat_conversations where id='+q(u(103)))==0
 denied(send(request=106,conversation=105,ids=[u(99)]),'42501')
 assert value('select count(*) from public.department_chat_messages')==1
 passed('same UUID rejects altered selection/output; stale or foreign output first Send rolls back without creating a conversation')
 read='select public.read_project_stage_chat_message_context('+','.join(map(q,[u(1),u(101),message['id']]))+')'
 assert value(actor(read))==metadata
 assert [item['instance'] for item in metadata['work']]==[1,2]
 assert value(actor('set enable_hashagg=off;set enable_sort=off;'+read))==metadata
 passed('explicit metadata ordinality preserves reviewed step/instance ordering under changed planner settings')
 denied(actor(read,5),'42501');denied(send(who=5),'42501')
 denied(actor('select private.append_project_stage_message_core('+','.join([q(u(101)),q(u(1)),q(u(4)),q(u(109)),q('x'),"null"])+')',4,'service_role'),'42501')
 denied('update public.department_chat_messages set project_stage_context=null where id='+q(message['id']),'55000')
 passed('foreign actor, direct service core call and metadata rewrite are denied')
 denied(actor("set qa.source_changed='yes';"+read),'40001')
 assert value(send(extra="set qa.source_changed='yes';"))==saved
 run('update public.artifact_approvals set decision=\'changes_requested\' where id='+q(u(42)))
 denied(actor(read),'40001')
 assert value(send())==saved
 run('update public.artifact_approvals set decision=\'approved\' where id='+q(u(42)))
 passed('changed source/approval blocks fresh runner context while original same-request recovery retains the historical selection')
 run('update public.organization_memberships set status=\'inactive\' where user_id='+q(u(4)))
 denied(actor(read),'42501');denied(send(),'42501')
 run('update public.organization_memberships set status=\'active\' where user_id='+q(u(4)))
 passed('revoked current membership denies both contextual revalidation and original request access')
 legacy='select public.start_context_chat_human_message('+','.join([q(u(110)),q(u(1)),q(u(4)),q('project_team'),q(u(2)),"null",q(u(111)),q('Plain unchanged')])+')'
 plain=value(actor(legacy,4,'service_role'))
 assert plain['message']['project_stage_context'] is None and value(actor(legacy,4,'service_role'))==plain
 denied(actor('select public.append_context_chat_human_message('+','.join([q(u(101)),q(u(1)),q(u(4)),q(u(102)),q('Native stage message')])+')',4,'service_role'),'23505')
 denied(send(request=111,conversation=110),'23505')
 passed('legacy start/append stays NULL-context and exact; plain/staged requests cannot adopt each other')
 second=value(send(request=112,start=False));assert second['project_stage_context']==metadata and second['sequence']==2
 assert value(send(request=112,start=False))==second
 passed('existing conversation append retains metadata and sequence with one exact immutable receipt')
 with ThreadPoolExecutor(max_workers=2) as pool:
  concurrent=list(pool.map(lambda _:raw(send(request=121,conversation=120)),[1,2]))
 assert all(r.returncode==0 for r in concurrent),[(r.stdout,r.stderr) for r in concurrent]
 outcomes=[json.loads(r.stdout.splitlines()[-1]) for r in concurrent]
 assert outcomes[0]['message']['id']==outcomes[1]['message']['id']
 assert value('select count(*) from public.department_chat_messages where conversation_id='+q(u(120)))==1
 passed('concurrent same first-message request creates one conversation message and returns its same identity')
 empty=value(send(request=122,ids=[],start=False))
 assert empty['project_stage_context']['outputs']==[] and empty['project_stage_context']['output_version_ids']==[]
 assert value(actor('select public.read_project_stage_chat_message_context('+','.join(map(q,[u(1),u(101),empty['id']]))+')'))==empty['project_stage_context']
 before=value('select count(*) from public.department_chat_messages')
 malformed=raw(send(request=123).replace('array[','array[[',1).replace(']::uuid[]',']]::uuid[]',1))
 assert malformed.returncode!=0 and value('select count(*) from public.department_chat_messages')==before
 passed('explicit no-output context revalidates; multidimensional output selection cannot persist a message')
 result={'status':'passed','count':len(checks),'checks':checks,'migration_sha256':hashlib.sha256(migration.encode()).hexdigest(),'boundary':'Actual stage reader, original Chat persistence preimages and new migration on synthetic minimal Chat/base tables. No production RLS completeness, HTTP, signed-in, provider or business execution claim.'}
 (qa/'message-verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 (qa/'actual-stage-message.json').write_text(json.dumps(saved,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(result))
