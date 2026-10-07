import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectImportHttpHandler } from '../../supabase/functions/_shared/projectSpreadsheetHttp.ts'
test('production HTTP capability stays closed before client access; body flags cannot enable it',async()=>{
 let calls=0;const handler=createProjectImportHttpHandler({clients:()=>{calls++;throw Error('Client touched')}})
 for(const action of ['targets','reserve_source','finish_source','confirm'])assert.equal((await handler(new Request('http://127.0.0.1/import',{method:'POST',body:JSON.stringify({action,releaseReady:true,enabled:true})}))).status,503)
 assert.equal(calls,0)
})
test('isolated HTTP handler enforces streamed bounds and actual Auth before source access',async()=>{
 let clients=0,authCalls=0
 const handler=createProjectImportHttpHandler({releaseReady:true,clients:()=>{clients++;return {auth:{auth:{getUser:async()=>{authCalls++;return {data:{user:null},error:Error('Invalid synthetic session')}}}},admin:new Proxy({},{get(){throw Error('Forbidden source read')}})}}})
 assert.equal((await handler(new Request('http://127.0.0.1/import',{method:'POST',body:'x'.repeat(131073)}))).status,413);assert.equal(clients,0)
 assert.equal((await handler(new Request('http://127.0.0.1/import',{method:'POST',body:'{}'}))).status,401);assert.equal(clients,0)
 assert.equal((await handler(new Request('http://127.0.0.1/import',{method:'POST',headers:{Authorization:'Bearer invalid-local-test'},body:'{}'}))).status,401)
 assert.equal(authCalls,1)
})
