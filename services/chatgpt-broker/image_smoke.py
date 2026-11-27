import json, os, secrets, subprocess, time, urllib.request, urllib.error
from uuid import uuid4
from cryptography.fernet import Fernet
assert os.getuid() in (0,10001)
env={**os.environ,'BROKER_PUBLIC_URL':'http://127.0.0.1:8000','SUPABASE_URL':'http://127.0.0.1:55621','SUPABASE_PUBLISHABLE_KEY':'synthetic-public-key','BROKER_UPSTREAM_AUDIENCE':'http://127.0.0.1:55621/functions/v1/hybrid-mcp','BROKER_UPSTREAM_CLIENT_ID':str(uuid4()),'BROKER_SIGNING_KEY':secrets.token_urlsafe(48),'BROKER_ENCRYPTION_KEY':Fernet.generate_key().decode(),'BROKER_CLIENT_REDIRECT_URIS':'["http://127.0.0.1:55632/callback"]','BROKER_LOCAL_TEST':'1'}
p=subprocess.Popen(['python','start.py'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
try:
    ready=False
    for _ in range(100):
        if p.poll() is not None:
            raise RuntimeError('Startup failed: '+p.stderr.read().decode()[-1500:])
        try:
            with urllib.request.urlopen('http://127.0.0.1:8000/.well-known/oauth-authorization-server',timeout=1) as r:
                metadata=json.load(r)
            assert metadata['issuer']=='http://127.0.0.1:8000/' or metadata['issuer']=='http://127.0.0.1:8000'
            ready=True;break
        except urllib.error.URLError:
            time.sleep(.1)
    assert ready
    status=open('/proc/'+str(p.pid)+'/status').read()
    assert 'Uid:\t10001\t10001\t10001\t10001' in status
    assert os.stat('/data/broker').st_uid==10001
    try:
        urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000/mcp', data=b'{}', headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'}),timeout=2)
        raise AssertionError('Unauthenticated MCP allowed')
    except urllib.error.HTTPError as e:
        assert e.code==401
    try:
        urllib.request.urlopen('http://127.0.0.1:8000/auth/callback?code=smoke-private-code&state=smoke-private-state',timeout=2)
    except urllib.error.HTTPError as e:
        assert e.code>=400
    print(json.dumps({'launcher_uid':os.getuid(),'server_uid':10001,'actual_image_startup':'pass','oauth_metadata':'pass','unauthenticated_mcp':401,'memory_limit_mb':512,'cpu_limit':1,'production_changed':False}))
finally:
    p.terminate();p.wait(timeout=10)
    logs=p.stderr.read().decode()
    assert 'smoke-private-code' not in logs and 'smoke-private-state' not in logs


