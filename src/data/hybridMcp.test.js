import test from 'node:test'
import assert from 'node:assert/strict'
import {createHybridMcpHandler} from '../../supabase/functions/_shared/hybridMcp.js'

const request=(message,headers={})=>new Request('http://127.0.0.1/mcp',{method:'POST',headers:{accept:'application/json, text/event-stream','content-type':'application/json',...headers},body:JSON.stringify(message)})
const call={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'content_create_draft',arguments:{organization_id:'org',project_id:'project'}}}
test('authentication, origin, protocol and size fail closed before adapter access',async()=>{
  let calls=0
  const handler=createHybridMcpHandler({authenticate:async()=>({client:{},authorize:async()=>{calls++;return false}})})
  assert.equal((await createHybridMcpHandler({authenticate:async()=>null})(request(call))).status,401)
  assert.equal((await handler(request(call,{origin:'https://hostile.example'}))).status,403)
  assert.equal((await handler(request(call,{'mcp-protocol-version':'invalid'}))).status,400)
  assert.equal((await handler(request('x'.repeat(650001)))).status,413)
  assert.equal(calls,0)
})
test('discovery advertises only two tools and live denial blocks every retry',async()=>{
  let calls=0
  const handler=createHybridMcpHandler({authenticate:async()=>({client:{rpc(){throw new Error('Must not run')}},authorize:async()=>{calls++;return false}})})
  const listed=await (await handler(request({jsonrpc:'2.0',id:2,method:'tools/list'}))).json()
  assert.deepEqual(listed.result.tools.map(x=>x.name),['project_get_context','content_create_draft'])
  assert.equal((await (await handler(request(call))).json()).result.isError,true)
  assert.equal((await (await handler(request(call))).json()).result.isError,true)
  assert.equal(calls,2)
  assert.equal((await (await handler(request({...call,params:{name:'seo_research'}}))).json()).error.code,-32602)
})
test('initialize, notifications, malformed batches and unsupported streaming methods',async()=>{
  const handler=createHybridMcpHandler({authenticate:async()=>({client:{},authorize:async()=>false})})
  assert.equal((await (await handler(request({jsonrpc:'2.0',id:3,method:'initialize',params:{protocolVersion:'2025-06-18'}}))).json()).result.protocolVersion,'2025-06-18')
  assert.equal((await handler(request({jsonrpc:'2.0',method:'notifications/initialized'}))).status,202)
  assert.equal((await handler(request([call]))).status,400)
  assert.equal((await handler(new Request('http://127.0.0.1/mcp'))).status,405)
})
