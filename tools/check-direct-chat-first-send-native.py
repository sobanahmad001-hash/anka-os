"""B1 native races in the named isolated local DB, using an existing fake member."""
import argparse, json, os, subprocess, time, uuid
parser = argparse.ArgumentParser()
parser.add_argument('--psql', required=True)
parser.add_argument('--port', default='55462')
parser.add_argument('--database', default='anka_b1_firstsend_20260930')
args = parser.parse_args()
assert args.database == 'anka_b1_firstsend_20260930', 'Only the isolated B1 local fixture is allowed'
base = [args.psql, '-X', '-w', '-h', '127.0.0.1', '-p', args.port, '-U', 'postgres', '-d', args.database, '-At', '-v', 'ON_ERROR_STOP=1']
org, actor = '99999999-9999-4999-8999-999999999901', '99999999-9999-4999-8999-999999999902'
def query(sql):
    r = subprocess.run(base, input=sql.encode(), capture_output=True, timeout=10)
    if r.returncode: raise RuntimeError(r.stderr.decode(errors='replace'))
    return r.stdout.decode().strip()
def spawn(sql, label):
    env = os.environ.copy(); env['PGAPPNAME'] = label
    p = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    p.stdin.write(sql.encode()); p.stdin.close(); p.stdin = None
    return p
def wait_for(label, condition):
    end = time.monotonic() + 5
    while time.monotonic() < end:
        if query(f"select count(*) from pg_stat_activity where application_name='{label}' and {condition};") == '1': return True
        time.sleep(.05)
    raise RuntimeError(f'Observed wait missing for {label}: {condition}')
def send(cid, request, body, project=None):
    kind = 'project_team' if project else 'organization'
    parent = f"'{project}'" if project else 'null'
    return f"select public.start_context_chat_human_message('{cid}','{org}','{actor}','{kind}',{parent},null,'{request}','{body}')#>>'{{message,id}}';"
def archive(project, value=True):
    return f"select set_config('request.jwt.claim.sub','{actor}',true);select public.set_project_archived('{org}','{project}',{str(value).lower()},'{uuid.uuid4()}');"
def race(name, leader_sql, follower_sql, expected_follower=0):
    leader_label, follower_label = f'b1-{name}-leader', f'b1-{name}-follower'
    leader = spawn('begin;' + leader_sql + 'select pg_sleep(2);commit;', leader_label)
    wait_for(leader_label, "wait_event='PgSleep'")
    follower = spawn('begin;' + follower_sql + 'commit;', follower_label)
    observed = wait_for(follower_label, "wait_event_type='Lock'")
    lo, le = leader.communicate(timeout=8); fo, fe = follower.communicate(timeout=8)
    assert leader.returncode == 0, le.decode()
    assert follower.returncode == expected_follower, fe.decode()
    return {'name': name, 'observedLockWait': observed, 'leaderExit': leader.returncode, 'followerExit': follower.returncode}, lo.decode(), fo.decode(), fe.decode()
results = []
project = query(f"select id from public.projects where organization_id='{org}' and archived_at is null order by id limit 1;")
uuid.UUID(project)
for changed in [False, True]:
    cid, request = str(uuid.uuid4()), str(uuid.uuid4())
    result, leader, follower, error = race('changed-body' if changed else 'same-request', 'set local role service_role;' + send(cid, request, 'One exact message'), 'set local role service_role;' + send(cid, request, 'Different message' if changed else 'One exact message'), 3 if changed else 0)
    counts = query(f"select (select count(*) from public.department_chat_conversations where id='{cid}'),(select count(*) from public.department_chat_messages where conversation_id='{cid}');")
    assert counts == '1|1', counts
    result['conversationCount'], result['messageCount'] = 1, 1
    if changed: assert 'different message inputs' in error
    else: assert [line for line in leader.splitlines() if len(line) == 36][0] == [line for line in follower.splitlines() if len(line) == 36][0]
    results.append(result)
cid, request = str(uuid.uuid4()), str(uuid.uuid4())
result, _, _, error = race('archive-first', archive(project), 'set local role service_role;' + send(cid, request, 'Blocked after archive', project), 3)
assert 'Project is unavailable' in error
assert query(f"select count(*) from public.department_chat_conversations where id='{cid}';") == '0'
results.append(result)
query('begin;' + archive(project, False) + 'commit;')
cid, request = str(uuid.uuid4()), str(uuid.uuid4())
result, _, _, _ = race('send-first', 'set local role service_role;' + send(cid, request, 'Sent before archive', project), archive(project))
assert query(f"select count(*) from public.department_chat_messages where conversation_id='{cid}';") == '1'
results.append(result)
query('begin;' + archive(project, False) + 'commit;')
cid, request = str(uuid.uuid4()), str(uuid.uuid4())
result, _, _, error = race('revocation-first', f"update public.organization_memberships set status='revoked' where organization_id='{org}' and user_id='{actor}';", 'set local role service_role;' + send(cid, request, 'Blocked revoked member'), 3)
assert 'Active team membership required' in error
assert query(f"select count(*) from public.department_chat_conversations where id='{cid}';") == '0'
results.append(result)
query(f"update public.organization_memberships set status='active' where organization_id='{org}' and user_id='{actor}';")
print(json.dumps({'database':args.database,'host':'127.0.0.1','providerFree':True,'results':results},indent=2))
