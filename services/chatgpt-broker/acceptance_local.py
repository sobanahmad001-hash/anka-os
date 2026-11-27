import asyncio, base64, hashlib, html, json, re, secrets, sys, tempfile
from urllib.parse import urlsplit, parse_qs
from uuid import uuid4

import httpx2 as httpx
from cryptography.fernet import Fernet
from broker import Settings, create_broker

async def main():
    f=json.load(open(sys.argv[1]))
    assert f['origin']=='http://127.0.0.1:55621'
    public='http://127.0.0.1:55631'
    callback='http://127.0.0.1:55632/callback'
    checks=[]
    with tempfile.TemporaryDirectory() as directory:
        settings=Settings(public,f['origin'],f['key'],f['origin']+'/functions/v1/hybrid-mcp',f['client_id'],secrets.token_urlsafe(48),Fernet.generate_key().decode(),directory,(callback,),True)
        server,auth=create_broker(settings)
        app=server.http_app(path='/mcp',stateless_http=True,json_response=True)
        async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=public,follow_redirects=False) as browser, httpx.AsyncClient(follow_redirects=False,timeout=20) as upstream:
            normal={'apikey':f['key'],'Authorization':'Bearer '+f['user_token']}
            async def grant(save=True,revoke=False):
                r=await upstream.post(f['origin']+'/rest/v1/rpc/set_hybrid_oauth_grant',headers=normal,json={'p_client':f['client_id'],'p_org':f['org'],'p_project':f['p1']['project_id'],'p_save':save,'p_revoke':revoke})
                assert r.status_code in (200,204), ('grant',r.status_code)
            registered=await browser.post('/register',json={'client_name':'Synthetic ChatGPT broker acceptance','redirect_uris':[callback],'grant_types':['authorization_code','refresh_token'],'response_types':['code'],'token_endpoint_auth_method':'none','scope':'email'})
            assert registered.status_code==201, ('register',registered.status_code)
            client=registered.json()['client_id']
            rejected=await browser.post('/register',json={'client_name':'Bad callback','redirect_uris':['https://unapproved.example/callback'],'grant_types':['authorization_code'],'response_types':['code'],'token_endpoint_auth_method':'none'})
            assert rejected.status_code>=400
            verifier=secrets.token_urlsafe(32)
            challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
            state=secrets.token_urlsafe(32)
            response=await browser.get('/authorize',params={'client_id':client,'redirect_uri':callback,'response_type':'code','scope':'email','state':state,'code_challenge':challenge,'code_challenge_method':'S256','resource':public+'/mcp'})
            assert response.status_code in (302,303), ('authorize',response.status_code)
            consent=await browser.get(response.headers['location'])
            assert consent.status_code==200, ('consent',consent.status_code)
            fields={html.unescape(k):html.unescape(v) for k,v in re.findall(r'name="([^"]+)"[^>]*value="([^"]*)"',consent.text)}
            fields['action']='approve'
            no_csrf=await browser.post('/consent',data={k:v for k,v in fields.items() if 'csrf' not in k})
            assert no_csrf.status_code>=400
            response=await browser.post('/consent',data=fields)
            assert response.status_code in (302,303), ('approve proxy',response.status_code, sorted(fields))
            response=await upstream.get(response.headers['location'],headers={'apikey':f['key']})
            assert response.status_code==302, ('upstream authorize',response.status_code)
            auth_id=parse_qs(urlsplit(response.headers['location']).query)['authorization_id'][0]
            details=await upstream.get(f['origin']+'/auth/v1/oauth/authorizations/'+auth_id,headers=normal)
            assert details.status_code==200, ('authorization details',details.status_code)
            await grant()
            approved=details.json()
            if not approved.get('redirect_url'):
                response=await upstream.post(f['origin']+'/auth/v1/oauth/authorizations/'+auth_id+'/consent',headers=normal,json={'action':'approve'})
                assert response.status_code==200, ('approve upstream',response.status_code)
                approved=response.json()
            wrong_state=await browser.get('/auth/callback',params={'code':'synthetic-invalid','state':'synthetic-invalid'})
            assert wrong_state.status_code>=400
            response=await browser.get(approved['redirect_url'])
            assert response.status_code in (302,303), ('broker callback',response.status_code)
            params=parse_qs(urlsplit(response.headers['location']).query)
            assert params['state']==[state]
            exchange={'grant_type':'authorization_code','client_id':client,'redirect_uri':callback,'code':params['code'][0],'code_verifier':verifier,'resource':public+'/mcp'}
            bad=await browser.post('/token',data={**exchange,'code_verifier':secrets.token_urlsafe(32)})
            assert bad.status_code in (400,401), ('wrong verifier',bad.status_code,bad.json().get('error'))
            response=await browser.post('/token',data=exchange)
            assert response.status_code==200, ('token',response.status_code)
            tokens=response.json()
            assert (await browser.post('/token',data=exchange)).status_code in (400,401)
            checks.append('real_oauth_double_consent_pkce_wrong_verifier_and_code_replay')
            checks.append('unapproved_redirect_missing_csrf_and_wrong_callback_state_denied')
            outer=tokens['access_token']
            assert (await upstream.put(f['origin']+'/auth/v1/user',headers={'apikey':f['key'],'Authorization':'Bearer '+outer},json={'data':{'broker_must_not_write':True}})).status_code>=400
            assert (await upstream.get(f['origin']+'/rest/v1/projects?select=id',headers={'apikey':f['key'],'Authorization':'Bearer '+outer})).status_code>=400
            checks.append('broker_token_denied_by_real_auth_account_update_and_data_api')
            async def invoke(name,args,token=outer):
                r=await browser.post('/mcp',headers={'Authorization':'Bearer '+token,'Accept':'application/json, text/event-stream'},json={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}})
                assert r.status_code==200, ('mcp',r.status_code)
                return r.json()['result']
            scope={'organization_id':f['org'],'project_id':f['p1']['project_id']}
            context=await invoke('project_get_context',scope)
            assert not context.get('isError'), 'context tool failed'
            data=context['structuredContent']
            assert data['approved_versions'][0]['artifact_version_id']==f['version']
            assert (await invoke('project_get_context',{**scope,'project_id':f['p2']['project_id']})).get('isError')
            checks.append('exact_approved_context_and_foreign_project_denial')
            draft={**scope,'schema_version':1,'card_kind':'engagement_work_item','card_id':f['card'],'request_id':str(uuid4()),'previous_version_id':None,'title':'Broker supplied brief','body':'Synthetic broker acceptance text'}
            first=await invoke('content_create_draft',draft)
            assert not first.get('isError'), 'save failed'
            retry=await invoke('content_create_draft',draft)
            assert retry['structuredContent']==first['structuredContent']
            reopened=await upstream.post(f['origin']+'/rest/v1/rpc/work_content_version',headers=normal,json={'p_org':f['org'],'p_project':f['p1']['project_id'],'p_id':first['structuredContent']['version_id']})
            assert reopened.status_code==200 and reopened.json()['body']==draft['body']
            refreshed=await browser.post('/token',data={'grant_type':'refresh_token','client_id':client,'refresh_token':tokens['refresh_token'],'resource':public+'/mcp'})
            assert refreshed.status_code==200, ('refresh',refreshed.status_code)
            new_tokens=refreshed.json()
            assert new_tokens['refresh_token']!=tokens['refresh_token']
            assert not (await invoke('project_get_context',scope,new_tokens['access_token'])).get('isError')
            reused=await browser.post('/token',data={'grant_type':'refresh_token','client_id':client,'refresh_token':tokens['refresh_token'],'resource':public+'/mcp'})
            assert reused.status_code>=400
            checks.append('refresh_rotates_and_old_refresh_is_denied')
            assert (await invoke('content_create_draft',{**draft,'body':'Changed text'})).get('isError')
            checks.append('draft_save_exact_retry_and_conflict_denial')
            await grant(save=False)
            assert (await invoke('content_create_draft',draft)).get('isError')
            assert not (await invoke('project_get_context',scope)).get('isError')
            await grant(revoke=True)
            assert (await invoke('project_get_context',scope)).get('isError')
            checks.append('read_only_and_revoked_grant_denial_with_cached_broker_token')
            json.dump({'checks':checks,'production_changed':False,'native_chatgpt_acceptance':False},open(sys.argv[2],'w'),indent=2)
            print(json.dumps({'checks':checks,'production_changed':False}))

asyncio.run(main())




